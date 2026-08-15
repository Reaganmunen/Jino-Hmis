const pool = require('../config/db');

const createUser = (data, callback) => {
  const { role, first_name, last_name, email, phone, password_hash } = data;
  const query = `
    INSERT INTO "User" (role, first_name, last_name, email, phone, password_hash)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, role, first_name, last_name, email, phone, is_active, created_at
  `;
  const values = [role, first_name, last_name, email, phone, password_hash];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findUserByEmail = (email, callback) => {
  const query = `SELECT * FROM "User" WHERE email = $1 AND deleted_at IS NULL`;
  pool.query(query, [email], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findUserById = (id, callback) => {
  const query = `
    SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.created_at,
           p.id AS patient_id
    FROM "User" u
    LEFT JOIN "Patient" p ON p.user_id = u.id AND p.deleted_at IS NULL
    WHERE u.id = $1 AND u.deleted_at IS NULL
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findUsersByRole = (role, callback) => {
  const query = `
    SELECT id, role, first_name, last_name, email, phone, is_active
    FROM "User" WHERE role = $1 AND deleted_at IS NULL
    ORDER BY first_name
  `;
  pool.query(query, [role], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateUser = (id, data, callback) => {
  const { first_name, last_name, phone, is_active } = data;
  const query = `
    UPDATE "User"
    SET first_name = $1, last_name = $2, phone = $3, is_active = $4
    WHERE id = $5 AND deleted_at IS NULL
    RETURNING id, role, first_name, last_name, email, phone, is_active
  `;
  const values = [first_name, last_name, phone, is_active, id];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const updatePassword = (id, password_hash, callback) => {
  const query = `UPDATE "User" SET password_hash = $1 WHERE id = $2`;
  pool.query(query, [password_hash, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

const softDeleteUser = (id, callback) => {
  const query = `UPDATE "User" SET deleted_at = now(), is_active = FALSE WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  findUsersByRole,
  updateUser,
  updatePassword,
  softDeleteUser,
};