import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import supabase
from backend.google_drive import (
    get_storage_quota,
    list_drive_files,
    copy_file_between_accounts,
    rename_file,
    download_file_stream,
)
from backend.auth import create_state_token, decode_state_token, verify_supabase_jwt, get_current_user
from backend import quota

app = FastAPI()

# CORS Configuration
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Google OAuth Configuration
GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo"

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


@app.get("/")
def read_root():
    return {"message": "Cloud Aggregator API", "status": "running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/auth/google/login")
def google_login(user_id: Optional[str] = None, mode: Optional[str] = None):
    """Initiate Google OAuth flow with optional user_id in state"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        return {"error": "Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI"}

    # Pre-check cloud limit (unless reauth mode or no user_id)
    if user_id and mode != "reauth":
        # Get user plan
        plan = quota.get_or_create_user_plan(supabase, user_id)
        plan_name = plan.get("plan", "free")
        max_clouds = quota.PLAN_CLOUD_LIMITS.get(plan_name, 1)
        extra_clouds = plan.get("extra_clouds", 0)
        allowed_clouds = max_clouds + extra_clouds
        
        # Count current connected accounts
        count_result = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).execute()
        current_count = len(count_result.data) if count_result.data else 0
        
        # Check limit
        if current_count >= allowed_clouds:
            return RedirectResponse(f"{FRONTEND_URL}/app?error=cloud_limit_reached&allowed={allowed_clouds}")

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }
    
    # Si se proporciona user_id, crear un state JWT
    if user_id:
        state_token = create_state_token(user_id)
        params["state"] = state_token

    from urllib.parse import urlencode
    url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
    return RedirectResponse(url)


@app.get("/auth/google/callback")
async def google_callback(request: Request):
    """Handle Google OAuth callback"""
    from urllib.parse import parse_qs
    import httpx

    query = request.url.query
    qs = parse_qs(query)
    code = qs.get("code", [None])[0]
    error = qs.get("error", [None])[0]
    state = qs.get("state", [None])[0]

    if error:
        return RedirectResponse(f"{FRONTEND_URL}?error={error}")

    if not code:
        return RedirectResponse(f"{FRONTEND_URL}?error=no_code")
    
    # Decodificar el state para obtener el user_id
    user_id = None
    if state:
        user_id = decode_state_token(state)

    # Exchange code for tokens
    data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient() as client:
        token_res = await client.post(GOOGLE_TOKEN_ENDPOINT, data=data)
        token_json = token_res.json()

    access_token = token_json.get("access_token")
    refresh_token = token_json.get("refresh_token")
    expires_in = token_json.get("expires_in", 3600)

    if not access_token:
        return RedirectResponse(f"{FRONTEND_URL}?error=no_access_token")

    # Get user info
    async with httpx.AsyncClient() as client:
        userinfo_res = await client.get(
            GOOGLE_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        userinfo = userinfo_res.json()

    account_email = userinfo.get("email")
    google_account_id = userinfo.get("id")

    # Calculate expiry
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    expiry_iso = expiry.isoformat()

    # Prevent orphan cloud_accounts without user_id
    if not user_id:
        return RedirectResponse(f"{FRONTEND_URL}/app?error=missing_user_id")
    
    # Check cloud account limit with slot-based validation
    try:
        quota.check_cloud_limit_with_slots(supabase, user_id, "google_drive", google_account_id)
    except HTTPException as e:
        # Extract error details
        error_detail = e.detail
        allowed = error_detail.get("allowed", 0) if isinstance(error_detail, dict) else 0
        return RedirectResponse(f"{FRONTEND_URL}/app?error=cloud_limit_reached&allowed={allowed}")
    
    # Preparar datos para guardar
    upsert_data = {
        "account_email": account_email,
        "google_account_id": google_account_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expiry": expiry_iso,
        "user_id": user_id,
    }

    # Save to database
    resp = supabase.table("cloud_accounts").upsert(
        upsert_data,
        on_conflict="google_account_id",
    ).execute()

    # Vincular slot histórico tras guardar la cuenta
    try:
        quota.connect_cloud_account_with_slot(
            supabase,
            user_id,
            "google_drive",
            google_account_id,
            account_email
        )
    except Exception as slot_err:
        import logging
        logging.error(f"[SLOT ERROR] Failed to link slot for user {user_id}, account {account_email}: {slot_err}")
        # Continuar sin fallar la conexión (slot se puede vincular manualmente después)

    # Redirect to frontend dashboard
    return RedirectResponse(f"{FRONTEND_URL}/app?auth=success")


@app.get("/accounts")
async def list_accounts(user_id: str = Depends(verify_supabase_jwt)):
    """Get all connected cloud accounts for the authenticated user"""
    resp = (
        supabase.table("cloud_accounts")
        .select("id, account_email, created_at")
        .eq("user_id", user_id)
        .execute()
    )
    return {"accounts": resp.data}


@app.get("/drive/{account_id}/copy-options")
async def get_copy_options(account_id: int, user_id: str = Depends(verify_supabase_jwt)):
    """Get list of target accounts for copying files (user-specific)"""
    try:
        # Verify source account exists and belongs to user
        source = (
            supabase.table("cloud_accounts")
            .select("id, account_email")
            .eq("id", account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not source.data:
            raise HTTPException(
                status_code=404,
                detail=f"Account {account_id} not found or doesn't belong to you"
            )
        
        # Get all other accounts belonging to the same user
        all_accounts = (
            supabase.table("cloud_accounts")
            .select("id, account_email")
            .eq("user_id", user_id)
            .execute()
        )
        targets = [
            {"id": acc["id"], "email": acc["account_email"]}
            for acc in all_accounts.data
            if acc["id"] != account_id
        ]
        
        return {
            "source_account": {
                "id": source.data["id"],
                "email": source.data["account_email"]
            },
            "target_accounts": targets
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Backend is running"}


@app.get("/storage/summary")
async def storage_summary(user_id: str = Depends(verify_supabase_jwt)):
    """Get aggregated storage summary across all user accounts"""
    # Get all accounts for this user
    accounts_resp = (
        supabase.table("cloud_accounts")
        .select("id, account_email")
        .eq("user_id", user_id)
        .execute()
    )
    accounts = accounts_resp.data
    
    # Si no hay cuentas para este usuario, retornar vacío
    if len(accounts) == 0:
        return {
            "total_limit": 0,
            "total_usage": 0,
            "total_free": 0,
            "total_usage_percent": 0,
            "accounts": []
        }

    total_limit = 0
    total_usage = 0
    account_details = []

    for account in accounts:
        try:
            quota_info = await get_storage_quota(account["id"])
            storage_quota = quota_info.get("storageQuota", {})
            
            limit = int(storage_quota.get("limit", 0))
            usage = int(storage_quota.get("usage", 0))
            
            total_limit += limit
            total_usage += usage
            
            account_details.append({
                "id": account["id"],
                "email": account["account_email"],
                "limit": limit,
                "usage": usage,
                "usage_percent": round((usage / limit * 100) if limit > 0 else 0, 2)
            })
        except Exception as e:
            # Silently skip accounts with quota fetch errors
            continue

    total_free = total_limit - total_usage if total_limit > 0 else 0
    
    return {
        "total_limit": total_limit,
        "total_usage": total_usage,
        "total_free": total_free,
        "total_usage_percent": round((total_usage / total_limit * 100) if total_limit > 0 else 0, 2),
        "accounts": account_details
    }


@app.get("/drive/{account_id}/files")
async def get_drive_files(
    account_id: int,
    folder_id: str = "root",
    page_token: Optional[str] = None,
    user_id: str = Depends(verify_supabase_jwt),
):
    """List files for a specific Drive account and folder with pagination (user-specific)"""
    try:
        # Verify account belongs to user
        account = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not account.data:
            raise HTTPException(
                status_code=404,
                detail=f"Account {account_id} not found or doesn't belong to you"
            )
        
        result = await list_drive_files(
            account_id=account_id,
            folder_id=folder_id,
            page_size=50,
            page_token=page_token,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CopyFileRequest(BaseModel):
    source_account_id: int
    target_account_id: int
    file_id: str


@app.post("/drive/copy-file")
async def copy_file(request: CopyFileRequest, user_id: str = Depends(verify_supabase_jwt)):
    """
    Copy a file from one Drive account to another.
    Detects duplicates first, then enforces quota limits.
    Returns job_id and quota info.
    """
    job_id = None
    
    try:
        # 1. Validate both accounts exist and belong to the user
        source_acc = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", request.source_account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        target_acc = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", request.target_account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        
        if not source_acc.data or not target_acc.data:
            raise HTTPException(
                status_code=404,
                detail="One or both accounts not found or don't belong to you"
            )
        
        # 2. Get source file metadata for duplicate detection
        from backend.google_drive import get_file_metadata, find_duplicate_file
        source_metadata = await get_file_metadata(request.source_account_id, request.file_id)
        
        # 3. Check if file already exists in target account BEFORE checking quota/rate limits
        duplicate = await find_duplicate_file(
            account_id=request.target_account_id,
            file_name=source_metadata.get("name", ""),
            mime_type=source_metadata.get("mimeType", ""),
            md5_checksum=source_metadata.get("md5Checksum"),
            folder_id="root"  # Currently copying to root
        )
        
        if duplicate:
            # File already exists - don't consume quota, don't create job, don't check rate limits
            # Get current quota for response (read-only, doesn't modify)
            quota_info = quota.get_user_quota_info(supabase, user_id)
            return {
                "success": True,
                "message": "Archivo ya existe en cuenta destino",
                "duplicate": True,
                "file": duplicate,
                "quota": quota_info
            }
        
        # 4. NOT a duplicate - now check rate limit
        quota.check_rate_limit(supabase, user_id)
        
        # 5. Check quota availability
        quota_info = quota.check_quota_available(supabase, user_id)
        
        # 6. Create copy job with status='pending' (only if not duplicate)
        job_id = quota.create_copy_job(
            supabase=supabase,
            user_id=user_id,
            source_account_id=request.source_account_id,
            target_account_id=request.target_account_id,
            file_id=request.file_id,
            file_name=source_metadata.get("name")
        )
        
        # 7. Get tokens with auto-refresh
        from backend.google_drive import get_valid_token
        await get_valid_token(request.source_account_id)
        await get_valid_token(request.target_account_id)
        
        # 8. Execute actual copy
        result = await copy_file_between_accounts(
            source_account_id=request.source_account_id,
            target_account_id=request.target_account_id,
            file_id=request.file_id
        )
        
        # 9. Mark job as success AND increment quota atomically
        quota.complete_copy_job_success(supabase, job_id, user_id)
        
        # 10. Get updated quota
        updated_quota = quota.get_user_quota_info(supabase, user_id)
        
        # 11. Return success (backward compatible + new fields)
        return {
            "success": True,
            "message": "File copied successfully",
            "file": result,
            "job_id": job_id,
            "quota": updated_quota
        }
        
    except HTTPException as e:
        # Quota exceeded or auth error - mark job as failed if created
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e.detail))
        raise
        
    except ValueError as e:
        # Validation error - mark job as failed if created
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
        
    except Exception as e:
        # Generic error - mark job as failed if created
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e))
        raise HTTPException(status_code=500, detail=f"Copy failed: {str(e)}")


@app.get("/me/plan")
async def get_my_plan(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get current user's plan and quota status.
    
    Returns:
        {
            "plan": "free",
            "used": 5,
            "limit": 20,
            "remaining": 15,
            "clouds_allowed": 2,
            "clouds_connected": 1,
            "clouds_remaining": 1,
            "copies_used_month": 5,
            "copies_limit_month": 20
        }
    """
    try:
        quota_info = quota.get_user_quota_info(supabase, user_id)
        return quota_info
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get plan info: {str(e)}")


