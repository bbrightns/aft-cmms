-- ============================================================
-- AFT-CMMS security: who may do what, enforced by the database
-- Run in Supabase > SQL Editor AFTER supabase_schema.sql. Safe to run again at any time.
--
-- member = a signed-in, email-confirmed, NON-anonymous user whose email or domain is in app_allowlist
--          (seeded with '@gmail.com': any Gmail account can sign in and READ).
-- Each member has one role, kept in app_roles (no row = viewer):
--   viewer : read everything. Change nothing.
--   staff  : viewer + withdraw/receive, add and edit items (prices, photos), create and edit PRs.
--   admin  : staff + delete items, import CSV, clear data/logs, delete and import PRs, manage roles.
-- PR approvers/clerks (approval_roles) may also update PRs whatever their role, for the approval flow.
-- guest  = the "Guest" button on login.html (no Supabase session, role anon). READ-ONLY while guest mode
--          is on (store_meta 'guestMode' = 1).
-- anyone else (an anonymous sign-in, a Google account outside app_allowlist) = nothing.
--
-- First admin (once, in the SQL editor, with your own sign-in email):
--   INSERT INTO app_roles (email, role, updated_by) VALUES ('you@gmail.com', 'admin', 'sql editor')
--   ON CONFLICT (email) DO UPDATE SET role = 'admin', updated_at = now(), updated_by = 'sql editor';
-- After that, admins change roles in the app: Settings > จัดการผู้ใช้และสิทธิ์.
-- Dashboard > Authentication > Sign In / Providers: keep "Anonymous sign-ins" OFF.
-- ============================================================

-- 1. Allowlist: a full email ('someone@gmail.com') or a whole domain ('@gmail.com').
--    RLS on with no policies: only the SQL editor can read or change it.
CREATE TABLE IF NOT EXISTS app_allowlist (
  email text PRIMARY KEY CHECK (email = lower(email)),
  note text
);
ALTER TABLE app_allowlist ENABLE ROW LEVEL SECURITY;
INSERT INTO app_allowlist (email, note) VALUES ('@gmail.com', 'every Gmail account may sign in (read-only until given a role)')
ON CONFLICT (email) DO NOTHING;

-- 2. Guest mode switch: 1 = on, 0 = off. Turning it off is a data edit:
--    UPDATE store_meta SET current = 0 WHERE key = 'guestMode';
INSERT INTO store_meta (key, current) VALUES ('guestMode', 1)
ON CONFLICT (key) DO NOTHING;

