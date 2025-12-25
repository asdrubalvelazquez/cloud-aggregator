import os
import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
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

# Google OAuth Scopes - MÍNIMOS NECESARIOS (Google OAuth Compliance)
# https://www.googleapis.com/auth/drive: Full Drive access (necesario para copy files between accounts)
# https://www.googleapis.com/auth/userinfo.email: Email del usuario (identificación)
# openid: OpenID Connect (autenticación)
# NOTA: drive.readonly NO es suficiente para copiar archivos entre cuentas
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


@app.get("/billing/quota")
def get_billing_quota(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get current user's plan and quota limits.
    
    Returns frontend-friendly quota information including:
    - plan: free/plus/pro
    - plan_type: FREE/PAID
    - copies_used/limit (lifetime for FREE, monthly for PAID)
    - transfer_used_bytes/limit_bytes
    - max_file_bytes
    
    Protected endpoint: requires valid JWT.
    """
    try:
        quota_data = quota.get_user_quota_info(supabase, user_id)
        
        # Defensive: ensure all required keys exist
        plan_name = quota_data.get("plan", "free")
        copies_data = quota_data.get("copies", {})
        transfer_data = quota_data.get("transfer", {})
        
        # Map to frontend-friendly response with safe defaults
        return {
            "plan": plan_name,
            "plan_type": quota_data.get("plan_type", "FREE"),
            "copies": {
                "used": copies_data.get("used_lifetime") if plan_name == "free" else copies_data.get("used_month", 0),
                "limit": copies_data.get("limit_lifetime") if plan_name == "free" else copies_data.get("limit_month"),
                "is_lifetime": plan_name == "free"
            },
            "transfer": {
                "used_bytes": transfer_data.get("used_bytes", 0),
                "limit_bytes": transfer_data.get("limit_bytes"),
                "used_gb": transfer_data.get("used_gb", 0.0),
                "limit_gb": transfer_data.get("limit_gb"),
                "is_lifetime": plan_name == "free"
            },
            "max_file_bytes": quota_data.get("max_file_bytes", 1_073_741_824),
            "max_file_gb": quota_data.get("max_file_gb", 1.0)
        }
    except Exception as e:
        logging.error(f"Error fetching billing quota for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch quota information")


@app.get("/auth/google/login-url")
def google_login_url(
    mode: Optional[str] = None, 
    reconnect_account_id: Optional[str] = None,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Get Google OAuth URL for client-side redirect.
    
    CRITICAL FIX: window.location.href NO envía Authorization headers → 401 si endpoint protegido.
    SOLUCIÓN: Frontend hace fetch autenticado a ESTE endpoint → recibe URL → redirect manual.
    
    SEGURIDAD: user_id derivado de JWT (NO query param) para evitar PII en URL/logs.
    
    OAuth Modes:
    - "connect": New account connection (checks slot availability)
    - "reauth": Re-authorize existing account (prompt=select_account)
    - "reconnect": Restore slot without consuming new slot (requires reconnect_account_id)
    
    OAuth Prompt Strategy (Google OAuth Compliance):
    - "select_account": Muestra selector de cuenta (UX recomendada por Google)
    - "consent": Fuerza pantalla de permisos (SOLO cuando mode="consent" explícito)
    
    Args:
        mode: "connect"|"reauth"|"reconnect"|"consent"
        reconnect_account_id: Google account ID (required for mode=reconnect)
        user_id: Derivado automáticamente de JWT (verify_supabase_jwt)
        
    Returns:
        {"url": "https://accounts.google.com/o/oauth2/v2/auth?..."}
    """
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI")

    # Validation: reconnect requires account_id
    if mode == "reconnect" and not reconnect_account_id:
        raise HTTPException(status_code=400, detail="reconnect_account_id required for mode=reconnect")
    
    # Validation: connect mode requires available slots (reconnect bypasses this)
    if mode == "connect" or mode is None:
        try:
            user_quota = quota.get_user_quota(supabase, user_id)
            if user_quota["clouds_remaining"] <= 0:
                raise HTTPException(status_code=403, detail="No slots available. Disconnect an account or upgrade your plan.")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            logging.error(f"[QUOTA CHECK ERROR] user_id={user_id} error={str(e)}")
            raise HTTPException(status_code=500, detail="Failed to check quota")
    
    # For reconnect: verify slot exists and get email for login_hint
    reconnect_email = None
    if mode == "reconnect":
        slot_check = supabase.table("cloud_slots_log").select("id,provider_email").eq("user_id", user_id).eq("provider_account_id", reconnect_account_id).limit(1).execute()
        if not slot_check.data:
            raise HTTPException(status_code=404, detail="Slot not found for this account")
        reconnect_email = slot_check.data[0].get("provider_email")
    
    # OAuth Prompt Strategy (Google best practices):
    # - Default: "select_account" (mejor UX, no agresivo)
    # - Consent: SOLO si mode="consent" explícito (primera vez o refresh_token perdido)
    # - Evitar "consent" innecesario (Google OAuth review lo penaliza)
    if mode == "consent":
        oauth_prompt = "consent"  # Forzar pantalla de permisos (casos excepcionales)
    else:
        oauth_prompt = "select_account"  # Default recomendado por Google
    
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",  # Solicita refresh_token
        "prompt": oauth_prompt,
        "include_granted_scopes": "true",  # Incremental authorization (Google best practice)
    }
    
    # Agregar login_hint para reconnect (mejora UX y previene account_mismatch)
    if mode == "reconnect" and reconnect_email:
        params["login_hint"] = reconnect_email
    
    # Crear state JWT con user_id, mode, reconnect_account_id (seguro, firmado)
    state_token = create_state_token(user_id, mode=mode or "connect", reconnect_account_id=reconnect_account_id)
    params["state"] = state_token

    from urllib.parse import urlencode
    url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
    
    # Log sin PII (solo hash parcial + mode)
    user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    print(f"[OAuth URL Generated] user_hash={user_hash} mode={mode or 'connect'} prompt={oauth_prompt}")
    
    return {"url": url}


