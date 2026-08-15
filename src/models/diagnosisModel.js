const pool = require('../config/db');

const createDiagnosis = (data, callback) => {
  const { patient_id, appointment_id, dentist_id, tooth_refs, diagnosis_text } = data;
  const query = `
    INSERT INTO "Diagnosis" (patient_id, appointment_id, dentist_id, tooth_refs, diagnosis_text)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  pool.query(query, [patient_id, appointment_id, dentist_id, tooth_refs, diagnosis_text], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findDiagnosesByPatient = (patient_id, callback) => {
  const query = `
    SELECT * FROM "Diagnosis" WHERE patient_id = $1 ORDER BY created_at DESC
  `;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findDiagnosisById = (id, callback) => {
  const query = `SELECT * FROM "Diagnosis" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createDiagnosis, findDiagnosesByPatient, findDiagnosisById };