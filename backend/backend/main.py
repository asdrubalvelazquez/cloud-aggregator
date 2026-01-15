import os
import hashlib
import logging
import uuid
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

import httpx
import stripe
from fastapi import FastAPI, Request, HTTPException, Depends, Header
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import supabase
from backend.crypto import encrypt_token, decrypt_token
from backend.google_drive import (
    get_storage_quota,
    list_drive_files,
    copy_file_between_accounts,
    rename_file,
    download_file_stream,
)
from backend.onedrive import (
    refresh_onedrive_token,
    list_onedrive_files,
    get_onedrive_storage_quota,
    GRAPH_API_BASE,
)
from backend.auth import create_state_token, decode_state_token, verify_supabase_jwt, get_current_user, get_jwt_user_info
from backend import quota
from backend import transfer
from backend.stripe_utils import STRIPE_PRICE_PLUS, STRIPE_PRICE_PRO, map_price_to_plan

app = FastAPI()

# CORS Configuration
# FRONTEND_URL: Canonical domain for redirects (OAuth, Stripe, etc.)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Canonical frontend domain enforcement
CANONICAL_FRONTEND_HOST = "www.cloudaggregatorapp.com"
CANONICAL_FRONTEND_ORIGIN = f"https://{CANONICAL_FRONTEND_HOST}"


def safe_frontend_origin_from_request(request: Request) -> str:
    """Return a safe frontend origin for redirects.

    Rules:
    - Never redirect to *.vercel.app
    - Only trust the request host when it is the canonical www domain
    - Otherwise fall back to FRONTEND_URL only if it matches canonical origin
    - Final fallback is the canonical origin
    """

    # Prefer forwarded headers (common behind proxies/CDNs)
    raw_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    raw_proto = request.headers.get("x-forwarded-proto") or "https"

    # If multiple values are present (comma-separated), take the first hop.
    host = raw_host.split(",", 1)[0].strip()
    proto = raw_proto.split(",", 1)[0].strip().lower()

    # Strip port if present.
    host_no_port = host.split(":", 1)[0].lower()

    if host_no_port == CANONICAL_FRONTEND_HOST:
        if proto not in ("http", "https"):
            proto = "https"
        return f"{proto}://{CANONICAL_FRONTEND_HOST}"

    # Fallback to configured FRONTEND_URL only if it is canonical.
    configured = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
    if configured == CANONICAL_FRONTEND_ORIGIN:
        return CANONICAL_FRONTEND_ORIGIN

    return CANONICAL_FRONTEND_ORIGIN

# CORS_ALLOWED_ORIGINS: Comma-separated list of allowed origins
# If not set, use defaults: FRONTEND_URL + localhost
cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS")
if cors_origins_env:
    # Use explicitly configured origins (comma-separated)
    allowed_origins = [origin.strip() for origin in cors_origins_env.split(",")]
else:
    # Default: Allow canonical domain and localhost for development
    allowed_origins = [
        FRONTEND_URL,
        "http://localhost:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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
# https://www.googleapis.com/auth/drive.file: Per-file access (archivos creados/abiertos por la app)
# https://www.googleapis.com/auth/userinfo.email: Email del usuario (identificación)
# openid: OpenID Connect (autenticación)
# NOTA: Reducido a drive.file para Google OAuth approval. La app solo accede a archivos que el usuario seleccione.
SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

# Microsoft OneDrive OAuth Configuration
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET")
MICROSOFT_TENANT_ID = os.getenv("MICROSOFT_TENANT_ID", "common")
MICROSOFT_REDIRECT_URI = os.getenv("MICROSOFT_REDIRECT_URI")

# Construct tenant-specific endpoints
MICROSOFT_AUTH_ENDPOINT = f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_ENDPOINT = f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token"
MICROSOFT_USERINFO_ENDPOINT = "https://graph.microsoft.com/v1.0/me"

# OneDrive OAuth Scopes
ONEDRIVE_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Files.ReadWrite",
]

# Stripe Configuration
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY


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


class CreateCheckoutSessionRequest(BaseModel):
    plan_code: str  # "PLUS" or "PRO"


