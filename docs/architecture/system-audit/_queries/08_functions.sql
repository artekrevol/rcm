SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS result
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY p.proname;