@app.get("/auth/google/login")
def google_login_deprecated(mode: Optional[str] = None):
    """
    DEPRECATED: Use /auth/google/login-url instead.
    
    This endpoint kept for backwards compatibility but should not be used.
    Frontend should call /auth/google/login-url (authenticated) to get OAuth URL,
    then redirect manually with window.location.href.
    
    Reason: window.location.href does NOT send Authorization headers → 401 if protected.
    """
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /auth/google/login-url (authenticated) instead."
    )


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
    
    # Decodificar el state para obtener user_id, mode, reconnect_account_id
    user_id = None
    mode = "connect"
    reconnect_account_id = None
    if state:
        state_data = decode_state_token(state)
        if state_data:
            user_id = state_data.get("user_id")
            mode = state_data.get("mode", "connect")
            reconnect_account_id = state_data.get("reconnect_account_id")

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
    
    # Normalizar ID de Google para comparación consistente (evitar int vs string)
    if google_account_id:
        google_account_id = str(google_account_id).strip()
        import logging
        logging.info(f"[OAUTH CALLBACK] ID de Google normalizado: {google_account_id}, email: {account_email}")

    # Calculate expiry
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    expiry_iso = expiry.isoformat()

    # Prevent orphan cloud_accounts without user_id
    if not user_id:
        return RedirectResponse(f"{FRONTEND_URL}/app?error=missing_user_id")
    
    # Handle reconnect mode: verify account match and skip slot consumption
    if mode == "reconnect":
        # Normalizar IDs para comparación consistente
        reconnect_account_id_normalized = str(reconnect_account_id).strip() if reconnect_account_id else ""
        google_account_id_normalized = str(google_account_id).strip() if google_account_id else ""
        
        if google_account_id_normalized != reconnect_account_id_normalized:
            # Obtener email esperado del slot para mejor UX
            expected_email = "unknown"
            try:
                slot_info = supabase.table("cloud_slots_log").select("provider_email").eq("user_id", user_id).eq("provider_account_id", reconnect_account_id_normalized).limit(1).execute()
                if slot_info.data:
                    expected_email = slot_info.data[0].get("provider_email", "unknown")
            except Exception:
                pass
            
            logging.error(
                f"[RECONNECT ERROR] Account mismatch: "
                f"expected_id={reconnect_account_id_normalized} got_id={google_account_id_normalized} "
                f"expected_email={expected_email} got_email={account_email} "
                f"user_id={user_id}"
            )
            return RedirectResponse(f"{FRONTEND_URL}/app?error=account_mismatch&expected={expected_email}")
        
        # Update or create cloud_account
        existing_account = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).eq("google_account_id", google_account_id).limit(1).execute()
        
        if existing_account.data:
            # UPDATE existing account with new tokens
            account_id = existing_account.data[0]["id"]
            
            # CRITICAL: Solo actualizar refresh_token si viene uno nuevo
            # Google NO devuelve refresh_token en reconexiones subsecuentes
            update_payload = {
                "access_token": access_token,
                "token_expiry": expiry_iso,
                "is_active": True,
                "disconnected_at": None,
            }
            
            # Solo actualizar refresh_token si viene un valor real (no None)
            if refresh_token:
                update_payload["refresh_token"] = refresh_token
                logging.info(f"[RECONNECT] Got new refresh_token for account_id={account_id}")
            else:
                logging.info(f"[RECONNECT] No new refresh_token, keeping existing one for account_id={account_id}")
            
            update_result = supabase.table("cloud_accounts").update(update_payload).eq("id", account_id).execute()
            
            rows_updated = len(update_result.data) if update_result.data else 0
            if rows_updated == 0:
                logging.warning(
                    f"[RECONNECT WARNING] cloud_accounts UPDATE affected 0 rows. "
                    f"account_id={account_id} user_id={user_id}"
                )
            else:
                logging.info(
                    f"[RECONNECT SUCCESS - cloud_accounts] "
                    f"user_id={user_id} account_id={account_id} "
                    f"google_account_id={google_account_id} email={account_email} "
                    f"rows_updated={rows_updated} is_active=True disconnected_at=None "
                    f"refresh_token_updated={bool(refresh_token)}"
                )
        else:
            # CREATE new cloud_account (edge case: account deleted but slot exists)
            slot_result = supabase.table("cloud_slots_log").select("id").eq("user_id", user_id).eq("provider_account_id", google_account_id).limit(1).execute()
            slot_id = slot_result.data[0]["id"] if slot_result.data else None
            
            if not slot_id:
                logging.error(
                    f"[RECONNECT ERROR] No slot found for reconnection. "
                    f"user_id={user_id} google_account_id={google_account_id} email={account_email}"
                )
                return RedirectResponse(f"{FRONTEND_URL}/app?error=slot_not_found")
            
            insert_result = supabase.table("cloud_accounts").insert({
                "user_id": user_id,
                "google_account_id": google_account_id,
                "account_email": account_email,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expiry": expiry_iso,
                "is_active": True,
                "slot_log_id": slot_id,
            }).execute()
            
            new_account_id = insert_result.data[0]["id"] if insert_result.data else "unknown"
            logging.info(
                f"[RECONNECT SUCCESS - cloud_accounts CREATED] "
                f"user_id={user_id} account_id={new_account_id} slot_id={slot_id} "
                f"google_account_id={google_account_id} email={account_email}"
            )
        
        # Ensure slot is active and update provider info
        slot_update = supabase.table("cloud_slots_log").update({
            "is_active": True,
            "disconnected_at": None,
            "provider_email": account_email,
        }).eq("user_id", user_id).eq("provider_account_id", google_account_id).execute()
        
        slots_updated = len(slot_update.data) if slot_update.data else 0
        if slots_updated == 0:
            logging.warning(
                f"[RECONNECT WARNING] cloud_slots_log UPDATE affected 0 rows. "
                f"user_id={user_id} provider_account_id={google_account_id} "
                f"This may indicate slot was deleted or provider_account_id mismatch"
            )
        else:
            logging.info(
                f"[RECONNECT SUCCESS - cloud_slots_log] "
                f"user_id={user_id} google_account_id={google_account_id} "
                f"email={account_email} slots_updated={slots_updated} "
                f"is_active=True disconnected_at=None"
            )
        
        return RedirectResponse(f"{FRONTEND_URL}/app?reconnect=success")
    
    # Check cloud account limit with slot-based validation (only for connect mode)
    try:
        quota.check_cloud_limit_with_slots(supabase, user_id, "google_drive", google_account_id)
    except HTTPException as e:
        import logging
        # Diferenciar tipos de error para mejor UX
        if e.status_code == 400:
            # VALIDATION ERROR: provider_account_id vacío/inválido (raro pero posible)
            # Log interno con detalles, redirect con error genérico sin PII
            error_detail = e.detail if isinstance(e.detail, dict) else {"error": "unknown"}
            logging.error(f"[CALLBACK VALIDATION ERROR] HTTP 400 - {error_detail.get('error', 'unknown')} para user_id={user_id}, provider=google_drive")
            return RedirectResponse(f"{FRONTEND_URL}/app?error=oauth_invalid_account")
        elif e.status_code == 402:
            # QUOTA ERROR: Límite de slots alcanzado
            # NO exponer PII (emails) en URL - frontend llamará a /me/slots para obtener detalles
            logging.info(f"[CALLBACK QUOTA] Usuario {user_id} alcanzó límite de slots")
            return RedirectResponse(f"{FRONTEND_URL}/app?error=cloud_limit_reached")
        else:
            # Otros errores HTTP inesperados
            logging.error(f"[CALLBACK ERROR] Unexpected HTTPException {e.status_code} para user_id={user_id}")
            return RedirectResponse(f"{FRONTEND_URL}/app?error=connection_failed")
    
    # CRITICAL FIX: Get/create slot BEFORE upserting cloud_account
    # This prevents creating orphan accounts with slot_log_id = NULL
    # which causes "infinite connections" bug
    try:
        slot_result = quota.connect_cloud_account_with_slot(
            supabase,
            user_id,
            "google_drive",
            google_account_id,
            account_email
        )
        slot_id = slot_result["id"]
        import logging
        logging.info(f"[SLOT LINKED] slot_id={slot_id}, is_new={slot_result.get('is_new')}, reconnected={slot_result.get('reconnected')}")
    except Exception as slot_err:
        import logging
        logging.error(f"[CRITICAL] Failed to get/create slot for user {user_id}, account {account_email}: {slot_err}")
        # ABORT: Do NOT create cloud_account without slot_id (prevents orphan accounts)
        return RedirectResponse(f"{FRONTEND_URL}/app?error=slot_creation_failed")
    
    # Preparar datos para guardar (incluye reactivación si es reconexión)
    upsert_data = {
        "account_email": account_email,
        "google_account_id": google_account_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expiry": expiry_iso,
        "user_id": user_id,
        "is_active": True,              # Reactivar cuenta si estaba soft-deleted
        "disconnected_at": None,        # Limpiar timestamp de desconexión
        "slot_log_id": slot_id,         # CRITICAL: Link to slot (prevents orphan accounts)
    }

    # Save to database
    resp = supabase.table("cloud_accounts").upsert(
        upsert_data,
        on_conflict="google_account_id",
    ).execute()

    # Redirect to frontend dashboard
    return RedirectResponse(f"{FRONTEND_URL}/app?auth=success")


