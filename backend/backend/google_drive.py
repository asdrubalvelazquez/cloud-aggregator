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
    Includes md5Checksum if available for duplicate detection.
    """
    token = await get_valid_token(account_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
            params={"fields": "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, md5Checksum"},
            headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        return resp.json()


async def find_duplicate_file(
    account_id: int,
    file_name: str,
    mime_type: str,
    md5_checksum: str = None,
    folder_id: str = "root"
) -> dict | None:
    """
    Search for duplicate file in target account.
    
    Strategy:
    - For binary files with md5Checksum: match by name AND md5
    - For Google Docs/Sheets/Slides (no md5): match by name AND mimeType
    
    Args:
        account_id: Target account to search in
        file_name: Name of file to search for
        mime_type: MIME type of the file
        md5_checksum: MD5 checksum if available (for binary files)
        folder_id: Folder to search in (default: root)
    
    Returns:
        File metadata if duplicate found, None otherwise
    """
    token = await get_valid_token(account_id)
    
    # Escape single quotes in filename for query
    escaped_name = file_name.replace("'", "\\'")
    
    # Build query to find files with same name in target folder
    query = f"name = '{escaped_name}' and '{folder_id}' in parents and trashed = false"
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files",
            params={
                "q": query,
                "fields": "files(id, name, mimeType, md5Checksum)",
                "pageSize": 10  # Should be enough to find duplicates
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        resp.raise_for_status()
        data = resp.json()
    
    files = data.get("files", [])
    if not files:
        return None
    
    # Check each candidate for true duplicate
    for candidate in files:
        # For binary files with md5: must match both name and checksum
        if md5_checksum and candidate.get("md5Checksum"):
            if candidate["md5Checksum"] == md5_checksum:
                return candidate
        
        # For Google Workspace files (no md5): match by name and mimeType
        elif mime_type.startswith("application/vnd.google-apps.") and candidate["mimeType"] == mime_type:
            return candidate
    
    return None


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
    import logging
    logger = logging.getLogger(__name__)
    
    # 1. Get file metadata from source
    metadata = await get_file_metadata(source_account_id, file_id)
    file_name = metadata.get("name", "copied_file")
    mime_type = metadata.get("mimeType", "application/octet-stream")
    
    logger.info(
        f"[DRIVE COPY] Starting copy: source_account={source_account_id} "
        f"target_account={target_account_id} file={file_name} mime={mime_type}"
    )
    
    source_token = await get_valid_token(source_account_id)
    target_token = await get_valid_token(target_account_id)
    
    # 2. Download file content from source with streaming
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Google Workspace files need export
        if mime_type.startswith("application/vnd.google-apps."):
            export_mime = "application/pdf"
            logger.info(f"[DRIVE COPY] Exporting Google Workspace file: {file_name} as {export_mime}")
            download_resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export",
                params={"mimeType": export_mime},
                headers={"Authorization": f"Bearer {source_token}"}
            )
            file_name = f"{file_name}.pdf"
            mime_type = "application/pdf"
        else:
            # Regular files
            logger.info(f"[DRIVE COPY] Downloading regular file: {file_name}")
            download_resp = await client.get(
                f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
                params={"alt": "media"},
                headers={"Authorization": f"Bearer {source_token}"}
            )
        
        download_resp.raise_for_status()
        file_bytes = download_resp.content
        logger.info(f"[DRIVE COPY] Downloaded {len(file_bytes)} bytes from source")
    
    # 3. Upload to target account
    metadata_obj = {"name": file_name}
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Multipart upload
        logger.info(f"[DRIVE COPY] Uploading {len(file_bytes)} bytes to target account")
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
    
    logger.info(f"[DRIVE COPY] Upload complete: new_file_id={new_file.get('id')}")
    return new_file


async def rename_file(account_id: int, file_id: str, new_name: str) -> dict:
    """
    Rename a file in Google Drive.
    
    Args:
        account_id: Account owning the file
        file_id: File to rename
        new_name: New name for the file
    
    Returns:
        Updated file metadata
    """
    token = await get_valid_token(account_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.patch(
            f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
            json={"name": new_name},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        resp.raise_for_status()
        return resp.json()


async def download_file_stream(account_id: int, file_id: str):
    """
    Download file with streaming support.
    Returns tuple of (content_iterator, filename, mime_type).
    For Google Workspace files, exports as appropriate format.
    """
    token = await get_valid_token(account_id)
    
    # Get file metadata
    metadata = await get_file_metadata(account_id, file_id)
    file_name = metadata.get("name", "download")
    mime_type = metadata.get("mimeType", "application/octet-stream")
    
    # Determine if it's a Google Workspace file
    is_google_doc = mime_type.startswith("application/vnd.google-apps.")
    
    if is_google_doc:
        # Export mapping for Google Workspace files
        export_formats = {
            "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
            "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
            "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
            "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
            "application/vnd.google-apps.form": ("application/zip", ".zip"),
        }
        
        export_mime, extension = export_formats.get(mime_type, ("application/pdf", ".pdf"))
        
        # Add extension if not present
        if not file_name.endswith(extension):
            file_name = f"{file_name}{extension}"
        
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export"
        params = {"mimeType": export_mime, "supportsAllDrives": "true"}
        mime_type = export_mime
    else:
        # Regular file download
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}"
        params = {"alt": "media", "supportsAllDrives": "true"}
    
    return (url, params, token, file_name, mime_type)
