const express = require('express');
const router = express.Router();
const { addReminder, getDue, getPatientReminders, markSent } = require('../controllers/recallReminderController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'dentist', 'receptionist'));

router.post('/', addReminder);
router.get('/due', getDue); // ?by=YYYY-MM-DD, defaults to today — call from a cron job
router.get('/patient/:patientId', getPatientReminders);
router.put('/:id/sent', markSent);

module.exports = router;