class RenameFileRequest(BaseModel):
    account_id: int
    file_id: str
    new_name: str


@app.post("/drive/rename-file")
async def rename_drive_file(
    request: RenameFileRequest,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Rename a file in Google Drive.
    
    Body:
        {
            "account_id": 1,
            "file_id": "abc123",
            "new_name": "New Filename.pdf"
        }
    
    Returns:
        Updated file metadata
    """
    try:
        # Validate new_name
        if not request.new_name.strip():
            raise HTTPException(status_code=400, detail="new_name cannot be empty")
        
        # Verify account belongs to user
        account_resp = supabase.table("cloud_accounts").select("user_id").eq("id", request.account_id).single().execute()
        if not account_resp.data or account_resp.data["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Account does not belong to user")
        
        # Rename file
        result = await rename_file(request.account_id, request.file_id, request.new_name)
        
        return {
            "success": True,
            "message": "File renamed successfully",
            "file": result
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")


@app.get("/drive/download")
async def download_drive_file(
    account_id: int,
    file_id: str,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Download a file from Google Drive.
    For Google Workspace files, exports to appropriate format (DOCX, XLSX, PPTX, PDF).
    
    Query params:
        account_id: Account ID owning the file
        file_id: File ID to download
    
    Returns:
        File content with proper headers for download
    """
    try:
        # Verify account belongs to user
        account_resp = supabase.table("cloud_accounts").select("user_id").eq("id", account_id).single().execute()
        if not account_resp.data or account_resp.data["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Account does not belong to user")
        
        # Get download info
        url, params, token, file_name, mime_type = await download_file_stream(account_id, file_id)
        
        # Stream the file
        import httpx
        from fastapi.responses import StreamingResponse
        
        async def file_iterator():
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("GET", url, params=params, headers={"Authorization": f"Bearer {token}"}) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        yield chunk
        
        # Sanitize filename for Content-Disposition header
        safe_filename = file_name.replace('"', '').replace('\n', '').replace('\r', '')
        
        return StreamingResponse(
            file_iterator(),
            media_type=mime_type,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"'
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


class RevokeAccountRequest(BaseModel):
    account_id: int


@app.post("/auth/revoke-account")
async def revoke_account(
    request: RevokeAccountRequest,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Revoke access to a connected Google Drive account using soft-delete.
    - Sets is_active=false in cloud_accounts and cloud_slots_log
    - Physically deletes OAuth tokens (access_token, refresh_token) for security compliance
    - Preserves historical slot data for quota enforcement
    
    Security:
    - Requires valid JWT token
    - Validates account ownership before revocation
    - Returns 403 if user doesn't own the account
    - Immediately removes OAuth tokens from database
    
    Body:
        {
            "account_id": 123
        }
    
    Returns:
        {
            "success": true,
            "message": "Account example@gmail.com disconnected successfully"
        }
    """
    try:
        # 1. Verify account exists and belongs to user (CRITICAL SECURITY CHECK)
        account_resp = (
            supabase.table("cloud_accounts")
            .select("id, account_email, user_id, google_account_id, slot_log_id")
            .eq("id", request.account_id)
            .single()
            .execute()
        )
        
        if not account_resp.data:
            raise HTTPException(
                status_code=404,
                detail="Account not found"
            )
        
        # 2. Verify ownership (PREVENT UNAUTHORIZED REVOCATION)
        if account_resp.data["user_id"] != user_id:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to disconnect this account"
            )
        
        account_email = account_resp.data["account_email"]
        google_account_id = account_resp.data["google_account_id"]
        slot_log_id = account_resp.data.get("slot_log_id")
        
        # 3. SOFT-DELETE: Update cloud_accounts (borrado físico de tokens OAuth)
        now_iso = datetime.now(timezone.utc).isoformat()
        supabase.table("cloud_accounts").update({
            "is_active": False,
            "disconnected_at": now_iso,
            "access_token": None,      # SEGURIDAD CRÍTICA: Borrado físico de tokens
            "refresh_token": None      # SEGURIDAD CRÍTICA: Borrado físico de tokens
        }).eq("id", request.account_id).execute()
        
        # 4. SOFT-DELETE: Update cloud_slots_log (marcar slot como inactivo)
        if slot_log_id:
            supabase.table("cloud_slots_log").update({
                "is_active": False,
                "disconnected_at": now_iso
            }).eq("id", slot_log_id).execute()
        else:
            # Si no hay slot_log_id vinculado, buscar por provider_account_id
            supabase.table("cloud_slots_log").update({
                "is_active": False,
                "disconnected_at": now_iso
            }).eq("user_id", user_id).eq("provider", "google_drive").eq("provider_account_id", google_account_id).execute()
        
        return {
            "success": True,
            "message": f"Account {account_email} disconnected successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.error(f"[REVOKE ERROR] Failed to revoke account {request.account_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to revoke account: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