-- 3. Roles. A member without a row is a viewer (set_user_role deletes the row when someone goes back to viewer).
--    RLS on with no policies: read and changed only through my_role / list_app_users / set_user_role below.
CREATE TABLE IF NOT EXISTS app_roles (
  email text PRIMARY KEY CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('viewer', 'staff', 'admin')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
ALTER TABLE app_roles ENABLE ROW LEVEL SECURITY;

-- 4. Helpers used by the policies. SECURITY DEFINER so they can read auth.users and the tables above.
CREATE OR REPLACE FUNCTION public.is_allowlisted(addr text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_allowlist a
    WHERE a.email = lower(addr) OR a.email = '@' || split_part(lower(addr), '@', 2)
  );
$$;

-- the signed-in user's email, only if they count as a member
CREATE OR REPLACE FUNCTION public.member_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT lower(u.email) FROM auth.users u
  WHERE u.id = auth.uid()
    AND coalesce(u.is_anonymous, false) = false
    AND u.email_confirmed_at IS NOT NULL          -- an unconfirmed email/password sign-up cannot claim an allowlisted email
    AND public.is_allowlisted(u.email);
$$;

CREATE OR REPLACE FUNCTION public.is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.member_email() IS NOT NULL;
$$;

-- 'viewer' | 'staff' | 'admin' for a member, NULL for everyone else
CREATE OR REPLACE FUNCTION public.app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN m.email IS NULL THEN NULL
              ELSE coalesce((SELECT r.role FROM public.app_roles r WHERE r.email = m.email), 'viewer') END
  FROM (SELECT public.member_email() AS email) m;
$$;

-- "may change data": staff or admin
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.app_role() IN ('staff', 'admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.app_role() = 'admin', false);
$$;

-- a PR approver or clerk (approval_roles), who must be able to update PRs even as a viewer
CREATE OR REPLACE FUNCTION public.has_approval_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.approval_roles ar WHERE lower(ar.email) = public.member_email());
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

-- 5. Drop every existing policy on the app tables, so no old policy survives.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('inventory', 'logs', 'store_meta', 'stock_value_snapshots',
                        'pr_records', 'pr_import_logs', 'approval_roles', 'pr_approval_log', 'app_roles')
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

-- inventory: everyone signed in (and a guest) reads; staff add and edit; only admin deletes
CREATE POLICY inventory_read   ON inventory FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_member()) OR (SELECT public.is_guest()));
CREATE POLICY inventory_insert ON inventory FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY inventory_update ON inventory FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY inventory_delete ON inventory FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- logs: staff add rows (every withdraw/receive/edit writes one); only admin edits or clears
CREATE POLICY logs_read   ON logs FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_member()) OR (SELECT public.is_guest()));
CREATE POLICY logs_insert ON logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY logs_admin_update ON logs FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY logs_admin_delete ON logs FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- store_meta: readable; written only by the SECURITY DEFINER functions below and the SQL editor
CREATE POLICY store_meta_read ON store_meta FOR SELECT TO anon, authenticated USING (true);

-- stock value trend: everyone who can see stock can see it; staff refresh the monthly snapshot
CREATE POLICY svs_read  ON stock_value_snapshots FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_member()) OR (SELECT public.is_guest()));
CREATE POLICY svs_write ON stock_value_snapshots FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

-- Purchase requests: members read; staff create and edit; approvers/clerks update; only admin deletes or imports
CREATE POLICY pr_records_read   ON pr_records FOR SELECT TO authenticated USING ((SELECT public.is_member()));
CREATE POLICY pr_records_insert ON pr_records FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_staff()));
CREATE POLICY pr_records_update ON pr_records FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff()) OR (SELECT public.has_approval_role()))
  WITH CHECK ((SELECT public.is_staff()) OR (SELECT public.has_approval_role()));
CREATE POLICY pr_records_delete ON pr_records FOR DELETE TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY pr_import_logs_read  ON pr_import_logs FOR SELECT TO authenticated USING ((SELECT public.is_member()));
CREATE POLICY pr_import_logs_write ON pr_import_logs FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY approval_roles_read  ON approval_roles  FOR SELECT TO authenticated USING ((SELECT public.is_member()));
CREATE POLICY pr_approval_log_read ON pr_approval_log FOR SELECT TO authenticated USING ((SELECT public.is_member()));

-- PR quotation files
DROP POLICY IF EXISTS "pr-docs read"   ON storage.objects;
DROP POLICY IF EXISTS "pr-docs upload" ON storage.objects;
DROP POLICY IF EXISTS "pr-docs delete" ON storage.objects;
CREATE POLICY "pr-docs read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pr-docs' AND (SELECT public.is_member()));
CREATE POLICY "pr-docs upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pr-docs' AND (SELECT public.is_staff()));
CREATE POLICY "pr-docs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pr-docs' AND (SELECT public.is_staff()));

