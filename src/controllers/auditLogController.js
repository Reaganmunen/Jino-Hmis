const { findAuditLogByRecord, findAuditLogByUser } = require('../models/auditLogModel');

// e.g. GET /audit-log/Bill/<bill-uuid>
const getAuditLogByRecord = (req, res, next) => {
  findAuditLogByRecord(req.params.tableName, req.params.recordId, (err, log) => {
    if (err) return next(err);
    res.json(log);
  });
};

const getAuditLogByUser = (req, res, next) => {
  findAuditLogByUser(req.params.userId, (err, log) => {
    if (err) return next(err);
    res.json(log);
  });
};

module.exports = { getAuditLogByRecord, getAuditLogByUser };