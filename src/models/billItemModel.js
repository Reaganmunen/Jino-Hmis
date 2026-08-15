const pool = require('../config/db');

// Inserting/updating/deleting rows here auto-recalculates the parent Bill.total_amount
// via the trg_billitem_recalc trigger — no manual total math needed.
const addBillItem = (data, callback) => {
  const { bill_id, service_id, description, quantity, unit_price } = data;
  const query = `
    INSERT INTO "BillItem" (bill_id, service_id, description, quantity, unit_price)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  pool.query(query, [bill_id, service_id, description, quantity, unit_price], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findItemsByBill = (bill_id, callback) => {
  const query = `SELECT * FROM "BillItem" WHERE bill_id = $1`;
  pool.query(query, [bill_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const removeBillItem = (id, callback) => {
  const query = `DELETE FROM "BillItem" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = { addBillItem, findItemsByBill, removeBillItem };