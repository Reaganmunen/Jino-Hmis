const express = require('express');
const router = express.Router();
const { addPrescription, getPatientPrescriptions } = require('../controllers/prescriptionController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addPrescription);
router.get('/patient/:patientId', getPatientPrescriptions);

module.exports = router;