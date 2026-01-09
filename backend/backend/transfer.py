"""
Cross-provider transfer system (Google Drive ↔ OneDrive)
Handles file transfers between different cloud providers with progress tracking
"""

import logging
import httpx
import asyncio
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from fastapi import HTTPException
from supabase import Client


class TransferCancelled(Exception):
    """Raised when a transfer is cancelled by the user"""
    pass

logger = logging.getLogger(__name__)

# OneDrive upload chunk size (MUST be multiple of 327680 for optimal performance)
# Recommended: 327680 * 32 = 10485760 bytes (~10MB)
ONEDRIVE_CHUNK_SIZE = 327680 * 32  # 10485760 bytes


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
    # Create job in pending state (will be updated to queued/blocked by prepare)
    job_data = {
        "user_id": user_id,
        "source_provider": source_provider,
        "source_account_id": source_account_id,
        "target_provider": target_provider,
        "target_account_id": target_account_id,
        "target_folder_id": target_folder_id,
        "status": "pending",  # pending → prepare → queued/blocked
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
            "items": [...],
            "total_items": int,
            "completed_items": int,
            "failed_items": int,
            "transferred_bytes": int,
            "total_bytes": int
        }
    """
    # Get job
    job_result = supabase.table("transfer_jobs").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
    
    if not job_result.data:
        raise HTTPException(status_code=404, detail="Transfer job not found")
    
    job_data = job_result.data
    
    # Get items
    items_result = supabase.table("transfer_job_items").select("*").eq("job_id", job_id).order("created_at").execute()
    items = items_result.data or []
    
    # Calculate summary from items (or fallback to job fields)
    if items:
        completed_count = sum(1 for item in items if item.get("status") in ["completed", "success", "done"])
        failed_count = sum(1 for item in items if item.get("status") in ["failed", "error"])
        skipped_count = sum(1 for item in items if item.get("status") == "skipped")
        total_count = len(items)
        transferred_bytes = sum(item.get("bytes_transferred", 0) or 0 for item in items)
        total_bytes = sum(item.get("size_bytes", 0) or 0 for item in items)
    else:
        # Fallback to job fields if no items yet
        completed_count = job_data.get("completed_items", 0) or 0
        failed_count = job_data.get("failed_items", 0) or 0
        skipped_count = 0
        total_count = job_data.get("total_items", 0) or 0
        transferred_bytes = job_data.get("transferred_bytes", 0) or 0
        total_bytes = job_data.get("total_bytes", 0) or 0
    
    # Calculate progress percentage (None if no total, clamped 0-100)
    if total_bytes > 0:
        progress = max(0, min(100, int((transferred_bytes / total_bytes) * 100)))
    else:
        progress = None
    
    return {
        "job": job_data,
        "items": items,
        "total_items": int(total_count),
        "completed_items": int(completed_count),
        "failed_items": int(failed_count),
        "skipped_items": int(skipped_count),
        "transferred_bytes": int(transferred_bytes),
        "total_bytes": int(total_bytes),
        "progress": progress,
    }


async def update_job_status(
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
    """
    update_data = {
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
    supabase: Client,
    item_id: str,
    status: str,
    error_message: Optional[str] = None,
    target_item_id: Optional[str] = None,
    target_web_url: Optional[str] = None,
    bytes_transferred: Optional[int] = None
) -> None:
    """
    Update transfer job item status.
    
    Args:
        supabase: Supabase client
        item_id: Transfer job item UUID
        status: New status ('queued', 'running', 'done', 'failed', 'skipped')
        error_message: Error message if failed (or reason if skipped)
        target_item_id: Target item ID if transferred successfully
        target_web_url: OneDrive web URL for "View in OneDrive" button
        bytes_transferred: Bytes transferred (for progress tracking)
    """
    update_data = {
        "status": status
    }
    
    if error_message:
        update_data["error_message"] = error_message
    if target_item_id:
        update_data["target_item_id"] = target_item_id
    if target_web_url:
        update_data["target_web_url"] = target_web_url
    if bytes_transferred is not None:
        update_data["bytes_transferred"] = bytes_transferred
    
    if status == "running":
        update_data["started_at"] = datetime.now(timezone.utc).isoformat()
    elif status in ("done", "failed", "skipped"):
        # Defensive: check if started_at exists to avoid constraint violation
        has_started = False
        try:
            current_item = supabase.table("transfer_job_items").select("started_at").eq("id", item_id).single().execute()
            has_started = bool(current_item.data and current_item.data.get("started_at"))
        except Exception:
            # If fetch fails, assume no started_at and set it
            has_started = False
        
        if not has_started:
            # Set started_at to satisfy constraint: completed_at requires started_at
            update_data["started_at"] = datetime.now(timezone.utc).isoformat()
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    supabase.table("transfer_job_items").update(update_data).eq("id", item_id).execute()


async def upload_to_onedrive_chunked(
    access_token: str,
    file_name: str,
    file_data: bytes,
    folder_path: str = "root",
    job_id: Optional[str] = None,
    supabase_client: Optional[Client] = None
) -> Dict[str, Any]:
    """
    Upload file to OneDrive using chunked upload session.
    Required for files >4MB or when progress tracking is needed.
    
    Args:
        access_token: OneDrive access token
        file_name: Target file name
        file_data: File content as bytes
        folder_path: Target folder (default "root")
        job_id: Transfer job ID for cancel checks (optional)
        supabase_client: Supabase client for cancel checks (optional)
        
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
        last_cancel_check_at = 0.0
        offset = 0
        while offset < file_size:
            # Throttle cancel checks to avoid hammering Supabase (every 2 seconds)
            now = time.time()
            if job_id and supabase_client and (now - last_cancel_check_at >= 2.0):
                last_cancel_check_at = now
                job_row = (
                    supabase_client.table("transfer_jobs")
                    .select("status")
                    .eq("id", job_id)
                    .single()
                    .execute()
                )
                if job_row.data and job_row.data.get("status") == "cancelled":
                    raise TransferCancelled("cancelled by user")
            
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
        
        item_id = final_response.get("id")
        web_url = final_response.get("webUrl")
        
        # If webUrl not in response, fetch it explicitly
        if item_id and not web_url:
            try:
                get_item_url = f"{GRAPH_API_BASE}/me/drive/items/{item_id}"
                get_response = await client.get(
                    get_item_url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"$select": "webUrl,name,size"}
                )
                if get_response.status_code == 200:
                    item_data = get_response.json()
                    web_url = item_data.get("webUrl")
                    logger.info(f"[ONEDRIVE_UPLOAD] Fetched webUrl: {web_url}")
            except Exception as e:
                logger.warning(f"[ONEDRIVE_UPLOAD] Failed to fetch webUrl: {e}")
        
        return {
            "id": item_id,
            "name": final_response.get("name"),
            "size": final_response.get("size", file_size),
            "webUrl": web_url
        }
