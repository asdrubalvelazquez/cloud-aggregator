-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1: PREVIEW - Ver duplicados y qué fila quedaría
-- ═══════════════════════════════════════════════════════════════════════════

WITH duplicates AS (
    SELECT 
        provider_account_id,
        COUNT(*) as duplicate_count
    FROM cloud_provider_accounts
    WHERE provider = 'onedrive'
    GROUP BY provider_account_id
    HAVING COUNT(*) > 1
),
ranked_accounts AS (
    SELECT 
        cpa.*,
        d.duplicate_count,
        ROW_NUMBER() OVER (
            PARTITION BY cpa.provider_account_id 
            ORDER BY 
                -- Criterio 1: is_active=true primero
                CASE WHEN cpa.is_active = true THEN 0 ELSE 1 END,
                -- Criterio 2: disconnected_at IS NULL primero
                CASE WHEN cpa.disconnected_at IS NULL THEN 0 ELSE 1 END,
                -- Criterio 3: connected_at más reciente primero
                cpa.connected_at DESC NULLS LAST,
                -- Criterio 4: id menor (determinista)
                cpa.id ASC
        ) as row_rank
    FROM cloud_provider_accounts cpa
    INNER JOIN duplicates d ON cpa.provider_account_id = d.provider_account_id
    WHERE cpa.provider = 'onedrive'
)
SELECT 
    provider_account_id,
    duplicate_count,
    id,
    user_id,
    account_email,
    is_active,
    disconnected_at,
    connected_at,
    slot_log_id,
    row_rank,
    CASE WHEN row_rank = 1 THEN '✅ KEEPER' ELSE '❌ DELETE' END as action
FROM ranked_accounts
ORDER BY provider_account_id, row_rank;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2: LIMPIEZA REAL - Eliminar duplicados y actualizar referencias
-- ═══════════════════════════════════════════════════════════════════════════

-- EJECUTAR DESPUÉS DE REVISAR EL PREVIEW

BEGIN;

-- Crear tabla temporal con las filas ganadoras
CREATE TEMP TABLE winner_accounts AS
WITH duplicates AS (
    SELECT 
        provider_account_id,
        COUNT(*) as duplicate_count
    FROM cloud_provider_accounts
    WHERE provider = 'onedrive'
    GROUP BY provider_account_id
    HAVING COUNT(*) > 1
),
ranked_accounts AS (
    SELECT 
        cpa.id,
        cpa.user_id,
        cpa.provider_account_id,
        ROW_NUMBER() OVER (
            PARTITION BY cpa.provider_account_id 
            ORDER BY 
                CASE WHEN cpa.is_active = true THEN 0 ELSE 1 END,
                CASE WHEN cpa.disconnected_at IS NULL THEN 0 ELSE 1 END,
                cpa.connected_at DESC NULLS LAST,
                cpa.id ASC
        ) as row_rank
    FROM cloud_provider_accounts cpa
    INNER JOIN duplicates d ON cpa.provider_account_id = d.provider_account_id
    WHERE cpa.provider = 'onedrive'
)
SELECT id, user_id, provider_account_id
FROM ranked_accounts
WHERE row_rank = 1;

-- Crear tabla temporal con las filas perdedoras
CREATE TEMP TABLE loser_accounts AS
WITH duplicates AS (
    SELECT 
        provider_account_id,
        COUNT(*) as duplicate_count
    FROM cloud_provider_accounts
    WHERE provider = 'onedrive'
    GROUP BY provider_account_id
    HAVING COUNT(*) > 1
),
ranked_accounts AS (
    SELECT 
        cpa.id,
        cpa.user_id,
        cpa.provider_account_id,
        ROW_NUMBER() OVER (
            PARTITION BY cpa.provider_account_id 
            ORDER BY 
                CASE WHEN cpa.is_active = true THEN 0 ELSE 1 END,
                CASE WHEN cpa.disconnected_at IS NULL THEN 0 ELSE 1 END,
                cpa.connected_at DESC NULLS LAST,
                cpa.id ASC
        ) as row_rank
    FROM cloud_provider_accounts cpa
    INNER JOIN duplicates d ON cpa.provider_account_id = d.provider_account_id
    WHERE cpa.provider = 'onedrive'
)
SELECT id, user_id, provider_account_id
FROM ranked_accounts
WHERE row_rank > 1;

