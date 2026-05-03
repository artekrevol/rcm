SELECT event_object_table, trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE trigger_schema='public'
ORDER BY 1,2;
