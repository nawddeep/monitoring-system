-- Run ONCE on the live Neon database as the owner (Neon console > SQL Editor, or psql with the owner URL).
-- Creates a SELECT-only login for the dashboard API. Replace the password with a long random one
-- (for example: openssl rand -hex 20) and keep it only in Vercel's DATABASE_URL, never in git.
-- Tables have row-level security enabled with no policies, so each table also needs a read policy.
BEGIN;
CREATE ROLE dashboard_ro LOGIN PASSWORD 'REPLACE_WITH_RANDOM_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE neondb TO dashboard_ro;
GRANT USAGE ON SCHEMA public TO dashboard_ro;
GRANT SELECT ON public.reading, public.sensor, public.station, public.parameter,
                public.calibration, public.sensor_installation TO dashboard_ro;
CREATE POLICY dashboard_ro_select ON public.reading FOR SELECT TO dashboard_ro USING (true);
CREATE POLICY dashboard_ro_select ON public.sensor FOR SELECT TO dashboard_ro USING (true);
CREATE POLICY dashboard_ro_select ON public.station FOR SELECT TO dashboard_ro USING (true);
CREATE POLICY dashboard_ro_select ON public.parameter FOR SELECT TO dashboard_ro USING (true);
CREATE POLICY dashboard_ro_select ON public.calibration FOR SELECT TO dashboard_ro USING (true);
CREATE POLICY dashboard_ro_select ON public.sensor_installation FOR SELECT TO dashboard_ro USING (true);
COMMIT;
-- Then in Vercel set DATABASE_URL to Neon's POOLED host (contains "-pooler") with this role:
--   postgresql://dashboard_ro:<password>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
