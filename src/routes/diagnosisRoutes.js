const express = require('express');
const router = express.Router();
const { addDiagnosis, getPatientDiagnoses, getDiagnosis } = require('../controllers/diagnosisController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addDiagnosis);
router.get('/patient/:patientId', getPatientDiagnoses);
router.get('/:id', getDiagnosis);

module.exports = router;