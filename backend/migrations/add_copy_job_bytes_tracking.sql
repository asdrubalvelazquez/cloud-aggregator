-- Migration: Add bytes tracking to copy_jobs
-- Created: 2025-12-22
-- Purpose: Track actual bytes transferred per copy job

BEGIN;

ALTER TABLE copy_jobs
ADD COLUMN IF NOT EXISTS bytes_copied BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Constraints (idempotent: only add if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_bytes_copied_positive'
    ) THEN
        ALTER TABLE copy_jobs
        ADD CONSTRAINT check_bytes_copied_positive 
        CHECK (bytes_copied >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_completed_after_created'
    ) THEN
        ALTER TABLE copy_jobs
        ADD CONSTRAINT check_completed_after_created 
        CHECK (completed_at IS NULL OR completed_at >= created_at);
    END IF;
END $$;

-- Index for analytics
CREATE INDEX IF NOT EXISTS idx_copy_jobs_bytes 
    ON copy_jobs(user_id, bytes_copied) 
    WHERE status = 'success';

-- Comments
COMMENT ON COLUMN copy_jobs.bytes_copied IS 'Actual bytes transferred in this copy job. Used for transfer quota.';
COMMENT ON COLUMN copy_jobs.completed_at IS 'Timestamp when copy completed successfully. Only set for status=success.';
COMMENT ON COLUMN copy_jobs.finished_at IS 'Timestamp when job ends (success OR failed). Always set when done.';

-- Verification
DO $$
DECLARE
    v_column_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='copy_jobs' AND column_name='bytes_copied'
    ) INTO v_column_exists;
    
    IF NOT v_column_exists THEN
        RAISE EXCEPTION 'Migration failed: bytes_copied column not created';
    END IF;
    
    RAISE NOTICE '✓ Migration successful: bytes_copied column added';
END $$;

COMMIT;
