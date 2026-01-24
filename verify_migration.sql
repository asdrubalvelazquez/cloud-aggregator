-- 
-- QUERY DE VERIFICACIÓN: Estado de cloud_transfer_events
-- 

-- 1. Verificar si la tabla existe
SELECT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'cloud_transfer_events'
) AS table_exists;

-- 2. Verificar columnas de la tabla
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'cloud_transfer_events'
ORDER BY ordinal_position;

-- 3. Verificar constraints
SELECT conname AS constraint_name, contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'public.cloud_transfer_events'::regclass;

-- 4. Verificar indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' 
AND tablename = 'cloud_transfer_events';

-- 5. Verificar policies
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' 
AND tablename = 'cloud_transfer_events';

-- 6. Verificar grants
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' 
AND table_name = 'cloud_transfer_events';
