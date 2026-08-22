const pool = require('../config/db');

/* ============================================================
   ADMIN OVERVIEW STATS
   ------------------------------------------------------------
   These are read-only aggregate queries for the admin dashboard.
   Nothing here writes to Bill/Payment/Appointment — it only reads
   off the trigger-maintained totals (Bill.total_amount / amount_paid
   / status), so there's no risk of drifting from the real numbers
   those triggers already keep in sync.
   ============================================================ */

// Total patients + how many were added this calendar month.
const getPatientSummary = (callback) => {
  const query = `
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_patients,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now())
      ) AS new_this_month
    FROM "Patient"
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Active headcount by role — dentist / receptionist / admin.
const getStaffSummary = (callback) => {
  const query = `
    SELECT role, COUNT(*) AS count
    FROM "User"
    WHERE deleted_at IS NULL AND is_active = TRUE
      AND role IN ('dentist', 'receptionist', 'admin')
    GROUP BY role
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Today's appointments across ALL dentists, grouped by status.
// [from, to) should be the caller's local "today" range as ISO strings,
// same convention dentistDashboard.js already uses (todayRangeIso()).
const getAppointmentStatusCounts = (from, to, callback) => {
  const query = `
    SELECT status, COUNT(*) AS count
    FROM "Appointment"
    WHERE deleted_at IS NULL AND scheduled_start >= $1 AND scheduled_start < $2
    GROUP BY status
  `;
  pool.query(query, [from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Revenue collected in [from, to) — sums actual Payment rows, not Bill totals,
// so it reflects cash actually received (M-Pesa, cash, card, bank, insurance).
const getRevenueForRange = (from, to, callback) => {
  const query = `
    SELECT COALESCE(SUM(amount), 0) AS revenue
    FROM "Payment"
    WHERE paid_at >= $1 AND paid_at < $2
  `;
  pool.query(query, [from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, Number(result.rows[0].revenue));
  });
};

// Total unpaid balance across all non-void bills — the "outstanding" figure.
const getOutstandingBalance = (callback) => {
  const query = `
    SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS outstanding
    FROM "Bill"
    WHERE status NOT IN ('void', 'paid')
  `;
  pool.query(query, (err, result) => {
    if (err) return callback(err);
    callback(null, Number(result.rows[0].outstanding));
  });
};

// Daily revenue for the last N days (for the trend chart). `since` is an
// ISO timestamp — pass e.g. 30 days ago at local midnight.
const getRevenueTrend = (since, callback) => {
  const query = `
    SELECT date_trunc('day', paid_at) AS day, COALESCE(SUM(amount), 0) AS revenue
    FROM "Payment"
    WHERE paid_at >= $1
    GROUP BY day
    ORDER BY day
  `;
  pool.query(query, [since], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Top services by revenue and volume, drawn from BillItem line items.
// Joined against Service for the clean catalog name — falls back to the
// line item's free-text description only for ad-hoc items with no
// linked service_id (e.g. one-off charges not in the catalog).
const getTopServices = (limit, callback) => {
  const query = `
    SELECT
      bi.service_id,
      COALESCE(s.name, bi.description) AS name,
      SUM(bi.quantity) AS volume,
      SUM(bi.quantity * bi.unit_price) AS revenue
    FROM "BillItem" bi
    LEFT JOIN "Service" s ON s.id = bi.service_id
    GROUP BY bi.service_id, COALESCE(s.name, bi.description)
    ORDER BY revenue DESC
    LIMIT $1
  `;
  pool.query(query, [limit], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Today's full clinic schedule — every dentist's appointments in one list,
// with patient + dentist names resolved so the frontend doesn't need a
// separate lookup pass.
const getScheduleForRange = (from, to, callback) => {
  const query = `
    SELECT
      a.id, a.status, a.scheduled_start, a.scheduled_end, a.reason, a.room,
      a.patient_id, a.dentist_id,
      p.first_name AS patient_first_name, p.last_name AS patient_last_name,
      d.first_name AS dentist_first_name, d.last_name AS dentist_last_name
    FROM "Appointment" a
    JOIN "Patient" p ON p.id = a.patient_id
    JOIN "User" d ON d.id = a.dentist_id
    WHERE a.deleted_at IS NULL AND a.scheduled_start >= $1 AND a.scheduled_start < $2
    ORDER BY a.scheduled_start
  `;
  pool.query(query, [from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Per-dentist appointment load for a range — powers the "staff workload" list.
const getDentistWorkload = (from, to, callback) => {
  const query = `
    SELECT
      u.id, u.first_name, u.last_name,
      COUNT(a.id) AS appointment_count
    FROM "User" u
    LEFT JOIN "Appointment" a
      ON a.dentist_id = u.id AND a.deleted_at IS NULL
      AND a.scheduled_start >= $1 AND a.scheduled_start < $2
    WHERE u.role = 'dentist' AND u.deleted_at IS NULL AND u.is_active = TRUE
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY u.first_name
  `;
  pool.query(query, [from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = {
  getPatientSummary,
  getStaffSummary,
  getAppointmentStatusCounts,
  getRevenueForRange,
  getOutstandingBalance,
  getRevenueTrend,
  getTopServices,
  getScheduleForRange,
  getDentistWorkload,
};