-- Log de lo que vamos a hacer
DO $$
DECLARE
    winner_count INTEGER;
    loser_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO winner_count FROM winner_accounts;
    SELECT COUNT(*) INTO loser_count FROM loser_accounts;
    
    RAISE NOTICE 'Winner accounts (to keep): %', winner_count;
    RAISE NOTICE 'Loser accounts (to delete): %', loser_count;
END $$;

-- Paso 1: Actualizar cloud_slots_log para apuntar al user_id ganador
-- (Solo para slots que tienen el mismo provider_account_id)
UPDATE cloud_slots_log csl
SET user_id = w.user_id
FROM loser_accounts l
INNER JOIN winner_accounts w ON l.provider_account_id = w.provider_account_id
WHERE csl.provider = 'onedrive'
  AND csl.provider_account_id = l.provider_account_id
  AND csl.user_id = l.user_id;

-- Paso 2: Actualizar slot_log_id en winner_accounts si apunta a un slot del loser
UPDATE cloud_provider_accounts cpa
SET slot_log_id = (
    SELECT csl.id
    FROM cloud_slots_log csl
    WHERE csl.provider = 'onedrive'
      AND csl.provider_account_id = cpa.provider_account_id
      AND csl.user_id = cpa.user_id
    LIMIT 1
)
FROM winner_accounts w
WHERE cpa.id = w.id
  AND cpa.slot_log_id IN (
      SELECT csl2.id 
      FROM cloud_slots_log csl2
      INNER JOIN loser_accounts l ON csl2.user_id = l.user_id
      WHERE csl2.provider_account_id = w.provider_account_id
  );

-- Paso 3: Eliminar las filas perdedoras de cloud_provider_accounts
DELETE FROM cloud_provider_accounts
WHERE id IN (SELECT id FROM loser_accounts);

-- Reporte final
DO $$
DECLARE
    deleted_count INTEGER;
    remaining_duplicates INTEGER;
BEGIN
    SELECT COUNT(*) INTO deleted_count FROM loser_accounts;
    
    -- Verificar si todavía hay duplicados
    SELECT COUNT(*) INTO remaining_duplicates
    FROM (
        SELECT provider_account_id, COUNT(*) as cnt
        FROM cloud_provider_accounts
        WHERE provider = 'onedrive'
        GROUP BY provider_account_id
        HAVING COUNT(*) > 1
    ) subq;
    
    RAISE NOTICE '✅ Deleted % duplicate rows', deleted_count;
    RAISE NOTICE '✅ Remaining duplicates: %', remaining_duplicates;
    
    IF remaining_duplicates > 0 THEN
        RAISE WARNING 'Still have duplicates! Run cleanup again.';
    ELSE
        RAISE NOTICE '✅ All duplicates cleaned!';
    END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-LIMPIEZA
-- ═══════════════════════════════════════════════════════════════════════════

-- Contar duplicados restantes
SELECT 
    provider_account_id,
    COUNT(*) as count,
    STRING_AGG(user_id::text, ', ') as user_ids,
    STRING_AGG(id::text, ', ') as account_ids
FROM cloud_provider_accounts
WHERE provider = 'onedrive'
GROUP BY provider_account_id
HAVING COUNT(*) > 1;

-- Estadísticas finales
SELECT 
    COUNT(*) as total_onedrive_accounts,
    COUNT(DISTINCT provider_account_id) as unique_provider_accounts,
    COUNT(*) - COUNT(DISTINCT provider_account_id) as duplicates_count
FROM cloud_provider_accounts
WHERE provider = 'onedrive';
