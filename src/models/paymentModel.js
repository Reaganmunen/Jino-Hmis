const pool = require('../config/db');

// Inserting here auto-updates Bill.amount_paid and Bill.status via trg_payment_recalc.
const recordPayment = (data, callback) => {
  const { bill_id, amount, method, reference, received_by } = data;
  const query = `
    INSERT INTO "Payment" (bill_id, amount, method, reference, received_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  pool.query(query, [bill_id, amount, method, reference, received_by], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findPaymentsByBill = (bill_id, callback) => {
  const query = `SELECT * FROM "Payment" WHERE bill_id = $1 ORDER BY paid_at DESC`;
  pool.query(query, [bill_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { recordPayment, findPaymentsByBill };