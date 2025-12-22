-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: Normalize provider_account_id in cloud_slots_log
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE: Fix reconnection failures caused by whitespace inconsistencies
--          in historical provider_account_id values
--
-- ISSUE: When comparing provider IDs (e.g., "12345 " vs "12345"), the
--        salvoconducto lookup fails, causing legitimate reconnections to be
--        blocked with cloud_limit_reached errors
--
-- SOLUTION: Normalize all existing IDs using TRIM to match current backend logic
--
-- SAFETY: Idempotent - only updates rows where trimming would change the value
-- ═══════════════════════════════════════════════════════════════════════════

-- Normalize provider_account_id by removing leading/trailing whitespace
UPDATE cloud_slots_log
SET provider_account_id = TRIM(provider_account_id)
WHERE provider_account_id IS NOT NULL
  AND provider_account_id != TRIM(provider_account_id);

-- Verification query (run after migration to confirm)
-- SELECT 
--   COUNT(*) as total_slots,
--   COUNT(CASE WHEN provider_account_id != TRIM(provider_account_id) THEN 1 END) as needs_normalization
-- FROM cloud_slots_log
-- WHERE provider_account_id IS NOT NULL;
