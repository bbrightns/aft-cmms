-- ============================================================
-- AFT-CMMS security lockdown
-- Run in Supabase > SQL Editor AFTER supabase_schema.sql. Safe to run again at any time.
--
-- Who may do what after this script:
--   staff  = a signed-in, email-confirmed, NON-anonymous user whose email or domain is in app_allowlist
--            (seeded with '@gmail.com'). Staff can read and write everything, as before.
--            WARNING: '@gmail.com' means ANY Gmail account in the world is staff and can delete all data.
--            To narrow it later: add each person's email, then DELETE FROM app_allowlist WHERE email = '@gmail.com';
--   guest  = the "Guest" button on login.html (no Supabase session, role anon). READ-ONLY: while guest mode
--            is on, a guest can view inventory, logs and the stock value trend. No withdraw, receive, add,
--            edit, delete, import or clear.
--   anyone else (an anonymous sign-in, a Google account outside app_allowlist) = nothing.
--
-- BEFORE RUNNING: see "Step 0" at the bottom of this file, to list who would lose write access.
-- AFTER RUNNING: Dashboard > Authentication > Sign In / Providers > turn OFF "Anonymous sign-ins".
-- ============================================================

-- 1. Allowlist: a full email ('someone@gmail.com') or a whole domain ('@gmail.com').
--    RLS on with no policies: only the SQL editor can read or change it.
CREATE TABLE IF NOT EXISTS app_allowlist (
  email text PRIMARY KEY CHECK (email = lower(email)),
  note text
);
ALTER TABLE app_allowlist ENABLE ROW LEVEL SECURITY;
INSERT INTO app_allowlist (email, note) VALUES ('@gmail.com', 'every Gmail account (temporary, see header)')
ON CONFLICT (email) DO NOTHING;

-- 2. Guest mode switch: 1 = on, 0 = off. Turning it off is a data edit:
--    UPDATE store_meta SET current = 0 WHERE key = 'guestMode';
INSERT INTO store_meta (key, current) VALUES ('guestMode', 1)
ON CONFLICT (key) DO NOTHING;

-- 3. Helpers used by the policies. SECURITY DEFINER so they can read auth.users / app_allowlist.
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND coalesce(u.is_anonymous, false) = false
      AND u.email_confirmed_at IS NOT NULL          -- an unconfirmed email/password sign-up cannot claim an allowlisted email
      AND EXISTS (
        SELECT 1 FROM public.app_allowlist a
        WHERE a.email = lower(u.email)
           OR a.email = '@' || split_part(lower(u.email), '@', 2)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.guest_mode() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT current = 1 FROM public.store_meta WHERE key = 'guestMode'), false);
$$;

-- a request with no session at all (the Guest button)
CREATE OR REPLACE FUNCTION public.is_guest() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.jwt() ->> 'role', '') = 'anon' AND public.guest_mode();
$$;

-- 4. Drop every existing policy on the app tables, so no old "true" policy survives.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('inventory', 'logs', 'store_meta', 'stock_value_snapshots',
                        'pr_records', 'pr_import_logs', 'approval_roles', 'pr_approval_log')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE inventory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_meta            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_value_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_import_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_approval_log       ENABLE ROW LEVEL SECURITY;

-- (SELECT fn()) instead of fn() makes Postgres evaluate it once per query, not once per row.

-- inventory: staff do everything; a guest only reads
CREATE POLICY inventory_read  ON inventory FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_staff()) OR (SELECT public.is_guest()));
CREATE POLICY inventory_write ON inventory FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

-- logs: a guest only reads; staff add, edit and clear
CREATE POLICY logs_read   ON logs FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_staff()) OR (SELECT public.is_guest()));
CREATE POLICY logs_insert ON logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY logs_staff_update ON logs FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY logs_staff_delete ON logs FOR DELETE TO authenticated
  USING ((SELECT public.is_staff()));

-- store_meta: readable; written only by the SECURITY DEFINER functions below and the SQL editor
CREATE POLICY store_meta_read ON store_meta FOR SELECT TO anon, authenticated USING (true);

-- stock value trend: everyone who can see stock can see it; only staff save the monthly snapshot
CREATE POLICY svs_read  ON stock_value_snapshots FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_staff()) OR (SELECT public.is_guest()));
CREATE POLICY svs_write ON stock_value_snapshots FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

-- Purchase requests: staff only (pr.html already asks a guest to sign in)
CREATE POLICY pr_records_staff ON pr_records FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY pr_import_logs_staff ON pr_import_logs FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY approval_roles_read  ON approval_roles  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY pr_approval_log_read ON pr_approval_log FOR SELECT TO authenticated USING ((SELECT public.is_staff()));