@app.get("/accounts")
async def list_accounts(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get all active cloud slots with their account details for the authenticated user.
    
    This endpoint queries cloud_slots_log (active slots) and LEFT JOINs with cloud_accounts
    to provide usage/limit information. This ensures dashboard shows accounts that have
    active slots, even if the underlying cloud_account record is marked is_active=false
    due to token refresh failures.
    
    Returns accounts that:
    - Have an active slot in cloud_slots_log (is_active=true)
    - Joined with cloud_accounts for usage/limit data
    - Shows all active slots regardless of account.is_active status
    """
    try:
        # Query active slots with LEFT JOIN to cloud_accounts
        # Note: Supabase doesn't support explicit JOINs in select(), so we'll fetch
        # slots first, then enrich with account data
        slots_result = (
            supabase.table("cloud_slots_log")
            .select("id,provider,provider_email,provider_account_id")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
        
        if not slots_result.data:
            return {"accounts": []}
        
        # For each slot, try to find matching cloud_account
        accounts = []
        for slot in slots_result.data:
            # Try to find account by provider_account_id (Google account ID)
            account_result = (
                supabase.table("cloud_accounts")
                .select("id,account_email,created_at")
                .eq("user_id", user_id)
                .eq("google_account_id", slot["provider_account_id"])
                .limit(1)
                .execute()
            )
            
            if account_result.data:
                # Account exists, use its data
                accounts.append(account_result.data[0])
            else:
                # Slot exists but no matching account (edge case: account was deleted)
                # Return minimal info from slot
                accounts.append({
                    "id": None,  # No account record
                    "account_email": slot["provider_email"],
                    "created_at": None,
                })
        
        return {"accounts": accounts}
    
    except Exception as e:
        logger.error(f"[ACCOUNTS FETCH ERROR] user_id={user_id} error={str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch accounts: {str(e)}")


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
async def copy_file(http_request: Request, payload: CopyFileRequest, user_id: str = Depends(verify_supabase_jwt)):
    """
    Copy a file from one Drive account to another.
    Detects duplicates first, then enforces quota limits.
    Returns job_id and quota info.
    """
    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())
    logger = logging.getLogger(__name__)
    
    job_id = None
    file_name = None
    mime_type = None
    file_size_bytes = None
    
    try:
        # Log request start
        logger.info(
            f"[COPY START] correlation_id={correlation_id} user_id={user_id} "
            f"source_account_id={payload.source_account_id} target_account_id={payload.target_account_id} "
            f"file_id={payload.file_id}"
        )
        
        # 0. Extract/validate Authorization header EARLY to avoid inconsistent states
        # (e.g., file copied but RPC fails due to missing/invalid header)
        authorization = http_request.headers.get("authorization") or http_request.headers.get("Authorization")
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header required")

        parts = authorization.strip().split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
            raise HTTPException(status_code=401, detail="Invalid Authorization header format")

        jwt_token = parts[1].strip()

        from backend.auth import create_user_scoped_client
        user_client = create_user_scoped_client(jwt_token)

        # 1. Validate both accounts exist and belong to the user
        source_acc = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", payload.source_account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        target_acc = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", payload.target_account_id)
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
        source_metadata = await get_file_metadata(payload.source_account_id, payload.file_id)
        file_name = source_metadata.get("name", "unknown")
        mime_type = source_metadata.get("mimeType", "unknown")
        file_size_bytes = int(source_metadata.get("size", 0))
        
        # Log file metadata
        logger.info(
            f"[FILE METADATA] correlation_id={correlation_id} file_name={file_name} "
            f"mime_type={mime_type} size_bytes={file_size_bytes}"
        )
        
        # 3. Check if file already exists in target account BEFORE checking quota/rate limits
        duplicate = await find_duplicate_file(
            account_id=payload.target_account_id,
            file_name=source_metadata.get("name", ""),
            mime_type=source_metadata.get("mimeType", ""),
            md5_checksum=source_metadata.get("md5Checksum"),
            folder_id="root"  # Currently copying to root
        )
        
        if duplicate:
            # File already exists - don't consume quota, don't create job, don't check rate limits
            logger.info(f"[DUPLICATE FOUND] correlation_id={correlation_id} file already exists in target account")
            # Get current quota for response (read-only, doesn't modify)
            quota_info = quota.get_user_quota_info(supabase, user_id)
            return {
                "success": True,
                "message": "Archivo ya existe en cuenta destino",
                "duplicate": True,
                "file": duplicate,
                "quota": quota_info,
                "correlation_id": correlation_id
            }
        
        # 4. NOT a duplicate - validate file size limit
        quota.check_file_size_limit_bytes(supabase, user_id, file_size_bytes, file_name)
        
        # 4.5. Check transfer bandwidth availability
        transfer_quota = quota.check_transfer_bytes_available(supabase, user_id, file_size_bytes)
        logger.info(f"[QUOTA CHECK] correlation_id={correlation_id} transfer_quota_ok={transfer_quota}")
        
        # 5. Check rate limit
        quota.check_rate_limit(supabase, user_id)
        
        # 6. Check copy quota availability
        quota_info = quota.check_quota_available(supabase, user_id)
        
        # 7. Create copy job with status='pending' (only if not duplicate)
        job_id = quota.create_copy_job(
            supabase=supabase,
            user_id=user_id,
            source_account_id=payload.source_account_id,
            target_account_id=payload.target_account_id,
            file_id=payload.file_id,
            file_name=source_metadata.get("name")
        )
        logger.info(f"[JOB CREATED] correlation_id={correlation_id} job_id={job_id}")
        
        # 8. Get tokens with auto-refresh
        from backend.google_drive import get_valid_token
        await get_valid_token(payload.source_account_id)
        await get_valid_token(payload.target_account_id)
        
        # 9. Execute actual copy
        logger.info(f"[COPY EXECUTE] correlation_id={correlation_id} starting file transfer")
        result = await copy_file_between_accounts(
            source_account_id=payload.source_account_id,
            target_account_id=payload.target_account_id,
            file_id=payload.file_id
        )
        
        # 10. Get actual bytes copied from result (fallback to metadata)
        actual_bytes = int(result.get("size", file_size_bytes))
        logger.info(f"[COPY SUCCESS] correlation_id={correlation_id} bytes_copied={actual_bytes}")
        
        # 11. Mark job as success AND increment quota atomically via RPC (USER-SCOPED for auth.uid())
        rpc_result = user_client.rpc("complete_copy_job_success_and_increment_usage", {
            "p_job_id": job_id,
            "p_user_id": user_id,
            "p_bytes_copied": actual_bytes
        }).execute()
        
        if rpc_result.data and len(rpc_result.data) > 0:
            rpc_status = rpc_result.data[0]
            if not rpc_status.get("success"):
                logger.warning(f"[RPC WARNING] correlation_id={correlation_id} {rpc_status.get('message')}")
        
        # 12. Get updated quota
        updated_quota = quota.get_user_quota_info(supabase, user_id)
        
        # 13. Return success (backward compatible + new fields)
        return {
            "success": True,
            "message": "File copied successfully",
            "file": result,
            "job_id": job_id,
            "quota": updated_quota,
            "correlation_id": correlation_id
        }
        
    except HTTPException as e:
        # Quota exceeded or auth error - mark job as failed if created
        logger.error(
            f"[COPY FAILED] correlation_id={correlation_id} HTTPException status={e.status_code} "
            f"detail={e.detail} file_name={file_name}"
        )
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e.detail))
        # Re-raise with correlation_id in detail
        raise HTTPException(
            status_code=e.status_code,
            detail={
                "message": str(e.detail) if isinstance(e.detail, str) else e.detail,
                "correlation_id": correlation_id
            }
        )
    
    except httpx.HTTPStatusError as e:
        # Google Drive API errors (401, 403, 404, 429, etc.)
        response_text = e.response.text[:500] if hasattr(e.response, 'text') else "N/A"
        logger.error(
            f"[GOOGLE API ERROR] correlation_id={correlation_id} "
            f"status={e.response.status_code} url={e.request.url} "
            f"response_body={response_text} file_name={file_name}"
        )
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, f"Google API error: {e.response.status_code}")
        raise HTTPException(
            status_code=e.response.status_code,
            detail={
                "message": f"Google Drive API error: {e.response.status_code}. El archivo podría ser inaccesible o el token expiró.",
                "correlation_id": correlation_id,
                "upstream_status": e.response.status_code
            }
        )
    
    except httpx.TimeoutException as e:
        # Timeout during download/upload
        logger.error(
            f"[TIMEOUT ERROR] correlation_id={correlation_id} "
            f"error={str(e)} file_name={file_name} size_bytes={file_size_bytes}"
        )
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, "Timeout: File transfer took too long")
        raise HTTPException(
            status_code=504,
            detail={
                "message": "La copia excedió el tiempo límite. El archivo podría ser demasiado grande o la conexión es lenta.",
                "correlation_id": correlation_id
            }
        )
        
    except ValueError as e:
        # Validation error - mark job as failed if created
        logger.error(
            f"[VALIDATION ERROR] correlation_id={correlation_id} "
            f"error={str(e)} file_name={file_name}"
        )
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e))
        raise HTTPException(
            status_code=400,
            detail={
                "message": str(e),
                "correlation_id": correlation_id
            }
        )
        
    except Exception as e:
        # Generic unexpected error
        logger.exception(
            f"[COPY FAILED - UNEXPECTED] correlation_id={correlation_id} "
            f"error_type={type(e).__name__} error={str(e)} file_name={file_name}"
        )
        if job_id:
            quota.complete_copy_job_failed(supabase, job_id, str(e))
        raise HTTPException(
            status_code=500,
            detail={
                "message": f"Error inesperado al copiar archivo: {str(e)}",
                "correlation_id": correlation_id
            }
        )


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


@app.get("/me/slots")
async def get_user_slots(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get all historical cloud slots (active and inactive) for the authenticated user.
    
    Returns:
        {
            "slots": [
                {
                    "id": "uuid",
                    "provider": "google_drive",
                    "provider_email": "user@gmail.com",
                    "slot_number": 1,
                    "is_active": true,
                    "connected_at": "2025-12-01T00:00:00Z",
                    "disconnected_at": null,
                    "plan_at_connection": "free"
                }
            ]
        }
    
    Security:
    - Only returns slots for authenticated user
    - No PII in URL (querystring)
    - Minimal field exposure: provider_account_id REMOVED (no necesario para UI)
    - UI reconecta via OAuth, no necesita account_id interno
    """
    try:
        # IMPORTANTE: NO devolver provider_account_id (identificador interno, no necesario)
        slots_result = supabase.table("cloud_slots_log").select(
            "id,provider,provider_email,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
        ).eq("user_id", user_id).order("slot_number").execute()
        
        return {"slots": slots_result.data or []}
    except Exception as e:
        logger.error(f"[SLOTS FETCH ERROR] user_id={user_id} error={str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch slots: {str(e)}")


def classify_account_status(slot: dict, cloud_account: dict) -> dict:
    """
    Determina el estado de conexión de una cuenta basado en slot y cloud_account.
    
    Args:
        slot: Row de cloud_slots_log
        cloud_account: Row de cloud_accounts (puede ser None)
    
    Returns:
        {
            "connection_status": "connected" | "needs_reconnect" | "disconnected",
            "reason": str | None,
            "can_reconnect": bool
        }
    """
    # Caso 1: Slot inactivo (usuario desconectó explícitamente)
    if not slot.get("is_active"):
        return {
            "connection_status": "disconnected",
            "reason": "slot_inactive",
            "can_reconnect": True
        }
    
    # Caso 2: Slot activo pero no hay cloud_account
    if cloud_account is None:
        return {
            "connection_status": "needs_reconnect",
            "reason": "cloud_account_missing",
            "can_reconnect": True
        }
    
    # Caso 3: cloud_account existe pero marcada is_active=false
    if not cloud_account.get("is_active"):
        return {
            "connection_status": "needs_reconnect",
            "reason": "account_is_active_false",
            "can_reconnect": True
        }
    
    # Caso 4: Verificar token_expiry primero
    token_expiry = cloud_account.get("token_expiry")
    access_token = cloud_account.get("access_token")
    refresh_token = cloud_account.get("refresh_token")
    
    # Calcular si el token está expirado (con buffer de 60s)
    token_is_expired = False
    if token_expiry:
        try:
            expiry_dt = datetime.fromisoformat(token_expiry.replace("Z", "+00:00"))
            buffer = timedelta(seconds=60)
            token_is_expired = expiry_dt < (datetime.now(timezone.utc) + buffer)
        except (ValueError, AttributeError):
            token_is_expired = True  # Invalid date format, assume expired
    
    # Caso 4a: Token expirado y NO hay refresh_token (bloqueante)
    if token_is_expired and not refresh_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "token_expired_no_refresh",
            "can_reconnect": True
        }
    
    # Caso 4b: Token expirado pero hay refresh_token (puede auto-renovarse)
    if token_is_expired and refresh_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "token_expired",
            "can_reconnect": True
        }
    
    # Caso 5: Token NO expirado pero falta access_token (sospechoso)
    if not access_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "missing_access_token",
            "can_reconnect": True
        }
    
    # Caso 6: Token válido, access_token existe
    # SI falta refresh_token PERO token NO expirado → connected (permisivo)
    # El token actual funciona, solo requerirá reconexion cuando expire
    if not refresh_token:
        # Token funcional pero sin refresh_token (requiere atención futura)
        return {
            "connection_status": "connected",
            "reason": "limited_no_refresh",  # Opcional: para UI informativa
            "can_reconnect": False
        }
    
    # Caso 7: Todo OK - token válido, access_token existe, puede o no tener refresh_token
    return {
        "connection_status": "connected",
        "reason": None,
        "can_reconnect": False
    }


