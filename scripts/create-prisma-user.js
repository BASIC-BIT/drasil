/* eslint-env node, commonjs */
const { Client } = require('pg');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const prismaDbPassword = process.env.PRISMA_DB_PASSWORD;
// Use environment variables for postgres connection, fallback to defaults for local Supabase
const dbHost = process.env.POSTGRES_HOST || '127.0.0.1';
const dbPort = process.env.POSTGRES_PORT || 54322;
const dbUser = process.env.POSTGRES_USER || 'postgres';
const dbPassword = process.env.POSTGRES_PASSWORD || 'postgres';
const dbDatabase = process.env.POSTGRES_DB || 'postgres';

// SQL Commands
const createExtensionSql = `
-- Ensure the uuid-ossp extension is installed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
`;

const createUserSql = (password) => `
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'prisma') THEN
      CREATE USER "prisma" WITH PASSWORD '${password.replace(/'/g, "''")}' BYPASSRLS CREATEDB;
      RAISE NOTICE 'User "prisma" created.';
   ELSE
      RAISE NOTICE 'User "prisma" already exists, attempting to update password.';
      -- Update password if user exists, in case it changed in .env
      ALTER USER "prisma" WITH PASSWORD '${password.replace(/'/g, "''")}';
      RAISE NOTICE 'User "prisma" password updated.';
   END IF;
END
$$;
`;

const grantPrivilegesSql = `
-- Extend prisma's privileges to postgres (necessary to view changes in Dashboard)
GRANT "prisma" TO "postgres";

-- Grant necessary permissions over the public schema
GRANT USAGE ON SCHEMA public TO prisma;
GRANT CREATE ON SCHEMA public TO prisma;
GRANT ALL ON ALL TABLES IN SCHEMA public TO prisma;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO prisma;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO prisma;

-- Grant permissions to the extensions schema (needed for uuid-ossp)
GRANT USAGE ON SCHEMA extensions TO prisma;

-- Grant default privileges for future objects created by postgres user
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO prisma;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO prisma;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO prisma;

-- Grant default privileges for future objects created by the prisma user itself (optional but good practice)
-- Note: This might fail if the prisma user doesn't exist yet, run separately or ensure user exists first.
-- We run CREATE USER first, so this should be okay.
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT ALL ON TABLES TO prisma;
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT ALL ON ROUTINES TO prisma;
ALTER DEFAULT PRIVILEGES FOR ROLE prisma IN SCHEMA public GRANT ALL ON SEQUENCES TO prisma;
`;
// --- End Configuration ---

async function setupPrismaUser() {
  if (!prismaDbPassword) {
    console.error(
      'Error: PRISMA_DB_PASSWORD environment variable is not set in your .env file.'
    );
    process.exit(1);
  }

  const client = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
  });

  try {
    console.log(`Connecting to local database (${dbDatabase}) as superuser (${dbUser})...`);
    await client.connect();
    console.log('Connected.');

    console.log('Ensuring uuid-ossp extension is installed...');
    await client.query(createExtensionSql);
    console.log('Extension check complete.');

    console.log('Attempting to create/configure "prisma" user...');
    await client.query(createUserSql(prismaDbPassword));

    console.log('Granting privileges to "prisma" user...');
    await client.query(grantPrivilegesSql);
    console.log('Privileges granted.');

    console.log('"prisma" user setup complete.');
  } catch (err) {
    console.error('Error during prisma user setup:', err);
    process.exit(1);
  } finally {
    console.log('Disconnecting from database...');
    await client.end();
    console.log('Disconnected.');
  }
}

setupPrismaUser();