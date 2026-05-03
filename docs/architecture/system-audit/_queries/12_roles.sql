SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;
