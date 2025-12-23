"""
Quota management system for copy operations
Phase 2: Slot-based historical tracking with FREE/PAID differentiation
"""
from datetime import datetime, timezone
from typing import Dict, Optional
from fastapi import HTTPException
from supabase import Client
import uuid


# Plan cloud account limits
PLAN_CLOUD_LIMITS = {
    "free": 2,
    "plus": 3,
    "pro": 7
}


def get_or_create_user_plan(supabase: Client, user_id: str) -> Dict:
    """
    Get user's plan, create if doesn't exist.
    Auto-reset if new month started.
    
    Args:
        supabase: Supabase client with SERVICE_ROLE_KEY
        user_id: User UUID from auth
    
    Returns:
        Dict with plan, used, limit, period_start
    """
    # Try to get existing plan
    result = supabase.table("user_plans").select("*").eq("user_id", user_id).execute()
    
    if result.data and len(result.data) > 0:
        plan = result.data[0]
        
        # Check if month changed - auto reset
        period_start = datetime.fromisoformat(plan["period_start"].replace("Z", "+00:00"))
        now = datetime.now(period_start.tzinfo)
        
        if period_start.month != now.month or period_start.year != now.year:
            # Reset for new month
            updated = supabase.table("user_plans").update({
                "copies_used_month": 0,
                "period_start": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat(),
                "updated_at": now.isoformat()
            }).eq("user_id", user_id).execute()
            
            return updated.data[0]
        
        return plan
    else:
        # Create new plan (free tier)
        now = datetime.now()
        new_plan = {
            "user_id": user_id,
            "plan": "free",
            "copies_used_month": 0,
            "copies_limit_month": 20,
            "period_start": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        }
        
        created = supabase.table("user_plans").insert(new_plan).execute()
        return created.data[0]


def check_quota_available(supabase: Client, user_id: str) -> Dict:
    """
    Check if user has quota available.
    Raises HTTPException(402) if quota exceeded.
    
    Returns:
        Dict with used, limit, remaining
    """
    plan = get_or_create_user_plan(supabase, user_id)
    
    used = plan["copies_used_month"]
    limit = plan["copies_limit_month"]
    remaining = limit - used
    
    if used >= limit:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "quota_exceeded",
                "message": "Has alcanzado el límite de copias este mes.",
                "used": used,
                "limit": limit
            }
        )
    
    return {
        "used": used,
        "limit": limit,
        "remaining": remaining
    }


def create_copy_job(
    supabase: Client,
    user_id: str,
    source_account_id: int,
    target_account_id: int,
    file_id: str,
    file_name: Optional[str] = None
) -> str:
    """
    Create a new copy job with status='pending'.
    
    Returns:
        job_id (UUID as string)
    """
    job = {
        "user_id": user_id,
        "source_account_id": source_account_id,
        "target_account_id": target_account_id,
        "file_id": file_id,
        "file_name": file_name,
        "status": "pending"
    }
    
    result = supabase.table("copy_jobs").insert(job).execute()
    return result.data[0]["id"]


def complete_copy_job_success(supabase: Client, job_id: str, user_id: str) -> None:
    """
    Mark job as success AND increment quota atomically.
    Only increments if job was 'pending' (prevents double increment).
    
    Args:
        supabase: Supabase client with SERVICE_ROLE_KEY
        job_id: UUID of the job
        user_id: User UUID (for security)
    """
    # 1. Update job to success (only if currently pending)
    job_result = supabase.table("copy_jobs").update({
        "status": "success",
        "finished_at": datetime.now().isoformat()
    }).eq("id", job_id).eq("status", "pending").execute()
    
    # If no rows updated, job was already completed (idempotency)
    if not job_result.data or len(job_result.data) == 0:
        # Job already processed, don't increment again
        return
    
    # 2. Increment quota ATOMICALLY (SQL-level increment to prevent race conditions)
    # Using PostgreSQL's native increment avoids read-modify-write race
    supabase.rpc("increment_user_quota", {"p_user_id": user_id}).execute()


