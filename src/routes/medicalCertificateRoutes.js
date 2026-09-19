const express = require('express');
const router = express.Router();
const {
  createMedicalCertificate, getCertificatesForPatient, downloadMedicalCertificate, deleteMedicalCertificate,
} = require('../controllers/medicalCertificateController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Only a dentist issues/revokes certificates — same restriction as diagnoses.
router.post('/', authorizeRoles('dentist'), createMedicalCertificate);
router.delete('/:id', authorizeRoles('dentist'), deleteMedicalCertificate);

// Staff can list/reprint for any patient. NOTE: same known gap as your other
// :patientId routes (patientRoutes.js has the allowSelfOrStaff check, this
// one doesn't yet) — add that once roleMiddleware.js's helper is wired in
// here if patients should also be able to fetch their own certificates.
router.get('/patient/:patientId', authorizeRoles('dentist', 'admin', 'receptionist'), getCertificatesForPatient);
router.get('/:id/pdf', authorizeRoles('dentist', 'admin', 'receptionist'), downloadMedicalCertificate);

module.exports = router;