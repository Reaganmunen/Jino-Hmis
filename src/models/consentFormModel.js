const pool = require('../config/db');

const createConsentForm = (data, callback) => {
  const {
    patient_id, appointment_id, form_type, content_snapshot,
    consented, signed_by_name, signature_data, witnessed_by,
  } = data;
  const query = `
    INSERT INTO "ConsentForm"
      (patient_id, appointment_id, form_type, content_snapshot, consented, signed_by_name, signature_data, signed_at, witnessed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
    RETURNING *
  `;
  const values = [
    patient_id, appointment_id, form_type, content_snapshot,
    consented, signed_by_name, signature_data, witnessed_by,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findConsentFormsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "ConsentForm" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { createConsentForm, findConsentFormsByPatient };