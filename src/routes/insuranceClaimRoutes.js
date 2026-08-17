const express = require('express');
const router = express.Router();
const {
  addClaim, getClaim, getPatientClaims, getClaimForBill, setClaimStatus, payoutClaim,
} = require('../controllers/insuranceClaimController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Patients may create a claim for themselves; staff may create on behalf of
// anyone. Ownership (patient_id) is enforced in the controller, not here.
router.post('/', authorizeRoles('admin', 'receptionist', 'patient'), addClaim);

// Patients may view their own claim history; staff may view any patient's.
router.get('/patient/:patientId', authorizeRoles('admin', 'receptionist', 'patient'), getPatientClaims);

// Patients may check whether their own bill already has a claim; staff may too.
router.get('/bill/:billId', authorizeRoles('admin', 'receptionist', 'patient'), getClaimForBill);

// Staff-only from here down: full claim lookup by id, status transitions, payout.
router.get('/:id', authorizeRoles('admin', 'receptionist'), getClaim);
router.put('/:id/status', authorizeRoles('admin', 'receptionist'), setClaimStatus);
router.post('/:id/payout', authorizeRoles('admin', 'receptionist'), payoutClaim);

module.exports = router;