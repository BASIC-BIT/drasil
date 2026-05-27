require('dotenv/config');

const { Client } = require('pg');

const CLIENT_ROLES = ['anon', 'authenticated'];
const DEFAULT_DEFAULT_ACL_OWNERS = ['postgres', 'prisma'];
const TABLE_PRIVILEGE_CANDIDATES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];

function createConnectionConfig() {
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Missing TEST_DATABASE_URL or DATABASE_URL for RLS check.');
  }

  if (process.env.PGSSL_REJECT_UNAUTHORIZED === 'false') {
    const url = new URL(databaseUrl);
    url.searchParams.delete('sslmode');

    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    };
  }

  return { connectionString: databaseUrl };
}

function formatList(items) {
  return items.length > 0 ? items.join(', ') : 'none';
}

function configuredDefaultAclOwners(currentUser) {
  const configured = process.env.RLS_CHECK_DEFAULT_ACL_OWNERS;
  const owners = configured
    ? configured
        .split(',')
        .map((owner) => owner.trim())
        .filter(Boolean)
    : DEFAULT_DEFAULT_ACL_OWNERS;

  return new Set([...owners, currentUser]);
}

async function supportedTablePrivileges(client) {
  const privileges = [];

  for (const privilege of TABLE_PRIVILEGE_CANDIDATES) {
    try {
      await client.query("SELECT has_table_privilege(current_user, 'pg_class'::regclass, $1)", [
        privilege,
      ]);
      privileges.push(privilege);
    } catch (error) {
      if (!error.message.includes('unrecognized privilege type')) {
        throw error;
      }
    }
  }

  return privileges;
}

async function main() {
  const client = new Client(createConnectionConfig());
  await client.connect();

  try {
    const currentUserResult = await client.query('SELECT current_user AS user_name;');
    const defaultAclOwners = configuredDefaultAclOwners(currentUserResult.rows[0].user_name);
    const tablePrivileges = await supportedTablePrivileges(client);

    const tableResult = await client.query(
      `
        WITH public_tables AS (
          SELECT c.oid, c.relname, c.relrowsecurity
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
        ), client_privileges AS (
          SELECT
            t.oid,
            client_role.role_name,
            privilege.privilege_type
          FROM public_tables t
          CROSS JOIN unnest($1::text[]) AS client_role(role_name)
          CROSS JOIN unnest($2::text[]) AS privilege(privilege_type)
          WHERE to_regrole(client_role.role_name) IS NOT NULL
            AND has_table_privilege(client_role.role_name, t.oid, privilege.privilege_type)
        )
        SELECT
          t.relname AS table_name,
          t.relrowsecurity AS rls_enabled,
          COALESCE(
            array_agg(DISTINCT cp.role_name || ':' || cp.privilege_type)
              FILTER (WHERE cp.role_name IS NOT NULL),
            ARRAY[]::text[]
          ) AS client_privileges
        FROM public_tables t
        LEFT JOIN client_privileges cp ON cp.oid = t.oid
        GROUP BY t.relname, t.relrowsecurity
        ORDER BY t.relname;
      `,
      [CLIENT_ROLES, tablePrivileges]
    );

    const policyResult = await client.query(
      `
        SELECT schemaname, tablename, policyname, roles, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
        ORDER BY tablename, policyname;
      `
    );

    const defaultPrivilegeResult = await client.query(
      `
        SELECT
          COALESCE(owner.rolname, 'PUBLIC') AS owner,
          n.nspname AS schema_name,
          COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
          acl.privilege_type
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        LEFT JOIN pg_roles owner ON owner.oid = d.defaclrole
        CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public'
          AND d.defaclobjtype = 'r'
          AND COALESCE(grantee.rolname, 'PUBLIC') = ANY($1)
        ORDER BY owner, grantee, acl.privilege_type;
      `,
      [['PUBLIC', ...CLIENT_ROLES]]
    );

    if (tableResult.rows.length === 0) {
      throw new Error('RLS check found no public tables; migrations may not have run.');
    }

    const missingRls = tableResult.rows.filter((row) => !row.rls_enabled);
    const clientPrivileges = tableResult.rows.filter((row) => row.client_privileges.length > 0);

    const blockingDefaultPrivileges = defaultPrivilegeResult.rows.filter((row) =>
      defaultAclOwners.has(row.owner)
    );
    const unmanagedDefaultPrivileges = defaultPrivilegeResult.rows.filter(
      (row) => !defaultAclOwners.has(row.owner)
    );

    if (
      missingRls.length > 0 ||
      clientPrivileges.length > 0 ||
      policyResult.rows.length > 0 ||
      blockingDefaultPrivileges.length > 0
    ) {
      console.error('Public database security check failed.');
      console.error(`Tables missing RLS: ${formatList(missingRls.map((row) => row.table_name))}`);
      console.error(
        `Tables with effective anon/authenticated table privileges: ${formatList(
          clientPrivileges.map((row) => `${row.table_name} (${row.client_privileges.join(', ')})`)
        )}`
      );
      console.error(
        `Client-facing RLS policies: ${formatList(
          policyResult.rows.map(
            (row) => `${row.tablename}.${row.policyname} (${row.roles.join(', ')}/${row.cmd})`
          )
        )}`
      );
      console.error(
        `Client default table privileges: ${formatList(
          blockingDefaultPrivileges.map(
            (row) => `${row.owner}->${row.grantee}:${row.privilege_type}`
          )
        )}`
      );
      process.exitCode = 1;
      return;
    }

    if (unmanagedDefaultPrivileges.length > 0) {
      console.warn(
        `Unmanaged client default table privileges were observed but not failed: ${formatList(
          unmanagedDefaultPrivileges.map(
            (row) => `${row.owner}->${row.grantee}:${row.privilege_type}`
          )
        )}`
      );
    }

    console.log(
      `Public database security check passed for ${tableResult.rows.length} tables: RLS enabled, no effective client privileges, no client policies, no checked-owner client default table privileges.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
