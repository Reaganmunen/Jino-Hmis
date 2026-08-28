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

// Powers "print today's prescription" — every prescription for this patient
// written on a single calendar date, with the prescribing dentist's name
// joined in so the PDF template doesn't need a lookup per row.
// `date` is a 'YYYY-MM-DD' string; the range covers Africa/Nairobi's day
// bounds in UTC terms since scheduled_start/created_at are stored as
// timestamptz — adjust the offset here if the DB column isn't UTC-based.
const findPrescriptionsByPatientOnDate = (patient_id, date, callback) => {
  const query = `
    SELECT rx.*, u.first_name AS dentist_first_name, u.last_name AS dentist_last_name
    FROM "Prescription" rx
    JOIN "User" u ON u.id = rx.dentist_id
    WHERE rx.patient_id = $1
      AND rx.created_at >= ($2::date AT TIME ZONE 'Africa/Nairobi')
      AND rx.created_at < (($2::date + 1) AT TIME ZONE 'Africa/Nairobi')
    ORDER BY rx.created_at
  `;
  pool.query(query, [patient_id, date], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = {
  createPrescription, findPrescriptionsByPatient, findPrescriptionsByDentist, findPrescriptionsByPatientOnDate,
};