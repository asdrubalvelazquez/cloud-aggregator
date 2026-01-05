"""
Microsoft OneDrive integration helpers.

Handles OneDrive file listing, token refresh, and storage quota queries
using Microsoft Graph API.
"""

import os
import logging
import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from fastapi import HTTPException

logger = logging.getLogger(__name__)


MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET")
MICROSOFT_REDIRECT_URI = os.getenv("MICROSOFT_REDIRECT_URI")
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"


async def find_duplicate_in_onedrive(
    access_token: str,
    file_name: str,
    file_size: int,
    folder_id: str = "root"
) -> Optional[Dict[str, Any]]:
    """
    Search for duplicate file in OneDrive folder.
    
    Strategy:
    - Uses Graph API search endpoint (more reliable than $filter)
    - Filters results by: same parentReference.id, name, and size
    - OneDrive doesn't expose reliable file hash, so we match by name+size
    - Robust error handling: timeouts, 429 rate limits, network errors
    - NEVER raises: returns None on any error (safe fallback to allow transfer)
    - Pagination: processes only first page (top 200 results) to avoid blocking
    
    Args:
        access_token: OneDrive access token
        file_name: Name of file to search for
        file_size: Size in bytes (for matching)
        folder_id: Target folder ID (default "root")
        
    Returns:
        File metadata if duplicate found, None otherwise (or on error)
        {
            "id": str,
            "name": str,
            "size": int,
            "webUrl": str
        }
    """
    logger.info(f"[DEDUPE] START search: {file_name} (size={file_size}, folder={folder_id})")
    
    try:
        # Proper escaping for OData search query
        # OneDrive search uses single quotes, so escape: ' → ''
        # Special chars like (), [], &, etc. are handled by URL encoding
        escaped_name = file_name.replace("'", "''")
        
        # Use search endpoint (more reliable than $filter on /children)
        # Limit to first 200 results (don't paginate to avoid blocking)
        if folder_id == "root":
            search_url = f"{GRAPH_API_BASE}/me/drive/root/search(q='{escaped_name}')?$top=200"
        else:
            search_url = f"{GRAPH_API_BASE}/me/drive/items/{folder_id}/search(q='{escaped_name}')?$top=200"
        
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # Strict 5s timeout (don't block transfer job)
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
            try:
                response = await client.get(search_url, headers=headers)
            except httpx.TimeoutException:
                logger.warning(f"[DEDUPE] TIMEOUT (5s exceeded) for: {file_name}")
                return None  # Safe fallback: assume no duplicate
            except httpx.NetworkError as e:
                logger.warning(f"[DEDUPE] NETWORK ERROR: {e}")
                return None
            except Exception as e:
                logger.warning(f"[DEDUPE] HTTP REQUEST FAILED: {e}")
                return None
            
            # Handle rate limiting (429)
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "?")
                logger.warning(f"[DEDUPE] RATE LIMITED (429), retry_after={retry_after}s - fallback to copy")
                return None  # Don't wait, assume no duplicate
            
            # Handle auth errors (401, 403)
            if response.status_code in (401, 403):
                logger.error(f"[DEDUPE] AUTH ERROR ({response.status_code}) - fallback to copy")
                return None
            
            # Handle other errors (404, 500, etc.)
            if response.status_code != 200:
                logger.warning(f"[DEDUPE] SEARCH FAILED ({response.status_code}): {response.text[:300]} - fallback to copy")
                return None
            
            data = response.json()
            candidates = data.get("value", [])
            
            # Log pagination info (for debugging)
            next_link = data.get("@odata.nextLink")
            if next_link:
                logger.info(f"[DEDUPE] NOTE: More results exist (pagination ignored), checking first {len(candidates)} items")
            
            if not candidates:
                logger.info(f"[DEDUPE] NO MATCH: {file_name}")
                return None
            
            # Filter candidates by exact name, size, and parent folder
            for candidate in candidates:
                # Match by name (exact, case-sensitive)
                if candidate.get("name") != file_name:
                    continue
                
                # Match by size (exact)
                if candidate.get("size") != file_size:
                    continue
                
                # Match by parent folder
                parent_ref = candidate.get("parentReference", {})
                parent_id = parent_ref.get("id", "")
                
                # For root: check if parent path is /drive/root
                if folder_id == "root":
                    parent_path = parent_ref.get("path", "")
                    if "/drive/root:" not in parent_path and parent_path != "/drive/root":
                        continue
                else:
                    # For specific folder: match parent ID
                    if parent_id != folder_id:
                        continue
                
                # Found exact match
                logger.info(f"[DEDUPE] DUPLICATE FOUND: {file_name} (id={candidate.get('id')}, size={file_size})")
                return {
                    "id": candidate.get("id"),
                    "name": candidate.get("name"),
                    "size": candidate.get("size"),
                    "webUrl": candidate.get("webUrl")
                }
            
            logger.info(f"[DEDUPE] NO EXACT MATCH: {file_name} ({len(candidates)} candidates checked)")
            return None
            
    except httpx.TimeoutException:
        logger.warning(f"[DEDUPE] FALLBACK (outer timeout): {file_name}")
        return None
    except httpx.HTTPError as e:
        logger.warning(f"[DEDUPE] FALLBACK (http error): {e}")
        return None
    except Exception as e:
        logger.exception(f"[DEDUPE] FALLBACK (unexpected error): {e}")
        return None  # NEVER raise, always safe fallback


