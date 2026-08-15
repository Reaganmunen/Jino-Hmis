const express = require('express');
const router = express.Router();
const { addClaim, getClaim, getPatientClaims, setClaimStatus } = require('../controllers/insuranceClaimController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'receptionist'));

router.post('/', addClaim);
router.get('/patient/:patientId', getPatientClaims);
router.get('/:id', getClaim);
router.put('/:id/status', setClaimStatus);

module.exports = router;