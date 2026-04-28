#!/bin/bash
set -e

npm install

# Apply schema changes via direct SQL instead of drizzle-kit push.
# drizzle-kit push prompts for interactive input when it detects new columns,
# which causes the post-merge script to hang and time out.
# All ALTER TABLE statements here are idempotent (IF NOT EXISTS).
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrations = [
  // submission_attempts table (Task 3 — submission guardrails)
  \`CREATE TABLE IF NOT EXISTS submission_attempts (
    id VARCHAR PRIMARY KEY,
    claim_id VARCHAR,
    organization_id VARCHAR,
    isa15 VARCHAR(1),
    test_mode_override BOOLEAN DEFAULT false,
    automated BOOLEAN DEFAULT false,
    test_data_result VARCHAR(32),
    test_data_score INTEGER,
    attempted_by VARCHAR,
    attempted_at TIMESTAMP DEFAULT NOW()
  )\`,
  // FRCPB enrollment columns on practice_settings (Task #28)
  \`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS frcpb_enrolled BOOLEAN DEFAULT false\`,
  \`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS frcpb_enrolled_at TIMESTAMP\`,
];
(async () => {
  for (const sql of migrations) {
    await pool.query(sql);
    console.log('Migration OK:', sql.slice(0, 60).replace(/\n/g, ' '));
  }
  await pool.end();
  console.log('All migrations applied successfully.');
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
"
