/**
 * DentaCare / Jino - database reset script
 *
 * Usage (from project root):
 *   node scripts/resetDb.js <mode> --yes [--schema path/to/schema.sql]
 *
 * Modes:
 *   truncate  Empty every table but keep the structure (fastest, safest)
 *   drop      Drop every table + enum type in the public schema
 *   nuke      Drop the whole public schema (tables, functions, triggers,
 *             types, views) and recreate it clean. Full factory reset.
 *
 * Examples:
 *   node scripts/resetDb.js truncate --yes
 *   node scripts/resetDb.js nuke --yes --schema ./database/schema.sql
 *
 * Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME from .env
 * (or DATABASE_URL if set). For Neon, also add DB_SSL=true.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const mode = args[0];
const confirmed = args.includes('--yes');
const schemaIdx = args.indexOf('--schema');
const schemaFile = schemaIdx !== -1 ? args[schemaIdx + 1] : null;

// Supports either DATABASE_URL or separate DB_* variables (DB_HOST, DB_PORT, ...)
const url = process.env.DATABASE_URL;
const useUrl = Boolean(url);

if (!['truncate', 'drop', 'nuke'].includes(mode)) {
  console.error('Usage: node scripts/resetDb.js <truncate|drop|nuke> --yes [--schema file.sql]');
  process.exit(1);
}
if (!useUrl && !(process.env.DB_HOST && process.env.DB_NAME)) {
  console.error('Set DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in your .env file.');
  process.exit(1);
}

const host = useUrl ? new URL(url).host : `${process.env.DB_HOST}:${process.env.DB_PORT || 5432}`;
const dbName = useUrl ? new URL(url).pathname.slice(1) : process.env.DB_NAME;

// Neon requires SSL; local Postgres usually doesn't.
const needsSsl =
  process.env.DB_SSL === 'true' ||
  /sslmode=require|neon\.tech/.test(url || '') ||
  /neon\.tech/.test(process.env.DB_HOST || '');
const ssl = needsSsl ? { rejectUnauthorized: false } : false;

const pool = new Pool(
  useUrl
    ? { connectionString: url, ssl }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl,
      }
);

const SQL = {
  // Keeps tables, deletes all rows, resets identity counters.
  // CASCADE handles foreign-key order for us.
  truncate: `
    DO $$
    DECLARE tbls text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tbls
        FROM pg_tables
       WHERE schemaname = 'public';
      IF tbls IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tbls || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `,

  // Drops every table (triggers and indexes go with them), then enum types.
  drop: `
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;

      FOR r IN
        SELECT t.typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e'
      LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
      END LOOP;
    END $$;
  `,

  // Wipes everything in the schema, including functions used by triggers.
  nuke: `
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  `,
};

(async () => {
  console.log(`Target database: ${dbName} on ${host}${needsSsl ? ' (SSL)' : ''}`);
  console.log(`Mode: ${mode}`);

  if (!confirmed) {
    console.error('\nThis is destructive. Re-run with --yes to confirm.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query(SQL[mode]);
    console.log(`Reset (${mode}) complete.`);

    if (schemaFile) {
      const full = path.resolve(schemaFile);
      console.log(`Applying schema: ${full}`);
      await client.query(fs.readFileSync(full, 'utf8'));
      console.log('Schema applied.');
    }

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`
    );
    console.log(`Tables now in public schema: ${rows[0].n}`);
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();