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

// Powers the dentist overview: diagnoses this dentist logged within a date range.
// Query params expected as ISO timestamps, e.g. ?from=2026-08-17T00:00:00&to=2026-08-18T00:00:00
const findDiagnosesByDentist = (dentist_id, from, to, callback) => {
  const query = `
    SELECT * FROM "Diagnosis"
    WHERE dentist_id = $1 AND created_at >= $2 AND created_at < $3
    ORDER BY created_at DESC
  `;
  pool.query(query, [dentist_id, from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Cheap existence check used to flag "needs notes" on a single appointment,
// instead of pulling every diagnosis for a patient and scanning client-side.
const findDiagnosisByAppointment = (appointment_id, callback) => {
  const query = `SELECT * FROM "Diagnosis" WHERE appointment_id = $1 LIMIT 1`;
  pool.query(query, [appointment_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = {
  createDiagnosis,
  findDiagnosesByPatient,
  findDiagnosisById,
  findDiagnosesByDentist,
  findDiagnosisByAppointment,
};