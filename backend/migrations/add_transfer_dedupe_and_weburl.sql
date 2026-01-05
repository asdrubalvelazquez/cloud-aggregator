-- Migration: Add dedupe support and web URLs to transfer_job_items
-- Purpose: Support duplicate detection and "View in OneDrive" button
-- Date: 2026-01-04
-- ==========================================

-- Add columns for dedupe and web URL tracking
DO $$
BEGIN
    -- Add bytes_transferred (for progress tracking)
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='transfer_job_items' AND column_name='bytes_transferred'
    ) THEN
        ALTER TABLE transfer_job_items 
        ADD COLUMN bytes_transferred BIGINT DEFAULT 0;
        RAISE NOTICE '✓ Added column: transfer_job_items.bytes_transferred';
    ELSE
        RAISE NOTICE '⊘ Column already exists: transfer_job_items.bytes_transferred';
    END IF;

    -- Add target_web_url (for "View in OneDrive" button)
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='transfer_job_items' AND column_name='target_web_url'
    ) THEN
        ALTER TABLE transfer_job_items 
        ADD COLUMN target_web_url TEXT;
        RAISE NOTICE '✓ Added column: transfer_job_items.target_web_url';
    ELSE
        RAISE NOTICE '⊘ Column already exists: transfer_job_items.target_web_url';
    END IF;

    -- Update status constraint to include 'skipped' (for dedupe)
    -- Drop old constraint and recreate with new values
    IF EXISTS (
        SELECT FROM information_schema.constraint_column_usage
        WHERE table_name='transfer_job_items' AND constraint_name='transfer_job_items_status_check'
    ) THEN
        ALTER TABLE transfer_job_items DROP CONSTRAINT transfer_job_items_status_check;
        ALTER TABLE transfer_job_items 
        ADD CONSTRAINT transfer_job_items_status_check 
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped'));
        RAISE NOTICE '✓ Updated constraint: transfer_job_items.status includes skipped';
    ELSE
        -- Constraint might have different name, try generic approach
        BEGIN
            ALTER TABLE transfer_job_items 
            ADD CONSTRAINT transfer_job_items_status_check 
            CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped'));
            RAISE NOTICE '✓ Created constraint: transfer_job_items.status includes skipped';
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE '⊘ Status constraint already updated';
        END;
    END IF;

    -- Add index on target_web_url for quick lookups
    IF NOT EXISTS (
        SELECT FROM pg_indexes 
        WHERE tablename='transfer_job_items' AND indexname='idx_transfer_job_items_web_url'
    ) THEN
        CREATE INDEX idx_transfer_job_items_web_url ON transfer_job_items(target_web_url) 
        WHERE target_web_url IS NOT NULL;
        RAISE NOTICE '✓ Created index: idx_transfer_job_items_web_url';
    ELSE
        RAISE NOTICE '⊘ Index already exists: idx_transfer_job_items_web_url';
    END IF;

END $$;

-- Add comments
COMMENT ON COLUMN transfer_job_items.bytes_transferred IS 'Bytes transferred (updated during/after upload)';
COMMENT ON COLUMN transfer_job_items.target_web_url IS 'OneDrive web URL for "View in OneDrive" button';

-- Verify migration
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name='transfer_job_items' 
        AND column_name IN ('bytes_transferred', 'target_web_url')
        GROUP BY table_name
        HAVING COUNT(*) = 2
    ) THEN
        RAISE NOTICE '✓✓✓ Migration successful: transfer dedupe and web URL support added';
    ELSE
        RAISE EXCEPTION 'Migration failed: columns not created';
    END IF;
END $$;
