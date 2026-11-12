const pool = require('../config/db');

// Nairobi is UTC+3 all year (no daylight saving), so a "month" for billing purposes
// runs from the 1st at 00:00 +03:00 to the 1st of next month at 00:00 +03:00.
const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return [`${y}-${pad(m)}-01T00:00:00+03:00`, `${nextY}-${pad(nextM)}-01T00:00:00+03:00`];
};

// Per-month totals, then the same totals split by event and by who triggered it.
// "billed_sms" (sum of segments) is the number your provider charges you for.
const getMonthlyUsage = (month, callback) => {
  const [from, to] = monthRange(month);
  const base = `FROM "SmsLog" WHERE created_at >= $1 AND created_at < $2`;
  const run = (sql) => pool.query(sql, [from, to]);

  Promise.all([
    run(`SELECT
           COUNT(*) FILTER (WHERE status = 'sent')                          AS messages_sent,
           COALESCE(SUM(segments) FILTER (WHERE status = 'sent'), 0)        AS billed_sms,
           COUNT(*) FILTER (WHERE status = 'failed')                        AS messages_failed,
           COALESCE(SUM(cost_kes) FILTER (WHERE status = 'sent'), 0)        AS cost_kes
         ${base}`),
    run(`SELECT event,
                COUNT(*) FILTER (WHERE status = 'sent')                     AS messages_sent,
                COALESCE(SUM(segments) FILTER (WHERE status = 'sent'), 0)   AS billed_sms,
                COALESCE(SUM(cost_kes) FILTER (WHERE status = 'sent'), 0)   AS cost_kes
         ${base} GROUP BY event ORDER BY billed_sms DESC`),
    run(`SELECT COALESCE(triggered_role, 'system') AS triggered_role,
                COUNT(*) FILTER (WHERE status = 'sent')                     AS messages_sent,
                COALESCE(SUM(segments) FILTER (WHERE status = 'sent'), 0)   AS billed_sms
         ${base} GROUP BY 1 ORDER BY billed_sms DESC`),
  ])
    .then(([totals, byEvent, byRole]) =>
      callback(null, { month, totals: totals.rows[0], by_event: byEvent.rows, by_triggered_role: byRole.rows }))
    .catch(callback);
};

// Newest first. All filters optional.
const findSmsLogs = ({ event, status, appointment_id, patient_id, limit = 100 }, callback) => {
  const where = [];
  const values = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replace('?', `$${values.length}`)); };
  if (event) add('l.event = ?', event);
  if (status) add('l.status = ?', status);
  if (appointment_id) add('l.appointment_id = ?', appointment_id);
  if (patient_id) add('l.patient_id = ?', patient_id);
  values.push(Math.min(Number(limit) || 100, 500));

  const query = `
    SELECT l.*, (p.first_name || ' ' || p.last_name) AS patient_name,
           (u.first_name || ' ' || u.last_name) AS triggered_by_name
    FROM "SmsLog" l
    LEFT JOIN "Patient" p ON p.id = l.patient_id
    LEFT JOIN "User" u ON u.id = l.triggered_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY l.created_at DESC
    LIMIT $${values.length}
  `;
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = { getMonthlyUsage, findSmsLogs };
