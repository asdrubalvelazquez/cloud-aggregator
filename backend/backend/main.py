import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import supabase
from backend.google_drive import (
    get_storage_quota,
    list_drive_files,
    copy_file_between_accounts,
)

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
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
]


@app.get("/")
def read_root():
    return {"message": "Cloud Aggregator API", "status": "running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/auth/google/login")
def google_login():
    """Initiate Google OAuth flow"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        return {"error": "Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI"}

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }

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

    if error:
        return RedirectResponse(f"{FRONTEND_URL}?error={error}")

    if not code:
        return RedirectResponse(f"{FRONTEND_URL}?error=no_code")

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

    # Save to database
    resp = supabase.table("cloud_accounts").upsert(
        {
            "account_email": account_email,
            "google_account_id": google_account_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_expiry": expiry_iso,
        },
        on_conflict="google_account_id",
    ).execute()

    # Redirect to frontend dashboard
    return RedirectResponse(f"{FRONTEND_URL}?auth=success")


@app.get("/accounts")
async def list_accounts():
    """Get all connected cloud accounts"""
    resp = supabase.table("cloud_accounts").select("id, account_email, created_at").execute()
    return {"accounts": resp.data}


@app.get("/drive/{account_id}/copy-options")
async def get_copy_options(account_id: int):
    """Get list of target accounts for copying files"""
    try:
        # Verify source account exists
        source = supabase.table("cloud_accounts").select("id, account_email").eq("id", account_id).single().execute()
        if not source.data:
            raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
        
        # Get all other accounts
        all_accounts = supabase.table("cloud_accounts").select("id, account_email").execute()
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
@app.get("/storage/summary")
async def storage_summary():
    """Get aggregated storage summary across all accounts"""
    # Get all accounts
    accounts_resp = supabase.table("cloud_accounts").select("id, account_email").execute()
    accounts = accounts_resp.data

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
            print(f"Error getting quota for account {account['id']}: {e}")
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
async def get_drive_files(account_id: int, page_token: Optional[str] = None):
    """List files for a specific Drive account with pagination and token refresh"""
    try:
        # Verify account exists
        account = supabase.table("cloud_accounts").select("id").eq("id", account_id).single().execute()
        if not account.data:
            raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
        
        # Ensure token is valid (auto-refresh if needed)
        from backend.google_drive import get_valid_token
        await get_valid_token(account_id)
        
        result = await list_drive_files(account_id, page_size=20, page_token=page_token)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list files: {str(e)}")


class CopyFileRequest(BaseModel):
    source_account_id: int
    target_account_id: int
    file_id: str


@app.post("/drive/copy-file")
async def copy_file(request: CopyFileRequest):
    """Copy a file from one Drive account to another with token refresh"""
    try:
        # Validate accounts exist and refresh tokens
        source_acc = supabase.table("cloud_accounts").select("id").eq("id", request.source_account_id).single().execute()
        target_acc = supabase.table("cloud_accounts").select("id").eq("id", request.target_account_id).single().execute()
        
        if not source_acc.data or not target_acc.data:
            raise HTTPException(status_code=404, detail="One or both accounts not found")
        
        # Get tokens with auto-refresh
        from backend.google_drive import get_valid_token
        await get_valid_token(request.source_account_id)
        await get_valid_token(request.target_account_id)
        
        result = await copy_file_between_accounts(
            source_account_id=request.source_account_id,
            target_account_id=request.target_account_id,
            file_id=request.file_id
        )
        
        return {
            "success": True,
            "message": "File copied successfully",
            "file": result
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Copy failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
