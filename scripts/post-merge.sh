#!/bin/bash
set -e

npm install

# All schema migrations (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS)
# are handled by the startup seeder in server/routes.ts (registerRoutes → try block).
# The seeder runs on every server startup and is idempotent, so both Replit and
# Railway production are guaranteed to reach the same schema state automatically.
#
# RULE: Never add raw ALTER TABLE / CREATE TABLE statements here.
#       Add them to the startup seeder in server/routes.ts instead.
#
# After this script exits, Replit automatically restarts the 'Start application'
# workflow, which starts the Express server. The seeder executes at the top of
# registerRoutes() before any request is served, applying any pending DDL and
# logging "[SEEDER] Startup schema seeder complete." when done.
echo "post-merge.sh: dependencies installed. The server will restart and the startup seeder will apply any pending schema changes."
