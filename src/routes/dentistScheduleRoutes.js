const express = require('express');
const router = express.Router();
const { addSlot, getDentistSchedule, editSlot, removeSlot } = require('../controllers/dentistScheduleController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.get('/:dentistId', getDentistSchedule); // anyone logged in can view availability to book against
router.post('/', authorizeRoles('admin', 'dentist'), addSlot);
router.put('/:id', authorizeRoles('admin', 'dentist'), editSlot);
router.delete('/:id', authorizeRoles('admin', 'dentist'), removeSlot);

module.exports = router;