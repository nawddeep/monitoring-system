-- Run ONCE on Neon (SQL Editor, branch dev, database neondb). Replace the password first.
BEGIN;
CREATE ROLE sensor_ingest LOGIN PASSWORD 'REPLACE_WITH_RANDOM_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE neondb TO sensor_ingest;
GRANT USAGE ON SCHEMA public TO sensor_ingest;
GRANT SELECT ON public.station, public.sensor, public.parameter TO sensor_ingest;
GRANT SELECT, INSERT ON public.reading TO sensor_ingest;
GRANT USAGE, SELECT ON SEQUENCE public.reading_id_seq TO sensor_ingest;
CREATE POLICY sensor_ingest_select ON public.station FOR SELECT TO sensor_ingest USING (true);
CREATE POLICY sensor_ingest_select ON public.sensor FOR SELECT TO sensor_ingest USING (true);
CREATE POLICY sensor_ingest_select ON public.parameter FOR SELECT TO sensor_ingest USING (true);
CREATE POLICY sensor_ingest_select ON public.reading FOR SELECT TO sensor_ingest USING (true);
CREATE POLICY sensor_ingest_insert ON public.reading FOR INSERT TO sensor_ingest WITH CHECK (true);
COMMIT;
