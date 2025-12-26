"""
Helper functions for Google Drive API interactions
"""
import os
from datetime import datetime, timezone, timedelta
from dateutil import parser as dateutil_parser
import httpx

from backend.db import supabase
from backend.crypto import decrypt_token, encrypt_token

GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"


async def get_valid_token(account_id: int) -> str:
    """
    Get a valid access token for the account.
    If expired, refresh it automatically.
    Raises HTTPException(401) if token is missing or refresh fails.
    """
    import logging
    from fastapi import HTTPException
    
    logger = logging.getLogger(__name__)
    
    # Get account from database
    resp = supabase.table("cloud_accounts").select("*").eq("id", account_id).single().execute()
    account = resp.data

    if not account:
        raise ValueError(f"Account {account_id} not found")

    # SECURITY: Decrypt tokens from storage
    access_token = decrypt_token(account.get("access_token"))
    account_email = account.get("account_email", "unknown")
    
    # CRITICAL: Validate token exists before checking expiry
    if not access_token or not access_token.strip():
        logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has empty access_token")
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Google Drive token missing. Please reconnect your account.",
                "account_email": account_email,
                "needs_reconnect": True
            }
        )

    # Check if token is expired (with 60s buffer to avoid race conditions)
    token_expiry = account.get("token_expiry")
    needs_refresh = False
    
    if token_expiry:
        expiry_dt = dateutil_parser.parse(token_expiry)
        now = datetime.now(timezone.utc)
        buffer = timedelta(seconds=60)
        
        # If token expires in less than 60s, refresh it proactively
        if expiry_dt <= (now + buffer):
            needs_refresh = True
            logger.info(f"[TOKEN REFRESH] account_id={account_id} token expires soon, refreshing")
    else:
        # No expiry info - refresh to be safe
        needs_refresh = True
        logger.warning(f"[TOKEN REFRESH] account_id={account_id} has no token_expiry, refreshing")

    if not needs_refresh:
        return access_token

    # Token expired or missing expiry - refresh it
    # SECURITY: Decrypt refresh_token from storage
    refresh_token = decrypt_token(account.get("refresh_token"))
    if not refresh_token:
        logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has no refresh_token")
        # Mark account as needing reconnection
        supabase.table("cloud_accounts").update({
            "is_active": False,
            "disconnected_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", account_id).execute()
        
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Google Drive refresh token missing. Please reconnect your account.",
                "account_email": account_email,
                "needs_reconnect": True
            }
        )

    # Request new access token
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                }
            )
            
            # Handle refresh errors (invalid_grant, revoked token, etc.)
            if token_res.status_code != 200:
                error_data = token_res.json() if token_res.headers.get("content-type", "").startswith("application/json") else {}
                error_type = error_data.get("error", "unknown")
                
                logger.error(
                    f"[TOKEN REFRESH FAILED] account_id={account_id} email={account_email} "
                    f"status={token_res.status_code} error={error_type}"
                )
                
                # Mark account as needing reconnection
                supabase.table("cloud_accounts").update({
                    "is_active": False,
                    "disconnected_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", account_id).execute()
                
                raise HTTPException(
                    status_code=401,
                    detail={
                        "message": f"Google Drive token expired or revoked. Please reconnect your account. (Error: {error_type})",
                        "account_email": account_email,
                        "needs_reconnect": True,
                        "error_type": error_type
                    }
                )
            
            # Parse JSON response (success case)
            try:
                token_json = token_res.json()
            except Exception as json_err:
                logger.error(f"[TOKEN REFRESH ERROR] account_id={account_id} invalid JSON response: {str(json_err)}")
                raise HTTPException(
                    status_code=503,
                    detail={
                        "message": "Invalid token refresh response",
                        "account_email": account_email
                    }
                )
    except httpx.HTTPError as e:
        logger.error(f"[TOKEN REFRESH ERROR] account_id={account_id} network error: {str(e)}")
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Failed to refresh Google Drive token. Network error.",
                "account_email": account_email
            }
        )

    new_access_token = token_json.get("access_token")
    expires_in = token_json.get("expires_in", 3600)

    if not new_access_token:
        logger.error(f"[TOKEN REFRESH FAILED] account_id={account_id} no access_token in response")
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Google Drive token refresh failed. Please reconnect your account.",
                "account_email": account_email,
                "needs_reconnect": True
            }
        )

    # Calculate new expiry
    new_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Update database with new token and expiry
    # SECURITY: Encrypt token before storage
    supabase.table("cloud_accounts").update({
        "access_token": encrypt_token(new_access_token),
        "token_expiry": new_expiry.isoformat(),
        "is_active": True,  # Reactivate if was marked inactive
    }).eq("id", account_id).execute()

    logger.info(f"[TOKEN REFRESH SUCCESS] account_id={account_id} new_expiry={new_expiry.isoformat()}")
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
