const pool = require('../config/db');

const createService = (data, callback) => {
  const { name, description, price } = data;
  const query = `
    INSERT INTO "Service" (name, description, price)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  pool.query(query, [name, description, price], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const listServices = (callback) => {
  const query = `SELECT * FROM "Service" WHERE is_active = TRUE ORDER BY name`;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findServiceById = (id, callback) => {
  const query = `SELECT * FROM "Service" WHERE id = $1 AND is_active = TRUE`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const updateService = (id, data, callback) => {
  const { name, description, price, is_active } = data;
  const query = `
    UPDATE "Service" SET name = $1, description = $2, price = $3, is_active = $4
    WHERE id = $5
    RETURNING *
  `;
  pool.query(query, [name, description, price, is_active, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createService, listServices, findServiceById, updateService };