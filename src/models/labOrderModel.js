const pool = require('../config/db');

// "Today" in the clinic's timezone — the DB server runs in UTC on Render, and
// CURRENT_DATE would roll over 3 hours late for Kenya.
const TODAY_KE = `(now() AT TIME ZONE 'Africa/Nairobi')::date`;

// Shared SELECT: an order plus the names the UI needs, and an is_overdue flag
// (only meaningful while the work is physically at the lab).
const ORDER_SELECT = `
  SELECT o.*,
         to_char(o.due_date, 'YYYY-MM-DD') AS due_date, -- plain string: avoids JS Date timezone shifts on a date column
         (p.first_name || ' ' || p.last_name) AS patient_name,
         (u.first_name || ' ' || u.last_name) AS dentist_name,
         l.name AS lab_name,
         l.phone AS lab_phone,
         (o.due_date IS NOT NULL AND o.due_date < ${TODAY_KE}
            AND o.status IN ('sent', 'adjustment')) AS is_overdue
  FROM "LabOrder" o
  JOIN "Patient" p ON p.id = o.patient_id
  JOIN "User" u ON u.id = o.dentist_id
  LEFT JOIN "LabPartner" l ON l.id = o.lab_partner_id
`;

const rows = (callback) => (err, result) => {
  if (err) return callback(err);
  callback(null, result.rows);
};

const findLabOrderById = (id, callback) => {
  pool.query(`${ORDER_SELECT} WHERE o.id = $1`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Creates the order and its first history row in a single statement,
// so there is never an order without a status trail.
const createLabOrder = (data, callback) => {
  const {
    patient_id, dentist_id, lab_partner_id, appointment_id, treatment_plan_item_id,
    work_type, tooth_numbers, shade, material, instructions, due_date,
    lab_cost, patient_charge, notes,
  } = data;

  const query = `
    WITH ins AS (
      INSERT INTO "LabOrder"
        (patient_id, dentist_id, lab_partner_id, appointment_id, treatment_plan_item_id,
         work_type, tooth_numbers, shade, material, instructions, due_date,
         lab_cost, patient_charge, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 0), COALESCE($13, 0), $14)
      RETURNING id, status
    ), hist AS (
      INSERT INTO "LabOrderStatusHistory" (lab_order_id, status, changed_by)
      SELECT id, status, $2 FROM ins
    )
    SELECT id FROM ins
  `;
  const values = [
    patient_id, dentist_id, lab_partner_id || null, appointment_id || null, treatment_plan_item_id || null,
    work_type, tooth_numbers && tooth_numbers.length ? tooth_numbers : null,
    shade || null, material || null, instructions || null, due_date || null,
    lab_cost, patient_charge, notes || null,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    findLabOrderById(result.rows[0].id, callback);
  });
};

// Full replace of the editable fields (controller merges the request over the
// existing row first, same approach as updatePatient).
const updateLabOrder = (id, data, callback) => {
  const {
    lab_partner_id, appointment_id, treatment_plan_item_id, work_type, tooth_numbers,
    shade, material, instructions, due_date, lab_cost, lab_paid, patient_charge, notes,
  } = data;
  const query = `
    UPDATE "LabOrder"
    SET lab_partner_id = $1, appointment_id = $2, treatment_plan_item_id = $3, work_type = $4,
        tooth_numbers = $5, shade = $6, material = $7, instructions = $8, due_date = $9,
        lab_cost = $10, lab_paid = $11, patient_charge = $12, notes = $13
    WHERE id = $14
    RETURNING id
  `;
  const values = [
    lab_partner_id || null, appointment_id || null, treatment_plan_item_id || null, work_type,
    tooth_numbers && tooth_numbers.length ? tooth_numbers : null,
    shade || null, material || null, instructions || null, due_date || null,
    lab_cost, lab_paid, patient_charge, notes || null, id,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findLabOrderById(id, callback);
  });
};

// Status change + timestamp stamping + history row, atomically, and only if the
// order is still in the status the caller saw (so two people clicking at once
// can't both "send" the same order). Returns null if the guard didn't match.
const changeLabOrderStatus = (id, expectedStatus, newStatus, notes, userId, callback) => {
  const query = `
    WITH upd AS (
      UPDATE "LabOrder"
      SET status = $1::public.lab_order_status,
          sent_at = CASE WHEN $1::public.lab_order_status = 'sent' THEN now() ELSE sent_at END,
          received_at = CASE WHEN $1::public.lab_order_status = 'received' THEN now() ELSE received_at END,
          completed_at = CASE WHEN $1::public.lab_order_status = 'completed' THEN now() ELSE completed_at END,
          due_date = CASE
            WHEN $1::public.lab_order_status = 'sent' AND due_date IS NULL
              THEN ${TODAY_KE} + (SELECT turnaround_days FROM "LabPartner" WHERE id = lab_partner_id)::int
            ELSE due_date
          END
      WHERE id = $2 AND status = $3::public.lab_order_status
      RETURNING id
    ), hist AS (
      INSERT INTO "LabOrderStatusHistory" (lab_order_id, status, notes, changed_by)
      SELECT id, $1::public.lab_order_status, $4, $5 FROM upd
    )
    SELECT id FROM upd
  `;
  pool.query(query, [newStatus, id, expectedStatus, notes || null, userId], (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findLabOrderById(id, callback);
  });
};

const findLabOrdersByPatient = (patient_id, callback) => {
  pool.query(`${ORDER_SELECT} WHERE o.patient_id = $1 ORDER BY o.created_at DESC`, [patient_id], rows(callback));
};

const findLabOrdersByDentist = (dentist_id, callback) => {
  pool.query(
    `${ORDER_SELECT} WHERE o.dentist_id = $1 ORDER BY o.created_at DESC LIMIT 500`,
    [dentist_id],
    rows(callback),
  );
};

// Everything still in flight, clinic-wide — overdue first, then soonest due.
const findOpenLabOrders = (callback) => {
  const query = `
    ${ORDER_SELECT}
    WHERE o.status NOT IN ('completed', 'cancelled')
    ORDER BY (o.due_date IS NOT NULL AND o.due_date < ${TODAY_KE}
              AND o.status IN ('sent', 'adjustment')) DESC,
             o.due_date NULLS LAST, o.created_at DESC
  `;
  pool.query(query, rows(callback));
};

const findLabOrderHistory = (lab_order_id, callback) => {
  const query = `
    SELECT h.id, h.status, h.notes, h.changed_at,
           (u.first_name || ' ' || u.last_name) AS changed_by_name
    FROM "LabOrderStatusHistory" h
    LEFT JOIN "User" u ON u.id = h.changed_by
    WHERE h.lab_order_id = $1
    ORDER BY h.changed_at ASC
  `;
  pool.query(query, [lab_order_id], rows(callback));
};

module.exports = {
  createLabOrder, findLabOrderById, updateLabOrder, changeLabOrderStatus,
  findLabOrdersByPatient, findLabOrdersByDentist, findOpenLabOrders, findLabOrderHistory,
};