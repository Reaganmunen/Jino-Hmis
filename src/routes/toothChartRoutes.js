const express = require('express');
const router = express.Router();
const { addEntry, getFullChart, getCurrentChart, getToothHistory } = require('../controllers/toothChartController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addEntry);
router.get('/patient/:patientId/current', getCurrentChart); // latest per tooth — default chart view
router.get('/patient/:patientId/history', authorizeRoles('admin', 'dentist'), getFullChart);
router.get('/patient/:patientId/tooth/:toothNumber', getToothHistory);

module.exports = router;