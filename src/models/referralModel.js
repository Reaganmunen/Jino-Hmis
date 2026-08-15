const pool = require('../config/db');

const createReferral = (data, callback) => {
  const { patient_id, referring_dentist_id, referred_to_name, referred_to_facility, specialty, reason } = data;
  const query = `
    INSERT INTO "Referral"
      (patient_id, referring_dentist_id, referred_to_name, referred_to_facility, specialty, reason)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const values = [patient_id, referring_dentist_id, referred_to_name, referred_to_facility, specialty, reason];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findReferralsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "Referral" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateReferralStatus = (id, status, callback) => {
  const query = `UPDATE "Referral" SET status = $1 WHERE id = $2 RETURNING *`;
  pool.query(query, [status, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createReferral, findReferralsByPatient, updateReferralStatus };