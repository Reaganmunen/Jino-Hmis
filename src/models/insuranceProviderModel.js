const pool = require('../config/db');

const createInsuranceProvider = (data, callback) => {
  const { name, contact_phone, contact_email } = data;
  const query = `
    INSERT INTO "InsuranceProvider" (name, contact_phone, contact_email)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  pool.query(query, [name, contact_phone, contact_email], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const listInsuranceProviders = (callback) => {
  const query = `SELECT * FROM "InsuranceProvider" WHERE is_active = TRUE ORDER BY name`;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { createInsuranceProvider, listInsuranceProviders };