@app.post("/stripe/create-checkout-session")
def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Create Stripe Checkout Session for subscription upgrade.
    
    Args:
        request.plan_code: "PLUS" or "PRO"
        user_id: Derived from JWT (authenticated)
    
    Returns:
        {"url": "https://checkout.stripe.com/..."}
    
    Errors:
        400: Invalid plan_code
        409: User already has active subscription
        500: Stripe API error or configuration issue
    """
    # Validation 1: Stripe configured (secret key + price IDs)
    missing_vars = []
    if not STRIPE_SECRET_KEY:
        missing_vars.append("STRIPE_SECRET_KEY")
    if not STRIPE_PRICE_PLUS:
        missing_vars.append("STRIPE_PRICE_PLUS")
    if not STRIPE_PRICE_PRO:
        missing_vars.append("STRIPE_PRICE_PRO")
    if not os.getenv("FRONTEND_URL"):
        missing_vars.append("FRONTEND_URL")
    
    if missing_vars:
        logging.error(f"[STRIPE] Missing environment variables: {', '.join(missing_vars)}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "stripe_not_configured",
                "message": "Sistema de pagos no configurado. Contacta al administrador.",
                "missing": missing_vars
            }
        )
    
    # Validation 2: plan_code allowlist
    plan_code = request.plan_code.upper()
    if plan_code not in ["PLUS", "PRO"]:
        raise HTTPException(status_code=400, detail="Invalid plan_code. Must be PLUS or PRO")
    
    # Map plan_code to Stripe price_id
    price_id = STRIPE_PRICE_PLUS if plan_code == "PLUS" else STRIPE_PRICE_PRO
    
    try:
        # Query 1: Check if user already has active subscription
        user_plan_result = supabase.table("user_plans").select(
            "stripe_customer_id, stripe_subscription_id, subscription_status, plan"
        ).eq("user_id", user_id).execute()
        
        if not user_plan_result.data:
            # User plan doesn't exist - create it first (safety fallback)
            logging.warning(f"[STRIPE] User plan not found for user_id={user_id}, creating...")
            quota.get_or_create_user_plan(supabase, user_id)
            user_plan_result = supabase.table("user_plans").select(
                "stripe_customer_id, stripe_subscription_id, subscription_status, plan"
            ).eq("user_id", user_id).execute()
        
        user_plan = user_plan_result.data[0]
        
        # Validation 3: Allow ONLY upgrades (block downgrades and lateral moves)
        # Plan hierarchy: free < plus < pro
        PLAN_HIERARCHY = {"free": 0, "plus": 1, "pro": 2}
        
        current_plan = user_plan.get("plan", "free").lower()
        target_plan = plan_code.lower()
        
        current_level = PLAN_HIERARCHY.get(current_plan, 0)
        target_level = PLAN_HIERARCHY.get(target_plan, 0)
        
        # Block if trying to downgrade or stay same
        if target_level <= current_level:
            raise HTTPException(
                status_code=409,
                detail=f"Solo se permiten upgrades. Plan actual: {current_plan.upper()}, plan solicitado: {target_plan.upper()}. Contacta soporte para cambios de plan."
            )
        
        # Query 2: Get user email for Stripe Customer
        user_result = supabase.auth.admin.get_user_by_id(user_id)
        user_email = user_result.user.email if user_result and user_result.user else None
        
        if not user_email:
            logging.error(f"[STRIPE] Could not retrieve email for user_id={user_id}")
            raise HTTPException(status_code=500, detail="Could not retrieve user information")
        
        # Detect Stripe mode (live vs test) from API key prefix
        stripe_mode = "live" if STRIPE_SECRET_KEY and STRIPE_SECRET_KEY.startswith("sk_live_") else "test"
        logging.info(f"[STRIPE] Operating in {stripe_mode.upper()} mode")
        
        # Query 3: Get or Create Stripe Customer (with mode compatibility)
        stripe_customer_id = user_plan.get("stripe_customer_id")
        
        if stripe_customer_id:
            # Validate existing customer_id works in current mode
            try:
                logging.info(f"[STRIPE] Validating existing customer: {stripe_customer_id}")
                customer = stripe.Customer.retrieve(stripe_customer_id)
                logging.info(f"[STRIPE] Customer validated successfully in {stripe_mode} mode")
            except stripe.error.InvalidRequestError as e:
                # Customer doesn't exist in current mode (e.g., test ID used with live key)
                error_message = str(e)
                if "No such customer" in error_message or "similar object exists in test mode" in error_message:
                    logging.warning(
                        f"[STRIPE] Customer {stripe_customer_id} invalid in {stripe_mode} mode "
                        f"(likely from different mode). Creating new customer. Error: {error_message}"
                    )
                    
                    # Create new customer in current mode
                    customer = stripe.Customer.create(
                        email=user_email,
                        metadata={"supabase_user_id": user_id}
                    )
                    old_customer_id = stripe_customer_id
                    stripe_customer_id = customer.id
                    
                    # Update DB with new customer_id
                    supabase.table("user_plans").update({
                        "stripe_customer_id": stripe_customer_id,
                        "updated_at": datetime.utcnow().isoformat()
                    }).eq("user_id", user_id).execute()
                    
                    logging.info(
                        f"[STRIPE] Customer recreated for {stripe_mode} mode: "
                        f"old={old_customer_id}, new={stripe_customer_id}"
                    )
                else:
                    # Other InvalidRequestError - re-raise
                    raise
        else:
            # No customer_id saved - create new one
            logging.info(f"[STRIPE] Creating new customer for user_id={user_id} in {stripe_mode} mode")
            customer = stripe.Customer.create(
                email=user_email,
                metadata={"supabase_user_id": user_id}
            )
            stripe_customer_id = customer.id
            
            # Save customer_id to DB
            supabase.table("user_plans").update({
                "stripe_customer_id": stripe_customer_id,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("user_id", user_id).execute()
            
            logging.info(f"[STRIPE] Customer created: {stripe_customer_id}")
        
        # Generate success/cancel URLs (route to existing /pricing page)
        # Use canonical production domain or FRONTEND_URL fallback
        frontend_url = os.getenv("FRONTEND_URL", "https://www.cloudaggregatorapp.com")
        success_url = f"{frontend_url}/pricing?payment=success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{frontend_url}/pricing?payment=cancel"
        
        # Create Stripe Checkout Session
        logging.info(f"[STRIPE] Creating checkout session for plan={plan_code}, customer={stripe_customer_id}")
        checkout_session = stripe.checkout.Session.create(
            customer=stripe_customer_id,
            payment_method_types=["card"],
            line_items=[{
                "price": price_id,
                "quantity": 1
            }],
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "user_id": user_id,
                "plan_code": plan_code.lower()  # "plus" or "pro"
            },
            allow_promotion_codes=True,
            billing_address_collection="auto"
        )
        
        logging.info(f"[STRIPE] Checkout session created: {checkout_session.id}")
        
        return {"url": checkout_session.url}
    
    except stripe.error.StripeError as e:
        # Stripe API errors (card declined, network issues, etc.)
        error_code = getattr(e, 'code', 'unknown')
        error_param = getattr(e, 'param', None)
        user_message = getattr(e, 'user_message', str(e))
        
        logging.error(
            f"[STRIPE] Stripe API error: plan={plan_code}, "
            f"code={error_code}, param={error_param}, message={user_message}"
        )
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "stripe_api_error",
                "message": "Error al procesar el pago. Por favor intenta nuevamente.",
                "code": error_code,
                "technical_details": str(e) if error_code != 'unknown' else None
            }
        )
    except HTTPException:
        # Re-raise HTTPExceptions (validation errors)
        raise
    except Exception as e:
        # Unexpected errors
        logging.error(
            f"[STRIPE] Unexpected error: plan={plan_code}, "
            f"error_type={type(e).__name__}, message={str(e)}"
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "checkout_creation_failed",
                "message": "No se pudo crear la sesión de pago. Intenta nuevamente en unos momentos.",
                "technical_details": str(e)
            }
        )


@app.post("/stripe/webhooks")
async def stripe_webhooks(request: Request):
    """
    Stripe webhook handler.
    
    Events handled:
    - checkout.session.completed: Upgrade user to PLUS/PRO
    - customer.subscription.deleted: Downgrade user to FREE
    
    Security: Validates webhook signature with STRIPE_WEBHOOK_SECRET
    """
    # Validation 1: Webhook secret configured
    if not STRIPE_WEBHOOK_SECRET:
        logging.error("[STRIPE_WEBHOOK] STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=500, detail="Webhook not configured")
    
    # Get raw body and signature
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if not sig_header:
        logging.error("[STRIPE_WEBHOOK] Missing stripe-signature header")
        raise HTTPException(status_code=400, detail="Missing signature")
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
        logging.info(f"[STRIPE_WEBHOOK] Event received: {event['type']}")
        
    except ValueError as e:
        # Invalid payload
        logging.error(f"[STRIPE_WEBHOOK] Invalid payload: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError as e:
        # Invalid signature
        logging.error(f"[STRIPE_WEBHOOK] Invalid signature: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # Handle events
    event_type = event["type"]
    
    try:
        if event_type == "checkout.session.completed":
            handle_checkout_completed(event)
        elif event_type == "customer.subscription.deleted":
            handle_subscription_deleted(event)
        elif event_type == "customer.subscription.updated":
            handle_subscription_updated(event)
        elif event_type == "invoice.paid":
            handle_invoice_paid(event)
        elif event_type == "invoice.payment_failed":
            handle_invoice_payment_failed(event)
        else:
            logging.info(f"[STRIPE_WEBHOOK] Unhandled event type: {event_type}")
    except Exception as e:
        logging.error(f"[STRIPE_WEBHOOK] ❌ Error processing {event_type}: {str(e)}")
        # Don't raise - return 200 to avoid Stripe retry spam on permanent errors
    
    return {"received": True}


def handle_checkout_completed(event: dict):
    """
    Handle checkout.session.completed event.
    
    Updates user_plans:
    - Map metadata.plan_code → plan (plus/pro)
    - Set stripe_customer_id, stripe_subscription_id
    - Set subscription_status = 'active'
    - Update period_start to first day of current month
    
    Idempotency: Checks if subscription_id already exists to avoid duplicate processing.
    """
    session = event["data"]["object"]
    session_id = session.get("id")
    
    # Extract metadata (required)
    metadata = session.get("metadata", {})
    user_id = metadata.get("user_id")
    plan_code = metadata.get("plan_code")
    
    # Extract Stripe IDs
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    
    # Validation: user_id required
    if not user_id:
        logging.error(f"[STRIPE_WEBHOOK] Missing user_id in metadata: session_id={session.get('id')}")
        raise HTTPException(status_code=400, detail="Missing user_id in metadata")
    
    # Validation: subscription_id required
    if not subscription_id:
        logging.error(f"[STRIPE_WEBHOOK] Missing subscription_id: session_id={session_id}")
        raise HTTPException(status_code=400, detail="Missing subscription_id")
    
    # Idempotency check: Skip if already processed this subscription
    try:
        existing = supabase.table("user_plans").select(
            "subscription_status"
        ).eq("stripe_subscription_id", subscription_id).execute()
        
        if existing.data:
            logging.info(
                f"[STRIPE_WEBHOOK] ⚠️ checkout.session.completed already processed: "
                f"session_id={session_id}, subscription_id={subscription_id}. Skipping."
            )
            return
    except Exception as e:
        logging.warning(f"[STRIPE_WEBHOOK] Could not check idempotency: {str(e)}. Continuing...")
    
    # Validation: plan_code required
    if not plan_code:
        logging.error(f"[STRIPE_WEBHOOK] Missing plan_code in metadata: session_id={session.get('id')}")
        raise HTTPException(status_code=400, detail="Missing plan_code in metadata")
    
    # Normalize and validate plan_code
    plan_code = plan_code.lower()  # "plus" or "pro"
    
    if plan_code not in ["plus", "pro"]:
        logging.error(f"[STRIPE_WEBHOOK] Invalid plan_code: {plan_code}, session_id={session.get('id')}")
        raise HTTPException(status_code=400, detail=f"Invalid plan_code: {plan_code}")
    
    # Update user_plans
    try:
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        # Get plan limits from billing_plans
        from backend.billing_plans import get_plan_limits
        plan_limits = get_plan_limits(plan_code)
        
        # Retrieve Stripe subscription to get current_period_end
        logging.info(f"[STRIPE_WEBHOOK] Retrieving subscription details: subscription_id={subscription_id}")
        sub = stripe.Subscription.retrieve(subscription_id)
        
        # ROBUST extraction of current_period_end (StripeObject can be tricky)
        current_period_end = None
        
        # Attempt 1: getattr (works with StripeObject attributes)
        current_period_end = getattr(sub, "current_period_end", None)
        
        # Attempt 2: dict-style access (works if StripeObject supports __getitem__)
        if current_period_end is None:
            try:
                current_period_end = sub["current_period_end"]
            except (KeyError, TypeError):
                pass
        
        # Attempt 3: to_dict() method (some Stripe objects have this)
        if current_period_end is None:
            try:
                sub_dict = sub.to_dict() if hasattr(sub, "to_dict") else dict(sub)
                current_period_end = sub_dict.get("current_period_end")
            except (AttributeError, TypeError):
                pass
        
        # Fallback: use 31 days from now if all attempts fail
        if current_period_end is None:
            available_keys = list(sub.keys()) if hasattr(sub, "keys") else "unknown"
            logging.warning(
                f"[STRIPE_WEBHOOK] ⚠️ Could not extract current_period_end from subscription. "
                f"Available keys: {available_keys}. Using 31-day fallback. "
                f"subscription_id={subscription_id}, user_id={user_id}"
            )
            # Fallback: 31 days from now (UTC)
            plan_expires_at = (now + timedelta(days=31)).isoformat()
        else:
            # Convert epoch seconds to ISO timestamp UTC
            plan_expires_at = datetime.fromtimestamp(
                current_period_end, 
                tz=timezone.utc
            ).isoformat()
        
        logging.info(
            f"[STRIPE_WEBHOOK] checkout.session.completed: "
            f"user_id={user_id}, plan={plan_code}, "
            f"subscription_id={subscription_id}, "
            f"current_period_end={current_period_end}, "
            f"plan_expires_at={plan_expires_at}"
        )
        
        update_data = {
            "plan": plan_code,
            "plan_type": "PAID",  # Required by check_paid_plan_has_expiration
            "plan_expires_at": plan_expires_at,  # Required for PAID plans
            "stripe_customer_id": customer_id,
            "stripe_subscription_id": subscription_id,
            "subscription_status": "active",
            # Set monthly limits (required by check_paid_has_monthly constraint)
            # Use REAL column names: copies_limit_month, transfer_bytes_limit_month
            "copies_limit_month": plan_limits.copies_limit_month,
            "transfer_bytes_limit_month": plan_limits.transfer_bytes_limit_month,
            # Reset usage counters for new billing period
            "copies_used_month": 0,
            "transfer_bytes_used_month": 0,
            "period_start": period_start.isoformat(),
            "updated_at": now.isoformat()
        }
        
        logging.info(
            f"[STRIPE_WEBHOOK] Applying limits: plan={plan_code} "
            f"copies_limit_month={plan_limits.copies_limit_month} "
            f"transfer_bytes_limit_month={plan_limits.transfer_bytes_limit_month} "
            f"transfer_bytes_limit_month_gb={plan_limits.transfer_bytes_limit_month / 1_073_741_824:.1f}GB "
            f"expires_at={plan_expires_at}"
        )
        
        result = supabase.table("user_plans").update(update_data).eq("user_id", user_id).execute()
        
        if result.data:
            logging.info(
                f"[STRIPE_WEBHOOK] ✅ UPGRADE SUCCESS: user_id={user_id}, "
                f"plan={plan_code.upper()}, plan_type=PAID, "
                f"plan_expires_at={plan_expires_at}, "
                f"copies_limit_month={plan_limits.copies_limit_month}, "
                f"transfer_bytes_limit_month={plan_limits.transfer_bytes_limit_month}"
            )
        else:
            logging.error(
                f"[STRIPE_WEBHOOK] ❌ Failed to update user_plans for user_id={user_id} "
                f"(Supabase returned empty result)"
            )
    
    except Exception as e:
        logging.error(
            f"[STRIPE_WEBHOOK] ❌ Error updating user_plans: {str(e)} "
            f"(user_id={user_id}, subscription_id={subscription_id})"
        )
        raise


def handle_subscription_deleted(event: dict):
    """
    Handle customer.subscription.deleted event.
    
    Downgrades user to FREE:
    - Set plan = 'free'
    - Clear stripe_subscription_id (keep customer_id for reactivation)
    - Set subscription_status = NULL
    - Reset monthly counters to 0
    - Update period_start to first day of current month
    """
    subscription = event["data"]["object"]
    
    # Extract subscription_id
    subscription_id = subscription.get("id")
    
    if not subscription_id:
        logging.error("[STRIPE_WEBHOOK] Missing subscription_id in event")
        return
    
    # Find user by subscription_id
    try:
        user_result = supabase.table("user_plans").select(
            "user_id"
        ).eq("stripe_subscription_id", subscription_id).execute()
        
        if not user_result.data:
            logging.warning(f"[STRIPE_WEBHOOK] No user found for subscription_id={subscription_id}")
            return
        
        user_id = user_result.data[0]["user_id"]
        
        # Downgrade to FREE
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        logging.info(
            f"[STRIPE_WEBHOOK] customer.subscription.deleted: "
            f"user_id={user_id}, subscription_id={subscription_id}, "
            f"downgrading to FREE"
        )
        
        downgrade_data = {
            "plan": "free",
            "plan_type": "FREE",  # Required by check_free_plan_no_expiration
            "plan_expires_at": None,  # FREE plans must NOT have expiration
            "stripe_subscription_id": None,  # Clear subscription
            "subscription_status": "canceled",  # Mark as canceled
            # Reset monthly limit fields to NULL (FREE plan uses lifetime counters)
            # Use REAL column names: copies_limit_month, transfer_bytes_limit_month
            "copies_limit_month": None,
            "transfer_bytes_limit_month": None,
            "copies_used_month": 0,
            "transfer_bytes_used_month": 0,
            "period_start": period_start.isoformat(),
            "updated_at": now.isoformat()
        }
        
        logging.info(
            f"[STRIPE_WEBHOOK] Downgrading to FREE: "
            f"plan_type=FREE, plan_expires_at=NULL, "
            f"copies_limit_month=NULL, transfer_bytes_limit_month=NULL"
        )
        
        result = supabase.table("user_plans").update(downgrade_data).eq("user_id", user_id).execute()
        
        if result.data:
            logging.info(
                f"[STRIPE_WEBHOOK] ✅ User {user_id} downgraded to FREE successfully "
                f"(subscription {subscription_id} deleted)"
            )
        else:
            logging.error(
                f"[STRIPE_WEBHOOK] ❌ Failed to downgrade user_id={user_id} "
                f"(Supabase returned empty result)"
            )
    
    except Exception as e:
        logging.error(
            f"[STRIPE_WEBHOOK] ❌ Error handling subscription deletion: {str(e)} "
            f"(subscription_id={subscription_id})"
        )


def handle_subscription_updated(event: dict):
    """
    Handle customer.subscription.updated event.
    
    Updates subscription_status when it changes (e.g., active → past_due).
    This keeps the app in sync with Stripe's subscription state.
    """
    subscription = event["data"]["object"]
    subscription_id = subscription.get("id")
    status = subscription.get("status")  # active, past_due, canceled, unpaid, etc.
    
    if not subscription_id:
        logging.error("[STRIPE_WEBHOOK] Missing subscription_id in customer.subscription.updated")
        return
    
    try:
        # Find user by subscription_id
        user_result = supabase.table("user_plans").select(
            "user_id, subscription_status"
        ).eq("stripe_subscription_id", subscription_id).execute()
        
        if not user_result.data:
            logging.warning(f"[STRIPE_WEBHOOK] No user found for subscription_id={subscription_id}")
            return
        
        user_id = user_result.data[0]["user_id"]
        current_status = user_result.data[0].get("subscription_status")
        
        # Only update if status changed
        if current_status == status:
            logging.info(
                f"[STRIPE_WEBHOOK] customer.subscription.updated: No change. "
                f"user_id={user_id}, status={status}"
            )
            return
        
        logging.info(
            f"[STRIPE_WEBHOOK] customer.subscription.updated: "
            f"user_id={user_id}, subscription_id={subscription_id}, "
            f"status: {current_status} → {status}"
        )
        
        # Update subscription status
        now = datetime.now(timezone.utc)
        result = supabase.table("user_plans").update({
            "subscription_status": status,
            "updated_at": now.isoformat()
        }).eq("user_id", user_id).execute()
        
        if result.data:
            logging.info(
                f"[STRIPE_WEBHOOK] ✅ Subscription status updated: "
                f"user_id={user_id}, new_status={status}"
            )
        else:
            logging.error(
                f"[STRIPE_WEBHOOK] ❌ Failed to update subscription status for user_id={user_id}"
            )
    
    except Exception as e:
        logging.error(
            f"[STRIPE_WEBHOOK] ❌ Error handling subscription update: {str(e)} "
            f"(subscription_id={subscription_id})"
        )


def handle_invoice_paid(event: dict):
    """
    Handle invoice.paid event.
    
    Ensures subscription remains active after successful payment.
    Updates subscription_status to 'active' if it was 'past_due'.
    """
    invoice = event["data"]["object"]
    subscription_id = invoice.get("subscription")
    
    if not subscription_id:
        logging.info("[STRIPE_WEBHOOK] invoice.paid without subscription (one-time payment). Ignoring.")
        return
    
    try:
        # Find user by subscription_id
        user_result = supabase.table("user_plans").select(
            "user_id, subscription_status"
        ).eq("stripe_subscription_id", subscription_id).execute()
        
        if not user_result.data:
            logging.warning(f"[STRIPE_WEBHOOK] No user found for subscription_id={subscription_id}")
            return
        
        user_id = user_result.data[0]["user_id"]
        current_status = user_result.data[0].get("subscription_status")
        
        logging.info(
            f"[STRIPE_WEBHOOK] invoice.paid: "
            f"user_id={user_id}, subscription_id={subscription_id}, "
            f"current_status={current_status}"
        )
        
        # If status is past_due, update to active
        if current_status == "past_due":
            now = datetime.now(timezone.utc)
            result = supabase.table("user_plans").update({
                "subscription_status": "active",
                "updated_at": now.isoformat()
            }).eq("user_id", user_id).execute()
            
            if result.data:
                logging.info(
                    f"[STRIPE_WEBHOOK] ✅ Subscription reactivated after payment: user_id={user_id}"
                )
        else:
            logging.info(
                f"[STRIPE_WEBHOOK] invoice.paid: Subscription already active for user_id={user_id}"
            )
    
    except Exception as e:
        logging.error(
            f"[STRIPE_WEBHOOK] ❌ Error handling invoice.paid: {str(e)} "
            f"(subscription_id={subscription_id})"
        )


def handle_invoice_payment_failed(event: dict):
    """
    Handle invoice.payment_failed event.
    
    Updates subscription_status to 'past_due' when payment fails.
    This allows the app to show warnings or restrict features.
    """
    invoice = event["data"]["object"]
    subscription_id = invoice.get("subscription")
    
    if not subscription_id:
        logging.info("[STRIPE_WEBHOOK] invoice.payment_failed without subscription. Ignoring.")
        return
    
    try:
        # Find user by subscription_id
        user_result = supabase.table("user_plans").select(
            "user_id"
        ).eq("stripe_subscription_id", subscription_id).execute()
        
        if not user_result.data:
            logging.warning(f"[STRIPE_WEBHOOK] No user found for subscription_id={subscription_id}")
            return
        
        user_id = user_result.data[0]["user_id"]
        
        logging.warning(
            f"[STRIPE_WEBHOOK] ⚠️ invoice.payment_failed: "
            f"user_id={user_id}, subscription_id={subscription_id}"
        )
        
        # Update status to past_due
        now = datetime.now(timezone.utc)
        result = supabase.table("user_plans").update({
            "subscription_status": "past_due",
            "updated_at": now.isoformat()
        }).eq("user_id", user_id).execute()
        
        if result.data:
            logging.warning(
                f"[STRIPE_WEBHOOK] ⚠️ Subscription marked as past_due: user_id={user_id}"
            )
        else:
            logging.error(
                f"[STRIPE_WEBHOOK] ❌ Failed to update status to past_due for user_id={user_id}"
            )
    
    except Exception as e:
        logging.error(
            f"[STRIPE_WEBHOOK] ❌ Error handling invoice.payment_failed: {str(e)} "
            f"(subscription_id={subscription_id})"
        )


@app.get("/auth/google/login-url")
def google_login_url(
    mode: Optional[str] = None, 
    reconnect_account_id: Optional[str] = None,
    user_info: dict = Depends(get_jwt_user_info)
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
    # Extract user_id and user_email from JWT
    user_id = user_info["user_id"]
    user_email = user_info["email"]
    
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI")

    # Validation: reconnect requires account_id
    if mode == "reconnect" and not reconnect_account_id:
        raise HTTPException(status_code=400, detail="reconnect_account_id required for mode=reconnect")
    
    # For reconnect: verify slot exists and get email for login_hint + slot_log_id
    reconnect_email = None
    slot_log_id = None
    if mode == "reconnect":
        try:
            # Normalize reconnect_account_id for consistent comparison
            reconnect_account_id_normalized = str(reconnect_account_id).strip() if reconnect_account_id else ""
            
            # CRITICAL: DO NOT filter by user_id here - Phase 3.3 allows reclaiming slots with different user_id if email matches
            # Load slot by provider + provider_account_id (order by id desc for historical duplicates)
            slot_check = supabase.table("cloud_slots_log").select("id,provider_email").eq("provider", "google").eq("provider_account_id", reconnect_account_id_normalized).order("id", desc=True).limit(1).execute()
            
            # Defensive check: verify slot exists before accessing data[0]
            if not slot_check.data:
                # Log security event (mask account ID for privacy)
                logging.warning(
                    f"[SECURITY][RECONNECT] slot_not_found for reconnect_account_id=***"
                    f"{reconnect_account_id_normalized[-4:] if reconnect_account_id_normalized else 'EMPTY'}"
                )
                return JSONResponse(
                    status_code=404,
                    content={"error": "slot_not_found"}
                )
            
            # Safe access to slot data
            slot_data = slot_check.data[0]
            reconnect_email = slot_data.get("provider_email")
            slot_log_id = slot_data.get("id")
        except Exception:
            # Log full stack trace for debugging (NO tokens/PII)
            logging.exception("[SECURITY][LOGIN_URL] reconnect_mode_failed")
            return JSONResponse(
                status_code=500,
                content={"error": "login_url_failed"}
            )
    
    # OAuth Prompt Strategy (Google best practices):
    # - Default: "select_account" (mejor UX, no agresivo)
    # - Consent: SOLO si mode="consent" explícito O si es primera conexión sin refresh_token
    # - Evitar "consent" innecesario (Google OAuth review lo penaliza)
    
    # CRITICAL: Detectar si necesitamos forzar consent para obtener refresh_token
    # Google NO envía refresh_token en re-autorizaciones (prompt=select_account)
    # Solo lo envía en primera autorización O si usamos prompt=consent
    needs_consent = False
    
    if mode == "consent":
        # Modo consent explícito (forzado por usuario)
        needs_consent = True
        logging.info(f"[OAUTH_URL] mode=consent explicit for user_id={user_id}")
    elif mode == "connect":
        # Modo connect: verificar si ya existe refresh_token para este usuario
        # Si NO existe → primera conexión → forzar consent
        try:
            # Multi-cuenta: si se proporciona account_email, filtrar por ese email específico
            # Si NO hay account_email, buscar cualquier cuenta Google del usuario (fallback)
            account_email = request.query_params.get("account_email")
            
            query = supabase.table("cloud_accounts").select("id,refresh_token,account_email").eq(
                "user_id", user_id
            ).eq("provider", "google")
            
            # Filtro adicional por email si se proporciona (multi-cuenta)
            if account_email:
                query = query.eq("account_email", account_email)
                logging.info(f"[OAUTH_URL] Checking refresh_token for specific account: {account_email}")
            
            existing_accounts = query.limit(1).execute()
            
            has_refresh_token = False
            if existing_accounts.data:
                for acc in existing_accounts.data:
                    refresh = acc.get("refresh_token")
                    if refresh and refresh.strip():
                        has_refresh_token = True
                        break
            
            if not has_refresh_token:
                # Primera conexión o refresh_token perdido → forzar consent
                needs_consent = True
                target_info = f"account_email={account_email}" if account_email else "any Google account"
                logging.info(
                    f"[OAUTH_URL] First connection detected (no refresh_token in DB) for user_id={user_id} "
                    f"({target_info}). Forcing prompt=consent to obtain refresh_token."
                )
            else:
                target_info = f"for {account_email}" if account_email else f"for user_id={user_id}"
                logging.info(f"[OAUTH_URL] Existing refresh_token found {target_info}, using prompt=select_account")
        except Exception as e:
            # Error al verificar DB → usar consent por seguridad (mejor obtener token que fallar)
            logging.warning(f"[OAUTH_URL] Failed to check existing refresh_token: {e}. Using prompt=consent as fallback.")
            needs_consent = True
    
    # Determinar prompt final
    oauth_prompt = "consent" if needs_consent else "select_account"
    
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
    
    # user_email already extracted from JWT claims above (no need for extra query)
    # Crear state JWT con user_id, mode, reconnect_account_id, slot_log_id, user_email (seguro, firmado)
    state_token = create_state_token(
        user_id, 
        mode=mode or "connect", 
        reconnect_account_id=reconnect_account_id,
        slot_log_id=slot_log_id,
        user_email=user_email
    )
    params["state"] = state_token

    from urllib.parse import urlencode
    url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
    
    # Log structured para observability (sin PII)
    user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    logging.info(
        f"[OAUTH_URL_GENERATED] user_hash={user_hash} mode={mode or 'connect'} "
        f"prompt={oauth_prompt} reconnect_account_id={bool(reconnect_account_id)}"
    )
    
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

    frontend_origin = safe_frontend_origin_from_request(request)

    if error:
        return RedirectResponse(f"{frontend_origin}?error={error}")

    if not code:
        return RedirectResponse(f"{frontend_origin}?error=no_code")
    
    # Decodificar el state para obtener user_id, mode, reconnect_account_id, slot_log_id, user_email
    user_id = None
    mode = "connect"
    reconnect_account_id = None
    slot_log_id = None
    user_email = None
    if state:
        state_data = decode_state_token(state)
        if state_data:
            user_id = state_data.get("user_id")
            mode = state_data.get("mode", "connect")
            reconnect_account_id = state_data.get("reconnect_account_id")
            slot_log_id = state_data.get("slot_log_id")
            user_email = state_data.get("user_email")

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
    granted_scope = token_json.get("scope")  # Puede ser None si no viene en token response

    if not access_token:
        return RedirectResponse(f"{frontend_origin}?error=no_access_token")

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
        return RedirectResponse(f"{frontend_origin}/app?error=missing_user_id")
    
    # Handle reconnect mode: verify account match and skip slot consumption
    if mode == "reconnect":
        # Normalizar IDs para comparación consistente
        reconnect_account_id_normalized = str(reconnect_account_id).strip() if reconnect_account_id else ""
        google_account_id_normalized = str(google_account_id).strip() if google_account_id else ""
        
        if google_account_id_normalized != reconnect_account_id_normalized:
            # Obtener email esperado del slot para mejor UX
            expected_email = "unknown"
            try:
                slot_info = supabase.table("cloud_slots_log").select("provider_email").eq("provider", "google").eq("provider_account_id", reconnect_account_id_normalized).order("created_at", desc=True).limit(1).execute()
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
            return RedirectResponse(f"{frontend_origin}/app?error=account_mismatch&expected={expected_email}")
        
        # ===== SECURITY CHECK: Verify slot ownership before updating tokens =====
        # CRITICAL: Load target slot/account by reconnect_account_id and verify ownership
        # This prevents malicious users from hijacking other users' slots/accounts
        
        # Step 1: Load target slot - prioritize slot_log_id from state, fallback to provider_account_id
        if slot_log_id:
            # Precise lookup by id from state JWT (preferred)
            target_slot = supabase.table("cloud_slots_log") \
                .select("id, user_id, provider_account_id, provider_email") \
                .eq("id", slot_log_id) \
                .eq("provider", "google") \
                .limit(1) \
                .execute()
        else:
            # Fallback: lookup by provider + provider_account_id (order by created_at desc)
            target_slot = supabase.table("cloud_slots_log") \
                .select("id, user_id, provider_account_id, provider_email") \
                .eq("provider", "google") \
                .eq("provider_account_id", reconnect_account_id_normalized) \
                .order("created_at", desc=True) \
                .limit(1) \
                .execute()
        
        if not target_slot.data:
            # Slot doesn't exist => Invalid reconnect attempt
            logging.error(
                f"[SECURITY] Reconnect failed: slot not found. "
                f"reconnect_account_id={reconnect_account_id_normalized} "
                f"user_id={user_id}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")
        
        slot_user_id = target_slot.data[0]["user_id"]
        slot_id = target_slot.data[0]["id"]
        slot_email = target_slot.data[0].get("provider_email", "")
        
        # Step 2: Verify slot belongs to current user (ownership check with safe reclaim)
        if slot_user_id != user_id:
            # Ownership mismatch detected
            # SAFE RECLAIM: Allow reassignment ONLY if provider_email matches current user's auth email
            
            # Normalize emails for comparison
            slot_email_normalized = slot_email.lower().strip() if slot_email else ""
            current_user_email_normalized = user_email.lower().strip() if user_email else ""
            
            # Validate we have both emails to compare
            if not slot_email_normalized or not current_user_email_normalized:
                # Missing email data => BLOCK for safety
                logging.error(
                    f"[SECURITY] Ownership violation: Missing email for validation. "
                    f"slot_id={slot_id} slot_email={'PRESENT' if slot_email_normalized else 'MISSING'} "
                    f"user_email={'PRESENT' if current_user_email_normalized else 'MISSING'}"
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
            
            # Compare emails (case-insensitive, trimmed)
            if slot_email_normalized == current_user_email_normalized:
                # ✅ Email matches => SAFE RECLAIM
                logging.warning(
                    f"[SECURITY][RECLAIM] Slot reassignment authorized: "
                    f"slot_id={slot_id} provider_account_id={reconnect_account_id_normalized} "
                    f"from_user_id={slot_user_id} to_user_id={user_id} "
                    f"email={slot_email_normalized} (verified match)"
                )
                
                # Update slot ownership in cloud_slots_log
                # NOTE: updated_at is handled by database trigger automatically
                try:
                    supabase.table("cloud_slots_log").update({
                        "user_id": user_id
                    }).eq("id", slot_id).execute()
                    
                    # Also update cloud_accounts ownership if exists
                    # CRITICAL: Use provider + provider_account_id (not google_account_id which doesn't exist)
                    supabase.table("cloud_accounts").update({
                        "user_id": user_id
                    }).eq("provider", "google").eq("provider_account_id", reconnect_account_id_normalized).execute()
                    
                    logging.info(
                        f"[SECURITY][RECLAIM] Slot ownership transferred successfully. "
                        f"slot_id={slot_id} new_user_id={user_id}"
                    )
                except Exception as e:
                    logging.error(
                        f"[SECURITY][RECLAIM] Ownership transfer failed: {type(e).__name__} "
                        f"slot_id={slot_id} user_id={user_id}"
                    )
                    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed")
                
                # Update slot_user_id for subsequent code flow
                slot_user_id = user_id
            else:
                # ❌ Email doesn't match => BLOCK (account takeover attempt)
                logging.error(
                    f"[SECURITY] Account takeover attempt blocked! "
                    f"Slot reconnect_account_id={reconnect_account_id_normalized} "
                    f"belongs_to_user_id={slot_user_id} (slot_email={slot_email_normalized}) but "
                    f"current_user_id={user_id} (auth_email={current_user_email_normalized}) attempted reconnect. "
                    f"Email mismatch prevents reclaim."
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
        
        # Ownership verified (either original owner or safely reclaimed) => OK to proceed
        logging.info(
            f"[SECURITY] Reconnect ownership verified: "
            f"slot_id={slot_id} belongs to user_id={user_id}, "
            f"google_account_id={google_account_id_normalized}"
        )
        # ===== END SECURITY CHECK =====
        
        # slot_id already retrieved from target_slot above
        if not slot_id:
            logging.error(
                f"[RECONNECT ERROR] No slot found for reconnection. "
                f"user_id={user_id} google_account_id={google_account_id} email={account_email}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")
        
        # Build upsert payload
        # CRITICAL FIX (OAuth): Preservar refresh_token existente cuando Google no envía uno nuevo
        # Google NO retorna refresh_token en reconnect con prompt=select_account (comportamiento normal)
        # Debemos leer y preservar el token existente para evitar sobrescritura con NULL
        upsert_payload = {
            "google_account_id": google_account_id,
            "user_id": user_id,
            "account_email": account_email,
            "access_token": encrypt_token(access_token),
            "token_expiry": expiry_iso,
            "is_active": True,
            "disconnected_at": None,
            "slot_log_id": slot_id,
            "granted_scope": granted_scope,  # OAuth scope concedido
        }
        
        # Gestionar refresh_token: nuevo de Google o preservar existente
        if refresh_token:
            # Google envió refresh_token nuevo (raro en reconnect, típico de prompt=consent)
            upsert_payload["refresh_token"] = encrypt_token(refresh_token)
            logging.info(f"[RECONNECT] Got new refresh_token for google_account_id={google_account_id}")
        else:
            # Google NO envió refresh_token (normal en prompt=select_account)
            # CRITICAL: Leer y preservar el refresh_token existente en DB
            logging.info(f"[RECONNECT] No new refresh_token, loading existing from DB for google_account_id={google_account_id}")
            try:
                existing_account = supabase.table("cloud_accounts").select("refresh_token").eq(
                    "google_account_id", google_account_id
                ).limit(1).execute()
                
                if existing_account.data and existing_account.data[0].get("refresh_token"):
                    # Preservar refresh_token existente (ya encriptado en DB)
                    upsert_payload["refresh_token"] = existing_account.data[0]["refresh_token"]
                    logging.info(f"[RECONNECT] Preserved existing refresh_token for google_account_id={google_account_id}")
                else:
                    # NO hay refresh_token existente → requiere prompt=consent
                    logging.error(
                        f"[RECONNECT ERROR] No existing refresh_token for google_account_id={google_account_id}. "
                        f"User needs to reconnect with mode=consent to obtain new refresh_token."
                    )
                    return RedirectResponse(f"{frontend_origin}/app?error=missing_refresh_token&hint=need_consent")
            except Exception as e:
                logging.error(f"[RECONNECT ERROR] Failed to load existing refresh_token: {e}")
                return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed&reason=token_load_error")
        
        # Perform UPSERT (UPDATE if exists, INSERT if not)
        # refresh_token siempre incluido en payload (nuevo o preservado) → nunca NULL
        upsert_result = supabase.table("cloud_accounts").upsert(
            upsert_payload,
            on_conflict="google_account_id"
        ).execute()
        
        if upsert_result.data:
            account_id = upsert_result.data[0].get("id", "unknown")
            logging.info(
                f"[RECONNECT SUCCESS - cloud_accounts UPSERT] "
                f"user_id={user_id} account_id={account_id} "
                f"google_account_id={google_account_id} email={account_email} "
                f"is_active=True disconnected_at=None "
                f"refresh_token_updated={bool(refresh_token)}"
            )
        else:
            logging.warning(
                f"[RECONNECT WARNING] cloud_accounts UPSERT returned no data. "
                f"user_id={user_id} google_account_id={google_account_id}"
            )
        
        # Ensure slot is active and update provider info
        # CRITICAL: Use slot_log_id if available (more precise), fallback to provider_account_id
        if slot_log_id:
            slot_update = supabase.table("cloud_slots_log").update({
                "is_active": True,
                "disconnected_at": None,
                "provider_email": account_email,
            }).eq("id", slot_log_id).eq("user_id", user_id).execute()
        else:
            slot_update = supabase.table("cloud_slots_log").update({
                "is_active": True,
                "disconnected_at": None,
                "provider_email": account_email,
            }).eq("user_id", user_id).eq("provider_account_id", google_account_id).execute()
        
        slots_updated = len(slot_update.data) if slot_update.data else 0
        
        # CRITICAL: Return error if slot update failed (no fake success)
        if slots_updated == 0:
            logging.error(
                f"[RECONNECT ERROR] cloud_slots_log UPDATE affected 0 rows (CRITICAL FAILURE). "
                f"user_id={user_id} provider_account_id={google_account_id} "
                f"This indicates slot was deleted, provider_account_id mismatch, or database error."
            )
            return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed&reason=slot_not_updated")
        
        # Get slot_log_id for frontend validation (prefer from state JWT, fallback to database)
        validated_slot_id = slot_log_id if slot_log_id else slot_update.data[0].get("id")
        
        logging.info(
            f"[RECONNECT SUCCESS - cloud_slots_log] "
            f"user_id={user_id} google_account_id={google_account_id} "
            f"email={account_email} slots_updated={slots_updated} "
            f"slot_id={validated_slot_id} is_active=True disconnected_at=None"
        )
        
        return RedirectResponse(f"{frontend_origin}/app?reconnect=success&slot_id={validated_slot_id}")
    
    # Check cloud account limit with slot-based validation (only for connect mode)
    try:
        logging.info(f"[OAUTH_SLOT_VALIDATION] user_id={user_id} provider=google_drive account_id={google_account_id}")
        quota.check_cloud_limit_with_slots(supabase, user_id, "google_drive", google_account_id)
        logging.info(f"[OAUTH_SLOT_VALIDATION_PASSED] user_id={user_id} account_id={google_account_id}")
    except HTTPException as e:
        import logging
        # Diferenciar tipos de error para mejor UX
        if e.status_code == 400:
            # VALIDATION ERROR: provider_account_id vacío/inválido (raro pero posible)
            # Log interno con detalles, redirect con error genérico sin PII
            error_detail = e.detail if isinstance(e.detail, dict) else {"error": "unknown"}
            logging.error(f"[CALLBACK VALIDATION ERROR] HTTP 400 - {error_detail.get('error', 'unknown')} para user_id={user_id}, provider=google_drive")
            return RedirectResponse(f"{frontend_origin}/app?error=oauth_invalid_account")
        elif e.status_code == 402:
            # QUOTA ERROR: Límite de slots alcanzado
            # NO exponer PII (emails) en URL - frontend llamará a /me/slots para obtener detalles
            logging.info(f"[CALLBACK QUOTA] Usuario {user_id} alcanzó límite de slots")
            return RedirectResponse(f"{frontend_origin}/app?error=cloud_limit_reached")
        else:
            # Otros errores HTTP inesperados
            logging.error(f"[CALLBACK ERROR] Unexpected HTTPException {e.status_code} para user_id={user_id}")
            return RedirectResponse(f"{frontend_origin}/app?error=connection_failed")
    
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
        return RedirectResponse(f"{frontend_origin}/app?error=slot_creation_failed")
    
    # Preparar datos para guardar (incluye reactivación si es reconexión)
    # CRITICAL FIX (OAuth): Preservar refresh_token existente si Google no envía uno nuevo
    upsert_data = {
        "account_email": account_email,
        "google_account_id": google_account_id,
        "access_token": encrypt_token(access_token),
        "token_expiry": expiry_iso,
        "user_id": user_id,
        "is_active": True,              # Reactivar cuenta si estaba soft-deleted
        "disconnected_at": None,        # Limpiar timestamp de desconexión
        "slot_log_id": slot_id,         # CRITICAL: Link to slot (prevents orphan accounts)
        "granted_scope": granted_scope,  # OAuth scope concedido
    }
    
    # Gestionar refresh_token: nuevo de Google o preservar existente
    if refresh_token:
        # Google envió refresh_token (primera autorización o prompt=consent)
        upsert_data["refresh_token"] = encrypt_token(refresh_token)
        logging.info(f"[CONNECT] Got refresh_token from Google for {account_email}")
    else:
        # Google NO envió refresh_token (usuario ya autorizó previamente)
        # CRITICAL: Leer y preservar el refresh_token existente en DB
        logging.warning(f"[CONNECT] No refresh_token from Google for {account_email}, checking existing")
        try:
            existing_account = supabase.table("cloud_accounts").select("refresh_token").eq(
                "google_account_id", google_account_id
            ).limit(1).execute()
            
            if existing_account.data and existing_account.data[0].get("refresh_token"):
                # Preservar refresh_token existente (ya encriptado en DB)
                upsert_data["refresh_token"] = existing_account.data[0]["refresh_token"]
                logging.info(f"[CONNECT] Preserved existing refresh_token for {account_email}")
            else:
                # NO hay refresh_token (ni nuevo ni existente) → requiere prompt=consent
                # Este caso NO debería ocurrir si /auth/google/login-url detecta correctamente
                # la primera conexión, pero lo manejamos por seguridad
                logging.error(
                    f"[CONNECT ERROR] No refresh_token for {account_email}. "
                    f"This should not happen if login-url correctly detects first connection. "
                    f"Redirecting to error page with actionable hint."
                )
                # Redirect con hint para que frontend pueda reintentar con mode=consent
                # (sin email por privacidad)
                return RedirectResponse(
                    f"{frontend_origin}/app?error=missing_refresh_token&hint=need_consent"
                )
        except Exception as e:
            logging.error(f"[CONNECT ERROR] Failed to load existing refresh_token: {e}")
            return RedirectResponse(f"{frontend_origin}/app?error=connection_failed&reason=token_load_error")

    # Save to database
    # refresh_token siempre incluido en payload (nuevo o preservado) → nunca NULL
    resp = supabase.table("cloud_accounts").upsert(
        upsert_data,
        on_conflict="google_account_id",
    ).execute()

    # Redirect to frontend dashboard
    return RedirectResponse(f"{frontend_origin}/app?auth=success")


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
        logging.error(f"[ACCOUNTS FETCH ERROR] user_id={user_id} error={str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch accounts: {str(e)}")


@app.get("/drive/{account_id}/copy-options")
async def get_copy_options(account_id: int, user_id: str = Depends(verify_supabase_jwt)):
    """
    Get list of target accounts for copying files (user-specific).
    Includes both Google Drive (cloud_accounts) and OneDrive (cloud_provider_accounts) targets.
    
    Returns:
        {
            "source_account": {"id": int, "email": str},
            "target_accounts": [
                {"provider": "google_drive", "account_id": "123", "email": "user@gmail.com"},
                {"provider": "onedrive", "account_id": "uuid", "email": "user@outlook.com"}
            ]
        }
    """
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
        
        # Get all other Google Drive accounts belonging to the same user
        google_accounts = (
            supabase.table("cloud_accounts")
            .select("id, account_email")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
        google_targets = [
            {
                "provider": "google_drive",
                "account_id": str(acc["id"]),
                "email": acc["account_email"]
            }
            for acc in google_accounts.data
            if acc["id"] != account_id
        ]
        
        # Get all OneDrive accounts belonging to the same user
        onedrive_accounts = (
            supabase.table("cloud_provider_accounts")
            .select("id, account_email")
            .eq("user_id", user_id)
            .eq("provider", "onedrive")
            .eq("is_active", True)
            .execute()
        )
        onedrive_targets = [
            {
                "provider": "onedrive",
                "account_id": acc["id"],  # UUID as string
                "email": acc["account_email"]
            }
            for acc in onedrive_accounts.data
        ]
        
        # Combine all targets
        all_targets = google_targets + onedrive_targets
        
        return {
            "source_account": {
                "id": source.data["id"],
                "email": source.data["account_email"]
            },
            "target_accounts": all_targets
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


@app.get("/onedrive/{account_id}/files")
async def get_onedrive_files(
    account_id: str,
    parent_id: Optional[str] = None,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    List files and folders from OneDrive account.
    
    Security:
    - Validates JWT authentication
    - Verifies account ownership (user_id match)
    - Ensures provider is 'onedrive' and account is active
    
    Args:
        account_id: UUID from cloud_provider_accounts table
        parent_id: OneDrive folder ID. If None, lists root
        user_id: Extracted from JWT by dependency
        
    Returns:
        {
            "provider": "onedrive",
            "account_id": int,
            "parent_id": str | null,
            "items": [
                {
                    "id": str,
                    "name": str,
                    "kind": "folder" | "file",
                    "size": int,
                    "mimeType": str | null,
                    "modifiedTime": str (ISO),
                    "webViewLink": str,
                    "parentId": str | null
                }
            ],
            "nextPageToken": str | null
        }
        
    Raises:
        HTTPException: 401/403/404/500 with structured error
    """
    try:
        # 1. Verify account ownership, provider, and active status
        try:
            account_result = supabase.table("cloud_provider_accounts").select(
                "id, user_id, provider, is_active, access_token, refresh_token, token_expiry"
            ).eq("id", account_id).eq("user_id", user_id).eq("provider", "onedrive").eq("is_active", True).single().execute()
            
            if not account_result.data:
                logging.info(f"[ONEDRIVE] Account {account_id} not found for user {user_id}")
                raise HTTPException(
                    status_code=404,
                    detail={
                        "error_code": "ACCOUNT_NOT_FOUND",
                        "message": f"OneDrive account {account_id} not found or doesn't belong to you"
                    }
                )
            
            account = account_result.data
            
            # SECURITY: Decrypt tokens from storage
            has_refresh_token = bool(account.get("refresh_token"))
            logging.info(f"[ONEDRIVE] Fetching files - user={user_id} account={account_id} has_refresh={has_refresh_token}")
            
            try:
                access_token = decrypt_token(account["access_token"]) if account.get("access_token") else None
                refresh_token = decrypt_token(account["refresh_token"]) if account.get("refresh_token") else None
            except Exception as decrypt_error:
                logging.error(f"[ONEDRIVE] Token decryption failed for account {account_id}: {decrypt_error}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error_code": "DECRYPTION_ERROR",
                        "message": "Failed to decrypt account tokens"
                    }
                )
        except Exception as query_error:
            # Handle .single() errors (0 rows returned)
            error_msg = str(query_error).lower()
            if "0 rows" in error_msg or "no rows" in error_msg or "single row" in error_msg:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "error_code": "ACCOUNT_NOT_FOUND",
                        "message": f"OneDrive account {account_id} not found or doesn't belong to you"
                    }
                )
            # Other DB errors
            raise HTTPException(
                status_code=500,
                detail={
                    "error_code": "INTERNAL_ERROR",
                    "message": "Database error while fetching account",
                    "detail": str(query_error)
                }
            )
        
        # 2. Check if token is expired and refresh if needed
        token_expiry = account.get("token_expiry")
        
        if token_expiry:
            expiry_dt = datetime.fromisoformat(token_expiry.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            
            # Refresh if token expires in less than 5 minutes
            if expiry_dt <= now + timedelta(minutes=5):
                logging.info(f"[ONEDRIVE] Token expired/expiring for account {account_id}, refreshing...")
                
                # Validate refresh_token exists
                if not refresh_token or not refresh_token.strip():
                    logging.error(f"[ONEDRIVE] Missing refresh_token for account {account_id}")
                    raise HTTPException(
                        status_code=401,
                        detail={
                            "error_code": "MISSING_REFRESH_TOKEN",
                            "message": "OneDrive needs reconnect",
                            "detail": "No refresh token available"
                        }
                    )
                
                try:
                    refresh_result = await refresh_onedrive_token(refresh_token)
                    
                    # Build update payload (always update access_token and expiry)
                    update_payload = {
                        "access_token": encrypt_token(refresh_result["access_token"]),
                        "token_expiry": refresh_result["token_expiry"].isoformat(),
                        "updated_at": datetime.utcnow().isoformat()
                    }
                    
                    # CRITICAL: Only update refresh_token if Microsoft rotated it
                    # Prevents double encryption bug when Microsoft returns the same token
                    new_refresh = refresh_result.get("refresh_token")
                    if new_refresh and new_refresh != refresh_token:
                        update_payload["refresh_token"] = encrypt_token(new_refresh)
                        logging.info(f"[ONEDRIVE] Microsoft rotated refresh_token for account {account_id}")
                    else:
                        logging.info(f"[ONEDRIVE] Preserving existing refresh_token (not rotated) for account {account_id}")
                    
                    supabase.table("cloud_provider_accounts").update(update_payload).eq("id", account_id).execute()
                    
                    access_token = refresh_result["access_token"]  # Use fresh plaintext token
                    logging.info(f"[ONEDRIVE] Token refreshed successfully for account {account_id}")
                    
                except HTTPException as refresh_error:
                    # Propagate 401 errors from refresh_onedrive_token
                    logging.error(f"[ONEDRIVE] Token refresh failed for account {account_id}: {refresh_error.detail}")
                    raise
        
        # 3. List files from OneDrive
        try:
            files_result = await list_onedrive_files(
                access_token=access_token,
                parent_id=parent_id,
                page_size=50
            )
            logging.info(f"[ONEDRIVE] Successfully listed files for account {account_id}, items={len(files_result['items'])}")
        except HTTPException as graph_error:
            # Propagate structured errors from list_onedrive_files (401, 404, etc.)
            logging.error(f"[ONEDRIVE] Graph API error for account {account_id}: {graph_error.detail}")
            raise
        
        # 4. Return normalized response
        return {
            "provider": "onedrive",
            "account_id": account_id,
            "parent_id": parent_id,
            "items": files_result["items"],
            "nextPageToken": files_result.get("nextPageToken")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[ONEDRIVE] Failed to list files for account {account_id}")
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "INTERNAL_ERROR",
                "message": "Failed to list OneDrive files",
                "detail": str(e)
            }
        )


