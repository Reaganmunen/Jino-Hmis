const { getMonthlyUsage, findSmsLogs } = require('../models/smsLogModel');

const EVENTS = ['booked', 'confirmed', 'cancelled', 'rescheduled', 'reassigned'];

// GET /api/sms/usage?month=2026-11   (defaults to the current month, Nairobi time)
const getUsage = (req, res, next) => {
  let { month } = req.query;
  if (!month) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit' }).format(new Date());
    month = parts.slice(0, 7); // 2026-11
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ message: 'month must look like 2026-11' });
  }
  getMonthlyUsage(month, (err, usage) => {
    if (err) return next(err);
    res.json(usage);
  });
};

// GET /api/sms/logs?event=cancelled&status=failed&appointment_id=...&limit=100
const getLogs = (req, res, next) => {
  const { event, status } = req.query;
  if (event && !EVENTS.includes(event)) {
    return res.status(400).json({ message: `event must be one of: ${EVENTS.join(', ')}` });
  }
  if (status && !['sent', 'failed'].includes(status)) {
    return res.status(400).json({ message: 'status must be sent or failed' });
  }
  findSmsLogs(req.query, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

module.exports = { getUsage, getLogs };
