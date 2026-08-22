const pool = require('../config/db');

const createPatient = (data, callback) => {
  const {
    user_id, first_name, last_name, date_of_birth, national_id,
    phone, email, address, next_of_kin_name, next_of_kin_phone, allergies,
  } = data;
  const query = `
    INSERT INTO "Patient"
      (user_id, first_name, last_name, date_of_birth, national_id, phone, email, address, next_of_kin_name, next_of_kin_phone, allergies)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;
  const values = [
    user_id, first_name, last_name, date_of_birth, national_id,
    phone, email, address, next_of_kin_name, next_of_kin_phone, allergies,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findPatientById = (id, callback) => {
  const query = `
    SELECT p.*, u.profile_picture_url
    FROM "Patient" p
    LEFT JOIN "User" u ON u.id = p.user_id
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findPatientByUserId = (user_id, callback) => {
  const query = `
    SELECT p.*, u.profile_picture_url
    FROM "Patient" p
    LEFT JOIN "User" u ON u.id = p.user_id
    WHERE p.user_id = $1 AND p.deleted_at IS NULL
  `;
  pool.query(query, [user_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const searchPatients = (searchTerm, callback) => {
  const query = `
    SELECT p.*, u.profile_picture_url
    FROM "Patient" p
    LEFT JOIN "User" u ON u.id = p.user_id
    WHERE p.deleted_at IS NULL
      AND (p.first_name ILIKE $1 OR p.last_name ILIKE $1 OR p.national_id ILIKE $1 OR p.phone ILIKE $1)
    ORDER BY p.first_name
    LIMIT 50
  `;
  pool.query(query, [`%${searchTerm}%`], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const listPatients = (callback) => {
  const query = `
    SELECT p.*, u.profile_picture_url
    FROM "Patient" p
    LEFT JOIN "User" u ON u.id = p.user_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updatePatient = (id, data, callback) => {
  const {
    first_name, last_name, date_of_birth, national_id,
    phone, email, address, next_of_kin_name, next_of_kin_phone, allergies,
  } = data;
  const query = `
    UPDATE "Patient"
    SET first_name = $1, last_name = $2, date_of_birth = $3, national_id = $4,
        phone = $5, email = $6, address = $7, next_of_kin_name = $8, next_of_kin_phone = $9, allergies = $10
    WHERE id = $11 AND deleted_at IS NULL
    RETURNING *
  `;
  const values = [
    first_name, last_name, date_of_birth, national_id,
    phone, email, address, next_of_kin_name, next_of_kin_phone, allergies, id,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const softDeletePatient = (id, callback) => {
  const query = `UPDATE "Patient" SET deleted_at = now(), is_active = FALSE WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = {
  createPatient,
  findPatientById,
  findPatientByUserId,
  searchPatients,
  listPatients,
  updatePatient,
  softDeletePatient,
};