def complete_copy_job_failed(supabase: Client, job_id: str, error_message: str) -> None:
    """
    Mark job as failed. Does NOT increment quota.
    
    Args:
        job_id: UUID of the job
        error_message: Error description
    """
    supabase.table("copy_jobs").update({
        "status": "failed",
        "error_message": error_message,
        "finished_at": datetime.now().isoformat()
    }).eq("id", job_id).execute()


def get_user_quota_info(supabase: Client, user_id: str) -> Dict:
    """
    Get user's current quota status.
    
    Returns:
        {
            "plan": "free",
            "used": 5,
            "limit": 20,
            "remaining": 15,
            # DEPRECATED (ambiguous) - use explicit fields below:
            "clouds_allowed": 2,
            "clouds_connected": 1,
            "clouds_remaining": 1,
            # NEW EXPLICIT FIELDS (preferred):
            "historical_slots_used": 2,      # Lifetime slots consumed (never decreases)
            "historical_slots_total": 2,     # Slots allowed by plan (free=2 + extras)
            "active_clouds_connected": 1,    # Currently active cloud accounts
            "copies_used_month": 5,
            "copies_limit_month": 20
        }
    """
    plan = get_or_create_user_plan(supabase, user_id)
    
    # Calculate cloud limits
    plan_name = plan.get("plan", "free")
    max_clouds = PLAN_CLOUD_LIMITS.get(plan_name, 1)
    extra_clouds = plan.get("extra_clouds", 0)
    clouds_allowed = max_clouds + extra_clouds
    
    # Count ACTIVE connected clouds (for UI display)
    active_count_result = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).eq("is_active", True).execute()
    active_clouds_connected = len(active_count_result.data) if active_count_result.data else 0
    
    # Historical slots (lifetime, never decreases) - FALLBACK ROBUSTO
    # Prioridad 1: usar clouds_slots_used del plan (incremental, mantenido por connect_cloud_account_with_slot)
    # Prioridad 2: si es NULL/0 inconsistente, contar DISTINCT desde cloud_slots_log (fuente de verdad)
    historical_slots_used_from_plan = plan.get("clouds_slots_used", 0)
    
    if historical_slots_used_from_plan == 0:
        # Fallback: contar slots únicos desde cloud_slots_log (incluye activos e inactivos)
        slots_count_result = supabase.table("cloud_slots_log").select("provider_account_id").eq("user_id", user_id).execute()
        # COUNT DISTINCT provider_account_id (cada cuenta única cuenta como 1 slot)
        unique_provider_accounts = set()
        if slots_count_result.data:
            for slot in slots_count_result.data:
                provider_id = slot.get("provider_account_id")
                # Filtrar NULL, empty strings, y whitespace (defensa contra data inconsistente)
                if provider_id and str(provider_id).strip():
                    unique_provider_accounts.add(provider_id)
        historical_slots_used = len(unique_provider_accounts)
        
        import logging
        logging.warning(f"[FALLBACK SLOTS] user_id={user_id} - plan.clouds_slots_used era 0, usando COUNT desde cloud_slots_log: {historical_slots_used}")
    else:
        historical_slots_used = historical_slots_used_from_plan
    
    historical_slots_total = plan.get("clouds_slots_total", 2)  # Default FREE=2
    
    copies_used = plan["copies_used_month"]
    copies_limit = plan["copies_limit_month"]
    
    return {
        "plan": plan_name,
        # Backward-compatible keys (copy quota)
        "used": copies_used,
        "limit": copies_limit,
        "remaining": copies_limit - copies_used,
        # DEPRECATED cloud limit fields (kept for backward compat, but UI should migrate)
        "clouds_allowed": clouds_allowed,
        "clouds_connected": active_clouds_connected,  # Changed to active count for accuracy
        "clouds_remaining": max(0, historical_slots_total - historical_slots_used),
        # NEW EXPLICIT FIELDS (PREFERRED - use these for gating):
        "historical_slots_used": historical_slots_used,
        "historical_slots_total": historical_slots_total,
        "active_clouds_connected": active_clouds_connected,
        # Explicit copy quota fields
        "copies_used_month": copies_used,
        "copies_limit_month": copies_limit
    }


