const pool = require('../config/db');

// total_amount, amount_paid, and status are trigger-maintained (see schema.sql) —
// never set them directly from application code.
const createBill = (data, callback) => {
  const { patient_id, appointment_id, created_by } = data;
  const query = `
    INSERT INTO "Bill" (patient_id, appointment_id, created_by)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  pool.query(query, [patient_id, appointment_id, created_by], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findBillById = (id, callback) => {
  const query = `SELECT * FROM "Bill" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findBillsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "Bill" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findBillsByStatus = (status, callback) => {
  const query = `SELECT * FROM "Bill" WHERE status = $1 ORDER BY created_at DESC`;
  pool.query(query, [status], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const voidBill = (id, callback) => {
  const query = `UPDATE "Bill" SET status = 'void' WHERE id = $1 RETURNING *`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createBill, findBillById, findBillsByPatient, findBillsByStatus, voidBill };