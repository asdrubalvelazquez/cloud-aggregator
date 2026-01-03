-- Migration: Add cross-provider transfer system (Google Drive → OneDrive)
-- Created: 2026-01-03
-- Purpose: Support file transfers between different cloud providers with job tracking

BEGIN;

-- ==========================================
-- TABLE: transfer_jobs
-- ==========================================
CREATE TABLE IF NOT EXISTS transfer_jobs (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Source provider
    source_provider TEXT NOT NULL CHECK (source_provider IN ('google_drive', 'onedrive', 'dropbox')),
    source_account_id TEXT NOT NULL,  -- Can be INT (Google) or UUID (OneDrive)
    
    -- Target provider
    target_provider TEXT NOT NULL CHECK (target_provider IN ('google_drive', 'onedrive', 'dropbox')),
    target_account_id TEXT NOT NULL,  -- Can be INT (Google) or UUID (OneDrive)
    target_folder_id TEXT DEFAULT 'root',
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'partial')),
    
    -- Progress counters
    total_items INT NOT NULL DEFAULT 0,
    completed_items INT NOT NULL DEFAULT 0,
    failed_items INT NOT NULL DEFAULT 0,
    
    -- Bandwidth tracking
    total_bytes BIGINT NOT NULL DEFAULT 0,
    transferred_bytes BIGINT NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT check_total_items_positive CHECK (total_items >= 0),
    CONSTRAINT check_completed_items_positive CHECK (completed_items >= 0),
    CONSTRAINT check_failed_items_positive CHECK (failed_items >= 0),
    CONSTRAINT check_total_bytes_positive CHECK (total_bytes >= 0),
    CONSTRAINT check_transferred_bytes_positive CHECK (transferred_bytes >= 0),
    CONSTRAINT check_completed_le_total CHECK (completed_items + failed_items <= total_items),
    CONSTRAINT check_started_after_created CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT check_completed_after_started CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

-- ==========================================
-- TABLE: transfer_job_items
-- ==========================================
CREATE TABLE IF NOT EXISTS transfer_job_items (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
    
    -- Source item
    source_item_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    
    -- Transfer status
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    error_message TEXT,
    
    -- Target item
    target_item_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT check_size_positive CHECK (size_bytes >= 0),
    CONSTRAINT check_started_after_created_item CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT check_completed_after_started_item CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_user_id ON transfer_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_status ON transfer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_created_at ON transfer_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_job_items_job_id ON transfer_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_transfer_job_items_status ON transfer_job_items(status);

-- ==========================================
-- COMMENTS
-- ==========================================
COMMENT ON TABLE transfer_jobs IS 'Cross-provider file transfer jobs (e.g., Google Drive → OneDrive)';
COMMENT ON TABLE transfer_job_items IS 'Individual file items in transfer jobs';
COMMENT ON COLUMN transfer_jobs.status IS 'queued: not started, running: in progress, done: all success, failed: all failed, partial: some failed';
COMMENT ON COLUMN transfer_job_items.status IS 'queued: waiting, running: transferring, done: success, failed: error';

-- ==========================================
-- VERIFICATION
-- ==========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name='transfer_jobs') THEN
        RAISE EXCEPTION 'Migration failed: transfer_jobs table not created';
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name='transfer_job_items') THEN
        RAISE EXCEPTION 'Migration failed: transfer_job_items table not created';
    END IF;
    
    RAISE NOTICE '✓ Migration successful: transfer_jobs and transfer_job_items tables created';
END $$;

COMMIT;