def check_rate_limit(supabase: Client, user_id: str) -> None:
    """
    Check if user is within rate limits for copy operations.
    
    Rules:
    - Maximum 1 copy per 10 seconds
    - Maximum 5 copies per minute
    
    Counts ALL copy attempts (success/pending/failed) to prevent spam.
    Can be disabled with RATE_LIMIT_DISABLED=true env var (dev only).
    
    Raises:
        HTTPException(429) if rate limit exceeded
    """
    import os
    from datetime import timedelta, timezone
    
    # Allow disabling rate limit in development only
    if os.getenv("RATE_LIMIT_DISABLED", "false").lower() == "true":
        return
    
    # Use UTC timezone-aware datetime (Supabase stores timestamps in UTC)
    now = datetime.now(timezone.utc)
    
    # Check last 10 seconds (max 1 copy attempt)
    # Count ALL attempts (including failed) to prevent spam
    ten_seconds_ago = (now - timedelta(seconds=10)).isoformat()
    recent_jobs = supabase.table("copy_jobs").select("id,created_at,status").eq("user_id", user_id).gte("created_at", ten_seconds_ago).execute()
    
    # DEBUG logging (only in dev)
    if os.getenv("DEBUG_RATE_LIMIT", "false").lower() == "true":
        print(f"[RATE_LIMIT DEBUG] UTC now: {now.isoformat()}")
        print(f"[RATE_LIMIT DEBUG] 10s window start: {ten_seconds_ago}")
        print(f"[RATE_LIMIT DEBUG] Found {len(recent_jobs.data) if recent_jobs.data else 0} jobs in last 10s for user {user_id}")
        if recent_jobs.data:
            for job in recent_jobs.data:
                print(f"  - Job {job['id']}: status={job.get('status')}, created_at={job.get('created_at')}")
    
    if recent_jobs.data and len(recent_jobs.data) >= 1:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Por favor espera 10 segundos entre copias.",
                "retry_after": 10
            }
        )
    
    # Check last 60 seconds (max 5 copy attempts)
    # Count ALL attempts (including failed) to prevent spam
    one_minute_ago = (now - timedelta(seconds=60)).isoformat()
    minute_jobs = supabase.table("copy_jobs").select("id").eq("user_id", user_id).gte("created_at", one_minute_ago).execute()
    
    if minute_jobs.data and len(minute_jobs.data) >= 5:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Has excedido el límite de 5 copias por minuto. Espera un momento.",
                "retry_after": 60
            }
        )


def check_cloud_limit(supabase: Client, user_id: str, google_account_id: str) -> None:
    """
    LEGACY: Check if user can connect a new cloud account based on plan limits.
    Use check_cloud_limit_with_slots for slot-based enforcement.
    
    Args:
        supabase: Supabase client with SERVICE_ROLE_KEY
        user_id: User UUID from auth
        google_account_id: Google account ID being connected
    
    Raises:
        HTTPException(402) if cloud account limit exceeded
    """
    # Get user plan
    plan = get_or_create_user_plan(supabase, user_id)
    
    # Calculate allowed clouds
    plan_name = plan.get("plan", "free")
    max_clouds = PLAN_CLOUD_LIMITS.get(plan_name, 1)
    extra_clouds = plan.get("extra_clouds", 0)
    allowed_clouds = max_clouds + extra_clouds
    
    # Check if this google_account_id is already connected for this user
    existing = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).eq("google_account_id", google_account_id).execute()
    if existing.data and len(existing.data) > 0:
        # Re-authenticating existing account - allow
        return
    
    # Count current connected accounts
    count_result = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).execute()
    current_count = len(count_result.data) if count_result.data else 0
    
    # Check limit
    if current_count >= allowed_clouds:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "cloud_limit_reached",
                "message": f"Has alcanzado el límite de {allowed_clouds} cuenta(s) para tu plan {plan_name}.",
                "allowed": allowed_clouds,
                "current": current_count
            }
        )


