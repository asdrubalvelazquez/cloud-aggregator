"""
Dropbox API helper functions for Cloud Aggregator
"""
import os
import httpx
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from fastapi import HTTPException

# Dropbox API endpoints
DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize"
DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
DROPBOX_API_BASE = "https://api.dropboxapi.com/2"

# OAuth credentials
DROPBOX_CLIENT_ID = os.getenv("DROPBOX_CLIENT_ID")
DROPBOX_CLIENT_SECRET = os.getenv("DROPBOX_CLIENT_SECRET")
DROPBOX_REDIRECT_URI = os.getenv("DROPBOX_REDIRECT_URI")

logger = logging.getLogger(__name__)


async def get_dropbox_storage_quota(access_token: str) -> Dict[str, Any]:
    """
    Get Dropbox storage quota information.
    
    Args:
        access_token: Valid Dropbox access token
        
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
    url = f"{DROPBOX_API_BASE}/users/get_space_usage"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, timeout=30.0)
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error_code": "DROPBOX_UNAUTHORIZED",
                        "message": "Dropbox access token expired or invalid"
                    }
                )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "QUOTA_FETCH_FAILED",
                        "message": "Failed to fetch Dropbox storage quota"
                    }
                )
            
            data = response.json()
            
            # Dropbox returns allocation which can be individual or team
            allocation = data.get("allocation", {})
            
            # Get allocated space (total)
            if ".tag" in allocation:
                if allocation[".tag"] == "individual":
                    total = allocation.get("allocated", 0)
                elif allocation[".tag"] == "team":
                    total = allocation.get("allocated", 0)
                else:
                    total = 0
            else:
                total = 0
            
            # Get used space
            used = data.get("used", 0)
            remaining = total - used if total > 0 else 0
            
            # Determine state
            if total > 0:
                usage_percent = (used / total) * 100
                if usage_percent >= 95:
                    state = "exceeded" if used >= total else "critical"
                elif usage_percent >= 80:
                    state = "nearing"
                else:
                    state = "normal"
            else:
                state = "normal"
            
            return {
                "total": total,
                "used": used,
                "remaining": remaining,
                "state": state
            }
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Dropbox API",
                "detail": str(e)
            }
        )


async def refresh_dropbox_token(refresh_token: str) -> Dict[str, str]:
    """
    Refresh Dropbox access token using refresh token.
    
    Args:
        refresh_token: Valid Dropbox refresh token
        
    Returns:
        {
            "access_token": str,
            "refresh_token": str (may be same or new),
            "expires_in": int (seconds)
        }
        
    Raises:
        HTTPException: If token refresh fails
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                DROPBOX_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": DROPBOX_CLIENT_ID,
                    "client_secret": DROPBOX_CLIENT_SECRET
                },
                timeout=30.0
            )
            
            if response.status_code != 200:
                error_data = response.json() if response.headers.get("content-type") == "application/json" else {}
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "TOKEN_REFRESH_FAILED",
                        "message": "Failed to refresh Dropbox token",
                        "detail": error_data.get("error_description", str(response.text))
                    }
                )
            
            tokens = response.json()
            
            return {
                "access_token": tokens["access_token"],
                "refresh_token": tokens.get("refresh_token", refresh_token),  # Dropbox may not return new refresh token
                "expires_in": tokens.get("expires_in", 14400)  # Default 4 hours
            }
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Dropbox token endpoint",
                "detail": str(e)
            }
        )


async def get_dropbox_account_info(access_token: str) -> Dict[str, Any]:
    """
    Get Dropbox account information (email, name, account_id).
    
    Args:
        access_token: Valid Dropbox access token
        
    Returns:
        {
            "account_id": str,
            "email": str,
            "name": {
                "given_name": str,
                "surname": str,
                "display_name": str
            }
        }
        
    Raises:
        HTTPException: If API call fails
    """
    url = f"{DROPBOX_API_BASE}/users/get_current_account"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, timeout=30.0)
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error_code": "DROPBOX_UNAUTHORIZED",
                        "message": "Dropbox access token expired or invalid"
                    }
                )
            
            if response.status_code != 200:
                error_text = response.text
                logger.error(f"[DROPBOX_ACCOUNT_INFO] Failed with status {response.status_code}: {error_text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "ACCOUNT_INFO_FAILED",
                        "message": "Failed to fetch Dropbox account info",
                        "detail": error_text
                    }
                )
            
            data = response.json()
            
            return {
                "account_id": data.get("account_id"),
                "email": data.get("email"),
                "name": data.get("name", {})
            }
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Dropbox API",
                "detail": str(e)
            }
        )


async def list_dropbox_files(
    access_token: str,
    path: str = "",
    limit: int = 100
) -> Dict[str, Any]:
    """
    List files in Dropbox folder.
    
    Args:
        access_token: Valid Dropbox access token
        path: Folder path (empty string for root)
        limit: Max number of entries to return
        
    Returns:
        {
            "entries": [
                {
                    ".tag": "file" | "folder",
                    "name": str,
                    "path_display": str,
                    "id": str,
                    "size": int (for files),
                    "client_modified": str (for files)
                }
            ],
            "cursor": str (for pagination),
            "has_more": bool
        }
        
    Raises:
        HTTPException: If API call fails
    """
    url = f"{DROPBOX_API_BASE}/files/list_folder"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "path": path or "",
        "limit": min(limit, 2000),  # Dropbox max is 2000
        "include_deleted": False,
        "include_has_explicit_shared_members": False,
        "include_mounted_folders": True
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload, timeout=30.0)
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error_code": "DROPBOX_UNAUTHORIZED",
                        "message": "Dropbox access token expired or invalid"
                    }
                )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "error_code": "LIST_FILES_FAILED",
                        "message": "Failed to list Dropbox files"
                    }
                )
            
            return response.json()
            
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "NETWORK_ERROR",
                "message": "Failed to connect to Dropbox API",
                "detail": str(e)
            }
        )
