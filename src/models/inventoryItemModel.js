const pool = require('../config/db');

const createInventoryItem = (data, callback) => {
  const { name, category, quantity, unit, reorder_level, unit_cost, supplier } = data;
  const query = `
    INSERT INTO "InventoryItem" (name, category, quantity, unit, reorder_level, unit_cost, supplier)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const values = [name, category, quantity, unit, reorder_level, unit_cost, supplier];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findInventoryItemById = (id, callback) => {
  const query = `SELECT * FROM "InventoryItem" WHERE id = $1 AND is_active = TRUE`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const listInventoryItems = (callback) => {
  const query = `SELECT * FROM "InventoryItem" WHERE is_active = TRUE ORDER BY name`;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findLowStockItems = (callback) => {
  const query = `
    SELECT * FROM "InventoryItem"
    WHERE is_active = TRUE AND quantity <= reorder_level
    ORDER BY quantity ASC
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateInventoryItem = (id, data, callback) => {
  const { name, category, quantity, unit, reorder_level, unit_cost, supplier } = data;
  const query = `
    UPDATE "InventoryItem"
    SET name = $1, category = $2, quantity = $3, unit = $4, reorder_level = $5, unit_cost = $6, supplier = $7
    WHERE id = $8
    RETURNING *
  `;
  const values = [name, category, quantity, unit, reorder_level, unit_cost, supplier, id];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const adjustQuantity = (id, delta, callback) => {
  const query = `
    UPDATE "InventoryItem" SET quantity = quantity + $1 WHERE id = $2
    RETURNING *
  `;
  pool.query(query, [delta, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = {
  createInventoryItem,
  findInventoryItemById,
  listInventoryItems,
  findLowStockItems,
  updateInventoryItem,
  adjustQuantity,
};