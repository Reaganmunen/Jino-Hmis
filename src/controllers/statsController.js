const {
  getPatientSummary, getStaffSummary, getAppointmentStatusCounts,
  getRevenueForRange, getOutstandingBalance, getRevenueTrend,
  getTopServices, getScheduleForRange, getDentistWorkload,
} = require('../models/statsModel');

// Small callback-parallel helper — same spirit as Promise.all but matching
// this codebase's callback-style models instead of introducing a promise
// wrapper into every model file.
const parallel = (tasks, done) => {
  const keys = Object.keys(tasks);
  const results = {};
  let remaining = keys.length;
  let settled = false;

  keys.forEach((key) => {
    tasks[key]((err, value) => {
      if (settled) return;
      if (err) { settled = true; return done(err); }
      results[key] = value;
      remaining -= 1;
      if (remaining === 0) { settled = true; done(null, results); }
    });
  });
};

// GET /admin/stats/summary?from=&to=
// [from, to) is "today" in the caller's local time — same convention
// dentistDashboard.js already sends via todayRangeIso().
const getSummary = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  parallel({
    patients: getPatientSummary,
    staff: getStaffSummary,
    appointmentStatusCounts: (cb) => getAppointmentStatusCounts(from, to, cb),
    revenueToday: (cb) => getRevenueForRange(from, to, cb),
    revenueThisMonth: (cb) => getRevenueForRange(monthStart.toISOString(), to, cb),
    outstandingBalance: getOutstandingBalance,
  }, (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
};

// GET /admin/stats/revenue-trend?days=30
const getRevenueTrendStat = (req, res, next) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);

  getRevenueTrend(since.toISOString(), (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

// GET /admin/stats/top-services?limit=5
const getTopServicesStat = (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  getTopServices(limit, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

// GET /admin/stats/workload?from=&to=
const getWorkload = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  getDentistWorkload(from, to, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

// GET /admin/schedule?from=&to=
// The admin-wide equivalent of GET /appointments/dentist/:dentistId — every
// dentist's appointments in one list, names already resolved.
const getSchedule = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  getScheduleForRange(from, to, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

module.exports = { getSummary, getRevenueTrendStat, getTopServicesStat, getWorkload, getSchedule };