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
    Refresh OneDrive access token using refresh_token with retry logic.
    
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
        HTTPException: If token refresh fails after all retries
        
    Retry strategy:
        - 3 attempts with exponential backoff (1s, 2s, 4s)
        - Permanent errors (invalid_grant, interaction_required) fail immediately
        - Transient errors (network, 5xx) are retried
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
    
    # Helper: Determine if Microsoft error is permanent
    def is_permanent_error(error_code: str) -> bool:
        """
        Classify Microsoft OAuth errors as permanent vs transient.
        
        Permanent (user must reconnect):
        - invalid_grant: refresh token expired/revoked
        - interaction_required: user consent required (MFA, policy change)
        - invalid_client: OAuth app misconfigured
        - unauthorized_client: App not authorized for tenant
        
        Transient (retry eligible):
        - Network errors, timeouts
        - 5xx server errors
        - Rate limiting (429)
        
        Ref: https://learn.microsoft.com/en-us/azure/active-directory/develop/reference-aadsts-error-codes
        """
        permanent_codes = [
            "invalid_grant",
            "interaction_required",
            "invalid_client",
            "unauthorized_client"
        ]
        return error_code.lower() in permanent_codes
    
    payload = {
        "client_id": MICROSOFT_CLIENT_ID,
        "client_secret": MICROSOFT_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "redirect_uri": MICROSOFT_REDIRECT_URI,
        "scope": "offline_access Files.ReadWrite.All User.Read"
    }
    
    max_attempts = 3
    backoff_delays = [1.0, 2.0, 4.0]
    last_error_detail = "Unknown error"
    
    for attempt in range(1, max_attempts + 1):
        try:
            logger.info(f"[ONEDRIVE_RETRY] attempt={attempt}/{max_attempts}")
            
            async with httpx.AsyncClient() as client:
                response = await client.post(MICROSOFT_TOKEN_URL, data=payload, timeout=30.0)
                
                if response.status_code != 200:
                    error_data = response.json() if response.text else {}
                    error_code = error_data.get("error", "unknown")
                    error_desc = error_data.get("error_description", error_code)
                    last_error_detail = error_desc
                    
                    # Check if error is permanent
                    if is_permanent_error(error_code):
                        logger.error(
                            f"[ONEDRIVE_RETRY] PERMANENT ERROR attempt={attempt}/{max_attempts} "
                            f"status={response.status_code} error={error_code}"
                        )
                        raise HTTPException(
                            status_code=401,
                            detail={
                                "error_code": "TOKEN_REFRESH_FAILED_PERMANENT",
                                "message": "OneDrive needs reconnect",
                                "detail": error_desc,
                                "error": error_code
                            }
                        )
                    
                    # Transient error - log and retry
                    logger.warning(
                        f"[ONEDRIVE_RETRY] TRANSIENT ERROR attempt={attempt}/{max_attempts} "
                        f"status={response.status_code} error={error_code}"
                    )
                    
                    if attempt < max_attempts:
                        import asyncio
                        delay = backoff_delays[attempt - 1]
                        logger.info(f"[ONEDRIVE_RETRY] Waiting {delay}s before retry...")
                        await asyncio.sleep(delay)
                        continue
                    else:
                        # All attempts exhausted
                        logger.error(
                            f"[ONEDRIVE_RETRY] ALL ATTEMPTS FAILED "
                            f"final_status={response.status_code} final_error={error_code}"
                        )
                        raise HTTPException(
                            status_code=401,
                            detail={
                                "error_code": "TOKEN_REFRESH_FAILED",
                                "message": f"OneDrive token refresh failed after {max_attempts} attempts",
                                "detail": error_desc,
                                "error": error_code
                            }
                        )
                
                # SUCCESS - parse response
                data = response.json()
                expires_in = data.get("expires_in", 3600)
                token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)
                
                logger.info(f"[ONEDRIVE_RETRY] SUCCESS attempt={attempt}/{max_attempts}")
                
                return {
                    "access_token": data["access_token"],
                    "refresh_token": data.get("refresh_token", refresh_token),  # Microsoft may not return new one
                    "expires_in": expires_in,
                    "token_expiry": token_expiry
                }
                
        except httpx.RequestError as e:
            # Network errors - retryable
            logger.warning(f"[ONEDRIVE_RETRY] NETWORK ERROR attempt={attempt}/{max_attempts}: {e}")
            last_error_detail = str(e)
            
            if attempt < max_attempts:
                import asyncio
                delay = backoff_delays[attempt - 1]
                logger.info(f"[ONEDRIVE_RETRY] Waiting {delay}s before retry...")
                await asyncio.sleep(delay)
                continue
            else:
                # All network attempts failed
                logger.error(f"[ONEDRIVE_RETRY] NETWORK FAILURE after {max_attempts} attempts")
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error_code": "NETWORK_ERROR",
                        "message": f"Failed to connect to Microsoft after {max_attempts} attempts",
                        "detail": last_error_detail
                    }
                )
    
    # Should never reach here
    raise HTTPException(
        status_code=503,
        detail={
            "error_code": "UNEXPECTED_ERROR",
            "message": "Token refresh failed unexpectedly",
            "detail": last_error_detail
        }
    )


