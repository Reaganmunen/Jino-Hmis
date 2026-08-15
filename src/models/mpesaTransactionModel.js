const pool = require('../config/db');

// Called right after STK push initiation
const createMpesaTransaction = (data, callback) => {
  const { bill_id, phone, amount, checkout_request_id, merchant_request_id } = data;
  const query = `
    INSERT INTO "MpesaTransaction"
      (bill_id, phone, amount, checkout_request_id, merchant_request_id, status)
    VALUES ($1, $2, $3, $4, $5, 'pending')
    RETURNING *
  `;
  const values = [bill_id, phone, amount, checkout_request_id, merchant_request_id];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findByCheckoutRequestId = (checkout_request_id, callback) => {
  const query = `SELECT * FROM "MpesaTransaction" WHERE checkout_request_id = $1`;
  pool.query(query, [checkout_request_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Called from the Daraja callback endpoint once Safaricom confirms/rejects
const updateMpesaTransactionResult = (checkout_request_id, data, callback) => {
  const { status, mpesa_receipt, result_desc, raw_callback } = data;
  const query = `
    UPDATE "MpesaTransaction"
    SET status = $1, mpesa_receipt = $2, result_desc = $3, raw_callback = $4
    WHERE checkout_request_id = $5
    RETURNING *
  `;
  const values = [status, mpesa_receipt, result_desc, raw_callback, checkout_request_id];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findTransactionsByBill = (bill_id, callback) => {
  const query = `SELECT * FROM "MpesaTransaction" WHERE bill_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [bill_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = {
  createMpesaTransaction,
  findByCheckoutRequestId,
  updateMpesaTransactionResult,
  findTransactionsByBill,
};