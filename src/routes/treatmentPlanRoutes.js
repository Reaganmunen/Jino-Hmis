const express = require('express');
const router = express.Router();
const {
  addPlan, getPlan, getPatientPlans, getDentistActivePlans, setStatus,
} = require('../controllers/treatmentPlanController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff, allowDentistSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', authorizeRoles('dentist'), addPlan);

// Powers the dentist overview "Active treatment plans" panel.
router.get(
  '/dentist/:dentistId/active',
  allowDentistSelfOrStaff(['admin'], (req) => req.params.dentistId),
  getDentistActivePlans,
);

router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientPlans,
);
router.get('/:id', getPlan); // ownership checked in controller — no patientId in the URL here
router.put('/:id/status', setStatus); // patient approves their own plan, or dentist/admin updates progress — ownership + allowed-transition checked in controller

module.exports = router;