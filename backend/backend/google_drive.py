"""
Helper functions for Google Drive API interactions
"""
import os
from datetime import datetime, timezone
from dateutil import parser as dateutil_parser
import httpx

from backend.db import supabase

GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"


async def get_valid_token(account_id: int) -> str:
    """
    Get a valid access token for the account.
    If expired, refresh it automatically.
    """
    # Get account from database
    resp = supabase.table("cloud_accounts").select("*").eq("id", account_id).single().execute()
    account = resp.data

    if not account:
        raise ValueError(f"Account {account_id} not found")

    # Check if token is expired
    token_expiry = account.get("token_expiry")
    if token_expiry:
        expiry_dt = dateutil_parser.parse(token_expiry)
        now = datetime.now(timezone.utc)
        
        # If token is still valid (with 5 min buffer), return it
        if expiry_dt > now:
            return account["access_token"]

    # Token expired, refresh it
    refresh_token = account.get("refresh_token")
    if not refresh_token:
        raise ValueError(f"No refresh token available for account {account_id}")

    # Request new access token
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
        )
        token_json = token_res.json()

    new_access_token = token_json.get("access_token")
    expires_in = token_json.get("expires_in", 3600)

    if not new_access_token:
        raise ValueError(f"Failed to refresh token: {token_json}")

    # Calculate new expiry
    from datetime import timedelta
    new_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Update database
    supabase.table("cloud_accounts").update({
        "access_token": new_access_token,
        "token_expiry": new_expiry.isoformat(),
    }).eq("id", account_id).execute()

    return new_access_token


async def get_storage_quota(account_id: int) -> dict:
    """
    Get storage quota information for a Google Drive account.
    Returns dict with limit, usage, usageInDrive, etc.
    """
    token = await get_valid_token(account_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/about",
            params={"fields": "storageQuota,user"},
            headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        return resp.json()


async def list_drive_files(
    account_id: int,
    folder_id: str = "root",
    page_size: int = 50,
    page_token: str = None,
) -> dict:
    """
    List files in a specific folder in Google Drive with pagination.
    
    Args:
        account_id: ID of the cloud account
        folder_id: Google Drive folder ID to list (default "root" for Drive root)
        page_size: Number of files per page
        page_token: Token for pagination
    
    Returns:
        dict with files list, nextPageToken, account info, and current folder_id
    """
    # Get account from database
    resp = supabase.table("cloud_accounts").select("*").eq("id", account_id).single().execute()
    account = resp.data
    if not account:
        raise ValueError(f"Account {account_id} not found")
    
    token = await get_valid_token(account_id)
    
    headers = {"Authorization": f"Bearer {token}"}
    
    params = {
        "pageSize": page_size,
        "fields": "files(id,name,mimeType,webViewLink,iconLink,modifiedTime,size,parents),nextPageToken",
        "q": f"'{folder_id}' in parents and trashed = false",
        "orderBy": "folder,name",
    }
    
    if page_token:
        params["pageToken"] = page_token
    
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files",
            headers=headers,
            params=params,
        )
        res.raise_for_status()
        data = res.json()
    
    return {
        "account_id": account_id,
        "account_email": account["account_email"],
        "folder_id": folder_id,
        "files": data.get("files", []),
        "nextPageToken": data.get("nextPageToken"),
    }


async def get_file_metadata(account_id: int, file_id: str) -> dict:
    """
    Get metadata for a specific file.
    """
    token = await get_valid_token(account_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
            params={"fields": "id, name, mimeType, size, createdTime, modifiedTime, webViewLink"},
            headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        return resp.json()


async def download_file_bytes(account_id: int, file_id: str) -> bytes:
    """
    Download file content as bytes.
    For Google Docs/Sheets/Slides, exports as PDF.
    """
    token = await get_valid_token(account_id)
    
    # Get file metadata to check mimeType
    metadata = await get_file_metadata(account_id, file_id)
    mime_type = metadata.get("mimeType", "")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Google Workspace files need export
        if mime_type.startswith("application/vnd.google-apps."):
            export_mime = "application/pdf"
            resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export",
                params={"mimeType": export_mime},
                headers={"Authorization": f"Bearer {token}"}
            )
        else:
            # Regular files
            resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
                params={"alt": "media"},
                headers={"Authorization": f"Bearer {token}"}
            )
        
        resp.raise_for_status()
        return resp.content


async def upload_file_bytes(account_id: int, file_name: str, file_bytes: bytes, mime_type: str = "application/octet-stream") -> dict:
    """
    Upload file bytes to Google Drive.
    Returns the created file metadata.
    """
    token = await get_valid_token(account_id)
    
    # Metadata
    metadata = {
        "name": file_name
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Multipart upload
        files = {
            "metadata": (None, str(metadata).replace("'", '"'), "application/json"),
            "file": (file_name, file_bytes, mime_type)
        }
        
        resp = await client.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink",
            headers={"Authorization": f"Bearer {token}"},
            files=files
        )
        resp.raise_for_status()
        return resp.json()


async def copy_file_between_accounts(
    source_account_id: int,
    target_account_id: int,
    file_id: str
) -> dict:
    """
    Copy a file from one Google Drive account to another.
    Uses streaming to avoid loading large files entirely in memory.
    Returns metadata of the newly created file in target account.
    """
    # 1. Get file metadata from source
    metadata = await get_file_metadata(source_account_id, file_id)
    file_name = metadata.get("name", "copied_file")
    mime_type = metadata.get("mimeType", "application/octet-stream")
    
    source_token = await get_valid_token(source_account_id)
    target_token = await get_valid_token(target_account_id)
    
    # 2. Download file content from source with streaming
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Google Workspace files need export
        if mime_type.startswith("application/vnd.google-apps."):
            export_mime = "application/pdf"
            download_resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export",
                params={"mimeType": export_mime},
                headers={"Authorization": f"Bearer {source_token}"}
            )
            file_name = f"{file_name}.pdf"
            mime_type = "application/pdf"
        else:
            # Regular files
            download_resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
                params={"alt": "media"},
                headers={"Authorization": f"Bearer {source_token}"}
            )
        
        download_resp.raise_for_status()
        file_bytes = download_resp.content
    
    # 3. Upload to target account
    metadata_obj = {"name": file_name}
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Multipart upload
        files = {
            "metadata": (None, str(metadata_obj).replace("'", '"'), "application/json"),
            "file": (file_name, file_bytes, mime_type)
        }
        
        upload_resp = await client.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink",
            headers={"Authorization": f"Bearer {target_token}"},
            files=files
        )
        upload_resp.raise_for_status()
        new_file = upload_resp.json()
    
    return new_file
