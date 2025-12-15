-- Migration: Add extra_clouds column to user_plans
-- Allows users to purchase additional cloud account slots beyond plan limits
-- Created: 2025-12-14

ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS extra_clouds INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_plans.extra_clouds IS 'Additional cloud account slots purchased by user (additive to plan base limit)';
