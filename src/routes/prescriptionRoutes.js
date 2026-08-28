const express = require('express');
const router = express.Router();
const {
  addPrescription, getPatientPrescriptions, getDentistPrescriptions, downloadPrescriptionPdf,
} = require('../controllers/prescriptionController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff, allowDentistSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', authorizeRoles('dentist'), addPrescription);

// Powers the dentist overview stat card — a dentist's own prescriptions in a date range.
router.get(
  '/dentist/:dentistId',
  allowDentistSelfOrStaff(['admin'], (req) => req.params.dentistId),
  getDentistPrescriptions,
);

router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientPrescriptions,
);
// Ownership checked in the controller (same self-or-staff logic as above);
// kept as its own path segment so it never collides with the route above.
router.get('/patient/:patientId/pdf', downloadPrescriptionPdf);

module.exports = router;