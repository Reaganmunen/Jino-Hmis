const express = require('express');
const router = express.Router();
const { getAuditLogByRecord, getAuditLogByUser } = require('../controllers/auditLogController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin')); // audit trail is admin-only

router.get('/record/:tableName/:recordId', getAuditLogByRecord);
router.get('/user/:userId', getAuditLogByUser);

module.exports = router;