-- Migration: Add nickname column to cloud_slots_log table
-- Date: 2026-01-30
-- Description: Add support for custom nicknames for cloud accounts

-- Add nickname column to cloud_slots_log
ALTER TABLE cloud_slots_log 
ADD COLUMN nickname VARCHAR(50);

-- Add index for better performance on nickname queries
CREATE INDEX idx_cloud_slots_log_nickname ON cloud_slots_log(nickname);

-- Optional: Add comment for documentation
COMMENT ON COLUMN cloud_slots_log.nickname IS 'Custom user-defined nickname for the cloud account';