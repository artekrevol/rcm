SELECT sequence_name, data_type, start_value, increment, last_value
FROM information_schema.sequences s LEFT JOIN pg_sequences pgs ON pgs.sequencename=s.sequence_name
WHERE s.sequence_schema='public' ORDER BY 1;
