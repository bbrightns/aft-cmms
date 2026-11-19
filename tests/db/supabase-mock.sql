-- Just enough of Supabase for supabase_schema.sql and supabase_security.sql to run on a plain Postgres:
-- the anon / authenticated roles, auth.users, auth.jwt() / auth.uid() read from request.jwt.claims (as PostgREST
-- sets it), storage.objects, and Supabase's default grants. Test users are listed at the bottom.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY, email text, is_anonymous boolean DEFAULT false, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}', last_sign_in_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated;

-- Supabase default: anon / authenticated get every privilege on new public tables (RLS is what limits them)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

INSERT INTO auth.users (id, email, is_anonymous, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@gmail.com',  false, now()),
  ('00000000-0000-0000-0000-000000000002', 'rando@agc.com',    false, now()),   -- not on the allowlist
  ('00000000-0000-0000-0000-000000000003', NULL,               true,  NULL),    -- anonymous sign-in
  ('00000000-0000-0000-0000-000000000004', 'unconf@gmail.com', false, NULL),    -- email never confirmed
  ('00000000-0000-0000-0000-000000000005', 'staff@gmail.com',  false, now()),
  ('00000000-0000-0000-0000-000000000006', 'viewer@gmail.com', false, now()),
  ('00000000-0000-0000-0000-000000000007', 'appr@gmail.com',   false, now());   -- PR approver, viewer role
