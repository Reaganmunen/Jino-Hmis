const pool = require('../config/db');

// Rows are auto-inserted by the audit_log_change() trigger attached to
// ToothChart, Diagnosis, Prescription, Bill, and Payment (see schema.sql).
// This model is read-only.
const findAuditLogByRecord = (table_name, record_id, callback) => {
  const query = `
    SELECT * FROM "AuditLog"
    WHERE table_name = $1 AND record_id = $2
    ORDER BY changed_at DESC
  `;
  pool.query(query, [table_name, record_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findAuditLogByUser = (changed_by, callback) => {
  const query = `SELECT * FROM "AuditLog" WHERE changed_by = $1 ORDER BY changed_at DESC LIMIT 200`;
  pool.query(query, [changed_by], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { findAuditLogByRecord, findAuditLogByUser };