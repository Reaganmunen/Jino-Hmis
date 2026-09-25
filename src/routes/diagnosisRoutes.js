const express = require('express');
const router = express.Router();
const {
  addDiagnosis, getPatientDiagnoses, getDiagnosis, editDiagnosis, getDentistDiagnoses, getDiagnosisForAppointment,
} = require('../controllers/diagnosisController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff, allowDentistSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', authorizeRoles('dentist'), addDiagnosis);

// Powers the dentist overview stat cards — a dentist's own diagnoses in a date range.
router.get(
  '/dentist/:dentistId',
  allowDentistSelfOrStaff(['admin'], (req) => req.params.dentistId),
  getDentistDiagnoses,
);

// "Does this appointment already have notes logged" — clinical workflow check, staff-only.
router.get('/appointment/:appointmentId', authorizeRoles(...STAFF), getDiagnosisForAppointment);

router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientDiagnoses,
);
router.get('/:id', getDiagnosis); // ownership checked in controller — no patientId in the URL here

// Editing a finding/checkup: staff-role gated here, "is this actually
// your record" ownership checked in the controller — same split as GET /:id.
router.put('/:id', authorizeRoles('dentist', 'admin'), editDiagnosis);

module.exports = router;