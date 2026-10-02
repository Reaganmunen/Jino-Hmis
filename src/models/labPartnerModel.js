const pool = require('../config/db');

const createLabPartner = (data, callback) => {
  const { name, contact_person, phone, email, address, turnaround_days, notes } = data;
  const query = `
    INSERT INTO "LabPartner" (name, contact_person, phone, email, address, turnaround_days, notes)
    VALUES ($1, $2, $3, $4, $5, COALESCE($6, 7), $7)
    RETURNING *
  `;
  const values = [name, contact_person, phone, email, address, turnaround_days, notes];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// activeOnly = true for dropdowns; false for the management list
const listLabPartners = (activeOnly, callback) => {
  const query = `
    SELECT * FROM "LabPartner"
    ${activeOnly ? 'WHERE is_active = TRUE' : ''}
    ORDER BY name
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findLabPartnerById = (id, callback) => {
  pool.query(`SELECT * FROM "LabPartner" WHERE id = $1`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const updateLabPartner = (id, data, callback) => {
  const { name, contact_person, phone, email, address, turnaround_days, notes, is_active } = data;
  const query = `
    UPDATE "LabPartner"
    SET name = $1, contact_person = $2, phone = $3, email = $4, address = $5,
        turnaround_days = COALESCE($6, turnaround_days), notes = $7,
        is_active = COALESCE($8, is_active)
    WHERE id = $9
    RETURNING *
  `;
  const values = [name, contact_person, phone, email, address, turnaround_days, notes, is_active, id];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = { createLabPartner, listLabPartners, findLabPartnerById, updateLabPartner };