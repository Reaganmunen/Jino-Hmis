const express = require('express');
const router = express.Router();
const { addConsentForm, getPatientConsentForms } = require('../controllers/consentFormController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('admin', 'dentist', 'receptionist'), addConsentForm);
router.get('/patient/:patientId', getPatientConsentForms);

module.exports = router;