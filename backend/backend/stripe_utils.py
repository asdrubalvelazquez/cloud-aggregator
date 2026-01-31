"""
Stripe utilities for Cloud Aggregator.

Pure functions for Stripe integration (no API calls, no side effects).
Production-ready with environment variable configuration.

Price IDs:
- Standard Monthly: price_1SvPSsJtzJiOgNkJR2fZj8sR ($9.99/month)
- Standard Yearly: price_1SvPtYJtzJiOgNkJ2hwQ0Us9 ($59.99/year)
- Premium Monthly: price_1SvPVRJtzJiOgNkJIgIiEUFw ($17.99/month)
- Premium Yearly: price_1SvPvoJtzJiOgNkJxjKgngM5 ($99.98/year)
"""

import os
import logging
from typing import Optional


# Stripe price IDs (loaded from environment variables)
# Defaults are TEST MODE Price IDs for local development
# Must be overridden in production via Fly.io secrets with LIVE mode Price IDs
STRIPE_PRICE_STANDARD_MONTHLY = os.getenv("STRIPE_PRICE_STANDARD_MONTHLY", "price_1Svf9GJtzJiOgNkJBXle45Op")
STRIPE_PRICE_STANDARD_YEARLY = os.getenv("STRIPE_PRICE_STANDARD_YEARLY", "price_1Svf88JtzJiOgNkJWKvPkoal")
STRIPE_PRICE_PREMIUM_MONTHLY = os.getenv("STRIPE_PRICE_PREMIUM_MONTHLY", "price_1Svf8hJtzJiOgNkJoeO0BgPu")
STRIPE_PRICE_PREMIUM_YEARLY = os.getenv("STRIPE_PRICE_PREMIUM_YEARLY", "price_1Svf7OJtzJiOgNkJSZRX6NsY")

# Legacy price IDs (for backward compatibility)
STRIPE_PRICE_PLUS = os.getenv("STRIPE_PRICE_PLUS")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO")

# Validate configuration on module load
if not all([STRIPE_PRICE_STANDARD_MONTHLY, STRIPE_PRICE_STANDARD_YEARLY, 
            STRIPE_PRICE_PREMIUM_MONTHLY, STRIPE_PRICE_PREMIUM_YEARLY]):
    logging.warning(
        "[STRIPE_CONFIG] ⚠️ Missing Stripe price IDs. "
        "Stripe functionality will be disabled."
    )

# Allowlist of valid price IDs (dynamically built from env vars)
VALID_PRICE_IDS = {
    STRIPE_PRICE_STANDARD_MONTHLY,
    STRIPE_PRICE_STANDARD_YEARLY,
    STRIPE_PRICE_PREMIUM_MONTHLY,
    STRIPE_PRICE_PREMIUM_YEARLY,
    STRIPE_PRICE_PLUS,  # Legacy
    STRIPE_PRICE_PRO   # Legacy
} - {None}


def map_price_to_plan(price_id: str) -> Optional[str]:
    """
    Map Stripe price_id to internal plan code.
    
    This is a pure function with strict allowlist validation.
    Used in webhook handlers to validate incoming Stripe events.
    
    Security:
    - Allowlist approach (only known price_ids accepted)
    - Returns None for invalid/unknown price_ids (safe fallback)
    - No API calls, no side effects
    
    Args:
        price_id: Stripe price ID from webhook event
        
    Returns:
        Plan code string (e.g., "standard_monthly", "premium_yearly")
        None for invalid/unknown price_id
        
    Examples:
        >>> map_price_to_plan("price_1SvPSsJtzJiOgNkJR2fZj8sR")
        "standard_monthly"
        
        >>> map_price_to_plan("price_1SvPtYJtzJiOgNkJ2hwQ0Us9")
        "standard_yearly"
        
        >>> map_price_to_plan("price_invalid_123")
        None
    """
    # Strict allowlist check
    if not price_id or price_id not in VALID_PRICE_IDS:
        return None
    
    # Map to internal plan codes
    price_map = {
        STRIPE_PRICE_STANDARD_MONTHLY: "standard_monthly",
        STRIPE_PRICE_STANDARD_YEARLY: "standard_yearly",
        STRIPE_PRICE_PREMIUM_MONTHLY: "premium_monthly",
        STRIPE_PRICE_PREMIUM_YEARLY: "premium_yearly",
        # Legacy plans
        STRIPE_PRICE_PLUS: "plus",
        STRIPE_PRICE_PRO: "pro"
    }
    
    return price_map.get(price_id)


def validate_price_id(price_id: str) -> bool:
    """
    Validate if price_id is in the allowlist.
    
    Helper function for pre-validation in endpoints.
    
    Args:
        price_id: Stripe price ID to validate
        
    Returns:
        True if valid (in allowlist)
        False otherwise
        
    Examples:
        >>> validate_price_id("price_1SiPP5JtzJiOgNkJ0Yy2fNEi")
        True
        
        >>> validate_price_id("price_invalid")
        False
    """
    return price_id in VALID_PRICE_IDS
