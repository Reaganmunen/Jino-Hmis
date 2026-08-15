const pool = require('../config/db');

const createTreatmentPlan = (data, callback) => {
  const { patient_id, diagnosis_id, dentist_id, description, estimated_cost } = data;
  const query = `
    INSERT INTO "TreatmentPlan" (patient_id, diagnosis_id, dentist_id, description, estimated_cost)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  pool.query(query, [patient_id, diagnosis_id, dentist_id, description, estimated_cost], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findTreatmentPlanById = (id, callback) => {
  const query = `SELECT * FROM "TreatmentPlan" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findTreatmentPlansByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "TreatmentPlan" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateTreatmentPlanStatus = (id, status, callback) => {
  const approvedAtClause = status === 'approved' ? ', approved_at = now()' : '';
  const query = `
    UPDATE "TreatmentPlan" SET status = $1 ${approvedAtClause}
    WHERE id = $2
    RETURNING *
  `;
  pool.query(query, [status, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = {
  createTreatmentPlan,
  findTreatmentPlanById,
  findTreatmentPlansByPatient,
  updateTreatmentPlanStatus,
};