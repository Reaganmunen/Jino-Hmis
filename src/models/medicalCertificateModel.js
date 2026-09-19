const pool = require('../config/db');

// Creates a certificate and returns it with patient/dentist names already
// joined in, so the controller can hand it straight to the PDF template
// without a second round-trip query.
const createCertificate = (data, callback) => {
  const { patient_id, dentist_id, appointment_id, visit_date, diagnosis_summary, rest_from, rest_to, notes } = data;
  const query = `
    WITH inserted AS (
      INSERT INTO "MedicalCertificate"
        (patient_id, dentist_id, appointment_id, visit_date, diagnosis_summary, rest_from, rest_to, notes)
      VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, $8)
      RETURNING *
    )
    SELECT inserted.*,
           p.first_name AS patient_first_name, p.last_name AS patient_last_name,
           u.first_name AS dentist_first_name, u.last_name AS dentist_last_name
    FROM inserted
    JOIN "Patient" p ON p.id = inserted.patient_id
    JOIN "User" u ON u.id = inserted.dentist_id
  `;
  const values = [patient_id, dentist_id, appointment_id || null, visit_date || null, diagnosis_summary, rest_from, rest_to, notes || null];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findCertificatesByPatient = (patientId, callback) => {
  const query = `
    SELECT mc.*, u.first_name AS dentist_first_name, u.last_name AS dentist_last_name
    FROM "MedicalCertificate" mc
    JOIN "User" u ON u.id = mc.dentist_id
    WHERE mc.patient_id = $1 AND mc.deleted_at IS NULL
    ORDER BY mc.visit_date DESC, mc.created_at DESC
  `;
  pool.query(query, [patientId], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findCertificateById = (id, callback) => {
  const query = `
    SELECT mc.*,
           p.first_name AS patient_first_name, p.last_name AS patient_last_name,
           u.first_name AS dentist_first_name, u.last_name AS dentist_last_name
    FROM "MedicalCertificate" mc
    JOIN "Patient" p ON p.id = mc.patient_id
    JOIN "User" u ON u.id = mc.dentist_id
    WHERE mc.id = $1 AND mc.deleted_at IS NULL
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const softDeleteCertificate = (id, callback) => {
  const query = `UPDATE "MedicalCertificate" SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = {
  createCertificate,
  findCertificatesByPatient,
  findCertificateById,
  softDeleteCertificate,
};