@app.get("/me/cloud-status")
async def get_cloud_status(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get detailed connection status for all cloud slots.
    
    Returns account status including connection state, reason for disconnection,
    and whether the account can be reconnected. This endpoint helps distinguish
    between slots that exist historically vs accounts that are actually usable.
    
    Connection statuses:
    - connected: Account has valid tokens and is usable
    - needs_reconnect: Slot exists but account requires reauthorization
    - disconnected: Slot was manually disconnected
    
    Returns:
        {
            "accounts": [
                {
                    "slot_log_id": "uuid",
                    "slot_number": 1,
                    "slot_is_active": true,
                    "provider": "google_drive",
                    "provider_email": "user@gmail.com",
                    "provider_account_id": "google-id-123",
                    "connection_status": "connected",
                    "reason": null,
                    "can_reconnect": false,
                    "cloud_account_id": 42,
                    "has_refresh_token": true,
                    "account_is_active": true
                }
            ],
            "summary": {
                "total_slots": 2,
                "active_slots": 2,
                "connected": 1,
                "needs_reconnect": 1,
                "disconnected": 0
            }
        }
    """
    try:
        # 1. Fetch all slots (active and inactive)
        slots_result = supabase.table("cloud_slots_log").select("*").eq("user_id", user_id).order("slot_number").execute()
        
        accounts_status = []
        summary = {"connected": 0, "needs_reconnect": 0, "disconnected": 0}
        
        for slot in slots_result.data:
            # 2. Try to find matching cloud_account
            # CRITICAL: Normalizar provider_account_id (strip) en ambos lados para evitar mismatch
            slot_provider_id = str(slot["provider_account_id"]).strip() if slot.get("provider_account_id") else ""
            
            # Buscar por google_account_id normalizado
            cloud_account_result = supabase.table("cloud_accounts").select("*").eq("user_id", user_id).execute()
            
            # Filtrar manualmente con normalización
            cloud_account = None
            for acc in (cloud_account_result.data or []):
                acc_google_id = str(acc.get("google_account_id", "")).strip()
                if acc_google_id == slot_provider_id:
                    cloud_account = acc
                    break
            
            # 3. Classify status
            status = classify_account_status(slot, cloud_account)
            
            # 4. Build response
            accounts_status.append({
                "slot_log_id": slot["id"],
                "slot_number": slot["slot_number"],
                "slot_is_active": slot["is_active"],
                "provider": slot["provider"],
                "provider_email": slot["provider_email"],
                "provider_account_id": slot["provider_account_id"],
                "connection_status": status["connection_status"],
                "reason": status["reason"],
                "can_reconnect": status["can_reconnect"],
                "cloud_account_id": cloud_account["id"] if cloud_account else None,
                "has_refresh_token": bool(cloud_account and cloud_account.get("refresh_token")),
                "account_is_active": cloud_account["is_active"] if cloud_account else False
            })
            
            summary[status["connection_status"]] += 1
        
        return {
            "accounts": accounts_status,
            "summary": {
                "total_slots": len(slots_result.data),
                "active_slots": len([s for s in slots_result.data if s["is_active"]]),
                **summary
            }
        }
    
    except Exception as e:
        logger.error(f"[CLOUD STATUS ERROR] user_id={user_id} error={str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch cloud status: {str(e)}")


@app.get("/me/slots")
async def get_user_slots(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get all historical cloud slots (active and inactive) for the authenticated user.
    
    Returns:
        {
            "slots": [
                {
                    "id": "uuid",
                    "provider": "google_drive",
                    "provider_email": "user@gmail.com",
                    "slot_number": 1,
                    "is_active": true,
                    "connected_at": "2025-12-01T00:00:00Z",
                    "disconnected_at": null,
                    "plan_at_connection": "free"
                }
            ]
        }
    
    Security:
    - Only returns slots for authenticated user
    - No PII in URL (querystring)
    - Minimal field exposure: provider_account_id REMOVED (no necesario para UI)
    - UI reconecta via OAuth, no necesita account_id interno
    """
    try:
        # IMPORTANTE: NO devolver provider_account_id (identificador interno, no necesario)
        slots_result = supabase.table("cloud_slots_log").select(
            "id,provider,provider_email,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
        ).eq("user_id", user_id).order("slot_number").execute()
        
        return {"slots": slots_result.data or []}
    except Exception as e:
        import logging
        logging.error(f"[SLOTS ERROR] Failed to fetch slots for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch slots: {str(e)}")


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
