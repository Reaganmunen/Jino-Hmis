const pool = require('../config/db');

// Note: recording usage does NOT auto-decrement InventoryItem.quantity.
// Call inventoryItemModel.adjustQuantity(item_id, -quantity_used, ...) alongside this
// in the controller, ideally within a pool client transaction (BEGIN/COMMIT).
const recordInventoryUsage = (data, callback) => {
  const { inventory_item_id, appointment_id, quantity_used, recorded_by } = data;
  const query = `
    INSERT INTO "InventoryUsage" (inventory_item_id, appointment_id, quantity_used, recorded_by)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  pool.query(query, [inventory_item_id, appointment_id, quantity_used, recorded_by], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findUsageByAppointment = (appointment_id, callback) => {
  const query = `SELECT * FROM "InventoryUsage" WHERE appointment_id = $1`;
  pool.query(query, [appointment_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findUsageByItem = (inventory_item_id, callback) => {
  const query = `
    SELECT * FROM "InventoryUsage" WHERE inventory_item_id = $1 ORDER BY recorded_at DESC
  `;
  pool.query(query, [inventory_item_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { recordInventoryUsage, findUsageByAppointment, findUsageByItem };