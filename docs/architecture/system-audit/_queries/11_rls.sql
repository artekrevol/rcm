SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.polname, p.polcmd,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
       (SELECT array_agg(rolname) FROM pg_roles WHERE oid=ANY(p.polroles)) AS roles
FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid=c.oid
WHERE c.relkind='r' AND c.relnamespace='public'::regnamespace AND (c.relrowsecurity OR p.polname IS NOT NULL)
ORDER BY c.relname, p.polname;
