SELECT
  tc.table_name AS from_table, kcu.column_name AS from_col,
  ccu.table_name AS to_table, ccu.column_name AS to_col,
  rc.delete_rule, rc.update_rule, tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.table_schema
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.column_name;