@app.get("/onedrive/account-info/{account_id}")
async def get_onedrive_account_info(
    account_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get OneDrive account information (email).
    
    Args:
        account_id: UUID from cloud_provider_accounts table
        user_id: Extracted from JWT
        
    Returns:
        { "id": str, "account_email": str }
    """
    try:
        account_result = supabase.table("cloud_provider_accounts").select(
            "id, account_email"
        ).eq("id", account_id).eq("user_id", user_id).eq("provider", "onedrive").single().execute()
        
        if not account_result.data:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "ACCOUNT_NOT_FOUND", "message": "OneDrive account not found"}
            )
        
        return account_result.data
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[ONEDRIVE] Failed to get account info for {account_id}")
        raise HTTPException(
            status_code=500,
            detail={"error_code": "INTERNAL_ERROR", "message": "Failed to get account info"}
        )


@app.get("/onedrive/download")
async def download_onedrive_file(
    account_id: str,
    item_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Download OneDrive file by redirecting to Graph API /content endpoint.
    
    Args:
        account_id: UUID from cloud_provider_accounts
        item_id: OneDrive item ID
        user_id: Extracted from JWT
        
    Returns:
        Redirect to OneDrive download URL
    """
    try:
        # Verify account ownership
        account_result = supabase.table("cloud_provider_accounts").select(
            "id, access_token, refresh_token"
        ).eq("id", account_id).eq("user_id", user_id).eq("provider", "onedrive").eq("is_active", True).single().execute()
        
        if not account_result.data:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account = account_result.data
        access_token = decrypt_token(account["access_token"])
        
        # Try to get download URL from Graph API
        try:
            async with httpx.AsyncClient() as client:
                # Get item metadata first to check if it's downloadable
                url = f"{GRAPH_API_BASE}/me/drive/items/{item_id}"
                headers = {"Authorization": f"Bearer {access_token}"}
                
                response = await client.get(url, headers=headers, timeout=30.0)
                
                if response.status_code == 401:
                    # Refresh token
                    refresh_token = decrypt_token(account["refresh_token"])
                    tokens = await refresh_onedrive_token(refresh_token)
                    
                    # Build update payload
                    update_payload = {
                        "access_token": encrypt_token(tokens["access_token"]),
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    
                    # CRITICAL: Only update refresh_token if Microsoft rotated it
                    new_refresh = tokens.get("refresh_token")
                    if new_refresh and new_refresh != refresh_token:
                        update_payload["refresh_token"] = encrypt_token(new_refresh)
                        logging.info(f"[ONEDRIVE] Microsoft rotated refresh_token for account {account_id}")
                    else:
                        logging.info(f"[ONEDRIVE] Preserving existing refresh_token (not rotated) for account {account_id}")
                    
                    # Add token_expiry if available
                    if "token_expiry" in tokens:
                        update_payload["token_expiry"] = tokens["token_expiry"].isoformat()
                    
                    supabase.table("cloud_provider_accounts").update(update_payload).eq("id", account_id).execute()
                    
                    access_token = tokens["access_token"]
                    headers = {"Authorization": f"Bearer {access_token}"}
                    response = await client.get(url, headers=headers, timeout=30.0)
                
                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail="Failed to get file info")
                
                item_data = response.json()
                
                # Check if it's a folder
                if "folder" in item_data:
                    raise HTTPException(status_code=400, detail="Cannot download folders")
                
                # Get download URL
                download_url = item_data.get("@microsoft.graph.downloadUrl")
                if not download_url:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error": "not_downloadable",
                            "message": "Item is not downloadable (folder or missing permissions)"
                        }
                    )
                
                # Redirect to download URL (Graph API pre-signed URL, valid for 1 hour)
                return RedirectResponse(download_url)
                
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Network error: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[ONEDRIVE] Download failed for account {account_id}, item {item_id}")
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


