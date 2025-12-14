  -- Migration: Add quota system for copy limits
  -- Phase 1: Safe implementation without RLS
  -- Created: 2025-12-13

  -- Table: user_plans
  -- Tracks monthly copy quota per user
  CREATE TABLE IF NOT EXISTS user_plans (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    copies_used_month INTEGER NOT NULL DEFAULT 0,
    copies_limit_month INTEGER NOT NULL DEFAULT 20,
    period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Table: copy_jobs
  -- Audit trail of all copy operations
  CREATE TABLE IF NOT EXISTS copy_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_account_id INTEGER NOT NULL,
    target_account_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, success, failed
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT copy_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
  );

  -- Index for performance
  CREATE INDEX IF NOT EXISTS idx_copy_jobs_user_id ON copy_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_copy_jobs_created_at ON copy_jobs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_plans_period_start ON user_plans(period_start);

  -- RLS Policies (COMMENTED - for future Phase 2)
  -- Enable RLS when ready:
  -- ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
  -- ALTER TABLE copy_jobs ENABLE ROW LEVEL SECURITY;

  -- Future policies (uncomment when enabling RLS):
  /*
  CREATE POLICY "Users can view own plan"
    ON user_plans FOR SELECT
    USING (auth.uid() = user_id);

  CREATE POLICY "Users can view own copy jobs"
    ON copy_jobs FOR SELECT
    USING (auth.uid() = user_id);

  -- Backend service role can do everything
  CREATE POLICY "Service role full access to user_plans"
    ON user_plans FOR ALL
    USING (true)
    WITH CHECK (true);

  CREATE POLICY "Service role full access to copy_jobs"
    ON copy_jobs FOR ALL
    USING (true)
    WITH CHECK (true);
  */

  -- Function to auto-reset monthly quota (optional, for cron)
  CREATE OR REPLACE FUNCTION reset_monthly_quotas()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  BEGIN
    UPDATE user_plans
    SET 
      copies_used_month = 0,
      period_start = date_trunc('month', now()),
      updated_at = now()
    WHERE period_start < date_trunc('month', now());
  END;
  $$;

  -- CRITICAL: Atomic increment function to prevent race conditions
  CREATE OR REPLACE FUNCTION increment_user_quota(p_user_id UUID)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  BEGIN
    -- Atomically increment copies_used_month
    -- This prevents race conditions when multiple copies finish simultaneously
    UPDATE user_plans
    SET 
      copies_used_month = copies_used_month + 1,
      updated_at = now()
    WHERE user_id = p_user_id;
    
    -- Create plan if it doesn't exist (safety fallback)
    IF NOT FOUND THEN
      INSERT INTO user_plans (user_id, copies_used_month, copies_limit_month)
      VALUES (p_user_id, 1, 20)
      ON CONFLICT (user_id) DO UPDATE
      SET 
        copies_used_month = user_plans.copies_used_month + 1,
        updated_at = now();
    END IF;
  END;
  $$;

  -- Grant execute to authenticated users (future)
  -- GRANT EXECUTE ON FUNCTION reset_monthly_quotas() TO authenticated;

  COMMENT ON TABLE user_plans IS 'Monthly copy quota tracking per user';
  COMMENT ON TABLE copy_jobs IS 'Audit trail of all copy operations';
  COMMENT ON COLUMN copy_jobs.status IS 'pending: created, success: completed, failed: error occurred';
