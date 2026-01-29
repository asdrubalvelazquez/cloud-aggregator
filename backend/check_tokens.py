from backend.db import supabase
from datetime import datetime, timezone

# Fetch OneDrive accounts
accounts = supabase.table('cloud_provider_accounts').select('account_email, token_expiry, provider, is_active').eq('provider', 'onedrive').execute()

print('=== OneDrive Accounts Token Status ===\n')
for acc in accounts.data:
    email = acc.get('account_email', 'N/A')
    token_expiry = acc.get('token_expiry')
    is_active = acc.get('is_active', False)
    
    if token_expiry:
        try:
            expiry_dt = datetime.fromisoformat(token_expiry.replace("Z", "+00:00"))
            is_expired = expiry_dt < datetime.now(timezone.utc)
            time_diff = datetime.now(timezone.utc) - expiry_dt
            
            print(f"Email: {email}")
            print(f"  Token expiry: {token_expiry}")
            print(f"  Is expired: {is_expired}")
            print(f"  Time since expiry: {time_diff}" if is_expired else f"  Time until expiry: {-time_diff}")
            print(f"  Account is_active: {is_active}")
            print()
        except Exception as e:
            print(f"Email: {email}")
            print(f"  ERROR parsing expiry: {e}")
            print()
    else:
        print(f"Email: {email}")
        print(f"  Token expiry: None")
        print(f"  Account is_active: {is_active}")
        print()
