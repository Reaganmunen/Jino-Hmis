const pool = require('../config/db');

// Every insert/status update here auto-logs a row into ClaimStatusHistory
// via trg_claim_status_history — no manual history tracking needed.
const createInsuranceClaim = (data, callback) => {
  const { patient_id, bill_id, insurance_provider_id, policy_number, claim_amount } = data;
  const query = `
    INSERT INTO "InsuranceClaim"
      (patient_id, bill_id, insurance_provider_id, policy_number, claim_amount)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const values = [patient_id, bill_id, insurance_provider_id, policy_number, claim_amount];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findClaimById = (id, callback) => {
  const query = `SELECT * FROM "InsuranceClaim" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findClaimsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "InsuranceClaim" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateClaimStatus = (id, status, approved_amount, callback) => {
  const submittedAtClause = status === 'submitted' ? ', submitted_at = now()' : '';
  const query = `
    UPDATE "InsuranceClaim"
    SET status = $1, approved_amount = $2 ${submittedAtClause}
    WHERE id = $3
    RETURNING *
  `;
  pool.query(query, [status, approved_amount, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createInsuranceClaim, findClaimById, findClaimsByPatient, updateClaimStatus };