-- PR quotation files
DROP POLICY IF EXISTS "pr-docs read"   ON storage.objects;
DROP POLICY IF EXISTS "pr-docs upload" ON storage.objects;
DROP POLICY IF EXISTS "pr-docs delete" ON storage.objects;
CREATE POLICY "pr-docs read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pr-docs' AND (SELECT public.is_staff()));
CREATE POLICY "pr-docs upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pr-docs' AND (SELECT public.is_staff()));
CREATE POLICY "pr-docs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pr-docs' AND (SELECT public.is_staff()));

-- 5. Table privileges: RLS is the fence, grants are the second fence.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON inventory, logs, store_meta, stock_value_snapshots TO anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 6. Stock functions: same logic as before, now SECURITY DEFINER with a permission check at the top.
--    Callers no longer need UPDATE on inventory, which is why the public UPDATE policy could go.
CREATE OR REPLACE FUNCTION get_next_part_id()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_num integer;
  max_num integer;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT COALESCE(MAX(CAST(substring("Part ID" from '(?i)^SPFL-C-(\d+)$') AS integer)), 0)
  INTO max_num
  FROM inventory;

  INSERT INTO store_meta (key, current)
  VALUES ('partIdCounter', max_num)
  ON CONFLICT (key) DO UPDATE
  SET current = GREATEST(store_meta.current, max_num);

  UPDATE store_meta
  SET current = current + 1
  WHERE key = 'partIdCounter'
  RETURNING current INTO next_num;

  RETURN next_num;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_stock_v2(
  item_id text,
  qty double precision,
  mode text,
  new_loc text,
  new_pos text,
  device_id text,
  user_name text
)
RETURNS double precision
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_actual double precision;
  new_actual double precision;
  raw_actual text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  -- the page only ever sends 0 or a positive quantity; a negative one would turn "in" into an unchecked withdrawal
  IF qty IS NULL OR qty < 0 THEN
    RAISE EXCEPTION 'Quantity must be zero or more';
  END IF;

  SELECT btrim(COALESCE("Actual", '')) INTO raw_actual
  FROM inventory
  WHERE id = item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  current_actual := CASE WHEN raw_actual ~ '^-?[0-9]+(\.[0-9]+)?$' THEN raw_actual::double precision ELSE 0 END;

  IF qty = 0 THEN
    new_actual := current_actual;
  ELSIF mode = 'out' THEN
    IF current_actual <= 0 AND qty > 0 THEN
      RAISE EXCEPTION 'ZERO_STOCK';
    END IF;
    IF qty > current_actual THEN
      RAISE EXCEPTION 'OVER_STOCK';
    END IF;
    new_actual := GREATEST(0, current_actual - qty);
  ELSE
    new_actual := current_actual + qty;
  END IF;

  UPDATE inventory
  SET "Actual" = CAST(new_actual AS text),
      "Location" = COALESCE(new_loc, "Location"),
      "Position" = COALESCE(new_pos, "Position"),
      "_updatedAt" = NOW(),
      "_device" = device_id,
      "_updatedBy" = user_name
  WHERE id = item_id;

  RETURN new_actual;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; take it back and give it only where it is needed.
REVOKE EXECUTE ON FUNCTION get_next_part_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_next_part_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION adjust_stock_v2(text, double precision, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION adjust_stock_v2(text, double precision, text, text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION adjust_stock_v2(text, double precision, text, text, text, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_staff(), public.guest_mode(), public.is_guest() TO anon, authenticated;

-- ============================================================
-- Step 0 (read-only, run BEFORE the script above):
-- people who have signed in with a non-Gmail email. Anyone listed here who really uses the app
-- needs a row in app_allowlist, or they lose write access:
--
--   SELECT email, last_sign_in_at FROM auth.users
--   WHERE NOT coalesce(is_anonymous, false)
--     AND split_part(lower(email), '@', 2) <> 'gmail.com'
--   ORDER BY last_sign_in_at DESC NULLS LAST;
--
--   INSERT INTO app_allowlist (email, note) VALUES ('someone@gmail.com', 'why') ON CONFLICT DO NOTHING;
--
-- Optional, AFTER turning off anonymous sign-ins (irreversible; these accounts have no email or name,
-- and their saved sessions would otherwise keep working until they expire):
--
--   DELETE FROM auth.users WHERE is_anonymous;
--
-- Emergency switches if the factory floor is blocked after rollout:
--   guests cannot even view stock   -> UPDATE store_meta SET current = 1 WHERE key = 'guestMode';
--   a staff member cannot save      -> INSERT INTO app_allowlist (email) VALUES ('their@email');
-- ============================================================