async def try_refresh_onedrive_token(provider_account: dict) -> dict:
    """
    Intenta refrescar tokens de OneDrive silenciosamente (sin excepciones).
    MultCloud-style: preserva conectividad cuando token expira normalmente.
    
    Args:
        provider_account: Row de cloud_provider_accounts (con tokens encrypted)
    
    Returns:
        {
            "success": bool,
            "error_type": str | None,  # "no_refresh_token", "invalid_grant", "interaction_required", "invalid_client", "transient_error", etc.
            "updated_account": dict  # provider_account actualizado (tokens ENCRYPTED, no decrypted)
        }
    
    NEVER raises exceptions - siempre retorna estructura de respuesta.
    """
    from backend.db import supabase
    from backend.crypto import decrypt_token, encrypt_token
    
    account_id = provider_account.get("id")
    
    # Caso 1: No existe refresh_token
    encrypted_refresh_token = provider_account.get("refresh_token")
    if not encrypted_refresh_token:
        logger.warning(f"[ONEDRIVE_REFRESH] No refresh_token available for account_id={account_id}")
        return {
            "success": False,
            "error_type": "no_refresh_token",
            "updated_account": provider_account
        }
    
    # Decrypt refresh_token
    try:
        refresh_token_plain = decrypt_token(encrypted_refresh_token)
    except Exception as e:
        logger.error(f"[ONEDRIVE_REFRESH] Token decryption failed for account_id={account_id}: {e}")
        return {
            "success": False,
            "error_type": "decryption_error",
            "updated_account": provider_account
        }
    
    # Intentar refresh con helper existente (puede lanzar HTTPException)
    try:
        refresh_result = await refresh_onedrive_token(refresh_token_plain)
        
        # refresh_onedrive_token retorna: {access_token, refresh_token, expires_in, token_expiry}
        new_access_token = refresh_result["access_token"]
        new_refresh_token = refresh_result.get("refresh_token")  # Puede ser None si Microsoft no lo envía
        new_expiry = refresh_result["token_expiry"]
        
        # Preparar update payload
        update_payload = {
            "access_token": encrypt_token(new_access_token),
            "token_expiry": new_expiry.isoformat(),
            "is_active": True
        }
        
        # Solo actualizar refresh_token si Microsoft envió uno nuevo
        if new_refresh_token:
            update_payload["refresh_token"] = encrypt_token(new_refresh_token)
            logger.info(f"[ONEDRIVE_REFRESH] Microsoft sent new refresh_token for account_id={account_id}")
        else:
            # Preservar existente (NO incluir campo en update)
            logger.info(f"[ONEDRIVE_REFRESH] Preserving existing refresh_token for account_id={account_id}")
        
        # Actualizar DB
        try:
            supabase.table("cloud_provider_accounts").update(update_payload).eq("id", account_id).execute()
            logger.info(f"[ONEDRIVE_REFRESH] SUCCESS for account_id={account_id}")
        except Exception as db_error:
            logger.error(f"[ONEDRIVE_REFRESH] DB update failed for account_id={account_id}: {db_error}")
            return {
                "success": False,
                "error_type": "db_update_error",
                "updated_account": provider_account
            }
        
        # Construir account actualizado (in-memory) reutilizando tokens ya encriptados del payload
        updated_account = provider_account.copy()
        updated_account["access_token"] = update_payload["access_token"]  # Ya encriptado
        updated_account["token_expiry"] = update_payload["token_expiry"]
        updated_account["is_active"] = update_payload["is_active"]
        if "refresh_token" in update_payload:
            updated_account["refresh_token"] = update_payload["refresh_token"]  # Ya encriptado
        
        return {
            "success": True,
            "error_type": None,
            "updated_account": updated_account
        }
        
    except HTTPException as http_err:
        # Analizar tipo de error desde detail
        error_detail = http_err.detail if hasattr(http_err, "detail") else {}
        error_code = error_detail.get("error_code", "") if isinstance(error_detail, dict) else ""
        error_msg = error_detail.get("error", "") if isinstance(error_detail, dict) else ""
        
        # Normalizar strings para detección case-insensitive
        error_code_lower = error_code.lower()
        error_msg_lower = error_msg.lower()
        
        # Caso 1: invalid_grant (token revocado permanentemente)
        # Clear tokens from DB so they can't be used anymore
        if "invalid_grant" in error_code_lower or "invalid_grant" in error_msg_lower:
            logger.warning(
                f"[ONEDRIVE_REFRESH] invalid_grant detected for account_id={account_id}. "
                f"Clearing tokens from database to force reconnection."
            )
            
            # Clear tokens from database
            try:
                supabase.table("cloud_provider_accounts").update({
                    "access_token": None,
                    "refresh_token": None,
                    "token_expiry": None
                }).eq("id", account_id).execute()
                logger.info(f"[ONEDRIVE_REFRESH] Tokens cleared from DB for account_id={account_id}")
                
                # Update provider_account to reflect cleared tokens
                provider_account_cleared = provider_account.copy()
                provider_account_cleared["access_token"] = None
                provider_account_cleared["refresh_token"] = None
                provider_account_cleared["token_expiry"] = None
                
                return {
                    "success": False,
                    "error_type": "invalid_grant",
                    "updated_account": provider_account_cleared
                }
            except Exception as db_err:
                logger.error(f"[ONEDRIVE_REFRESH] Failed to clear tokens from DB for account_id={account_id}: {db_err}")
                return {
                    "success": False,
                    "error_type": "invalid_grant",
                    "updated_account": provider_account
                }
        
        # Caso 2: interaction_required (requiere consentimiento usuario)
        # Clear tokens from DB so they can't be used anymore
        if "interaction_required" in error_code_lower or "interaction_required" in error_msg_lower:
            logger.warning(
                f"[ONEDRIVE_REFRESH] interaction_required detected for account_id={account_id}. "
                f"Clearing tokens from database to force reconnection."
            )
            
            # Clear tokens from database
            try:
                supabase.table("cloud_provider_accounts").update({
                    "access_token": None,
                    "refresh_token": None,
                    "token_expiry": None
                }).eq("id", account_id).execute()
                logger.info(f"[ONEDRIVE_REFRESH] Tokens cleared from DB for account_id={account_id}")
                
                # Update provider_account to reflect cleared tokens
                provider_account_cleared = provider_account.copy()
                provider_account_cleared["access_token"] = None
                provider_account_cleared["refresh_token"] = None
                provider_account_cleared["token_expiry"] = None
                
                return {
                    "success": False,
                    "error_type": "interaction_required",
                    "updated_account": provider_account_cleared
                }
            except Exception as db_err:
                logger.error(f"[ONEDRIVE_REFRESH] Failed to clear tokens from DB for account_id={account_id}: {db_err}")
                return {
                    "success": False,
                    "error_type": "interaction_required",
                    "updated_account": provider_account
                }
        
        # Caso 3: invalid_client o unauthorized_client (config OAuth incorrecta)
        if "invalid_client" in error_code_lower or "invalid_client" in error_msg_lower or \
           "unauthorized_client" in error_code_lower or "unauthorized_client" in error_msg_lower:
            logger.error(f"[ONEDRIVE_REFRESH] invalid_client/unauthorized_client for account_id={account_id} (OAuth misconfiguration)")
            # NO mutar tokens - es un problema de configuración, no de cuenta
            return {
                "success": False,
                "error_type": "invalid_client",
                "updated_account": provider_account
            }
        
        # Caso 4: Errores transitorios (network, 5xx, rate limit, etc.)
        logger.warning(f"[ONEDRIVE_REFRESH] Transient error for account_id={account_id}: error_code={error_code}")
        return {
            "success": False,
            "error_type": "transient_error",
            "updated_account": provider_account
        }
    
    except Exception as e:
        # Errores inesperados
        logger.exception(f"[ONEDRIVE_REFRESH] Unexpected error for account_id={account_id}: {e}")
        return {
            "success": False,
            "error_type": "unexpected_error",
            "updated_account": provider_account
        }


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
