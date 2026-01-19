-- Migration: Add cloud_transfer_events table for ownership transfer notifications
-- Purpose: Notify users when their cloud accounts are transferred to other users
-- Security: RLS enabled, users can only see their own transfer-out events

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CREATE TABLE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cloud_transfer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Provider info
    provider TEXT NOT NULL CHECK (provider IN ('google', 'onedrive', 'dropbox')),
    provider_account_id TEXT NOT NULL,
    account_email TEXT, -- Optional: email of the cloud account (not the user's app email)
    
    -- Transfer parties
    from_user_id UUID NOT NULL, -- User who lost the account
    to_user_id UUID NOT NULL, -- User who gained the account (NOT exposed to from_user_id)
    
    -- Event metadata
    event_type TEXT NOT NULL DEFAULT 'ownership_transferred' CHECK (event_type = 'ownership_transferred'),
    display_message TEXT, -- Optional custom message for UI
    acknowledged_at TIMESTAMPTZ, -- When user dismissed the notification
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Prevent duplicates: same account can only be transferred once from same user
    CONSTRAINT cloud_transfer_events_unique_key UNIQUE (provider, provider_account_id, from_user_id, event_type)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Index for user querying their transfer events
CREATE INDEX IF NOT EXISTS idx_transfer_events_from_user
ON public.cloud_transfer_events(from_user_id, created_at DESC);

-- Index for filtering unacknowledged events
CREATE INDEX IF NOT EXISTS idx_transfer_events_unacknowledged
ON public.cloud_transfer_events(from_user_id, acknowledged_at)
WHERE acknowledged_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cloud_transfer_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see events where they are the FROM user (lost the account)
-- CRITICAL: to_user_id is NOT exposed (privacy)
CREATE POLICY "Users can view their own transfer-out events"
ON public.cloud_transfer_events
FOR SELECT
TO authenticated
USING (auth.uid() = from_user_id);

-- Policy: Users can acknowledge (update) their own events
CREATE POLICY "Users can acknowledge their own transfer events"
ON public.cloud_transfer_events
FOR UPDATE
TO authenticated
USING (auth.uid() = from_user_id)
WITH CHECK (auth.uid() = from_user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Revoke all public access
REVOKE ALL ON public.cloud_transfer_events FROM PUBLIC;
REVOKE ALL ON public.cloud_transfer_events FROM anon;

-- Grant SELECT/UPDATE to authenticated users (controlled by RLS)
GRANT SELECT, UPDATE ON public.cloud_transfer_events TO authenticated;

-- Grant full access to service_role for backend inserts
GRANT ALL ON public.cloud_transfer_events TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.cloud_transfer_events IS 'Records when cloud accounts are transferred between users (for notifications)';
COMMENT ON COLUMN public.cloud_transfer_events.from_user_id IS 'User who lost ownership of the account (can read this event)';
COMMENT ON COLUMN public.cloud_transfer_events.to_user_id IS 'User who gained ownership (NOT exposed to from_user_id for privacy)';
COMMENT ON COLUMN public.cloud_transfer_events.acknowledged_at IS 'When user dismissed the notification in UI';
COMMENT ON COLUMN public.cloud_transfer_events.account_email IS 'Email of the cloud account (not the users app email)';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. OPTIONAL: CLEANUP QUERY (run manually or via cron)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Delete acknowledged events older than 30 days
-- DELETE FROM public.cloud_transfer_events 
-- WHERE acknowledged_at IS NOT NULL 
--   AND acknowledged_at < (now() - interval '30 days');
