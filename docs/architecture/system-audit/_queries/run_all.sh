#!/usr/bin/env bash
# Read-only schema inventory queries for ClaimShield system audit.
# Run with: bash docs/architecture/system-audit/_queries/run_all.sh
# Requires: DATABASE_URL env var. ALL queries are SELECT-only.
set -e
OUT="docs/architecture/system-audit/_queries"

psql "$DATABASE_URL" -At -F$'\t' -c "SELECT current_database(), current_user, version();" > "$OUT/00_db_identity.tsv"

# ---- Tables with row counts ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT t.table_schema, t.table_name,
       (xpath('/row/c/text()', query_to_xml('SELECT COUNT(*) AS c FROM '||quote_ident(t.table_schema)||'.'||quote_ident(t.table_name), false, true, '')))[1]::text::int AS row_count
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;" > "$OUT/01_tables_with_rowcounts.tsv"

# ---- Columns ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT table_name, ordinal_position, column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;" > "$OUT/02_columns.tsv"

# ---- Primary keys ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.ordinal_position;" > "$OUT/03_primary_keys.tsv"

# ---- Foreign keys ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT c.conrelid::regclass::text AS src_table,
       (SELECT string_agg(att.attname, ',' ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
          JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum) AS src_cols,
       c.confrelid::regclass::text AS tgt_table,
       (SELECT string_agg(att.attname, ',' ORDER BY u.ord)
          FROM unnest(c.confkey) WITH ORDINALITY u(attnum,ord)
          JOIN pg_attribute att ON att.attrelid = c.confrelid AND att.attnum = u.attnum) AS tgt_cols,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
       c.conname
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE c.contype = 'f' AND n.nspname = 'public'
ORDER BY src_table, c.conname;" > "$OUT/04_foreign_keys.tsv"

# ---- Unique constraints ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT tc.table_name, tc.constraint_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;" > "$OUT/05_unique_constraints.tsv"

# ---- Check constraints ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT con.conrelid::regclass::text AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_namespace n ON n.oid = con.connamespace
WHERE con.contype = 'c' AND n.nspname = 'public'
ORDER BY table_name, con.conname;" > "$OUT/06_check_constraints.tsv"

# ---- Indexes ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT t.relname AS table_name, i.relname AS index_name,
       ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
       pg_get_indexdef(ix.indexrelid) AS def
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relkind = 'r'
ORDER BY t.relname, i.relname;" > "$OUT/07_indexes.tsv"

# ---- Triggers ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT event_object_table, trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;" > "$OUT/08_triggers.tsv"

# ---- Views ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT table_name, view_definition
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;" > "$OUT/09_views.tsv"

# ---- Functions ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT p.proname, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS result, length(pg_get_functiondef(p.oid)) AS body_len
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;" > "$OUT/10_functions.tsv"

# ---- Sequences ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT sequence_name, start_value, increment, last_value
FROM information_schema.sequences s
LEFT JOIN LATERAL (SELECT last_value FROM pg_sequences WHERE schemaname='public' AND sequencename = s.sequence_name) lv ON TRUE
WHERE sequence_schema = 'public'
ORDER BY sequence_name;" > "$OUT/11_sequences.tsv"

# ---- RLS policies ----
psql "$DATABASE_URL" -At -F$'\t' -c "
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, policyname;" > "$OUT/12_rls_policies.tsv"

echo "Schema inventory complete. Files in $OUT/"
wc -l "$OUT"/*.tsv
