-- Agregar columna user_id a la tabla cloud_accounts
-- Esta columna vincula cada cuenta de Google Drive con un usuario de Supabase Auth

-- Agregar la columna user_id (UUID) que referencia a auth.users
ALTER TABLE cloud_accounts
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Crear índice para mejorar performance en queries filtradas por user_id
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_id ON cloud_accounts(user_id);

-- Nota: Las cuentas existentes tendrán user_id NULL hasta que se reconecten con OAuth
-- Si quieres asignar un usuario por defecto a las cuentas existentes:
-- UPDATE cloud_accounts SET user_id = '<tu-user-id-aqui>' WHERE user_id IS NULL;
