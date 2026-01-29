-- Verificar si la tabla existe
SELECT table_schema, table_name 
FROM information_schema.tables 
WHERE table_name = 'cloud_accounts';

-- Verificar columnas existentes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'cloud_accounts'
ORDER BY ordinal_position;

-- Verificación y creación segura
DO $$ 
BEGIN
  -- Intentar agregar token_expires_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cloud_accounts' 
    AND column_name = 'token_expires_at'
  ) THEN
    ALTER TABLE cloud_accounts 
    ADD COLUMN token_expires_at TIMESTAMPTZ;
    
    RAISE NOTICE 'Columna token_expires_at agregada';
  ELSE
    RAISE NOTICE 'Columna token_expires_at ya existe';
  END IF;

  -- Intentar agregar last_token_refresh
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cloud_accounts' 
    AND column_name = 'last_token_refresh'
  ) THEN
    ALTER TABLE cloud_accounts 
    ADD COLUMN last_token_refresh TIMESTAMPTZ;
    
    RAISE NOTICE 'Columna last_token_refresh agregada';
  ELSE
    RAISE NOTICE 'Columna last_token_refresh ya existe';
  END IF;

  -- Crear índice si no existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_cloud_accounts_expires_at'
  ) THEN
    CREATE INDEX idx_cloud_accounts_expires_at 
    ON cloud_accounts(token_expires_at) 
    WHERE is_active = true;
    
    RAISE NOTICE 'Índice creado';
  ELSE
    RAISE NOTICE 'Índice ya existe';
  END IF;

END $$;