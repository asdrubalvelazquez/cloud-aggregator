-- Migration: Add ownership_transfer_requests table for secure temporary token storage
-- Purpose: Store OAuth tokens during ownership transfer flow (10 min TTL)
-- Security: Service role only, tokens encrypted before storage

-- Create table
CREATE TABLE IF NOT EXISTS ownership_transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    requesting_user_id UUID NOT NULL,
    existing_owner_id UUID NOT NULL,
    account_email TEXT,
    access_token TEXT NOT NULL, -- Already encrypted with encrypt_token()
    refresh_token TEXT, -- Already encrypted, nullable
    token_expiry TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Unique constraint: Only one row per (provider, account, requesting_user) - updates same row
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_ownership_transfer_expires_at
ON ownership_transfer_requests(expires_at);

CREATE INDEX IF NOT EXISTS idx_ownership_transfer_requesting_user
ON ownership_transfer_requests(requesting_user_id);

CREATE INDEX IF NOT EXISTS idx_ownership_transfer_status
ON ownership_transfer_requests(status);

-- Security: Revoke all public access (backend uses service_role)
REVOKE ALL ON ownership_transfer_requests FROM PUBLIC;
REVOKE ALL ON ownership_transfer_requests FROM anon;
REVOKE ALL ON ownership_transfer_requests FROM authenticated;

-- Grant full access to service_role only
GRANT ALL ON ownership_transfer_requests TO service_role;

-- Optional: Cleanup expired requests periodically (run manually or via cron)
-- DELETE FROM ownership_transfer_requests WHERE expires_at < now() AND status = 'pending';

COMMENT ON TABLE ownership_transfer_requests IS 'Temporary storage for OAuth tokens during ownership transfer (10 min TTL)';
COMMENT ON COLUMN ownership_transfer_requests.access_token IS 'Encrypted access token from OAuth callback';
COMMENT ON COLUMN ownership_transfer_requests.refresh_token IS 'Encrypted refresh token from OAuth callback';
COMMENT ON COLUMN ownership_transfer_requests.status IS 'pending: awaiting transfer, used: transfer completed, expired: TTL exceeded';
