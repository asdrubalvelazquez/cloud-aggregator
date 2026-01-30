#!/usr/bin/env python3
"""
Migration script to add nickname column to cloud_slots_log table
"""

import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection details
DATABASE_URL = "postgresql://postgres.qqvlhqobcksqkrqiojgc:Alquimia1986$$@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

migration_sql = """
-- Migration: Add nickname column to cloud_slots_log table
-- Date: 2026-01-30
-- Description: Add support for custom nicknames for cloud accounts

-- Add nickname column to cloud_slots_log
ALTER TABLE cloud_slots_log 
ADD COLUMN IF NOT EXISTS nickname VARCHAR(50);

-- Add index for better performance on nickname queries (only if not exists)
CREATE INDEX IF NOT EXISTS idx_cloud_slots_log_nickname ON cloud_slots_log(nickname);

-- Add comment for documentation
COMMENT ON COLUMN cloud_slots_log.nickname IS 'Custom user-defined nickname for the cloud account';
"""

def run_migration():
    try:
        # Connect to the database
        print("Connecting to database...")
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        # Execute the migration
        print("Running migration...")
        cursor.execute(migration_sql)
        
        # Commit the changes
        conn.commit()
        print("✅ Migration completed successfully!")
        print("- Added nickname column to cloud_slots_log")
        print("- Added index on nickname column")
        print("- Added column comment")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        if conn:
            conn.rollback()
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

if __name__ == "__main__":
    run_migration()