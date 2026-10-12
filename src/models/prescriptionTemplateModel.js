const pool = require('../config/db');

const COLUMNS = 'id, name, drug_name, dosage, frequency, duration, notes, created_at';

// A dentist only ever sees their own templates.
const findTemplatesByDentist = (dentist_id, callback) => {
  const query = `
    SELECT ${COLUMNS} FROM "PrescriptionTemplate"
    WHERE dentist_id = $1
    ORDER BY lower(name)
  `;
  pool.query(query, [dentist_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const createTemplate = (data, callback) => {
  const { dentist_id, name, drug_name, dosage, frequency, duration, notes } = data;
  const query = `
    INSERT INTO "PrescriptionTemplate" (dentist_id, name, drug_name, dosage, frequency, duration, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING ${COLUMNS}
  `;
  pool.query(query, [dentist_id, name, drug_name, dosage, frequency, duration, notes || null], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Scoped by dentist_id so one dentist can never delete another's template.
const deleteTemplate = (id, dentist_id, callback) => {
  const query = `DELETE FROM "PrescriptionTemplate" WHERE id = $1 AND dentist_id = $2`;
  pool.query(query, [id, dentist_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = { findTemplatesByDentist, createTemplate, deleteTemplate };
