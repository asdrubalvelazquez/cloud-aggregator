-- Migration: Add granted_scope column to cloud_accounts
-- Purpose: Track OAuth scope granted by Google to detect scope drift and validate access
-- Date: 2026-01-07
-- Safe: Nullable column, idempotent, non-destructive

-- Add granted_scope column (nullable for backward compatibility with existing tokens)
ALTER TABLE cloud_accounts
ADD COLUMN IF NOT EXISTS granted_scope TEXT;

-- Partial index for efficient scope lookups (only non-null values)
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_granted_scope 
    ON cloud_accounts(granted_scope) 
    WHERE granted_scope IS NOT NULL;

-- Documentation
COMMENT ON COLUMN cloud_accounts.granted_scope IS 'OAuth scope concedido por Google (ej: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid"). NULL = scope desconocido (tokens pre-migración). Usado para validar acceso y detectar scope drift.';

-- Verification query (run after migration to confirm)
-- SELECT 
--     COUNT(*) as total_accounts,
--     COUNT(granted_scope) as accounts_with_scope,
--     COUNT(*) - COUNT(granted_scope) as accounts_without_scope
-- FROM cloud_accounts;
