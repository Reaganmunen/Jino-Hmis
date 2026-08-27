/**
 * seed.js
 *
 * Creates the initial staff accounts for Reene Dental:
 *   - Dan Ochieng   -> dentist account (dan@reenedental.com)
 *   - Dan Ochieng   -> admin account   (admin@reenedental.com)
 *   - Jacinta Kinyaa -> receptionist account (jacinta@reenedental.com)
 *
 * Also sets the dentist's availability to Monday-Sunday, 8:00 AM - 7:00 PM
 * (day_of_week: 0 = Sunday ... 6 = Saturday, matching the existing
 * DentistSchedule rows in the DB dump).
 *
 * Safe to re-run: users are upserted on email, and the dentist's schedule
 * rows are replaced fresh each run (no duplicate schedule rows).
 *
 * Usage:
 *   node seed.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

const SALT_ROUNDS = 10;
const PASSWORD = 'Password@2026';

const STAFF = [
  {
    role: 'dentist',
    first_name: 'Dan',
    last_name: 'Ochieng',
    email: 'dan@reenedental.com',
    phone: null,
  },
  {
    role: 'admin',
    first_name: 'Dan',
    last_name: 'Ochieng',
    email: 'admin@reenedental.com',
    phone: null,
  },
  {
    role: 'receptionist',
    first_name: 'Jacinta',
    last_name: 'Kinyaa',
    email: 'jacinta@reenedental.com',
    phone: null,
  },
];

// Upserts a user by email and returns their id.
// On conflict, refreshes the password hash and role/name too, so re-running
// this script always leaves you with a known-good login.
const upsertUser = async (client, { role, first_name, last_name, email, phone }) => {
  const password_hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  const { rows } = await client.query(
    `INSERT INTO "User" (role, first_name, last_name, email, phone, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash,
           is_active = true,
           updated_at = now()
     RETURNING id, role, email`,
    [role, first_name, last_name, email, phone, password_hash]
  );

  return rows[0];
};

// Replaces the dentist's weekly availability with Mon-Sun, 8:00-19:00.
const setFullWeekAvailability = async (client, dentistId) => {
  await client.query('DELETE FROM "DentistSchedule" WHERE dentist_id = $1', [dentistId]);

  const insertPromises = [];
  for (let day = 0; day <= 6; day += 1) {
    insertPromises.push(
      client.query(
        `INSERT INTO "DentistSchedule" (dentist_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1, $2, $3, $4, true)`,
        [dentistId, day, '08:00:00', '19:00:00']
      )
    );
  }
  await Promise.all(insertPromises);
};

const run = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Seeding staff accounts...');
    const createdUsers = {};

    for (const staff of STAFF) {
      const user = await upsertUser(client, staff);
      createdUsers[staff.role + ':' + staff.email] = user;
      console.log(`  - ${staff.role.padEnd(13)} ${user.email} (${user.id})`);
    }

    const dentist = createdUsers['dentist:dan@reenedental.com'];
    console.log(`\nSetting full-week availability for dentist ${dentist.email}...`);
    await setFullWeekAvailability(client, dentist.id);
    console.log('  - Monday-Sunday, 08:00-19:00 set.');

    await client.query('COMMIT');
    console.log('\nSeed complete. Login password for all accounts: Password@2026');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

run();