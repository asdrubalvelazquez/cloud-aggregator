"""
Cross-provider transfer system (Google Drive ↔ OneDrive)
Handles file transfers between different cloud providers with progress tracking
"""

import logging
import httpx
import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from fastapi import HTTPException
from supabase import Client

logger = logging.getLogger(__name__)

# OneDrive upload chunk size (recommended: 5-10MB for optimal performance)
ONEDRIVE_CHUNK_SIZE = 10 * 1024 * 1024  # 10MB


async def create_transfer_job(
    supabase: Client,
    user_id: str,
    source_provider: str,
    source_account_id: str,
    source_file_ids: List[str],
    target_provider: str,
    target_account_id: str,
    target_folder_id: str = "root"
) -> str:
    """
    Create a new cross-provider transfer job.
    
    Args:
        supabase: Supabase client
        user_id: User UUID
        source_provider: "google_drive" | "onedrive" | "dropbox"
        source_account_id: Source account ID (str to support both INT and UUID)
        source_file_ids: List of file IDs to transfer
        target_provider: Target provider
        target_account_id: Target account ID
        target_folder_id: Target folder (default "root")
        
    Returns:
        job_id (UUID as string)
    """
    if not source_file_ids:
        raise HTTPException(status_code=400, detail="source_file_ids cannot be empty")
    
    # Create job
    job_data = {
        "user_id": user_id,
        "source_provider": source_provider,
        "source_account_id": source_account_id,
        "target_provider": target_provider,
        "target_account_id": target_account_id,
        "target_folder_id": target_folder_id,
        "status": "queued",
        "total_items": len(source_file_ids),
        "completed_items": 0,
        "failed_items": 0,
        "total_bytes": 0,
        "transferred_bytes": 0
    }
    
    job_result = supabase.table("transfer_jobs").insert(job_data).execute()
    job_id = job_result.data[0]["id"]
    
    logger.info(f"[TRANSFER] Created job {job_id} with {len(source_file_ids)} items")
    
    return job_id


async def create_transfer_job_items(
    supabase: Client,
    job_id: str,
    items: List[Dict[str, Any]]
) -> None:
    """
    Create transfer job items in batch.
    
    Args:
        supabase: Supabase client
        job_id: Transfer job UUID
        items: List of dicts with keys: source_item_id, source_name, size_bytes
    """
    if not items:
        return
    
    item_records = []
    for item in items:
        item_records.append({
            "job_id": job_id,
            "source_item_id": item["source_item_id"],
            "source_name": item.get("source_name", "unknown"),
            "size_bytes": item.get("size_bytes", 0),
            "status": "queued"
        })
    
    supabase.table("transfer_job_items").insert(item_records).execute()
    logger.info(f"[TRANSFER] Created {len(item_records)} items for job {job_id}")


async def get_transfer_job_status(supabase: Client, job_id: str, user_id: str) -> Dict:
    """
    Get transfer job status with items.
    
    Args:
        supabase: Supabase client
        job_id: Transfer job UUID
        user_id: User UUID (for security)
        
    Returns:
        {
            "job": {...},
            "items": [...]
        }
    """
    # Get job
    job_result = supabase.table("transfer_jobs").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
    
    if not job_result.data:
        raise HTTPException(status_code=404, detail="Transfer job not found")
    
    # Get items
    items_result = supabase.table("transfer_job_items").select("*").eq("job_id", job_id).order("created_at").execute()
    
    return {
        "job": job_result.data,
        "items": items_result.data or []
    }


async def update_job_status(
    supabase: Client,
    job_id: str,
    status: str,
    completed_items: Optional[int] = None,
    failed_items: Optional[int] = None,
    transferred_bytes: Optional[int] = None
) -> None:
    """Update transfer job status and counters."""
    update_data = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    if completed_items is not None:
        update_data["completed_items"] = completed_items
    if failed_items is not None:
        update_data["failed_items"] = failed_items
    if transferred_bytes is not None:
        update_data["transferred_bytes"] = transferred_bytes
    
    if status == "running" and "started_at" not in update_data:
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    elif status in ("done", "failed", "partial"):
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    supabase.table("transfer_jobs").update(update_data).eq("id", job_id).execute()


async def update_item_status(
    supabase: Client,
    item_id: str,
    status: str,
    error_message: Optional[str] = None,
    target_item_id: Optional[str] = None
) -> None:
    """Update transfer job item status."""
    update_data = {
        "status": status
    }
    
    if error_message:
        update_data["error_message"] = error_message
    if target_item_id:
        update_data["target_item_id"] = target_item_id
    
    if status == "running":
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    elif status in ("done", "failed"):
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    supabase.table("transfer_job_items").update(update_data).eq("id", item_id).execute()


async def upload_to_onedrive_chunked(
    access_token: str,
    file_name: str,
    file_data: bytes,
    folder_path: str = "root"
) -> Dict[str, Any]:
    """
    Upload file to OneDrive using chunked upload session.
    Required for files >4MB or when progress tracking is needed.
    
    Args:
        access_token: OneDrive access token
        file_name: Target file name
        file_data: File content as bytes
        folder_path: Target folder (default "root")
        
    Returns:
        {
            "id": "item_id",
            "name": "filename",
            "size": 12345
        }
    """
    from backend.onedrive import GRAPH_API_BASE
    
    file_size = len(file_data)
    
    # Step 1: Create upload session
    if folder_path == "root":
        create_url = f"{GRAPH_API_BASE}/me/drive/root:/{file_name}:/createUploadSession"
    else:
        create_url = f"{GRAPH_API_BASE}/me/drive/items/{folder_path}:/{file_name}:/createUploadSession"
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    session_payload = {
        "item": {
            "@microsoft.graph.conflictBehavior": "rename",
            "name": file_name
        }
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Create session
        response = await client.post(create_url, headers=headers, json=session_payload)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to create upload session: {response.text}"
            )
        
        session_data = response.json()
        upload_url = session_data["uploadUrl"]
        
        # Step 2: Upload chunks
        offset = 0
        while offset < file_size:
            chunk_end = min(offset + ONEDRIVE_CHUNK_SIZE, file_size)
            chunk = file_data[offset:chunk_end]
            
            chunk_headers = {
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{chunk_end - 1}/{file_size}"
            }
            
            chunk_response = await client.put(upload_url, headers=chunk_headers, content=chunk)
            
            if chunk_response.status_code not in (200, 201, 202):
                raise HTTPException(
                    status_code=chunk_response.status_code,
                    detail=f"Failed to upload chunk: {chunk_response.text}"
                )
            
            offset = chunk_end
            logger.info(f"[ONEDRIVE_UPLOAD] Uploaded {offset}/{file_size} bytes ({(offset/file_size*100):.1f}%)")
        
        # Step 3: Get final result
        final_response = chunk_response.json()
        
        return {
            "id": final_response.get("id"),
            "name": final_response.get("name"),
            "size": final_response.get("size", file_size)
        }