def check_cloud_limit_with_slots(supabase: Client, user_id: str, provider: str, provider_account_id: str) -> None:
    """
    Check if user can connect a new cloud account using slot-based historical tracking.
    
    PRIORITY: Reconnection takes precedence over slot limits (salvoconducto).
    
    Rules:
    1. If account exists in cloud_slots_log → ALLOW immediately (reuses slot)
    2. Only if NEW account → validate clouds_slots_used < clouds_slots_total
    3. Slots are permanent (never expire for FREE plan)
    
    Args:
        supabase: Supabase client with SERVICE_ROLE_KEY
        user_id: User UUID from auth
        provider: Cloud provider type (google_drive, onedrive, dropbox)
        provider_account_id: Unique account ID from provider
    
    Raises:
        HTTPException(402) if slot limit exceeded for NEW accounts only
        HTTPException(400) if provider_account_id is empty/invalid
    """
    import logging
    
    # HARDENING 1: Validación temprana de provider_account_id (rechazar vacío/null)
    if not provider_account_id:
        logging.error(f"[VALIDATION ERROR] provider_account_id vacío para user_id={user_id}, provider={provider}")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_account_id",
                "message": "Provider account ID is required and cannot be empty"
            }
        )
    
    # HARDENING 2: Normalización estricta (strip whitespace, convertir a string)
    normalized_id = str(provider_account_id).strip()
    
    # Verificar que después de normalizar no quedó vacío
    if not normalized_id:
        logging.error(f"[VALIDATION ERROR] provider_account_id solo whitespace para user_id={user_id}, provider={provider}")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_account_id",
                "message": "Provider account ID cannot be empty or whitespace only"
            }
        )
    
    logging.info(f"[SLOT CHECK] Iniciando validación - user_id={user_id}, provider={provider}, account_id_recibido={normalized_id}")
    logging.info(f"[SLOT CHECK DEBUG] normalized_id='{normalized_id}' (type={type(normalized_id).__name__}, len={len(normalized_id)})")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PRIORIDAD 1: SALVOCONDUCTO DE RECONEXIÓN (Sin validar límites)
    # ═══════════════════════════════════════════════════════════════════════════
    # HARDENING 3: Query salvoconducto con 3 filtros (user_id + provider + provider_account_id normalizado)
    # Esto previene colisiones entre providers (ej. Google ID "123" vs OneDrive ID "123")
    existing_slot = supabase.table("cloud_slots_log").select("id, is_active, slot_number, provider_account_id").eq("user_id", user_id).eq("provider", provider).eq("provider_account_id", normalized_id).execute()
    
    logging.info(f"[SLOT CHECK DEBUG] Query result: found={len(existing_slot.data) if existing_slot.data else 0} slots")
    if existing_slot.data and len(existing_slot.data) > 0:
        logging.info(f"[SLOT CHECK DEBUG] Slot data: {existing_slot.data[0]}")
    
    if existing_slot.data and len(existing_slot.data) > 0:
        slot_info = existing_slot.data[0]
        logging.info(f"[SALVOCONDUCTO ✓] Slot histórico encontrado - slot_id={slot_info['id']}, slot_number={slot_info['slot_number']}, is_active={slot_info['is_active']}")
        return  # ALLOW (reuses existing slot)
    
    logging.info(f"[NEW ACCOUNT] No se encontró slot histórico para account_id={normalized_id}. Validando límites...")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PRIORIDAD 2: VALIDACIÓN DE CUENTA NUEVA (Solo si no existe en historial)
    # ═══════════════════════════════════════════════════════════════════════════
    # Get user plan and slots configuration from DB (not hardcoded)
    plan = get_or_create_user_plan(supabase, user_id)
    clouds_slots_total = plan.get("clouds_slots_total", 2)  # Default: 2 for FREE
    clouds_slots_used = plan.get("clouds_slots_used", 0)
    plan_name = plan.get("plan", "free")
    
    logging.info(f"[SLOT VALIDATION] Plan={plan_name}, slots_used={clouds_slots_used}, slots_total={clouds_slots_total}")
    
    # Nueva cuenta - verificar disponibilidad de slots
    if clouds_slots_used >= clouds_slots_total:
        logging.warning(f"[SLOT LIMIT ✗] Usuario {user_id} ha excedido el límite de slots: {clouds_slots_used}/{clouds_slots_total}")
        
        # Mensaje diferenciado para FREE vs PAID (sin exponer PII en respuesta)
        if plan_name == "free":
            message = f"Has usado tus {clouds_slots_total} slots históricos. Puedes reconectar tus cuentas anteriores en cualquier momento, pero no puedes agregar cuentas nuevas en plan FREE. Actualiza a un plan PAID para conectar más cuentas."
        else:
            message = f"Has alcanzado el límite de {clouds_slots_total} cuenta(s) únicas para tu plan {plan_name}."
        
        raise HTTPException(
            status_code=402,
            detail={
                "error": "cloud_limit_reached",
                "message": message,
                "allowed": clouds_slots_total,
                "used": clouds_slots_used
            }
        )
    
    logging.info(f"[SLOT VALIDATION ✓] Usuario puede conectar nueva cuenta. Slots disponibles: {clouds_slots_total - clouds_slots_used}")


