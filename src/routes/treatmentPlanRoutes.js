const express = require('express');
const router = express.Router();
const { addPlan, getPlan, getPatientPlans, setStatus } = require('../controllers/treatmentPlanController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addPlan);
router.get('/patient/:patientId', getPatientPlans);
router.get('/:id', getPlan);
router.put('/:id/status', setStatus); // patient approves their own plan, or dentist/admin updates progress

module.exports = router;