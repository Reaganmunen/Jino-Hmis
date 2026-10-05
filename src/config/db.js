const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

// Settings that keep the pool healthy when Neon suspends compute and drops idle connections.
const poolOptions = {
  max: 10,
  idleTimeoutMillis: 10000,       // close idle clients before Neon does
  connectionTimeoutMillis: 15000, // allow time for Neon to wake from suspend
  keepAlive: true,
};

const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
      ...poolOptions,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5433,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'Dental',
      ...poolOptions,
    });

// An idle client can be dropped by the server (Neon suspend, restart). pg discards that
// client and opens a new one on the next query, so log it instead of killing the app.
pool.on('error', (err) => {
  console.error('Idle PostgreSQL client error (ignored):', err.message);
});

module.exports = pool;