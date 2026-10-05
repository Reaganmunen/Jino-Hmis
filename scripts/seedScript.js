/**
 * Seed script: IMARA GSMM DENTAL SOLUTION
 * ---------------------------------------
 * Creates the clinic's first three staff accounts in the "User" table:
 *   - Admin         : Olgah Mugah
 *   - Dentist       : George Moses
 *   - Receptionist  : Lauzia Karembo
 *
 * Usage (from your backend folder, where node_modules + .env live):
 *   npm install pg bcryptjs dotenv      # skip whatever you already have
 *   node seed-imara-clinic.js
 *
 * Connection: reads DATABASE_URL from .env (use your Neon URL).
 * If DATABASE_URL is absent it falls back to DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
 * (or the standard PG* variables).
 *
 * Safe to re-run: accounts that already exist (matched by email) are skipped.
 */

require('dotenv').config();
const { Pool } = require('pg');

// Use whichever bcrypt flavour your project already has. Both produce
// compatible hashes ($2a/$2b$...), so your login code can verify either.
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch (_) { bcrypt = require('bcrypt'); }

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const CLINIC_NAME = 'IMARA GSMM DENTAL SOLUTION';
const EMAIL_DOMAIN = '';
const PASSWORD = '';
const SALT_ROUNDS = 10; // change if your register endpoint uses a different cost

// Also give the dentist a Mon-Fri 08:00-17:00 working schedule so the patient
// booking wizard can offer slots. Set to false if you'd rather add it in the UI.
const SEED_DENTIST_SCHEDULE = false;

const STAFF = [
  { role: '',        first_name: '',  last_name: '',   email: `` },
  { role: '',      first_name: '', last_name: '',   email: `` },
  { role: '', first_name: '', last_name: '', email: `` },
];

// ----------------------------------------------------------------------------
// Connection
// ----------------------------------------------------------------------------
function buildPool() {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    const needsSsl = /neon\.tech|sslmode=require/i.test(url);
    return new Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return new Pool({
    host:     process.env.DB_HOST     || process.env.PGHOST     || 'localhost',
    port:     Number(process.env.DB_PORT || process.env.PGPORT  || 5432),
    database: process.env.DB_NAME     || process.env.PGDATABASE || 'Dental',
    user:     process.env.DB_USER     || process.env.PGUSER     || 'postgres',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
  });
}

// ----------------------------------------------------------------------------
// Seed
// ----------------------------------------------------------------------------
async function seed() {
  const pool = buildPool();
  const client = await pool.connect();

  try {
    // One hash is enough: bcrypt embeds a random salt in each hash, and
    // reusing the hash for the same password is perfectly valid.
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    await client.query('BEGIN');
    console.log(`\nSeeding accounts for ${CLINIC_NAME}\n`);

    const created = [];

    for (const person of STAFF) {
      const { rows } = await client.query(
        `INSERT INTO "User" (role, first_name, last_name, email, password_hash, is_active)
         VALUES ($1::user_role, $2, $3, $4, $5, true)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [person.role, person.first_name, person.last_name, person.email, passwordHash]
      );

      if (rows.length === 0) {
        console.log(`  - skipped  ${person.role.padEnd(12)} ${person.email} (already exists)`);
        continue;
      }

      created.push({ ...person, id: rows[0].id });
      console.log(`  + created  ${person.role.padEnd(12)} ${person.email}`);
    }

    if (SEED_DENTIST_SCHEDULE) {
      const dentist = created.find((p) => p.role === 'dentist');
      if (dentist) {
        // day_of_week: 0 = Sunday ... 6 = Saturday (per the table's CHECK 0..6)
        for (let day = 1; day <= 5; day++) {
          await client.query(
            `INSERT INTO "DentistSchedule" (dentist_id, day_of_week, start_time, end_time, is_active)
             VALUES ($1, $2, '08:00', '17:00', true)`,
            [dentist.id, day]
          );
        }
        console.log('  + created  dentist schedule (Mon-Fri, 08:00-17:00)');
      }
    }

    await client.query('COMMIT');

    console.log('\nDone. Login with the emails above and the password you set in PASSWORD.');
    console.log('Change these passwords after first login.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nSeeding failed, nothing was saved:\n', err.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();