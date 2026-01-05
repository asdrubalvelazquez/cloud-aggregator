-- Migration: Add 3-phase transfer statuses
-- Purpose: Support async transfer flow (create → prepare → run)
-- Date: 2026-01-04
-- 
-- BLOCKER 1: Safe migration (preserves existing states)
-- BLOCKER 2: Comprehensive status list
--
-- New statuses:
-- - pending: Job created, waiting for prepare
-- - blocked_quota: Quota exceeded during prepare
-- - done_skipped: All items skipped (already exist)
--
-- Related: PHASE1 refactor to avoid 30-file timeout

DO $$
BEGIN
    -- Drop old constraint if exists
    IF EXISTS (
        SELECT FROM information_schema.constraint_column_usage
        WHERE table_name='transfer_jobs' AND constraint_name='transfer_jobs_status_check'
    ) THEN
        ALTER TABLE transfer_jobs DROP CONSTRAINT transfer_jobs_status_check;
        RAISE NOTICE '✓ Dropped old constraint: transfer_jobs_status_check';
    END IF;

    -- Add new constraint with ALL existing + new statuses
    -- CRITICAL: Must include all states currently in prod to avoid breaking existing jobs
    ALTER TABLE transfer_jobs
    ADD CONSTRAINT transfer_jobs_status_check
    CHECK (status IN (
        -- Phase 1: Creation
        'pending',         -- NEW: Created, awaiting prepare
        'preparing',       -- NEW: Metadata fetch in progress (reserved)
        
        -- Phase 2: Ready
        'queued',          -- EXISTING: Ready to run (old initial status)
        'blocked_quota',   -- NEW: Quota exceeded during prepare
        
        -- Phase 3: Execution
        'running',         -- EXISTING: Transfer in progress
        
        -- Phase 3: Terminal states
        'done',            -- EXISTING: Success (all completed)
        'done_skipped',    -- NEW: All items already existed (not error)
        'failed',          -- EXISTING: All failed
        'partial',         -- EXISTING: Mixed results (some success, some failed)
        'cancelled'        -- EXISTING: Manual cancellation
    ));
    RAISE NOTICE '✓ Created new constraint with all statuses';

    -- Add metadata JSON column if not exists (stores file_ids during prepare)
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='transfer_jobs' AND column_name='metadata'
    ) THEN
        ALTER TABLE transfer_jobs 
        ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        RAISE NOTICE '✓ Added column: transfer_jobs.metadata';
    ELSE
        RAISE NOTICE '⊘ Column already exists: transfer_jobs.metadata';
    END IF;

    -- Add index on status for faster queries
    IF NOT EXISTS (
        SELECT FROM pg_indexes 
        WHERE tablename='transfer_jobs' AND indexname='idx_transfer_jobs_status'
    ) THEN
        CREATE INDEX idx_transfer_jobs_status ON transfer_jobs(status);
        RAISE NOTICE '✓ Created index: idx_transfer_jobs_status';
    ELSE
        RAISE NOTICE '⊘ Index already exists: idx_transfer_jobs_status';
    END IF;

    -- Add index on user_id + status for job listing
    IF NOT EXISTS (
        SELECT FROM pg_indexes 
        WHERE tablename='transfer_jobs' AND indexname='idx_transfer_jobs_user_status'
    ) THEN
        CREATE INDEX idx_transfer_jobs_user_status ON transfer_jobs(user_id, status);
        RAISE NOTICE '✓ Created index: idx_transfer_jobs_user_status';
    ELSE
        RAISE NOTICE '⊘ Index already exists: idx_transfer_jobs_user_status';
    END IF;

END $$;

-- Add comments
COMMENT ON COLUMN transfer_jobs.metadata IS 'Job metadata (file_ids, config, etc.) - max 100 items per job';
COMMENT ON CONSTRAINT transfer_jobs_status_check ON transfer_jobs IS '3-phase flow: pending→queued/blocked_quota→running→done/done_skipped/failed/partial';

-- Verify migration
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='transfer_jobs' AND column_name='metadata'
    ) THEN
        RAISE NOTICE '✓✓✓ Migration successful: 3-phase transfer statuses added';
    ELSE
        RAISE EXCEPTION 'Migration failed: metadata column not created';
    END IF;
END $$;
