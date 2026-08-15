const pool = require('../config/db');

// Rows are auto-inserted by the trg_claim_status_history trigger on InsuranceClaim
// status changes. This model is read-only, plus an optional note attach.
const findHistoryByClaim = (claim_id, callback) => {
  const query = `
    SELECT * FROM "ClaimStatusHistory" WHERE claim_id = $1 ORDER BY changed_at DESC
  `;
  pool.query(query, [claim_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Attach a note/changed_by to the most recent auto-created history row
const annotateLatestHistoryEntry = (claim_id, changed_by, notes, callback) => {
  const query = `
    UPDATE "ClaimStatusHistory"
    SET changed_by = $1, notes = $2
    WHERE id = (
      SELECT id FROM "ClaimStatusHistory"
      WHERE claim_id = $3
      ORDER BY changed_at DESC
      LIMIT 1
    )
    RETURNING *
  `;
  pool.query(query, [changed_by, notes, claim_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { findHistoryByClaim, annotateLatestHistoryEntry };