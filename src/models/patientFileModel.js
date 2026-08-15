const pool = require('../config/db');

const addPatientFile = (data, callback) => {
  const { patient_id, appointment_id, file_type, file_url, description, uploaded_by } = data;
  const query = `
    INSERT INTO "PatientFile" (patient_id, appointment_id, file_type, file_url, description, uploaded_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const values = [patient_id, appointment_id, file_type, file_url, description, uploaded_by];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findFilesByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "PatientFile" WHERE patient_id = $1 ORDER BY uploaded_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const deletePatientFile = (id, callback) => {
  const query = `DELETE FROM "PatientFile" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = { addPatientFile, findFilesByPatient, deletePatientFile };