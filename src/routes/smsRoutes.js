const express = require('express');
const router = express.Router();
const { getUsage, getLogs } = require('../controllers/smsController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin')); // usage/cost and patient phone numbers: admin only

router.get('/usage', getUsage); // ?month=2026-11
router.get('/logs', getLogs);   // ?event=&status=&appointment_id=&patient_id=&limit=

module.exports = router;
