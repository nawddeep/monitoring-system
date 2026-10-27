-- Block Supabase's public Data API roles (anon, authenticated) from these tables.
-- RLS is enabled with no policies, so those roles see nothing. The app connects as the
-- table owner (postgres), which bypasses RLS, so Prisma access is unchanged.
-- On plain PostgreSQL (local Docker, CI) this is harmless.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apikey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
