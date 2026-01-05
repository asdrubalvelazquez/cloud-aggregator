# STORAGE SUMMARY ENDPOINT - ADD TO main.py after line 2763 (after disconnect_slot endpoint)

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
            "id, provider_account_id, provider_email, access_token, refresh_token"
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
                    "email": account["provider_email"],
                    "total_bytes": account_total,
                    "used_bytes": account_used,
                    "free_bytes": account_free,
                    "percent_used": account_percent,
                    "status": "ok"
                })
            except Exception as e:
                logging.warning(f"[STORAGE_SUMMARY] Failed to fetch OneDrive quota for {account.get('provider_email')}: {e}")
                accounts_data.append({
                    "provider": "onedrive",
                    "email": account.get("provider_email", "unknown"),
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
