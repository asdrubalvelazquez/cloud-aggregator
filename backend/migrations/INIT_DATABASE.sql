-- ================================================
-- INIT_DATABASE.sql: Ejecutar todas las migraciones
-- ================================================

-- 1. Sistema de Slots
-- MIGRATION: Sistema de Slots Históricos y Cuotas Híbridas
CREATE TABLE IF NOT EXISTS cloud_slots_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'dropbox')),
    provider_account_id TEXT NOT NULL,
    provider_email TEXT NOT NULL,
    slot_number INTEGER NOT NULL,
    plan_at_connection TEXT NOT NULL DEFAULT 'free',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at TIMESTAMPTZ,
    slot_expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_provider_account_per_user UNIQUE (user_id, provider, provider_account_id),
    CONSTRAINT check_disconnected_logic CHECK (
        (is_active = true AND disconnected_at IS NULL) OR 
        (is_active = false AND disconnected_at IS NOT NULL)
    ),
    CONSTRAINT check_disconnection_after_connection CHECK (
        disconnected_at IS NULL OR disconnected_at >= connected_at
    )
);

CREATE INDEX idx_cloud_slots_log_user_active ON cloud_slots_log(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_cloud_slots_log_provider_lookup ON cloud_slots_log(provider, provider_account_id);
CREATE INDEX idx_cloud_slots_log_user_provider ON cloud_slots_log(user_id, provider);
CREATE INDEX idx_cloud_slots_log_expiration ON cloud_slots_log(slot_expires_at) WHERE slot_expires_at IS NOT NULL AND is_active = true;

-- 2. Sistema de Quota
CREATE TABLE IF NOT EXISTS user_plans (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    copies_used_month INTEGER NOT NULL DEFAULT 0,
    copies_limit_month INTEGER NOT NULL DEFAULT 20,
    period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copy_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_account_id INTEGER NOT NULL,
    target_account_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT copy_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_copy_jobs_user_id ON copy_jobs(user_id);
CREATE INDEX idx_copy_jobs_created_at ON copy_jobs(created_at DESC);
CREATE INDEX idx_user_plans_period_start ON user_plans(period_start);

-- 3. Transferencias entre Proveedores
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL CHECK (source_provider IN ('google_drive', 'onedrive', 'dropbox')),
    source_account_id TEXT NOT NULL,
    target_provider TEXT NOT NULL CHECK (target_provider IN ('google_drive', 'onedrive', 'dropbox')),
    target_account_id TEXT NOT NULL,
    target_folder_id TEXT DEFAULT 'root',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'partial')),
    total_items INT NOT NULL DEFAULT 0,
    completed_items INT NOT NULL DEFAULT 0,
    failed_items INT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    transferred_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT check_total_items_positive CHECK (total_items >= 0),
    CONSTRAINT check_completed_items_positive CHECK (completed_items >= 0),
    CONSTRAINT check_failed_items_positive CHECK (failed_items >= 0),
    CONSTRAINT check_total_bytes_positive CHECK (total_bytes >= 0),
    CONSTRAINT check_transferred_bytes_positive CHECK (transferred_bytes >= 0),
    CONSTRAINT check_completed_le_total CHECK (completed_items + failed_items <= total_items),
    CONSTRAINT check_started_after_created CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT check_completed_after_started CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

CREATE TABLE IF NOT EXISTS transfer_job_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
    source_item_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    error_message TEXT,
    target_item_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT check_size_positive CHECK (size_bytes >= 0),
    CONSTRAINT check_started_after_created_item CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT check_completed_after_started_item CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

CREATE INDEX idx_transfer_jobs_user_id ON transfer_jobs(user_id);
CREATE INDEX idx_transfer_jobs_status ON transfer_jobs(status);
CREATE INDEX idx_transfer_jobs_created_at ON transfer_jobs(created_at DESC);
CREATE INDEX idx_transfer_job_items_job_id ON transfer_job_items(job_id);
CREATE INDEX idx_transfer_job_items_status ON transfer_job_items(status);

-- 4. Solicitudes de Transferencia de Propiedad
CREATE TABLE IF NOT EXISTS ownership_transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    requesting_user_id UUID NOT NULL,
    existing_owner_id UUID NOT NULL,
    account_email TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expiry TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
    CONSTRAINT ownership_transfer_unique_key UNIQUE (provider, provider_account_id, requesting_user_id)
);

CREATE INDEX idx_ownership_transfer_expires_at ON ownership_transfer_requests(expires_at);
CREATE INDEX idx_ownership_transfer_requesting_user ON ownership_transfer_requests(requesting_user_id);
CREATE INDEX idx_ownership_transfer_status ON ownership_transfer_requests(status);