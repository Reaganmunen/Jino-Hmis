const pool = require('../config/db');

const addTreatmentPlanItem = (data, callback) => {
  const { treatment_plan_id, procedure_name, tooth_number, estimated_cost, sequence_order } = data;
  const query = `
    INSERT INTO "TreatmentPlanItem"
      (treatment_plan_id, procedure_name, tooth_number, estimated_cost, sequence_order)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const values = [treatment_plan_id, procedure_name, tooth_number, estimated_cost, sequence_order];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findItemsByPlan = (treatment_plan_id, callback) => {
  const query = `
    SELECT * FROM "TreatmentPlanItem"
    WHERE treatment_plan_id = $1
    ORDER BY sequence_order
  `;
  pool.query(query, [treatment_plan_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Needed to resolve an item's parent plan (and therefore its owning patient)
// before allowing a status change — TreatmentPlanItem has no patient_id of
// its own to check against.
const findTreatmentPlanItemById = (id, callback) => {
  const query = `SELECT * FROM "TreatmentPlanItem" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const updateItemStatus = (id, status, completed_appointment_id, callback) => {
  const query = `
    UPDATE "TreatmentPlanItem"
    SET status = $1, completed_appointment_id = $2
    WHERE id = $3
    RETURNING *
  `;
  pool.query(query, [status, completed_appointment_id, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = {
  addTreatmentPlanItem, findItemsByPlan, findTreatmentPlanItemById, updateItemStatus,
};