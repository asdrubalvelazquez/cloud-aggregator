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
    target_provider: str,
    target_account_id: str,
    target_folder_id: str = "root",
    total_items: int = 0,
    total_bytes: int = 0
) -> str:
    """
    Create a new cross-provider transfer job.
    
    Args:
        supabase: Supabase client
        user_id: User UUID
        source_provider: "google_drive" | "onedrive" | "dropbox"
        source_account_id: Source account ID (str to support both INT and UUID)
        target_provider: Target provider
        target_account_id: Target account ID
        target_folder_id: Target folder (default "root")
        total_items: Total number of items to transfer
        total_bytes: Total bytes to transfer
        
    Returns:
        job_id (UUID as string)
    """
    # Create job
    job_data = {
        "user_id": user_id,
        "source_provider": source_provider,
        "source_account_id": source_account_id,
        "target_provider": target_provider,
        "target_account_id": target_account_id,
        "target_folder_id": target_folder_id,
        "status": "queued",
        "total_items": total_items,
        "completed_items": 0,
        "failed_items": 0,
        "total_bytes": total_bytes,
        "transferred_bytes": 0
    }
    
    logger.info(f"[TRANSFER] Creating job: user_id={user_id}, source={source_provider}, target={target_provider}, total_items={total_items}, total_bytes={total_bytes}")
    
    job_result = supabase.table("transfer_jobs").insert(job_data).execute()
    job_id = job_result.data[0]["id"]
    
    logger.info(f"[TRANSFER] Created job {job_id} with {total_items} items ({total_bytes} bytes)")
    
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
        items: List of dicts with keys: source_item_id, file_name (or source_name), size_bytes
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
    job_id: str,
    supabase: Client,
    job_id: str,
    status: Optional[str] = None,
    increment_completed: bool = False,
    increment_failed: bool = False,
    add_transferred_bytes: int = 0,
    started_at: bool = False,
    completed_at: bool = False
) -> None:
    """
    Update transfer job status and counters.
    
    Args:
        supabase: Supabase client
        job_id: Transfer job UUID
        status: New status ('queued', 'running', 'done', 'failed', 'partial')
        increment_completed: Increment completed_items by 1
        increment_failed: Increment failed_items by 1
        add_transferred_bytes: Add bytes to transferred_bytes
        started_at: Set started_at to now
        completed_at: Set completed_at to now
    """update_data = {
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    if status:
        update_data["status"] = status
    
    # Handle incremental counters (need to fetch current values)
    if increment_completed or increment_failed or add_transferred_bytes > 0:
        current_job = supabase.table("transfer_jobs").select("completed_items,failed_items,transferred_bytes").eq("id", job_id).single().execute()
        if current_job.data:
            if increment_completed:
                update_data["completed_items"] = current_job.data.get("completed_items", 0) + 1
            if increment_failed:
                update_data["failed_items"] = current_job.data.get("failed_items", 0) + 1
            if add_transferred_bytes > 0:
                update_data["transferred_bytes"] = current_job.data.get("transferred_bytes", 0) + add_transferred_bytes
    
    if started_at:
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    if completed_at:
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    supabase.table("transfer_jobs").update(update_data).eq("id", job_id).execute()
    logger.info(f"[TRANSFER] Updated job {job_id}: {update_data}")


async def update_item_status(
    item_id: str,
    supabase: Client,
    item_id: str,
    status: str,
    error_message: Optional[str] = None,
    target_item_id: Optional[str] = None
) -> None:
    """
    Update transfer job item status.
    
    Args:
        supabase: Supabase client
        item_id: Transfer job item UUID
        status: New status ('queued', 'running', 'done', 'failed')
        error_message: Error message if failed
        target_item_id: Target item ID if transferred successfully
    """update_data = {
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