async def refresh_onedrive_token(refresh_token: str) -> Dict[str, Any]:
    """
    Refresh OneDrive access token using refresh_token.
    
    Args:
        refresh_token: Valid refresh token from cloud_provider_accounts (DECRYPTED)
        
    Returns:
        {
            "access_token": str (plaintext - caller must encrypt before storing),
            "refresh_token": str (plaintext - caller must encrypt before storing),
            "expires_in": int,
            "token_expiry": datetime
        }
        
    Raises:
        HTTPException: If token refresh fails
    """
    if not refresh_token or not refresh_token.strip():
        logger.warning("[ONEDRIVE] Refresh token missing")
        raise HTTPException(
            status_code=401,
            detail={
                "error_code": "MISSING_REFRESH_TOKEN",
                "message": "OneDrive needs reconnect",
                "detail": "No refresh token available"
            }
        )
    
    payload = {
        "client_id": MICROSOFT_CLIENT_ID,
        "client_secret": MICROSOFT_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "redirect_uri": MICROSOFT_REDIRECT_URI,
        "scope": "offline_access Files.ReadWrite.All User.Read"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(MICROSOFT_TOKEN_URL, data=payload, timeout=30.0)
            
            if response.status_code != 200:
                error_data = response.json() if response.text else {}
                error_desc = error_data.get("error_description", error_data.get("error", "Unknown error"))
                logger.error(f"[ONEDRIVE] Token refresh failed: {response.status_code} - {error_desc}")
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error_code": "TOKEN_REFRESH_FAILED",
                        "message": "OneDrive needs reconnect",
                        "detail": error_desc
                    }
                )
            
            data = response.json()
            expires_in = data.get("expires_in", 3600)
            token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)
            
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", refresh_token),  # Microsoft may not return new one
                "expires_in": expires_in,
                "token_expiry": token_expiry
            }
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Microsoft token endpoint",
                "detail": str(e)
            }
        )


async def list_onedrive_files(
    access_token: str,
    parent_id: Optional[str] = None,
    page_size: int = 50
) -> Dict[str, Any]:
    """
    List files and folders in OneDrive using Microsoft Graph API.
    
    Args:
        access_token: Valid OneDrive access token
        parent_id: Parent folder ID. If None, lists root
        page_size: Number of items per page (max 200)
        
    Returns:
        {
            "items": [
                {
                    "id": str,
                    "name": str,
                    "kind": "folder" | "file",
                    "size": int,
                    "mimeType": str | None,
                    "modifiedTime": str (ISO),
                    "webViewLink": str,
                    "parentId": str | None
                }
            ],
            "nextPageToken": str | None
        }
        
    Raises:
        HTTPException: If API call fails
    """
    if page_size > 200:
        page_size = 200
    
    # Build URL: root or specific folder
    if parent_id:
        url = f"{GRAPH_API_BASE}/me/drive/items/{parent_id}/children"
    else:
        url = f"{GRAPH_API_BASE}/me/drive/root/children"
    
    params = {
        "$top": page_size,
        "$select": "id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference"
    }
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, headers=headers, timeout=30.0)
            
            if response.status_code == 401:
                logger.warning(f"[ONEDRIVE] Graph API returned 401 (unauthorized)")
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error_code": "GRAPH_UNAUTHORIZED",
                        "message": "OneDrive needs reconnect",
                        "detail": "Token expired or invalid"
                    }
                )
            
            if response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "error_code": "FOLDER_NOT_FOUND",
                        "message": f"Folder with ID '{parent_id}' not found"
                    }
                )
            
            if response.status_code != 200:
                error_data = response.json() if response.text else {}
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "GRAPH_API_ERROR",
                        "message": "Microsoft Graph API error",
                        "detail": error_data.get("error", {}).get("message", "Unknown error")
                    }
                )
            
            data = response.json()
            items = []
            
            for item in data.get("value", []):
                # Determine kind (folder vs file)
                kind = "folder" if "folder" in item else "file"
                
                # Get parent ID from parentReference
                parent_ref = item.get("parentReference", {})
                parent_item_id = parent_ref.get("id")
                
                # Get MIME type (only for files)
                mime_type = None
                if "file" in item:
                    mime_type = item["file"].get("mimeType")
                
                items.append({
                    "id": item["id"],
                    "name": item["name"],
                    "kind": kind,
                    "size": item.get("size", 0),
                    "mimeType": mime_type,
                    "modifiedTime": item.get("lastModifiedDateTime"),
                    "webViewLink": item.get("webUrl"),
                    "parentId": parent_item_id
                })
            
            # Check for pagination token
            next_page_token = data.get("@odata.nextLink")
            
            return {
                "items": items,
                "nextPageToken": next_page_token
            }
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Microsoft Graph API",
                "detail": str(e)
            }
        )


async def get_onedrive_storage_quota(access_token: str) -> Dict[str, Any]:
    """
    Get OneDrive storage quota information.
    
    Args:
        access_token: Valid OneDrive access token
        
    Returns:
        {
            "total": int (bytes),
            "used": int (bytes),
            "remaining": int (bytes),
            "state": str ("normal" | "nearing" | "critical" | "exceeded")
        }
        
    Raises:
        HTTPException: If API call fails
    """
    url = f"{GRAPH_API_BASE}/me/drive"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=30.0)
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "QUOTA_FETCH_FAILED",
                        "message": "Failed to fetch OneDrive storage quota"
                    }
                )
            
            data = response.json()
            quota = data.get("quota", {})
            
            return {
                "total": quota.get("total", 0),
                "used": quota.get("used", 0),
                "remaining": quota.get("remaining", 0),
                "state": quota.get("state", "normal")
            }
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Microsoft Graph API",
                "detail": str(e)
            }
        )
