"""
Quota management system for copy operations
Phase 1: Safe implementation with atomic operations
"""
from datetime import datetime
from typing import Dict, Optional
from fastapi import HTTPException
from supabase import Client
import uuid


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
            "remaining": 15
        }
    """
    plan = get_or_create_user_plan(supabase, user_id)
    
    return {
        "plan": plan["plan"],
        "used": plan["copies_used_month"],
        "limit": plan["copies_limit_month"],
        "remaining": plan["copies_limit_month"] - plan["copies_used_month"]
    }


def check_rate_limit(supabase: Client, user_id: str) -> None:
    """
    Check if user is within rate limits for copy operations.
    
    Rules:
    - Maximum 1 copy per 10 seconds
    - Maximum 5 copies per minute
    
    Raises:
        HTTPException(429) if rate limit exceeded
    """
    from datetime import timedelta
    
    now = datetime.now()
    
    # Check last 10 seconds (max 1 copy)
    ten_seconds_ago = (now - timedelta(seconds=10)).isoformat()
    recent_jobs = supabase.table("copy_jobs").select("id").eq("user_id", user_id).gte("created_at", ten_seconds_ago).execute()
    
    if recent_jobs.data and len(recent_jobs.data) >= 1:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Por favor espera 10 segundos entre copias.",
                "retry_after": 10
            }
        )
    
    # Check last 60 seconds (max 5 copies)
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
