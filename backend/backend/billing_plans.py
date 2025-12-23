"""
Centralized billing plan limits - Single Source of Truth
Usage: from backend.billing_plans import get_plan_limits

All limits defined in BYTES for precision. Frontend converts to GB for display.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class PlanLimits:
    """Billing plan limits configuration"""
    plan_name: str
    plan_type: str  # "FREE" | "PAID"
    price_monthly: float
    
    # Cloud slots
    clouds_slots_total: int
    
    # Copy quota
    copies_limit_month: Optional[int]  # None = N/A (uses lifetime for FREE)
    copies_limit_lifetime: Optional[int]  # None = N/A (uses monthly for PAID)
    
    # Transfer bandwidth (in BYTES)
    transfer_bytes_limit_month: Optional[int]  # None = N/A for FREE
    transfer_bytes_limit_lifetime: Optional[int]  # None = N/A for PAID
    
    # File size (in BYTES)
    max_file_bytes: int


# Official plan definitions
PLANS = {
    "free": PlanLimits(
        plan_name="free",
        plan_type="FREE",
        price_monthly=0.0,
        clouds_slots_total=2,
        copies_limit_month=None,  # N/A, uses lifetime
        copies_limit_lifetime=20,
        transfer_bytes_limit_month=None,  # N/A, uses lifetime
        transfer_bytes_limit_lifetime=5_368_709_120,  # 5GB
        max_file_bytes=1_073_741_824  # 1GB
    ),
    "plus": PlanLimits(
        plan_name="plus",
        plan_type="PAID",
        price_monthly=5.0,
        clouds_slots_total=5,
        copies_limit_month=1000,
        copies_limit_lifetime=None,  # N/A for PAID
        transfer_bytes_limit_month=214_748_364_800,  # 200GB
        transfer_bytes_limit_lifetime=None,  # N/A for PAID
        max_file_bytes=10_737_418_240  # 10GB
    ),
    "pro": PlanLimits(
        plan_name="pro",
        plan_type="PAID",
        price_monthly=10.0,
        clouds_slots_total=10,
        copies_limit_month=5000,
        copies_limit_lifetime=None,
        transfer_bytes_limit_month=1_099_511_627_776,  # 1TB
        transfer_bytes_limit_lifetime=None,
        max_file_bytes=53_687_091_200  # 50GB
    )
}


def get_plan_limits(plan_name: str) -> PlanLimits:
    """
    Get plan limits by name. Defaults to FREE if not found.
    
    Args:
        plan_name: Plan name ('free', 'plus', 'pro')
    
    Returns:
        PlanLimits dataclass with all limits
    """
    return PLANS.get(plan_name.lower(), PLANS["free"])


def bytes_to_gb(bytes_val: int) -> float:
    """Convert bytes to GB for display purposes"""
    return bytes_val / 1_073_741_824


def gb_to_bytes(gb_val: float) -> int:
    """Convert GB to bytes for storage"""
    return int(gb_val * 1_073_741_824)
