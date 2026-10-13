const pool = require('../config/db');

// Newest row = the patient's current medical history.
const SELECT_WITH_NAMES = `
  SELECT mh.*,
         rb.first_name AS recorded_by_first_name, rb.last_name AS recorded_by_last_name,
         vb.first_name AS reviewed_by_first_name, vb.last_name AS reviewed_by_last_name
  FROM "MedicalHistory" mh
  LEFT JOIN "User" rb ON rb.id = mh.recorded_by
  LEFT JOIN "User" vb ON vb.id = mh.reviewed_by
`;

const findLatestByPatient = (patient_id, callback) => {
  const query = `${SELECT_WITH_NAMES} WHERE mh.patient_id = $1 ORDER BY mh.created_at DESC LIMIT 1`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

const findAllByPatient = (patient_id, callback) => {
  const query = `${SELECT_WITH_NAMES} WHERE mh.patient_id = $1 ORDER BY mh.created_at DESC LIMIT 50`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// `data` must already be validated/sanitised by the controller.
const createMedicalHistory = (data, callback) => {
  const query = `
    INSERT INTO "MedicalHistory"
      (patient_id, conditions, condition_notes, medications,
       is_pregnant, pregnancy_weeks, is_breastfeeding,
       smoking_status, alcohol_use,
       anaesthetic_reaction, anaesthetic_reaction_notes,
       past_surgeries, other_conditions, notes,
       source, recorded_by, reviewed_by, reviewed_at)
    VALUES
      ($1, $2::jsonb, $3::jsonb, $4::jsonb,
       $5, $6, $7,
       $8, $9,
       $10, $11,
       $12, $13, $14,
       $15, $16, $17, $18)
    RETURNING *
  `;
  const values = [
    data.patient_id,
    JSON.stringify(data.conditions || []),
    JSON.stringify(data.condition_notes || {}),
    JSON.stringify(data.medications || []),
    !!data.is_pregnant,
    data.pregnancy_weeks == null ? null : data.pregnancy_weeks,
    !!data.is_breastfeeding,
    data.smoking_status || null,
    data.alcohol_use || null,
    !!data.anaesthetic_reaction,
    data.anaesthetic_reaction_notes || null,
    data.past_surgeries || null,
    data.other_conditions || null,
    data.notes || null,
    data.source || 'staff',
    data.recorded_by || null,
    data.reviewed_by || null,
    data.reviewed_at || null,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Allergies are free text on Patient; the alert engine needs them (latex etc).
const findPatientAllergies = (patient_id, callback) => {
  const query = `SELECT id, allergies FROM "Patient" WHERE id = $1 AND deleted_at IS NULL`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

module.exports = {
  findLatestByPatient, findAllByPatient, createMedicalHistory, findPatientAllergies,
};
