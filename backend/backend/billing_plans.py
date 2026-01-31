"""
Centralized billing plan limits - Single Source of Truth
Usage: from backend.billing_plans import get_plan_limits

All limits defined in BYTES for precision. Frontend converts to GB for display.

Plans:
- Free: 5GB/month, 50 emails/month, 2 threads
- Standard Monthly: 100GB/month, unlimited emails, 10 threads, $9.99/month
- Standard Yearly: 1200GB/year (100GB/month), unlimited emails, 10 threads, $59.99/year
- Premium Monthly: 200GB/month, unlimited emails, 10 threads, scheduled, $17.99/month
- Premium Yearly: 2400GB/year (200GB/month), unlimited emails, 10 threads, scheduled, $99.98/year
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class PlanLimits:
    """Billing plan limits configuration"""
    plan_name: str
    plan_type: str  # "FREE" | "PAID_MONTHLY" | "PAID_YEARLY"
    billing_period: str  # "MONTHLY" | "YEARLY"
    price_monthly: float  # Precio efectivo por mes
    price_total: float  # Precio total a pagar
    
    # Cloud slots
    clouds_slots_total: int
    
    # Copy quota (None = unlimited)
    copies_limit_month: Optional[int]
    
    # Transfer bandwidth (in BYTES)
    transfer_bytes_limit_month: int  # Límite mensual
    
    # File size (in BYTES)
    max_file_bytes: int


# Official plan definitions
PLANS = {
    "free": PlanLimits(
        plan_name="free",
        plan_type="FREE",
        billing_period="MONTHLY",
        price_monthly=0.0,
        price_total=0.0,
        clouds_slots_total=2,
        copies_limit_month=50,  # 50 conversions/month
        transfer_bytes_limit_month=5_368_709_120,  # 5GB/month
        max_file_bytes=1_073_741_824  # 1GB max file
    ),
    "standard_monthly": PlanLimits(
        plan_name="standard_monthly",
        plan_type="PAID_MONTHLY",
        billing_period="MONTHLY",
        price_monthly=9.99,
        price_total=9.99,
        clouds_slots_total=10,
        copies_limit_month=None,  # Unlimited
        transfer_bytes_limit_month=107_374_182_400,  # 100GB/month
        max_file_bytes=5_368_709_120  # 5GB max file
    ),
    "standard_yearly": PlanLimits(
        plan_name="standard_yearly",
        plan_type="PAID_YEARLY",
        billing_period="YEARLY",
        price_monthly=5.00,  # $59.99/12 = ~$5/month
        price_total=59.99,
        clouds_slots_total=10,
        copies_limit_month=None,  # Unlimited
        transfer_bytes_limit_month=107_374_182_400,  # 100GB/month (1200GB/year)
        max_file_bytes=5_368_709_120  # 5GB max file
    ),
    "premium_monthly": PlanLimits(
        plan_name="premium_monthly",
        plan_type="PAID_MONTHLY",
        billing_period="MONTHLY",
        price_monthly=17.99,
        price_total=17.99,
        clouds_slots_total=10,
        copies_limit_month=None,  # Unlimited
        transfer_bytes_limit_month=214_748_364_800,  # 200GB/month
        max_file_bytes=10_737_418_240  # 10GB max file
    ),
    "premium_yearly": PlanLimits(
        plan_name="premium_yearly",
        plan_type="PAID_YEARLY",
        billing_period="YEARLY",
        price_monthly=8.33,  # $99.98/12 = ~$8.33/month
        price_total=99.98,
        clouds_slots_total=10,
        copies_limit_month=None,  # Unlimited
        transfer_bytes_limit_month=214_748_364_800,  # 200GB/month (2400GB/year)
        max_file_bytes=10_737_418_240  # 10GB max file
    ),
    # Legacy plans for backward compatibility
    "plus": PlanLimits(
        plan_name="plus",
        plan_type="PAID_MONTHLY",
        billing_period="MONTHLY",
        price_monthly=5.0,
        price_total=5.0,
        clouds_slots_total=3,
        copies_limit_month=1000,
        transfer_bytes_limit_month=214_748_364_800,  # 200GB
        max_file_bytes=10_737_418_240  # 10GB
    ),
    "pro": PlanLimits(
        plan_name="pro",
        plan_type="PAID_MONTHLY",
        billing_period="MONTHLY",
        price_monthly=10.0,
        price_total=10.0,
        clouds_slots_total=7,
        copies_limit_month=5000,
        transfer_bytes_limit_month=1_099_511_627_776,  # 1TB
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
