"""
Quota management system for copy operations
Phase 1: Safe implementation with atomic operations
"""
from datetime import datetime
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
            "clouds_allowed": 2,
            "clouds_connected": 1,
            "clouds_remaining": 1,
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
    
    # Count connected clouds
    count_result = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).execute()
    clouds_connected = len(count_result.data) if count_result.data else 0
    
    copies_used = plan["copies_used_month"]
    copies_limit = plan["copies_limit_month"]
    
    return {
        "plan": plan_name,
        # Backward-compatible keys (copy quota)
        "used": copies_used,
        "limit": copies_limit,
        "remaining": copies_limit - copies_used,
        # New cloud limit fields
        "clouds_allowed": clouds_allowed,
        "clouds_connected": clouds_connected,
        "clouds_remaining": max(0, clouds_allowed - clouds_connected),
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
    Check if user can connect a new cloud account based on plan limits.
    
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