def connect_cloud_account_with_slot(
    supabase: Client,
    user_id: str,
    provider: str,
    provider_account_id: str,
    provider_email: str
) -> Dict:
    """
    Register a new cloud account slot or reactivate an existing one.
    
    If the account was previously connected:
    - Reactivates the existing slot (is_active=true, disconnected_at=NULL)
    - Does NOT increment clouds_slots_used
    
    If the account is new:
    - Creates a new slot in cloud_slots_log
    - Increments clouds_slots_used in user_plans
    
    Args:
        supabase: Supabase client
        user_id: User UUID
        provider: Cloud provider (google_drive, onedrive, dropbox)
        provider_account_id: Unique account ID from provider
        provider_email: Email of the provider account
    
    Returns:
        Dict with slot info (id, slot_number, is_new)
    
    Raises:
        HTTPException(400) if provider_account_id is empty/invalid
    """
    import logging
    
    # HARDENING: Validación temprana de provider_account_id
    if not provider_account_id:
        logging.error(f"[VALIDATION ERROR] provider_account_id vacío en connect_cloud_account_with_slot - user_id={user_id}, provider={provider}")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_account_id",
                "message": "Provider account ID is required"
            }
        )
    
    # HARDENING: Normalización estricta consistente
    normalized_id = str(provider_account_id).strip()
    
    if not normalized_id:
        logging.error(f"[VALIDATION ERROR] provider_account_id solo whitespace - user_id={user_id}, provider={provider}")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_account_id",
                "message": "Provider account ID cannot be whitespace only"
            }
        )
    
    logging.info(f"[SLOT LINK] Vinculando slot - user_id={user_id}, provider={provider}, account_id={normalized_id}, email={provider_email}")
    
    # HARDENING: Query con filtro triple (user_id + provider + provider_account_id normalizado)
    # Check if slot already exists (reconnection scenario)
    existing = supabase.table("cloud_slots_log").select("*").eq("user_id", user_id).eq("provider", provider).eq("provider_account_id", normalized_id).execute()
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    if existing.data and len(existing.data) > 0:
        # RECONNECTION: Reactivate existing slot
        slot = existing.data[0]
        slot_id = slot["id"]
        
        logging.info(f"[RECONEXIÓN] Reactivando slot existente - slot_id={slot_id}, slot_number={slot['slot_number']}")
        
        updated = supabase.table("cloud_slots_log").update({
            "is_active": True,
            "disconnected_at": None
        }).eq("id", slot_id).execute()
        
        return {
            "id": slot_id,
            "slot_number": slot["slot_number"],
            "is_new": False,
            "reconnected": True
        }
    else:
        # NEW ACCOUNT: Create new slot and increment counter
        logging.info(f"[NUEVA CUENTA] Creando nuevo slot para account_id={normalized_id}")
        
        plan = get_or_create_user_plan(supabase, user_id)
        plan_name = plan.get("plan", "free")
        
        # Get next slot number for this user
        max_slot = supabase.table("cloud_slots_log").select("slot_number").eq("user_id", user_id).order("slot_number", desc=True).limit(1).execute()
        next_slot_number = 1
        if max_slot.data and len(max_slot.data) > 0:
            next_slot_number = max_slot.data[0]["slot_number"] + 1
        
        # HARDENING: Create new slot con provider_account_id NORMALIZADO
        # Esto garantiza que TODOS los inserts usan el mismo formato (sin whitespace)
        new_slot = {
            "user_id": user_id,
            "provider": provider,
            "provider_account_id": normalized_id,  # SIEMPRE normalizado (strip whitespace)
            "provider_email": provider_email,
            "slot_number": next_slot_number,
            "plan_at_connection": plan_name,
            "connected_at": now_iso,
            "is_active": True,
            "slot_expires_at": None  # NULL for FREE (permanent)
        }
        
        created = supabase.table("cloud_slots_log").insert(new_slot).execute()
        slot_id = created.data[0]["id"]
        
        logging.info(f"[SLOT CREATED] Nuevo slot creado - slot_id={slot_id}, slot_number={next_slot_number}")
        
        # Increment clouds_slots_used in user_plans
        new_slots_used = plan.get("clouds_slots_used", 0) + 1
        supabase.table("user_plans").update({
            "clouds_slots_used": new_slots_used,
            "updated_at": now_iso
        }).eq("user_id", user_id).execute()
        
        logging.info(f"[SLOT COUNTER] Incrementado clouds_slots_used a {new_slots_used} para user_id={user_id}")
        
        return {
            "id": slot_id,
            "slot_number": next_slot_number,
            "is_new": True,
            "reconnected": False
        }


