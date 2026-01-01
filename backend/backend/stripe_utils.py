"""
Stripe utilities for Cloud Aggregator.

Pure functions for Stripe integration (no API calls, no side effects).
Production-ready with environment variable configuration.
"""

import os
import logging
from typing import Optional


# Stripe price IDs (loaded from environment variables)
# These must be set in production via Fly.io secrets
STRIPE_PRICE_PLUS = os.getenv("STRIPE_PRICE_PLUS")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO")

# Validate configuration on module load
if not STRIPE_PRICE_PLUS or not STRIPE_PRICE_PRO:
    logging.warning(
        "[STRIPE_CONFIG] ⚠️ Missing STRIPE_PRICE_PLUS or STRIPE_PRICE_PRO environment variables. "
        "Stripe functionality will be disabled."
    )

# Allowlist of valid price IDs (dynamically built from env vars)
VALID_PRICE_IDS = {STRIPE_PRICE_PLUS, STRIPE_PRICE_PRO} - {None}


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
        "plus" for PLUS plan
        "pro" for PRO plan
        None for invalid/unknown price_id
        
    Examples:
        >>> map_price_to_plan("price_1SiPP5JtzJiOgNkJ0Yy2fNEi")
        "plus"
        
        >>> map_price_to_plan("price_1SiPRdJtzJiOgNkJyOQ2XxCX")
        "pro"
        
        >>> map_price_to_plan("price_invalid_123")
        None
        
        >>> map_price_to_plan("")
        None
    """
    # Strict allowlist check
    if not price_id or price_id not in VALID_PRICE_IDS:
        return None
    
    # Map to internal plan codes
    if price_id == STRIPE_PRICE_PLUS:
        return "plus"
    elif price_id == STRIPE_PRICE_PRO:
        return "pro"
    
    # Fallback (should never reach here due to allowlist check)
    return None


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