-- Part photos (bucket 'parts', PUBLIC bucket). Viewing a photo goes through its public URL, which needs
-- no policy, so everyone still sees photos. Upload (upsert), replace and remove are staff work (editing an item).
-- Drops any other policy on this bucket, such as the dashboard-made "Public ..." ones that let anyone write.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (coalesce(qual, '') LIKE '%''parts''%' OR coalesce(with_check, '') LIKE '%''parts''%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "parts staff read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'parts' AND (SELECT public.is_staff()));
CREATE POLICY "parts staff upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'parts' AND (SELECT public.is_staff()));
CREATE POLICY "parts staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'parts' AND (SELECT public.is_staff())) WITH CHECK (bucket_id = 'parts' AND (SELECT public.is_staff()));
CREATE POLICY "parts staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'parts' AND (SELECT public.is_staff()));

-- 6. Table privileges: RLS is the fence, grants are the second fence.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON inventory, logs, store_meta, stock_value_snapshots TO anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 7. Stock functions: same logic as before, now SECURITY DEFINER with a permission check at the top.
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
GRANT  EXECUTE ON FUNCTION public.is_allowlisted(text), public.member_email(), public.is_member(), public.app_role(),
                           public.is_staff(), public.is_admin(), public.has_approval_role(),
                           public.guest_mode(), public.is_guest() TO anon, authenticated;

-- 8. Roles in the app. app_roles has no policies, so these three functions are the only way in.
-- my_role: what the page uses to decide which buttons work ('viewer' | 'staff' | 'admin', NULL for non-members)
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_role();
$$;

-- list_app_users: every member who has signed in, with their role. Admin only.
CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE (user_email text, user_name text, last_sign_in timestamptz, user_role text,
               role_updated_at timestamptz, role_updated_by text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN QUERY
    SELECT lower(u.email)::text,
           coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name',
                    u.raw_user_meta_data ->> 'name', '')::text,
           u.last_sign_in_at,
           coalesce(r.role, 'viewer')::text,
           r.updated_at,
           r.updated_by
    FROM auth.users u
    LEFT JOIN public.app_roles r ON r.email = lower(u.email)
    WHERE coalesce(u.is_anonymous, false) = false
      AND u.email IS NOT NULL
      AND u.email_confirmed_at IS NOT NULL
      AND public.is_allowlisted(u.email)
    ORDER BY u.last_sign_in_at DESC NULLS LAST;
END;
$$;

-- set_user_role: admin only. An admin cannot change their own role, so the last admin can never lock everyone out.
CREATE OR REPLACE FUNCTION public.set_user_role(target_email text, new_role text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me text := public.member_email();
  t  text := lower(btrim(coalesce(target_email, '')));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF new_role IS NULL OR new_role NOT IN ('viewer', 'staff', 'admin') THEN
    RAISE EXCEPTION 'BAD_ROLE';
  END IF;
  IF t = me THEN
    RAISE EXCEPTION 'CANNOT_CHANGE_OWN_ROLE';
  END IF;
  IF t = '' OR NOT public.is_allowlisted(t) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;
  IF new_role = 'viewer' THEN
    DELETE FROM public.app_roles WHERE email = t;   -- no row = viewer
  ELSE
    INSERT INTO public.app_roles (email, role, updated_at, updated_by) VALUES (t, new_role, now(), me)
    ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = now(), updated_by = me;
  END IF;
  RETURN new_role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_role(), public.list_app_users(), public.set_user_role(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_role(), public.list_app_users(), public.set_user_role(text, text) TO authenticated;

-- ============================================================
-- Useful SQL (run by hand in the SQL editor):
--
-- Who has which role:
--   SELECT * FROM app_roles ORDER BY role, email;
--
-- Optional, with anonymous sign-ins OFF (irreversible; these accounts have no email or name):
--   DELETE FROM auth.users WHERE is_anonymous;
--
-- Emergency switches if the factory floor is blocked after rollout:
--   guests cannot even view stock      -> UPDATE store_meta SET current = 1 WHERE key = 'guestMode';
--   someone must withdraw right now    -> INSERT INTO app_roles (email, role, updated_by) VALUES ('their@email', 'staff', 'sql editor')
--                                         ON CONFLICT (email) DO UPDATE SET role = 'staff', updated_at = now();
--   a non-Gmail address must sign in   -> INSERT INTO app_allowlist (email) VALUES ('their@email');
-- ============================================================
