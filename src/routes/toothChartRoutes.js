const express = require('express');
const router = express.Router();
const { addEntry, getFullChart, getCurrentChart, getToothHistory } = require('../controllers/toothChartController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', authorizeRoles('dentist'), addEntry);
router.get(
  '/patient/:patientId/current',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getCurrentChart,
);
router.get(
  '/patient/:patientId/history',
  authorizeRoles('admin', 'dentist'), // unchanged — already staff-only
  getFullChart,
);
router.get(
  '/patient/:patientId/tooth/:toothNumber',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getToothHistory,
);

module.exports = router;