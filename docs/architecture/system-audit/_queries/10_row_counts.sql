SELECT schemaname, relname, n_live_tup, n_dead_tup, last_vacuum, last_analyze
FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname;
