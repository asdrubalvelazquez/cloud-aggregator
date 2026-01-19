-- ============================================================================
-- VALIDATION SCRIPT: Verificar ownership_transfer_requests después de migración
-- ============================================================================

-- 1. Verificar que la tabla existe
SELECT 
    table_name, 
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'ownership_transfer_requests';
-- Esperado: 1 fila con table_type = 'BASE TABLE'

-- 2. Verificar que el UNIQUE CONSTRAINT existe (CRÍTICO)
SELECT 
    constraint_name, 
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_schema = 'public'
  AND table_name = 'ownership_transfer_requests' 
  AND constraint_type = 'UNIQUE';
-- Esperado: 1 fila con constraint_name = 'ownership_transfer_unique_key'

-- 3. Verificar columnas del constraint
SELECT 
    kcu.constraint_name,
    kcu.column_name,
    kcu.ordinal_position
FROM information_schema.key_column_usage kcu
JOIN information_schema.table_constraints tc 
    ON kcu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'ownership_transfer_requests'
  AND tc.constraint_type = 'UNIQUE'
ORDER BY kcu.ordinal_position;
-- Esperado: 3 filas:
--   - provider (ordinal_position = 1)
--   - provider_account_id (ordinal_position = 2)
--   - requesting_user_id (ordinal_position = 3)

-- 4. Verificar índices de performance
SELECT 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'ownership_transfer_requests'
ORDER BY indexname;
-- Esperado: 4+ índices:
--   - ownership_transfer_requests_pkey (PRIMARY KEY)
--   - idx_ownership_transfer_expires_at
--   - idx_ownership_transfer_requesting_user
--   - idx_ownership_transfer_status

-- 5. Verificar permisos (service_role debe tener ALL, PUBLIC/anon/authenticated deben tener NONE)
SELECT 
    grantee, 
    privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public'
  AND table_name = 'ownership_transfer_requests'
ORDER BY grantee, privilege_type;
-- Esperado: Solo service_role con SELECT, INSERT, UPDATE, DELETE, etc.
-- NO debe aparecer: PUBLIC, anon, authenticated

-- 6. Test de UPSERT (simula lo que hace el código Python)
DO $$
DECLARE
    test_access_token TEXT := 'encrypted_test_token_' || gen_random_uuid()::TEXT;
    test_refresh_token TEXT := 'encrypted_refresh_' || gen_random_uuid()::TEXT;
    test_provider_account_id TEXT := 'test_account_' || gen_random_uuid()::TEXT;
    test_user_id UUID := gen_random_uuid();
    test_owner_id UUID := gen_random_uuid();
BEGIN
    -- Insert inicial
    INSERT INTO ownership_transfer_requests (
        provider,
        provider_account_id,
        requesting_user_id,
        existing_owner_id,
        account_email,
        access_token,
        refresh_token,
        token_expiry,
        status
    ) VALUES (
        'onedrive',
        test_provider_account_id,
        test_user_id,
        test_owner_id,
        'test@example.com',
        test_access_token,
        test_refresh_token,
        now() + interval '1 hour',
        'pending'
    )
    ON CONFLICT (provider, provider_account_id, requesting_user_id)
    DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expiry = EXCLUDED.token_expiry,
        expires_at = now() + interval '10 minutes';
    
    RAISE NOTICE 'UPSERT test passed! constraint works correctly.';
    
    -- Cleanup
    DELETE FROM ownership_transfer_requests 
    WHERE provider_account_id = test_provider_account_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'UPSERT test FAILED: %', SQLERRM;
END $$;
-- Esperado: NOTICE "UPSERT test passed! constraint works correctly."

-- 7. Verificar TTL default (debe ser 10 minutos)
SELECT 
    expires_at - created_at AS ttl_interval,
    EXTRACT(EPOCH FROM (expires_at - created_at)) / 60 AS ttl_minutes
FROM ownership_transfer_requests
WHERE created_at > now() - interval '1 hour'
LIMIT 1;
-- Esperado: ttl_minutes ≈ 10 (si hay datos recientes)

-- 8. Contar requests por estado
SELECT 
    status, 
    COUNT(*) AS total
FROM ownership_transfer_requests
GROUP BY status;
-- Info: Ver distribución de pending/used/expired

-- 9. Detectar requests expirados que necesitan cleanup
SELECT 
    id,
    provider,
    provider_account_id,
    status,
    created_at,
    expires_at,
    now() - expires_at AS expired_since
FROM ownership_transfer_requests
WHERE status = 'pending' 
  AND expires_at < now()
ORDER BY expires_at DESC
LIMIT 10;
-- Info: Requests que deberían ser limpiados (si hay muchos, considerar cron job)

-- ============================================================================
-- CLEANUP MANUAL (opcional, ejecutar solo si hay muchos requests expirados)
-- ============================================================================
-- DELETE FROM ownership_transfer_requests 
-- WHERE status = 'pending' 
--   AND expires_at < now();

-- ============================================================================
-- RESUMEN
-- ============================================================================
SELECT 
    'ownership_transfer_requests' AS table_name,
    (SELECT COUNT(*) FROM ownership_transfer_requests) AS total_records,
    (SELECT COUNT(*) FROM ownership_transfer_requests WHERE status = 'pending') AS pending_count,
    (SELECT COUNT(*) FROM ownership_transfer_requests WHERE status = 'pending' AND expires_at < now()) AS expired_count,
    (SELECT EXISTS(
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'ownership_transfer_requests' 
          AND constraint_name = 'ownership_transfer_unique_key'
    )) AS constraint_exists;
-- Resumen de salud de la tabla
