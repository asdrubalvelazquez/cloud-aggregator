-- Migration: Allow NULL tokens in cloud_provider_accounts
-- Fixes: null value in column "access_token" violates not-null constraint (23502)
-- When disconnecting OneDrive/Dropbox accounts, tokens are cleared to NULL
-- Created: 2026-01-03

ALTER TABLE public.cloud_provider_accounts 
ALTER COLUMN access_token DROP NOT NULL;

ALTER TABLE public.cloud_provider_accounts 
ALTER COLUMN refresh_token DROP NOT NULL;

COMMENT ON COLUMN public.cloud_provider_accounts.access_token IS 'OAuth access token (nullable when account is disconnected)';
COMMENT ON COLUMN public.cloud_provider_accounts.refresh_token IS 'OAuth refresh token (nullable when account is disconnected)';