class RenameOneDriveItemRequest(BaseModel):
    account_id: str
    item_id: str
    new_name: str


@app.post("/onedrive/rename")
async def rename_onedrive_item(
    request: RenameOneDriveItemRequest,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Rename OneDrive file or folder.
    
    Args:
        account_id: UUID from cloud_provider_accounts
        item_id: OneDrive item ID
        new_name: New name for the item
        user_id: Extracted from JWT
        
    Returns:
        { "success": true }
    """
    try:
        # Verify account ownership
        account_result = supabase.table("cloud_provider_accounts").select(
            "id, access_token, refresh_token"
        ).eq("id", request.account_id).eq("user_id", user_id).eq("provider", "onedrive").eq("is_active", True).single().execute()
        
        if not account_result.data:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account = account_result.data
        access_token = decrypt_token(account["access_token"])
        
        # Try to rename via Graph API PATCH
        try:
            async with httpx.AsyncClient() as client:
                url = f"{GRAPH_API_BASE}/me/drive/items/{request.item_id}"
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
                payload = {"name": request.new_name}
                
                response = await client.patch(url, headers=headers, json=payload, timeout=30.0)
                
                if response.status_code == 401:
                    # Refresh token
                    refresh_token = decrypt_token(account["refresh_token"])
                    tokens = await refresh_onedrive_token(refresh_token)
                    
                    # Build update payload
                    update_payload = {
                        "access_token": encrypt_token(tokens["access_token"]),
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    
                    # CRITICAL: Only update refresh_token if Microsoft rotated it
                    new_refresh = tokens.get("refresh_token")
                    if new_refresh and new_refresh != refresh_token:
                        update_payload["refresh_token"] = encrypt_token(new_refresh)
                        logging.info(f"[ONEDRIVE] Microsoft rotated refresh_token for account {request.account_id}")
                    else:
                        logging.info(f"[ONEDRIVE] Preserving existing refresh_token (not rotated) for account {request.account_id}")
                    
                    # Add token_expiry if available
                    if "token_expiry" in tokens:
                        update_payload["token_expiry"] = tokens["token_expiry"].isoformat()
                    
                    supabase.table("cloud_provider_accounts").update(update_payload).eq("id", request.account_id).execute()
                    
                    access_token = tokens["access_token"]
                    headers = {"Authorization": f"Bearer {access_token}"}
                    response = await client.patch(url, headers=headers, json=payload, timeout=30.0)
                
                if response.status_code != 200:
                    error_data = response.json() if response.text else {}
                    error_msg = error_data.get("error", {}).get("message", "Unknown error")
                    raise HTTPException(status_code=response.status_code, detail=f"Rename failed: {error_msg}")
                
                return {"success": True}
                
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Network error: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[ONEDRIVE] Rename failed for account {request.account_id}, item {request.item_id}")
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")


# ============================================================================
# CROSS-PROVIDER TRANSFER ENDPOINTS (Phase 1: Google Drive → OneDrive)
# ============================================================================

class CreateTransferJobRequest(BaseModel):
    source_provider: str  # "google_drive"
    source_account_id: int  # Google Drive account ID (int)
    target_provider: str  # "onedrive"
    target_account_id: str  # OneDrive account UUID (string)
    file_ids: List[str]  # Google Drive file IDs
    target_folder_id: Optional[str] = None  # OneDrive folder ID (None = root)

@app.post("/transfer/create")
async def create_transfer_job_endpoint(
    request: CreateTransferJobRequest,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 1: Create empty transfer job (fast, <500ms).
    
    BLOCKER 1: State Flow
    - Creates job with status='pending'
    - Stores file_ids in metadata JSONB
    - Returns job_id immediately (no metadata fetch)
    - Client must call POST /transfer/prepare/{job_id} next
    
    BLOCKER 5: Metadata Validation
    - Max 100 files per job (payload protection)
    - file_ids must be non-empty string array
    
    SECURITY:
    - Validates both source/target accounts belong to user
    - Only Google Drive → OneDrive supported
    """
    try:
        # PHASE 1 ENFORCEMENT: Only Google Drive → OneDrive
        if request.source_provider != "google_drive":
            raise HTTPException(
                status_code=400,
                detail={"error": "unsupported_provider", "message": f"Phase 1 only supports source_provider='google_drive', got '{request.source_provider}'"}
            )
        if request.target_provider != "onedrive":
            raise HTTPException(
                status_code=400,
                detail={"error": "unsupported_provider", "message": f"Phase 1 only supports target_provider='onedrive', got '{request.target_provider}'"}
            )
        
        # BLOCKER 5: Validate metadata (file_ids)
        if not request.file_ids:
            raise HTTPException(status_code=400, detail={"error": "invalid_request", "message": "file_ids cannot be empty"})
        
        if not isinstance(request.file_ids, list):
            raise HTTPException(status_code=400, detail={"error": "invalid_request", "message": "file_ids must be an array"})
        
        # BLOCKER 5: Protect against huge payloads (max 100 files per job)
        if len(request.file_ids) > 100:
            raise HTTPException(
                status_code=400, 
                detail={
                    "error": "payload_too_large", 
                    "message": f"Maximum 100 files per transfer (requested: {len(request.file_ids)})"
                }
            )
        
        # Validate file_ids are strings
        if not all(isinstance(fid, str) and fid.strip() for fid in request.file_ids):
            raise HTTPException(status_code=400, detail={"error": "invalid_request", "message": "All file_ids must be non-empty strings"})
        
        # Verify source account ownership (Google Drive uses cloud_accounts table WITHOUT provider column)
        try:
            source_check = (
                supabase.table("cloud_accounts")
                .select("id")
                .eq("id", request.source_account_id)
                .eq("user_id", user_id)
                .single()
                .execute()
            )
            if not source_check.data:
                raise HTTPException(
                    status_code=403,
                    detail={"error": "account_not_owned", "message": "Source Google Drive account not found or doesn't belong to you"}
                )
        except HTTPException:
            raise
        except Exception as e:
            # Supabase .single() error (0 rows, multiple rows, etc.)
            logging.warning(f"[TRANSFER] Source account validation failed for account_id={request.source_account_id}, user_id={user_id}: {e}")
            raise HTTPException(
                status_code=403,
                detail={"error": "account_not_owned", "message": "Source Google Drive account not found or doesn't belong to you"}
            )
        
        # Verify target account ownership (OneDrive uses cloud_provider_accounts WITH provider column)
        try:
            target_check = (
                supabase.table("cloud_provider_accounts")
                .select("id")
                .eq("id", request.target_account_id)
                .eq("user_id", user_id)
                .eq("provider", "onedrive")
                .eq("is_active", True)
                .single()
                .execute()
            )
            if not target_check.data:
                raise HTTPException(
                    status_code=403,
                    detail={"error": "account_not_owned", "message": "Target OneDrive account not found, doesn't belong to you, or is inactive"}
                )
        except HTTPException:
            raise
        except Exception as e:
            # Supabase .single() error (0 rows, multiple rows, etc.)
            logging.warning(f"[TRANSFER] Target account validation failed for account_id={request.target_account_id}, user_id={user_id}: {e}")
            raise HTTPException(
                status_code=403,
                detail={"error": "account_not_owned", "message": "Target OneDrive account not found, doesn't belong to you, or is inactive"}
            )
        
        # PHASE 1: Create empty job (fast, <500ms)
        # Metadata fetch and quota check moved to /transfer/prepare/{job_id}
        job_id = await transfer.create_transfer_job(
            supabase,
            user_id=user_id,
            source_provider=request.source_provider,
            source_account_id=str(request.source_account_id),
            target_provider=request.target_provider,
            target_account_id=str(request.target_account_id),
            target_folder_id=request.target_folder_id,
            total_items=len(request.file_ids),  # Estimated count
            total_bytes=0  # Will be updated in prepare
        )
        
        # Store file_ids in job metadata (JSON column) for prepare phase
        supabase.table("transfer_jobs").update({
            "metadata": {"file_ids": request.file_ids}
        }).eq("id", job_id).execute()
        
        logging.info(f"[TRANSFER] Created empty job {job_id} for user {user_id}: {len(request.file_ids)} files (pending prepare)")
        return {"job_id": str(job_id)}
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[TRANSFER] Failed to create job for user {user_id}")
        raise HTTPException(status_code=500, detail=f"Failed to create transfer job: {str(e)}")


# ============================================================================
# BLOCKER 3: Provider Abstraction for Metadata Fetch
# ============================================================================

async def get_source_metadata_google_drive(source_account_id: int, file_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Fetch file metadata from Google Drive.
    
    Args:
        source_account_id: Google Drive account ID (int)
        file_ids: List of Google Drive file IDs
    
    Returns:
        List of {source_item_id, source_name, size_bytes}
    """
    from backend.google_drive import get_valid_token
    
    google_token = await get_valid_token(source_account_id)
    file_items = []
    
    for file_id in file_ids:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_id}",
                    params={"fields": "name,size,mimeType"},
                    headers={"Authorization": f"Bearer {google_token}"},
                    timeout=10.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    file_items.append({
                        "source_item_id": file_id,
                        "source_name": data.get("name", "unknown"),
                        "size_bytes": int(data.get("size", 0))
                    })
                else:
                    logging.warning(f"[TRANSFER] Could not fetch metadata for file {file_id}: {resp.status_code}")
                    file_items.append({
                        "source_item_id": file_id,
                        "source_name": f"file_{file_id}",
                        "size_bytes": 0
                    })
        except Exception as e:
            logging.warning(f"[TRANSFER] Error fetching metadata for file {file_id}: {e}")
            file_items.append({
                "source_item_id": file_id,
                "source_name": f"file_{file_id}",
                "size_bytes": 0
            })
    
    return file_items


async def get_source_metadata(provider: str, source_account_id: str, file_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Provider-agnostic metadata fetch (BLOCKER 3: extensible for OneDrive/Dropbox).
    
    Args:
        provider: "google_drive" | "onedrive" | "dropbox"
        source_account_id: Account ID (str to support both int and UUID)
        file_ids: List of file IDs
    
    Returns:
        List of {source_item_id, source_name, size_bytes}
    
    Raises:
        HTTPException: Unsupported provider
    """
    if provider == "google_drive":
        return await get_source_metadata_google_drive(int(source_account_id), file_ids)
    elif provider == "onedrive":
        # TODO: Implement OneDrive metadata fetch (for OneDrive→Google future support)
        raise HTTPException(
            status_code=501,
            detail=f"OneDrive as source provider not yet implemented"
        )
    elif provider == "dropbox":
        # TODO: Implement Dropbox metadata fetch
        raise HTTPException(
            status_code=501,
            detail=f"Dropbox as source provider not yet implemented"
        )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported source provider: {provider}"
        )


@app.post("/transfer/prepare/{job_id}")
async def prepare_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 2: Prepare transfer job (fetch metadata, check quota, create items).
    
    BLOCKER 1: State Flow
    - Accepts job with status='pending'
    - Transitions to 'queued' (success) or 'blocked_quota' (quota exceeded)
    - Must be called before /transfer/run
    
    BLOCKER 3: Provider Abstraction
    - Uses get_source_metadata() for extensibility
    - Currently supports: Google Drive
    - Stubs: OneDrive, Dropbox (501 Not Implemented)
    
    BLOCKER 4: Idempotence
    - If already queued/blocked/done: returns current status
    - Safe to retry on network errors
    
    This is the heavy lifting phase moved out of /transfer/create to avoid timeouts.
    
    Process:
    1. Fetch file metadata from Google Drive (name, size)
    2. Calculate total_bytes
    3. Check transfer quota (raises 402 if exceeded)
    4. Create transfer_job_items
    5. Update job status to 'queued' (ready) or 'blocked_quota'
    
    SECURITY:
    - Validates job belongs to user
    - Only prepares jobs with status='pending'
    """
    try:
        # Load job and verify ownership
        job_result = (
            supabase.table("transfer_jobs")
            .select("*")
            .eq("id", job_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        
        if not job_result.data:
            raise HTTPException(status_code=404, detail="Transfer job not found or doesn't belong to you")
        
        job = job_result.data
        
        # BLOCKER 4: Idempotence - skip if already prepared
        if job["status"] in ["queued", "blocked_quota", "running", "done", "done_skipped", "failed", "partial", "cancelled"]:
            logging.info(f"[TRANSFER] Job {job_id} already prepared (status={job['status']}), skipping prepare")
            return {
                "job_id": str(job_id),
                "status": job["status"],
                "total_items": job.get("total_items", 0),
                "total_bytes": job.get("total_bytes", 0),
                "message": "Job already prepared"
            }
        
        # AUDIT CONDITION 1: Single-flight protection - reject if already preparing
        if job["status"] == "preparing":
            raise HTTPException(
                status_code=409, 
                detail="Job is already being prepared by another request. Please wait."
            )
        
        if job["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Job status is '{job['status']}', cannot prepare (expected 'pending')")
        
        # AUDIT CONDITION 1: Mark as preparing to prevent concurrent prepare calls
        supabase.table("transfer_jobs").update({
            "status": "preparing"
        }).eq("id", job_id).execute()
        logging.info(f"[TRANSFER] Job {job_id} marked as preparing")
        
        # Get file_ids from job metadata
        file_ids = job.get("metadata", {}).get("file_ids", [])
        if not file_ids:
            raise HTTPException(status_code=400, detail="Job has no file_ids to prepare")
        
        # BLOCKER 3: Provider-agnostic metadata fetch
        file_items = await get_source_metadata(
            provider=job["source_provider"],
            source_account_id=job["source_account_id"],
            file_ids=file_ids
        )
        
        # Calculate total bytes
        total_bytes = sum(item["size_bytes"] for item in file_items)
        
        # QUOTA CHECK: Validate transfer quota
        try:
            quota_check = quota.check_transfer_bytes_available(supabase, user_id, total_bytes)
            logging.info(
                f"[TRANSFER] Quota check passed for job {job_id}: "
                f"requesting {total_bytes / 1_073_741_824:.2f}GB, "
                f"remaining {quota_check.get('remaining_bytes', 0) / 1_073_741_824:.2f}GB"
            )
            
            # Create transfer job items
            await transfer.create_transfer_job_items(supabase, job_id, file_items)
            
            # Update job: pending → queued (ready to run)
            supabase.table("transfer_jobs").update({
                "status": "queued",
                "total_items": len(file_items),
                "total_bytes": total_bytes
            }).eq("id", job_id).execute()
            
            logging.info(f"[TRANSFER] Prepared job {job_id}: {len(file_items)} files, {total_bytes / 1_073_741_824:.2f}GB")
            return {
                "job_id": str(job_id),
                "status": "queued",
                "total_items": len(file_items),
                "total_bytes": total_bytes
            }
            
        except HTTPException as quota_error:
            # Quota exceeded: mark job as blocked
            logging.warning(
                f"[TRANSFER] Quota exceeded for job {job_id}: "
                f"requesting {total_bytes / 1_073_741_824:.2f}GB - {quota_error.detail}"
            )
            
            supabase.table("transfer_jobs").update({
                "status": "blocked_quota",
                "total_bytes": total_bytes
            }).eq("id", job_id).execute()
            
            # Re-raise quota error to frontend
            raise
    
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[TRANSFER] Failed to prepare job {job_id}")
        # Mark job as failed
        try:
            supabase.table("transfer_jobs").update({
                "status": "failed",
                "error_message": str(e)[:500]
            }).eq("id", job_id).execute()
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to prepare transfer job: {str(e)}")


@app.post("/transfer/run/{job_id}")
async def run_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 3: Execute a transfer job (downloads from Google Drive, uploads to OneDrive).
    
    BLOCKER 1: State Flow
    - Accepts job with status='queued' (prepared and ready)
    - Rejects 'pending' (not prepared), 'blocked_quota' (no quota)
    - Transitions: queued → running → done/done_skipped/failed/partial
    
    BLOCKER 4: Idempotence
    - If already done/failed/partial: returns current status (no re-execution)
    - If running: allows retry/resume (idempotent)
    
    BLOCKER 6: Timeout Handling
    - Executes synchronously (in-request)
    - Client must use 120s timeout (handled in frontend)
    - Shows progress UI during transfer
    
    SECURITY:
    - Validates job belongs to user
    - Updates job/item status atomically
    """
    try:
        # Load job and verify ownership
        job_result = (
            supabase.table("transfer_jobs")
            .select("*")
            .eq("id", job_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        
        if not job_result.data:
            raise HTTPException(status_code=404, detail="Transfer job not found or doesn't belong to you")
        
        job = job_result.data
        
        # BLOCKER 4: Idempotence - don't re-run terminal states
        if job["status"] in ["done", "done_skipped", "failed", "partial", "cancelled"]:
            logging.info(f"[TRANSFER] Job {job_id} already completed (status={job['status']}), skipping run")
            # Return current status without re-executing
            status_data = await transfer.get_transfer_job_status(supabase, job_id, user_id)
            return {
                "job_id": str(job_id),
                "status": job["status"],
                "message": "Job already completed",
                **status_data
            }
        
        # BLOCKER 1: Only accept 'queued' status (prepared and ready)
        if job["status"] != "queued":
            # AUDIT CONDITION 2: If already running, return current status without re-executing
            if job["status"] == "running":
                logging.info(f"[TRANSFER] Job {job_id} already running, returning current status")
                status_data = await transfer.get_transfer_job_status(supabase, job_id, user_id)
                return {
                    "job_id": str(job_id),
                    "status": "running",
                    "message": "Job already in progress",
                    **status_data
                }
            elif job["status"] == "pending":
                raise HTTPException(
                    status_code=400, 
                    detail=f"Job not prepared yet. Run POST /transfer/prepare/{job_id} first."
                )
            elif job["status"] == "blocked_quota":
                raise HTTPException(
                    status_code=402, 
                    detail="Job blocked: quota exceeded. Upgrade plan or free up quota."
                )
            else:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Job status is '{job['status']}', cannot run. Expected 'queued'."
                )
        
        # Guard: Verify job has items before running
        items_check = (
            supabase.table("transfer_job_items")
            .select("id")
            .eq("job_id", job_id)
            .limit(1)
            .execute()
        )
        
        if not items_check.data:
            logging.error(f"[TRANSFER] Job {job_id} has no items to process")
            raise HTTPException(
                status_code=400,
                detail={"error": "no_items", "message": "Transfer job has no items to process"}
            )
        
        # Update job status to 'running'
        await transfer.update_job_status(supabase, job_id, status="running", started_at=True)
        
        # Load items to transfer
        items_result = (
            supabase.table("transfer_job_items")
            .select("*")
            .eq("job_id", job_id)
            .eq("status", "queued")
            .execute()
        )
        
        items = items_result.data
        if not items:
            # No items to process (all already processed or failed)
            await transfer.update_job_status(supabase, job_id, status="done", completed_at=True)
            return {"job_id": job_id, "status": "done", "message": "No items to transfer"}
        
        # Defensive logging: verify item structure
        logging.info(f"[TRANSFER] Job {job_id} processing {len(items)} items")
        if items:
            logging.info(f"[TRANSFER] First item keys: {list(items[0].keys())}")
        
        # Get tokens
        from backend.google_drive import get_valid_token
        google_token = await get_valid_token(int(job["source_account_id"]))
        
        # Get OneDrive token (decrypt + refresh if needed)
        from backend.onedrive import refresh_onedrive_token
        target_account_result = (
            supabase.table("cloud_provider_accounts")
            .select("access_token,refresh_token,id")
            .eq("id", job["target_account_id"])  # Use UUID directly, NOT int()
            .single()
            .execute()
        )
        if not target_account_result.data:
            raise HTTPException(status_code=500, detail="Target OneDrive account tokens not found")
        
        encrypted_access = target_account_result.data["access_token"]
        encrypted_refresh = target_account_result.data["refresh_token"]
        
        from backend.crypto import decrypt_token
        onedrive_access_token = decrypt_token(encrypted_access)
        onedrive_refresh_token = decrypt_token(encrypted_refresh)
        
        # Try token, refresh if 401
        async with httpx.AsyncClient() as test_client:
            test_resp = await test_client.get(
                "https://graph.microsoft.com/v1.0/me/drive",
                headers={"Authorization": f"Bearer {onedrive_access_token}"},
                timeout=10.0
            )
            if test_resp.status_code == 401:
                logging.info(f"[TRANSFER] OneDrive token expired, refreshing...")
                token_data = await refresh_onedrive_token(onedrive_refresh_token)
                onedrive_access_token = token_data["access_token"]
        
        # Process each item
        last_cancel_check_at = 0.0
        for item in items:
            # Throttle cancel checks to avoid hammering Supabase (every 2 seconds)
            now = time.time()
            if now - last_cancel_check_at >= 2.0:
                last_cancel_check_at = now
                job_row = (
                    supabase.table("transfer_jobs")
                    .select("status")
                    .eq("id", job_id)
                    .single()
                    .execute()
                )
                if job_row.data and job_row.data.get("status") == "cancelled":
                    logging.info(f"[TRANSFER] Job {job_id} cancelled -> stop item loop")
                    break
            
            file_name = item.get("source_name") or item.get("source_item_id") or "unknown"
            try:
                # Mark item as running (sets started_at)
                await transfer.update_item_status(
                    supabase,
                    item["id"],
                    status="running"
                )
                
                # Check for duplicates BEFORE downloading (save bandwidth)
                # CRITICAL: Wrap in try/except to prevent dedupe failures from blocking job
                target_folder_path = job.get("target_folder_id") or "root"
                file_size = item.get("size_bytes", 0)
                
                from backend.onedrive import find_duplicate_in_onedrive
                
                duplicate = None
                try:
                    duplicate = await find_duplicate_in_onedrive(
                        access_token=onedrive_access_token,
                        file_name=file_name,
                        file_size=file_size,
                        folder_id=target_folder_path
                    )
                except Exception as e:
                    # CRITICAL: Dedupe failure must not block transfer
                    logging.error(f"[TRANSFER] DEDUPE FAILED (fallback to copy): {file_name} - {e}")
                    duplicate = None  # Safe fallback: proceed with copy
                
                if duplicate:
                    # File already exists - skip transfer
                    logging.info(f"[TRANSFER] Item {item['id']} SKIPPED (already exists): {file_name}")
                    await transfer.update_item_status(
                        supabase,
                        item["id"],
                        status="skipped",
                        error_message="already_exists",
                        target_item_id=duplicate.get("id"),
                        target_web_url=duplicate.get("webUrl")
                    )
                    # CRITICAL: Update job counters (skipped counts as completed for job progress)
                    await transfer.update_job_status(supabase, job_id, increment_completed=True)
                    continue
                
                # Download from Google Drive
                async with httpx.AsyncClient() as client:
                    download_resp = await client.get(
                        f"https://www.googleapis.com/drive/v3/files/{item['source_item_id']}?alt=media",
                        headers={"Authorization": f"Bearer {google_token}"},
                        timeout=300.0  # 5 minutes for large files
                    )
                    
                    if download_resp.status_code != 200:
                        error_msg = f"Google Drive download failed: {download_resp.status_code}"
                        await transfer.update_item_status(
                            supabase,
                            item["id"],
                            status="failed",
                            error_message=error_msg
                        )
                        await transfer.update_job_status(supabase, job_id, increment_failed=True)
                        continue
                    
                    file_data = download_resp.content
                
                # Upload to OneDrive (chunked)
                upload_result = await transfer.upload_to_onedrive_chunked(
                    access_token=onedrive_access_token,
                    file_name=file_name,
                    file_data=file_data,
                    folder_path=target_folder_path,
                    job_id=job_id,
                    supabase_client=supabase
                )
                
                # Mark item as done (with webUrl)
                await transfer.update_item_status(
                    supabase,
                    item["id"],
                    status="done",
                    target_item_id=upload_result.get("id"),
                    target_web_url=upload_result.get("webUrl"),
                    bytes_transferred=len(file_data)
                )
                
                # Increment job counters
                await transfer.update_job_status(
                    supabase,
                    job_id,
                    increment_completed=True,
                    add_transferred_bytes=len(file_data)
                )
                
                logging.info(f"[TRANSFER] Item {item['id']} transferred successfully: {file_name}")
                
            except transfer.TransferCancelled:
                logging.info(f"[TRANSFER] Cancel detected during upload. job={job_id}")
                # Mark current item as skipped/cancelled
                await transfer.update_item_status(
                    supabase,
                    item["id"],
                    status="skipped",
                    error_message="Cancelled by user"
                )
                
                # Ensure job is cancelled (idempotent)
                supabase.table("transfer_jobs").update({
                    "status": "cancelled",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", job_id).execute()
                
                break
                
            except Exception as e:
                # CRITICAL: Any failure must update counters to prevent zombie job
                logging.exception(f"[TRANSFER] FAILED item {item['id']}: {file_name}")
                try:
                    await transfer.update_item_status(
                        supabase,
                        item["id"],
                        status="failed",
                        error_message=str(e)[:500]  # Truncate long errors
                    )
                    await transfer.update_job_status(supabase, job_id, increment_failed=True)
                except Exception as update_error:
                    # Last resort: log and continue (don't cascade failures)
                    logging.error(f"[TRANSFER] CRITICAL: Failed to update status for item {item['id']}: {update_error}")
        
        # Determine final job status
        final_result = (
            supabase.table("transfer_jobs")
            .select("total_items,completed_items,failed_items,skipped_items")
            .eq("id", job_id)
            .single()
            .execute()
        )
        
        total = final_result.data["total_items"]
        completed = final_result.data["completed_items"]
        failed = final_result.data["failed_items"]
        skipped = final_result.data.get("skipped_items", 0)
        
        # BLOCKER 1: Terminal state determination
        # Special case: all items skipped (already exist in destination)
        if skipped == total and completed == 0 and failed == 0:
            final_status = "done_skipped"
            logging.info(f"[TRANSFER] Job {job_id} completed: all {total} items already existed (skipped)")
        elif completed == total and failed == 0:
            # Pure success (all completed, no failures)
            final_status = "done"
        elif failed == total and completed == 0:
            # Pure failure (all failed, no success)
            final_status = "failed"
        elif completed > 0 or skipped > 0:
            # Partial success (some completed/skipped, some failed)
            final_status = "partial"
        else:
            # Unexpected state (no items processed?)
            final_status = "failed"
            logging.warning(f"[TRANSFER] Job {job_id} unexpected state: completed=0, failed=0, skipped=0, total={total}")
        
        await transfer.update_job_status(supabase, job_id, status=final_status, completed_at=True)
        
        logging.info(f"[TRANSFER] Job {job_id} completed: {completed}/{total} successful, {failed} failed")
        return {
            "job_id": job_id,
            "status": final_status,
            "total_items": total,
            "completed_items": completed,
            "failed_items": failed
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[TRANSFER] Job {job_id} execution failed")
        # Try to mark job as failed
        try:
            await transfer.update_job_status(supabase, job_id, status="failed", completed_at=True)
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Transfer execution failed: {str(e)}")


@app.get("/transfer/status/{job_id}")
async def get_transfer_status_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get transfer job status with item details (for progress polling).
    
    SECURITY:
    - Validates job belongs to user
    - Returns job metadata + all items with status/errors
    
    Frontend should poll this endpoint every 2-3 seconds during transfer.
    """
    try:
        result = await transfer.get_transfer_job_status(supabase, job_id, user_id)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[TRANSFER] Failed to get status for job {job_id}")
        raise HTTPException(status_code=500, detail=f"Failed to get transfer status: {str(e)}")


@app.post("/transfer/cancel/{job_id}")
async def cancel_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Cancel a transfer job in progress.
    
    BEHAVIOR:
    - Marks job as 'cancelled'
    - Stops further item processing
    - Already completed items remain done
    - Queued items are marked as 'skipped'
    
    SECURITY:
    - Validates job belongs to user
    """
    try:
        # Verify ownership
        job_result = (
            supabase.table("transfer_jobs")
            .select("*")
            .eq("id", job_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        
        if not job_result.data:
            raise HTTPException(status_code=404, detail="Transfer job not found")
        
        job = job_result.data
        
        # Only cancel if not already terminal
        if job["status"] in ["done", "failed", "partial", "cancelled"]:
            return {
                "job_id": job_id,
                "status": job["status"],
                "message": "Job already in terminal state"
            }
        
        # Mark job as cancelled
        supabase.table("transfer_jobs").update({
            "status": "cancelled",
            "completed_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", job_id).execute()
        
        # Mark remaining queued items as skipped
        supabase.table("transfer_job_items").update({
            "status": "skipped",
            "error_message": "Cancelled by user"
        }).eq("job_id", job_id).eq("status", "queued").execute()
        
        logging.info(f"[TRANSFER] Job {job_id} cancelled by user {user_id}")
        
        return {
            "job_id": job_id,
            "status": "cancelled",
            "message": "Transfer cancelled successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[TRANSFER] Failed to cancel job {job_id}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel transfer: {str(e)}")


@app.get("/transfer/targets/onedrive")
async def get_onedrive_transfer_targets(
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get list of active OneDrive accounts available as transfer targets.
    
    SECURITY:
    - Validates user authentication via JWT
    - Returns only accounts belonging to authenticated user
    - Only returns active accounts (is_active=true)
    - Does NOT expose tokens or sensitive data
    
    SOURCE OF TRUTH: cloud_provider_accounts table ONLY
    
    Returns:
        {
            "accounts": [
                {"id": account_id, "email": "user@example.com"},
                ...
            ]
        }
    """
    try:
        # Query cloud_provider_accounts directly (single source of truth)
        result = (
            supabase.table("cloud_provider_accounts")
            .select("id,account_email")
            .eq("user_id", user_id)
            .eq("provider", "onedrive")
            .eq("is_active", True)
            .execute()
        )
        
        accounts = [
            {
                "id": acc["id"],
                "email": acc["account_email"],
            }
            for acc in (result.data or [])
        ]
        
        logging.info(f"[TRANSFER_TARGETS] Found {len(accounts)} active OneDrive accounts for user {user_id}")
        return {"accounts": accounts}
        
    except Exception as e:
        logging.exception(f"[TRANSFER_TARGETS] Failed to fetch OneDrive targets for user {user_id}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch OneDrive accounts: {str(e)}")


@app.get("/drive/picker-token")
async def get_picker_token(
    account_id: int,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get valid Google OAuth access token for Google Picker API.
    
    SECURITY:
    - Validates that account belongs to authenticated user (RLS via user_id)
    - Returns valid access_token (refreshed if needed)
    - Never logs token values
    
    This token is needed by frontend to initialize Google Picker for file selection.
    With drive.file scope, Picker allows user to grant access to specific files.
    """
    try:
        # Verify account ownership (RLS)
        account_check = (
            supabase.table("cloud_accounts")
            .select("id")
            .eq("id", account_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        
        if not account_check.data:
            raise HTTPException(
                status_code=404,
                detail=f"Account {account_id} not found or doesn't belong to you"
            )
        
        # Get valid token (will refresh if needed)
        from backend.google_drive import get_valid_token
        access_token = await get_valid_token(account_id)
        
        # Get token expiry from database (after potential refresh)
        account = (
            supabase.table("cloud_accounts")
            .select("token_expiry")
            .eq("id", account_id)
            .single()
            .execute()
        ).data
        
        return {
            "access_token": access_token,
            "expires_at": account.get("token_expiry") if account else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"[PICKER_TOKEN] Failed to retrieve picker token for account_id={account_id}")
        raise HTTPException(status_code=500, detail="Failed to retrieve picker token")


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
        logging.error(f"[SLOTS FETCH ERROR] user_id={user_id} error={str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch slots: {str(e)}")


def classify_account_status(slot: dict, cloud_account: dict) -> dict:
    """
    Determina el estado de conexión de una cuenta basado en slot y cloud_account.
    
    REGLAS DE ESTADO (MultCloud-style):
    1. "disconnected": Usuario desconectó manualmente (is_active=false en SLOT)
    2. "needs_reconnect": Tokens inválidos/expirados (soft state, NO modifica is_active)
    3. "connected": Tokens válidos y operacionales
    
    IMPORTANTE: Esta función NO modifica datos - solo lee y clasifica.
    La única forma de pasar a "disconnected" es usuario llamando /auth/revoke-account.
    Los errores OAuth (invalid_grant, etc) solo causan "needs_reconnect".
    
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
    
    # Caso 6: Token NO expirado pero falta refresh_token (funcional pero limitado)
    # El token actual funciona, solo requerirá reconexión cuando expire
    # NO activar banner - la cuenta está operativa AHORA
    if not refresh_token:
        return {
            "connection_status": "connected",
            "reason": "limited_no_refresh",
            "can_reconnect": True
        }
    
    # Caso 7: Todo OK - token válido, access_token existe, refresh_token existe
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
        
        # 2. Fetch ALL cloud_accounts ONCE (eliminate N+1 query)
        all_accounts_result = supabase.table("cloud_accounts").select("*").eq("user_id", user_id).execute()
        
        # 2b. Fetch ALL cloud_provider_accounts ONCE (OneDrive, Dropbox, etc.)
        all_provider_accounts_result = supabase.table("cloud_provider_accounts").select("*").eq("user_id", user_id).execute()
        
        # 3. Build normalized lookup map: google_account_id (normalized) -> cloud_account
        accounts_map = {}
        for acc in (all_accounts_result.data or []):
            acc_google_id_normalized = str(acc.get("google_account_id", "")).strip()
            if acc_google_id_normalized:
                accounts_map[acc_google_id_normalized] = acc
        
        # 3b. Build lookup map for provider_accounts: (provider, provider_account_id) -> provider_account
        provider_accounts_map = {}
        for acc in (all_provider_accounts_result.data or []):
            provider = acc.get("provider", "").strip()
            acc_provider_id = str(acc.get("provider_account_id", "")).strip()
            if provider and acc_provider_id:
                key = (provider, acc_provider_id)
                provider_accounts_map[key] = acc
        
        accounts_status = []
        summary = {"connected": 0, "needs_reconnect": 0, "disconnected": 0}
        
        for slot in slots_result.data:
            # 4. Match slot to cloud_account using normalized ID (provider-aware)
            slot_provider = slot.get("provider", "").strip()
            slot_provider_id = str(slot.get("provider_account_id", "")).strip()
            
            if slot_provider == "google_drive":
                # Google uses cloud_accounts (legacy table)
                cloud_account = accounts_map.get(slot_provider_id)
            else:
                # OneDrive/Dropbox/others use cloud_provider_accounts
                cloud_account = provider_accounts_map.get((slot_provider, slot_provider_id))
            
            # 5. Classify status
            status = classify_account_status(slot, cloud_account)
            
            # 6. Build response
            # For non-Google providers, include provider_account_uuid (DB row ID) for routing
            provider_account_uuid = None
            if slot_provider != "google_drive" and cloud_account:
                provider_account_uuid = cloud_account.get("id")  # UUID from cloud_provider_accounts.id
            
            accounts_status.append({
                "slot_log_id": slot["id"],
                "slot_number": slot["slot_number"],
                "slot_is_active": slot["is_active"],
                "provider": slot["provider"],
                "provider_email": slot["provider_email"],
                "provider_account_id": slot["provider_account_id"],  # Microsoft/Dropbox account ID
                "provider_account_uuid": provider_account_uuid,  # UUID for /onedrive/{uuid}/files routing
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
        logging.error(f"[CLOUD STATUS ERROR] user_id={user_id} error={str(e)}")
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


class DisconnectSlotRequest(BaseModel):
    slot_log_id: str  # UUID from cloud_slots_log


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


@app.post("/cloud/disconnect")
async def disconnect_slot(
    request: DisconnectSlotRequest,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Universal endpoint to disconnect any cloud provider account (Google Drive, OneDrive, etc).
    
    Works with cloud_slots_log for multi-provider support. Deactivates slot and optionally
    clears tokens from provider-specific tables (cloud_accounts for Google, 
    cloud_provider_accounts for OneDrive/Dropbox).
    
    Security:
    - Requires valid JWT token
    - Validates slot ownership before disconnect
    - Returns 403 if user doesn't own the slot
    - Physically deletes OAuth tokens for security compliance
    
    Body:
        {
            "slot_log_id": "uuid-from-cloud-slots-log"
        }
    
    Returns:
        {
            "success": true,
            "message": "OneDrive account user@example.com disconnected successfully"
        }
    """
    try:
        # 1. Verify slot exists and belongs to user (filter by user_id directly)
        try:
            slot_resp = supabase.table("cloud_slots_log").select(
                "id, user_id, provider, provider_email, provider_account_id, is_active"
            ).eq("id", request.slot_log_id).eq("user_id", user_id).single().execute()
        except Exception as query_error:
            error_msg = str(query_error).lower()
            if "0 rows" in error_msg or "single row" in error_msg or "no rows" in error_msg:
                raise HTTPException(
                    status_code=404,
                    detail={"error_code": "SLOT_NOT_FOUND", "message": "Slot not found"}
                )
            raise
        
        if not slot_resp.data:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "SLOT_NOT_FOUND", "message": "Slot not found"}
            )
        
        slot = slot_resp.data
        
        # Check if already disconnected
        if not slot["is_active"]:
            return {
                "success": True,
                "message": f"{slot['provider']} account {slot['provider_email']} already disconnected"
            }
        
        provider = slot["provider"]
        provider_email = slot["provider_email"]
        provider_account_id = slot["provider_account_id"]
        now_iso = datetime.now(timezone.utc).isoformat()
        
        logging.info(f"[DISCONNECT] user={user_id} slot={request.slot_log_id} provider={provider} email={provider_email}")
        
        # 3. Deactivate slot in cloud_slots_log
        supabase.table("cloud_slots_log").update({
            "is_active": False,
            "disconnected_at": now_iso
        }).eq("id", request.slot_log_id).execute()
        
        # 4. Deactivate and clear tokens in provider-specific table
        if provider == "google_drive":
            # Google Drive: use cloud_accounts table
            supabase.table("cloud_accounts").update({
                "is_active": False,
                "disconnected_at": now_iso,
                "access_token": None,
                "refresh_token": None
            }).eq("user_id", user_id).eq("google_account_id", provider_account_id).execute()
            
        else:
            # OneDrive/Dropbox/etc: use cloud_provider_accounts table
            try:
                supabase.table("cloud_provider_accounts").update({
                    "is_active": False,
                    "access_token": None,
                    "refresh_token": None,
                    "updated_at": now_iso
                }).eq("user_id", user_id).eq("provider", provider).eq("provider_account_id", provider_account_id).execute()
            except Exception as token_clear_error:
                # Only tolerate NOT NULL constraint errors (23502)
                error_str = str(token_clear_error).lower()
                if "23502" in error_str or "not-null constraint" in error_str or "violates not-null" in error_str:
                    logging.warning(f"[DISCONNECT] Ignored NOT NULL constraint on tokens (slot already deactivated): {token_clear_error}")
                else:
                    # Re-raise other errors
                    raise
        
        logging.info(f"[DISCONNECT] Successfully disconnected {provider} account {provider_email}")
        
        return {
            "success": True,
            "message": f"{provider} account {provider_email} disconnected successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[DISCONNECT ERROR] Failed to disconnect slot {request.slot_log_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect account: {str(e)}"
        )


@app.get("/cloud/storage-summary")
async def get_cloud_storage_summary(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get aggregated storage summary across all connected cloud accounts (Google Drive + OneDrive).
    
    Returns total storage across all accounts plus per-account breakdown.
    Gracefully handles account errors (expired tokens, quota fetch failures).
    
    Security:
    - Requires valid JWT token
    - Only returns data for authenticated user's accounts
    
    Returns:
        {
            "totals": {
                "total_bytes": int,
                "used_bytes": int,
                "free_bytes": int,
                "percent_used": float
            },
            "accounts": [
                {
                    "provider": "google_drive"|"onedrive",
                    "email": str,
                    "total_bytes": int,
                    "used_bytes": int,
                    "free_bytes": int,
                    "percent_used": float,
                    "status": "ok"|"unavailable"|"error"
                }
            ]
        }
    """
    try:
        # Fetch all active accounts for user
        google_accounts_resp = supabase.table("cloud_accounts").select(
            "id, account_email, access_token"
        ).eq("user_id", user_id).eq("is_active", True).execute()
        
        onedrive_accounts_resp = supabase.table("cloud_provider_accounts").select(
            "id, provider_account_id, account_email, access_token, refresh_token"
        ).eq("user_id", user_id).eq("provider", "onedrive").eq("is_active", True).execute()
        
        google_accounts = google_accounts_resp.data or []
        onedrive_accounts = onedrive_accounts_resp.data or []
        
        accounts_data = []
        total_bytes = 0
        used_bytes = 0
        
        # Process Google Drive accounts
        for account in google_accounts:
            try:
                quota_info = await get_storage_quota(account["id"])
                storage_quota = quota_info.get("storageQuota", {})
                
                account_total = int(storage_quota.get("limit", 0))
                account_used = int(storage_quota.get("usage", 0))
                account_free = account_total - account_used if account_total > 0 else 0
                account_percent = round((account_used / account_total * 100) if account_total > 0 else 0, 2)
                
                total_bytes += account_total
                used_bytes += account_used
                
                accounts_data.append({
                    "provider": "google_drive",
                    "email": account["account_email"],
                    "total_bytes": account_total,
                    "used_bytes": account_used,
                    "free_bytes": account_free,
                    "percent_used": account_percent,
                    "status": "ok"
                })
            except Exception as e:
                logging.warning(f"[STORAGE_SUMMARY] Failed to fetch Google Drive quota for {account.get('account_email')}: {e}")
                accounts_data.append({
                    "provider": "google_drive",
                    "email": account.get("account_email", "unknown"),
                    "total_bytes": None,
                    "used_bytes": None,
                    "free_bytes": None,
                    "percent_used": None,
                    "status": "unavailable"
                })
        
        # Process OneDrive accounts
        for account in onedrive_accounts:
            try:
                # Decrypt access token
                access_token = decrypt_token(account["access_token"])
                
                # Try to get quota, refresh token if needed
                try:
                    quota_info = await get_onedrive_storage_quota(access_token)
                except HTTPException as e:
                    # If 401, try to refresh token
                    if e.status_code == 401:
                        refresh_token = decrypt_token(account["refresh_token"])
                        tokens = await refresh_onedrive_token(refresh_token)
                        
                        # Update tokens in DB
                        supabase.table("cloud_provider_accounts").update({
                            "access_token": encrypt_token(tokens["access_token"]),
                            "refresh_token": encrypt_token(tokens["refresh_token"]),
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }).eq("id", account["id"]).execute()
                        
                        # Retry quota fetch
                        quota_info = await get_onedrive_storage_quota(tokens["access_token"])
                    else:
                        raise
                
                account_total = quota_info.get("total", 0)
                account_used = quota_info.get("used", 0)
                account_free = quota_info.get("remaining", 0)
                account_percent = round((account_used / account_total * 100) if account_total > 0 else 0, 2)
                
                total_bytes += account_total
                used_bytes += account_used
                
                accounts_data.append({
                    "provider": "onedrive",
                    "email": account["account_email"],
                    "total_bytes": account_total,
                    "used_bytes": account_used,
                    "free_bytes": account_free,
                    "percent_used": account_percent,
                    "status": "ok"
                })
            except Exception as e:
                logging.warning(f"[STORAGE_SUMMARY] Failed to fetch OneDrive quota for {account.get('account_email')}: {e}")
                accounts_data.append({
                    "provider": "onedrive",
                    "email": account.get("account_email", "unknown"),
                    "total_bytes": None,
                    "used_bytes": None,
                    "free_bytes": None,
                    "percent_used": None,
                    "status": "unavailable"
                })
        
        free_bytes = total_bytes - used_bytes if total_bytes > 0 else 0
        percent_used = round((used_bytes / total_bytes * 100) if total_bytes > 0 else 0, 2)
        
        return {
            "totals": {
                "total_bytes": total_bytes,
                "used_bytes": used_bytes,
                "free_bytes": free_bytes,
                "percent_used": percent_used
            },
            "accounts": accounts_data
        }
        
    except Exception as e:
        logging.error(f"[STORAGE_SUMMARY ERROR] Failed to fetch storage summary for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch storage summary: {str(e)}"
        )


# ========================================================================
# OneDrive OAuth Endpoints
# ========================================================================

@app.get("/auth/onedrive/login-url")
def onedrive_login_url(
    mode: Optional[str] = None,
    reconnect_account_id: Optional[str] = None,
    user_info: dict = Depends(get_jwt_user_info)
):
    """
    Get Microsoft OneDrive OAuth URL for client-side redirect.
    
    Mirrors Google OAuth flow but for OneDrive integration.
    Reuses existing JWT state token system, slot validation, and encryption.
    
    OAuth Modes:
    - "connect": New account connection (checks slot availability)
    - "reauth": Re-authorize existing account
    - "reconnect": Restore slot without consuming new slot (requires reconnect_account_id)
    
    Args:
        mode: "connect"|"reauth"|"reconnect"
        reconnect_account_id: Microsoft account ID (required for mode=reconnect)
        user_info: Derived from JWT (verify_supabase_jwt)
        
    Returns:
        {"url": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?..."}
    """
    user_id = user_info["user_id"]
    user_email = user_info["email"]
    
    if not MICROSOFT_CLIENT_ID or not MICROSOFT_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Missing MICROSOFT_CLIENT_ID or MICROSOFT_REDIRECT_URI")

    # Validation: reconnect requires account_id
    if mode == "reconnect" and not reconnect_account_id:
        raise HTTPException(status_code=400, detail="reconnect_account_id required for mode=reconnect")
    
    # For reconnect: verify slot exists and get email for login_hint + slot_log_id
    reconnect_email = None
    slot_log_id = None
    if mode == "reconnect":
        try:
            reconnect_account_id_normalized = str(reconnect_account_id).strip() if reconnect_account_id else ""
            
            slot_check = supabase.table("cloud_slots_log").select("id,provider_email").eq("provider", "onedrive").eq("provider_account_id", reconnect_account_id_normalized).order("id", desc=True).limit(1).execute()
            
            if not slot_check.data:
                # Secure logging: hash account_id suffix only
                account_suffix = reconnect_account_id_normalized[-4:] if reconnect_account_id_normalized else 'EMPTY'
                logging.warning(
                    f"[SECURITY][RECONNECT][ONEDRIVE] slot_not_found account_suffix=***{account_suffix}"
                )
                return JSONResponse(
                    status_code=404,
                    content={"error": "slot_not_found"}
                )
            
            slot_data = slot_check.data[0]
            reconnect_email = slot_data.get("provider_email")
            slot_log_id = slot_data.get("id")
        except Exception:
            logging.exception("[SECURITY][LOGIN_URL][ONEDRIVE] reconnect_mode_failed")
            return JSONResponse(
                status_code=500,
                content={"error": "login_url_failed"}
            )
    
    # OAuth prompt strategy (Microsoft recommends "select_account" for better UX)
    oauth_prompt = "select_account"
    
    params = {
        "client_id": MICROSOFT_CLIENT_ID,
        "redirect_uri": MICROSOFT_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(ONEDRIVE_SCOPES),
        "prompt": oauth_prompt,
    }
    
    # Add login_hint for reconnect (improves UX)
    if mode == "reconnect" and reconnect_email:
        params["login_hint"] = reconnect_email
    
    # Create state JWT with user_id, mode, reconnect_account_id, slot_log_id, user_email
    state_token = create_state_token(
        user_id,
        mode=mode or "connect",
        reconnect_account_id=reconnect_account_id,
        slot_log_id=slot_log_id,
        user_email=user_email
    )
    params["state"] = state_token

    from urllib.parse import urlencode
    url = f"{MICROSOFT_AUTH_ENDPOINT}?{urlencode(params)}"
    
    # Secure logging: hash user_id
    user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    logging.info(
        f"[OAUTH_URL_GENERATED][ONEDRIVE] user_hash={user_hash} mode={mode or 'connect'} "
        f"prompt={oauth_prompt} reconnect_mode={bool(reconnect_account_id)}"
    )
    
    return {"url": url}


@app.get("/auth/onedrive/callback")
async def onedrive_callback(request: Request):
    """Handle Microsoft OneDrive OAuth callback"""
    from urllib.parse import parse_qs
    import httpx

    # Validate required environment variables
    if not MICROSOFT_CLIENT_ID or not MICROSOFT_CLIENT_SECRET or not MICROSOFT_REDIRECT_URI:
        logging.error("[ONEDRIVE][CALLBACK] Missing required env vars (MICROSOFT_CLIENT_ID, CLIENT_SECRET, or REDIRECT_URI)")
        frontend_origin = safe_frontend_origin_from_request(request)
        return RedirectResponse(f"{frontend_origin}/app?error=onedrive_not_configured")

    query = request.url.query
    qs = parse_qs(query)
    code = qs.get("code", [None])[0]
    error = qs.get("error", [None])[0]
    state = qs.get("state", [None])[0]

    frontend_origin = safe_frontend_origin_from_request(request)

    if error:
        return RedirectResponse(f"{frontend_origin}/app?error={error}")

    if not code:
        return RedirectResponse(f"{frontend_origin}/app?error=no_code")
    
    # Decode state to get user_id, mode, reconnect_account_id, slot_log_id, user_email
    user_id = None
    mode = "connect"
    reconnect_account_id = None
    slot_log_id = None
    user_email = None
    if state:
        state_data = decode_state_token(state)
        if state_data:
            user_id = state_data.get("user_id")
            mode = state_data.get("mode", "connect")
            reconnect_account_id = state_data.get("reconnect_account_id")
            slot_log_id = state_data.get("slot_log_id")
            user_email = state_data.get("user_email")

    # Exchange code for tokens
    data = {
        "code": code,
        "client_id": MICROSOFT_CLIENT_ID,
        "client_secret": MICROSOFT_CLIENT_SECRET,
        "redirect_uri": MICROSOFT_REDIRECT_URI,
        "grant_type": "authorization_code",
        "scope": " ".join(ONEDRIVE_SCOPES),  # CRITICAL: Required by Microsoft token endpoint
    }
    
    # DIAGNOSTIC LOGGING: Log token exchange attempt (without secrets)
    logging.info(
        f"[ONEDRIVE][TOKEN_EXCHANGE] Attempting token exchange: "
        f"endpoint={MICROSOFT_TOKEN_ENDPOINT} "
        f"tenant={MICROSOFT_TENANT_ID} "
        f"redirect_uri={MICROSOFT_REDIRECT_URI} "
        f"scope={' '.join(ONEDRIVE_SCOPES)} "
        f"grant_type=authorization_code"
    )

    async with httpx.AsyncClient() as client:
        try:
            token_res = await client.post(MICROSOFT_TOKEN_ENDPOINT, data=data)
            token_res.raise_for_status()
            token_json = token_res.json()
            logging.info(f"[ONEDRIVE][TOKEN_EXCHANGE] SUCCESS: Received tokens from Microsoft")
        except httpx.HTTPStatusError as e:
            # DIAGNOSTIC LOGGING: Log detailed error response (sanitize sensitive data)
            error_body = ""
            try:
                error_body = e.response.text[:500]  # Truncate to avoid logging huge responses
            except:
                error_body = "Unable to read response body"
            
            logging.error(
                f"[ONEDRIVE][TOKEN_EXCHANGE] HTTP {e.response.status_code} from Microsoft token endpoint. "
                f"Error body: {error_body}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=onedrive_token_exchange_failed")
        except Exception as e:
            logging.error(
                f"[ONEDRIVE][TOKEN_EXCHANGE] Unexpected error: {type(e).__name__} - {str(e)}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=onedrive_token_exchange_failed")

    access_token = token_json.get("access_token")
    refresh_token = token_json.get("refresh_token")  # May be None
    expires_in = token_json.get("expires_in", 3600)

    if not access_token:
        logging.error("[ONEDRIVE][TOKEN_EXCHANGE] No access_token in response")
        return RedirectResponse(f"{frontend_origin}/app?error=no_access_token")

    # Get user info from Microsoft Graph API
    async with httpx.AsyncClient() as client:
        try:
            userinfo_res = await client.get(
                MICROSOFT_USERINFO_ENDPOINT,
                headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_res.raise_for_status()
            userinfo = userinfo_res.json()
        except httpx.HTTPStatusError as e:
            logging.error(
                f"[ONEDRIVE][USERINFO] HTTP {e.response.status_code} from Microsoft Graph API"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=onedrive_userinfo_failed")
        except Exception as e:
            logging.error(f"[ONEDRIVE][USERINFO] Unexpected error: {type(e).__name__}")
            return RedirectResponse(f"{frontend_origin}/app?error=onedrive_userinfo_failed")

    # Extract multiple email/identity fields from Microsoft Graph API for robust matching
    graph_mail = userinfo.get("mail")
    graph_upn = userinfo.get("userPrincipalName")
    microsoft_account_id = userinfo.get("id")
    
    # Build primary account_email (for storage)
    account_email = graph_upn or graph_mail
    
    # Normalize Microsoft account ID for consistent comparison
    if microsoft_account_id:
        microsoft_account_id = str(microsoft_account_id).strip()
        # Secure logging: hash account_id, log available email fields (domains only)
        account_hash = hashlib.sha256(microsoft_account_id.encode()).hexdigest()[:8]
        mail_domain = graph_mail.split("@")[1] if graph_mail and "@" in graph_mail else None
        upn_domain = graph_upn.split("@")[1] if graph_upn and "@" in graph_upn else None
        logging.info(
            f"[OAUTH CALLBACK][ONEDRIVE] account_hash={account_hash}, "
            f"mail_present={bool(graph_mail)}, mail_domain={mail_domain}, "
            f"upn_present={bool(graph_upn)}, upn_domain={upn_domain}"
        )

    # Calculate expiry
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    expiry_iso = expiry.isoformat()

    # Prevent orphan cloud_provider_accounts without user_id
    if not user_id:
        return RedirectResponse(f"{frontend_origin}/app?error=missing_user_id")
    
    # Handle reconnect mode
    if mode == "reconnect":
        reconnect_account_id_normalized = str(reconnect_account_id).strip() if reconnect_account_id else ""
        microsoft_account_id_normalized = str(microsoft_account_id).strip() if microsoft_account_id else ""
        
        if microsoft_account_id_normalized != reconnect_account_id_normalized:
            # Secure logging: mask emails
            expected_email = "unknown"
            try:
                slot_info = supabase.table("cloud_slots_log").select("provider_email").eq("provider", "onedrive").eq("provider_account_id", reconnect_account_id_normalized).order("created_at", desc=True).limit(1).execute()
                if slot_info.data:
                    expected_email = slot_info.data[0].get("provider_email", "unknown")
            except Exception:
                pass
            
            expected_domain = expected_email.split("@")[1] if expected_email and "@" in expected_email else "unknown"
            got_domain = account_email.split("@")[1] if account_email and "@" in account_email else "unknown"
            logging.error(
                f"[RECONNECT ERROR][ONEDRIVE] Account mismatch: "
                f"expected_domain={expected_domain} got_domain={got_domain}"
            )
            # PRIVACY: Do NOT include email in redirect URL
            return RedirectResponse(f"{frontend_origin}/app?error=account_mismatch")
        
        # Security check: verify slot ownership
        if slot_log_id:
            target_slot = supabase.table("cloud_slots_log") \
                .select("id, user_id, provider_account_id, provider_email") \
                .eq("id", slot_log_id) \
                .eq("provider", "onedrive") \
                .limit(1) \
                .execute()
        else:
            target_slot = supabase.table("cloud_slots_log") \
                .select("id, user_id, provider_account_id, provider_email") \
                .eq("provider", "onedrive") \
                .eq("provider_account_id", reconnect_account_id_normalized) \
                .order("created_at", desc=True) \
                .limit(1) \
                .execute()
        
        if not target_slot.data:
            user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
            logging.error(
                f"[SECURITY][ONEDRIVE] Reconnect failed: slot not found. user_hash={user_hash}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")
        
        slot_user_id = target_slot.data[0]["user_id"]
        slot_id = target_slot.data[0]["id"]
        slot_email = target_slot.data[0].get("provider_email", "")
        
        # Verify ownership or allow safe reclaim
        if slot_user_id != user_id:
            slot_email_normalized = slot_email.lower().strip() if slot_email else ""
            current_user_email_normalized = user_email.lower().strip() if user_email else ""
            
            if not slot_email_normalized or not current_user_email_normalized:
                logging.error(
                    f"[SECURITY][ONEDRIVE] Ownership violation: Missing email. slot_id={slot_id}"
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
            
            if slot_email_normalized == current_user_email_normalized:
                # Safe reclaim: emails match
                slot_domain = slot_email.split("@")[1] if "@" in slot_email else "unknown"
                logging.warning(
                    f"[SECURITY][RECLAIM][ONEDRIVE] Slot reassignment authorized: "
                    f"slot_id={slot_id} email_domain={slot_domain}"
                )
                
                try:
                    supabase.table("cloud_slots_log").update({
                        "user_id": user_id
                    }).eq("id", slot_id).execute()
                    
                    supabase.table("cloud_provider_accounts").update({
                        "user_id": user_id
                    }).eq("provider", "onedrive").eq("provider_account_id", reconnect_account_id_normalized).execute()
                    
                    logging.info(f"[SECURITY][RECLAIM][ONEDRIVE] Ownership transferred. slot_id={slot_id}")
                except Exception as e:
                    logging.error(f"[SECURITY][RECLAIM][ONEDRIVE] Transfer failed: {type(e).__name__}")
                    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed")
                
                slot_user_id = user_id
            else:
                # Email mismatch - block takeover attempt
                logging.error(
                    f"[SECURITY][ONEDRIVE] Account takeover blocked! "
                    f"Email mismatch for slot_id={slot_id}"
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
        
        user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
        logging.info(
            f"[SECURITY][ONEDRIVE] Reconnect ownership verified: slot_id={slot_id} user_hash={user_hash}"
        )
        
        if not slot_id:
            logging.error(f"[RECONNECT ERROR][ONEDRIVE] No slot found")
            return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")
        
        # Build upsert payload for cloud_provider_accounts
        upsert_payload = {
            "user_id": user_id,
            "provider": "onedrive",
            "provider_account_id": microsoft_account_id,
            "account_email": account_email,
            "access_token": encrypt_token(access_token),
            "token_expiry": expiry_iso,
            "is_active": True,
            "disconnected_at": None,
            "slot_log_id": slot_id,
        }
        
        # CRITICAL: Only update refresh_token if a new one is provided
        # If refresh_token is None, omitting it from upsert preserves the existing value in database
        if refresh_token:
            upsert_payload["refresh_token"] = encrypt_token(refresh_token)
            logging.info(f"[RECONNECT][ONEDRIVE] Got new refresh_token for slot_id={slot_id}")
        else:
            # Do NOT set refresh_token field - this preserves existing refresh_token in database
            logging.info(f"[RECONNECT][ONEDRIVE] No new refresh_token, preserving existing for slot_id={slot_id}")
        
        # Upsert into cloud_provider_accounts
        upsert_result = supabase.table("cloud_provider_accounts").upsert(
            upsert_payload,
            on_conflict="user_id,provider,provider_account_id"
        ).execute()
        
        if upsert_result.data:
            account_id = upsert_result.data[0].get("id", "unknown")
            logging.info(
                f"[RECONNECT SUCCESS][ONEDRIVE] cloud_provider_accounts UPSERT account_id={account_id}"
            )
        
        # Ensure slot is active
        if slot_log_id:
            slot_update = supabase.table("cloud_slots_log").update({
                "is_active": True,
                "disconnected_at": None,
                "provider_email": account_email,
            }).eq("id", slot_log_id).eq("user_id", user_id).execute()
        else:
            slot_update = supabase.table("cloud_slots_log").update({
                "is_active": True,
                "disconnected_at": None,
                "provider_email": account_email,
            }).eq("user_id", user_id).eq("provider_account_id", microsoft_account_id).execute()
        
        slots_updated = len(slot_update.data) if slot_update.data else 0
        
        if slots_updated == 0:
            logging.error(f"[RECONNECT ERROR][ONEDRIVE] cloud_slots_log UPDATE affected 0 rows")
            return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed&reason=slot_not_updated")
        
        validated_slot_id = slot_log_id if slot_log_id else slot_update.data[0].get("id")
        
        logging.info(f"[RECONNECT SUCCESS][ONEDRIVE] cloud_slots_log updated. slot_id={validated_slot_id}")
        
        return RedirectResponse(f"{frontend_origin}/app?reconnect=success&slot_id={validated_slot_id}")
    
    # Check cloud account limit with slot-based validation (only for connect mode)
    try:
        user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
        account_hash = hashlib.sha256(microsoft_account_id.encode()).hexdigest()[:8]
        logging.info(f"[OAUTH_SLOT_VALIDATION][ONEDRIVE] user_hash={user_hash} account_hash={account_hash}")
        quota.check_cloud_limit_with_slots(supabase, user_id, "onedrive", microsoft_account_id)
        logging.info(f"[OAUTH_SLOT_VALIDATION_PASSED][ONEDRIVE] user_hash={user_hash}")
    except HTTPException as e:
        if e.status_code == 400:
            logging.error(f"[CALLBACK VALIDATION ERROR][ONEDRIVE] HTTP 400")
            return RedirectResponse(f"{frontend_origin}/app?error=oauth_invalid_account")
        elif e.status_code == 402:
            logging.info(f"[CALLBACK QUOTA][ONEDRIVE] Slot limit reached")
            return RedirectResponse(f"{frontend_origin}/app?error=cloud_limit_reached")
        else:
            logging.error(f"[CALLBACK ERROR][ONEDRIVE] Unexpected HTTPException {e.status_code}")
            return RedirectResponse(f"{frontend_origin}/app?error=connection_failed")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # SAFE RECLAIM: Check for existing account with different user_id
    # CRITICAL: Must happen BEFORE creating new slot to avoid duplication
    # ═══════════════════════════════════════════════════════════════════════════
    existing_account = supabase.table("cloud_provider_accounts").select(
        "id, user_id, account_email, is_active"
    ).eq("provider", "onedrive").eq("provider_account_id", microsoft_account_id).execute()
    
    if existing_account.data and len(existing_account.data) > 0:
        existing = existing_account.data[0]
        existing_user_id = existing["user_id"]
        existing_email = existing.get("account_email", "")
        
        # Check if account belongs to different user
        if existing_user_id != user_id:
            # Ownership mismatch detected
            # SAFE RECLAIM: Allow reassignment ONLY if ANY current email matches stored email
            
            # Build set of current emails (normalized: trim + lowercase)
            current_emails_set = set()
            if graph_mail:
                current_emails_set.add(graph_mail.lower().strip())
            if graph_upn:
                current_emails_set.add(graph_upn.lower().strip())
            if account_email:  # Fallback (should be upn or mail)
                current_emails_set.add(account_email.lower().strip())
            
            # Normalize existing email from DB
            existing_email_normalized = existing_email.lower().strip() if existing_email else ""
            
            # Validation: must have at least one email to compare
            if not current_emails_set or not existing_email_normalized:
                # Missing email data => BLOCK for safety
                logging.error(
                    f"[SECURITY][ONEDRIVE][CONNECT] Ownership violation: Missing email for validation. "
                    f"existing_user_id={existing_user_id} current_user_id={user_id} "
                    f"current_emails_count={len(current_emails_set)} existing_email_present={bool(existing_email_normalized)}"
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
            
            # Check if ANY current email matches the stored email
            emails_match = existing_email_normalized in current_emails_set
            
            # Log match attempt (domains only for security)
            current_domains = [e.split("@")[1] if "@" in e else "invalid" for e in current_emails_set]
            existing_domain = existing_email_normalized.split("@")[1] if "@" in existing_email_normalized else "invalid"
            logging.info(
                f"[SECURITY][ONEDRIVE][CONNECT] Email match check: "
                f"existing_domain={existing_domain} current_domains={current_domains} match={emails_match}"
            )
            
            if emails_match:
                # ✅ Email matches => SAFE RECLAIM
                email_domain = account_email.split("@")[1] if account_email and "@" in account_email else "unknown"
                logging.warning(
                    f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Account reassignment authorized: "
                    f"provider_account_id={microsoft_account_id} "
                    f"from_user_id={existing_user_id} to_user_id={user_id} "
                    f"email_domain={email_domain} (verified match)"
                )
                
                # Find existing slot to reuse (avoid creating duplicate)
                existing_slot = supabase.table("cloud_slots_log").select("id").eq(
                    "provider", "onedrive"
                ).eq("provider_account_id", microsoft_account_id).order(
                    "created_at", desc=True
                ).limit(1).execute()
                
                if not existing_slot.data:
                    logging.error(
                        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] No slot found for provider_account_id={microsoft_account_id}"
                    )
                    return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")
                
                reclaimed_slot_id = existing_slot.data[0]["id"]
                
                # Transfer ownership in cloud_provider_accounts and cloud_slots_log
                # NOTE: We'll update instead of upsert to ensure we transfer the existing row
                try:
                    # Transfer ownership in cloud_slots_log FIRST
                    supabase.table("cloud_slots_log").update({
                        "user_id": user_id,
                        "is_active": True,
                        "disconnected_at": None
                    }).eq("id", reclaimed_slot_id).execute()
                    
                    # Then update cloud_provider_accounts
                    supabase.table("cloud_provider_accounts").update({
                        "user_id": user_id,
                        "is_active": True,
                        "disconnected_at": None,
                        "access_token": encrypt_token(access_token),
                        "token_expiry": expiry_iso,
                        "slot_log_id": reclaimed_slot_id,
                        "account_email": account_email,
                        "refresh_token": encrypt_token(refresh_token) if refresh_token else None
                    }).eq("provider", "onedrive").eq("provider_account_id", microsoft_account_id).execute()
                    
                    logging.info(
                        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Ownership transferred successfully. "
                        f"new_user_id={user_id} slot_id={reclaimed_slot_id}"
                    )
                    
                    # CRITICAL: Return immediately to avoid creating new slot
                    return RedirectResponse(f"{frontend_origin}/app?connection=success")
                    
                except Exception as e:
                    logging.error(
                        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Ownership transfer failed: {type(e).__name__}"
                    )
                    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed")
            else:
                # ❌ Email doesn't match => BLOCK (account takeover attempt)
                logging.error(
                    f"[SECURITY][ONEDRIVE][CONNECT] Account takeover attempt blocked! "
                    f"provider_account_id={microsoft_account_id} belongs to different user. "
                    f"Email mismatch prevents reclaim."
                )
                return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # END SAFE RECLAIM - Proceed with normal flow (new account or same user reconnect)
    # ═══════════════════════════════════════════════════════════════════════════
    
    # Guard defensivo: verificar que no exista slot huérfano antes de crear nuevo
    orphan_slot_check = supabase.table("cloud_slots_log").select("id, user_id").eq(
        "provider", "onedrive"
    ).eq("provider_account_id", microsoft_account_id).execute()
    
    if orphan_slot_check.data and len(orphan_slot_check.data) > 0:
        orphan_user_id = orphan_slot_check.data[0]["user_id"]
        if orphan_user_id != user_id:
            # Slot exists for different user but cloud_provider_accounts didn't catch it
            logging.error(
                f"[SECURITY][ONEDRIVE][CONNECT] Orphan slot detected: "
                f"slot belongs to user_id={orphan_user_id} but current user_id={user_id}"
            )
            return RedirectResponse(f"{frontend_origin}/app?error=ownership_violation")
    
    # Get/create slot (only if no SAFE RECLAIM happened)
    try:
        slot_result = quota.connect_cloud_account_with_slot(
            supabase,
            user_id,
            "onedrive",
            microsoft_account_id,
            account_email
        )
        slot_id = slot_result["id"]
        logging.info(f"[SLOT LINKED][ONEDRIVE] slot_id={slot_id}, is_new={slot_result.get('is_new')}")
    except Exception as slot_err:
        logging.error(f"[CRITICAL][ONEDRIVE] Failed to get/create slot: {type(slot_err).__name__}")
        return RedirectResponse(f"{frontend_origin}/app?error=slot_creation_failed")
    
    # Prepare data for cloud_provider_accounts
    upsert_data = {
        "user_id": user_id,
        "provider": "onedrive",
        "provider_account_id": microsoft_account_id,
        "account_email": account_email,
        "access_token": encrypt_token(access_token),
        "token_expiry": expiry_iso,
        "is_active": True,
        "disconnected_at": None,
        "slot_log_id": slot_id,
    }
    
    # CRITICAL: Only encrypt and save refresh_token if it exists
    # If refresh_token is None, omitting it from upsert preserves the existing value in database
    if refresh_token:
        upsert_data["refresh_token"] = encrypt_token(refresh_token)
        logging.info(f"[ONEDRIVE][CONNECT] Got refresh_token for slot_id={slot_id}")
    else:
        # Do NOT set refresh_token field - this preserves existing refresh_token in database
        logging.warning(f"[ONEDRIVE][CONNECT] No refresh_token in response, preserving existing for slot_id={slot_id}")

    # Save to database
    resp = supabase.table("cloud_provider_accounts").upsert(
        upsert_data,
        on_conflict="user_id,provider,provider_account_id",
    ).execute()

    # Redirect to frontend dashboard
    return RedirectResponse(f"{frontend_origin}/app?connection=success")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
