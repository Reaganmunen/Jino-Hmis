const pool = require('../config/db');

const createPrescription = (data, callback) => {
  const { patient_id, diagnosis_id, dentist_id, drug_name, dosage, frequency, duration, notes } = data;
  const query = `
    INSERT INTO "Prescription"
      (patient_id, diagnosis_id, dentist_id, drug_name, dosage, frequency, duration, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const values = [patient_id, diagnosis_id, dentist_id, drug_name, dosage, frequency, duration, notes];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findPrescriptionsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "Prescription" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Powers the dentist overview: prescriptions this dentist wrote within a date range.
const findPrescriptionsByDentist = (dentist_id, from, to, callback) => {
  const query = `
    SELECT * FROM "Prescription"
    WHERE dentist_id = $1 AND created_at >= $2 AND created_at < $3
    ORDER BY created_at DESC
  `;
  pool.query(query, [dentist_id, from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { createPrescription, findPrescriptionsByPatient, findPrescriptionsByDentist };