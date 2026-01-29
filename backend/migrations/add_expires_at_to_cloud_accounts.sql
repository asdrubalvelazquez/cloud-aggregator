-- Agregar columna expires_at para tracking de expiración
ALTER TABLE cloud_accounts 
ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Agregar índice para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_expires_at 
ON cloud_accounts(token_expires_at) 
WHERE is_active = true;

-- Comentario de documentación
COMMENT ON COLUMN cloud_accounts.token_expires_at IS 
'Timestamp de expiración del access_token actual (UTC)';

-- Agregar columna last_token_refresh para trackear el último intento de refresh
ALTER TABLE cloud_accounts 
ADD COLUMN IF NOT EXISTS last_token_refresh TIMESTAMPTZ;

-- Comentario de documentación
COMMENT ON COLUMN cloud_accounts.last_token_refresh IS 
'Timestamp del último intento de refresh (para evitar refreshes repetidos)';