def check_quota_available_hybrid(supabase: Client, user_id: str) -> Dict:
    """
    Check quota availability with FREE/PAID differentiation.
    
    FREE users:
    - Check total_lifetime_copies against 20 (no reset)
    - Raises 402 if >= 20 lifetime copies
    
    PAID users:
    - Check copies_used_month against copies_limit_month (monthly reset)
    - Raises 402 if monthly limit exceeded
    
    Raises:
        HTTPException(402) if quota exceeded
    
    Returns:
        Dict with used, limit, remaining, plan_type
    """
    plan = get_or_create_user_plan(supabase, user_id)
    
    plan_type = plan.get("plan_type", "FREE")
    plan_name = plan.get("plan", "free")
    
    if plan_type == "FREE":
        # FREE: Check lifetime copies (no reset)
        used = plan.get("total_lifetime_copies", 0)
        limit = 20  # Hardcoded limit for FREE
        remaining = limit - used
        
        if used >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "quota_exceeded",
                    "message": "Has alcanzado el límite de 20 copias de por vida para el plan FREE. Actualiza a un plan PAID para copias ilimitadas.",
                    "used": used,
                    "limit": limit,
                    "plan_type": "FREE"
                }
            )
        
        return {
            "used": used,
            "limit": limit,
            "remaining": remaining,
            "plan_type": "FREE",
            "plan": plan_name
        }
    else:
        # PAID: Check monthly copies (with reset)
        used = plan.get("copies_used_month", 0)
        limit = plan.get("copies_limit_month", 999999)  # Unlimited for PAID
        remaining = limit - used
        
        if used >= limit:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "quota_exceeded",
                    "message": f"Has alcanzado el límite de {limit} copias este mes.",
                    "used": used,
                    "limit": limit,
                    "plan_type": "PAID"
                }
            )
        
        return {
            "used": used,
            "limit": limit,
            "remaining": remaining,
            "plan_type": "PAID",
            "plan": plan_name
        }
