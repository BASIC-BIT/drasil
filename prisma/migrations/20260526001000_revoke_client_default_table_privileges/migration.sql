DO $$
DECLARE
  owner_role text;
  client_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin', 'prisma'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role)
      AND pg_has_role(current_user, owner_role, 'MEMBER') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
        owner_role
      );

      FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
            owner_role,
            client_role
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
