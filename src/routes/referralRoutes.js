const express = require('express');
const router = express.Router();
const { addReferral, getPatientReferrals, setReferralStatus } = require('../controllers/referralController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addReferral);
router.get('/patient/:patientId', getPatientReferrals);
router.put('/:id/status', authorizeRoles('admin', 'dentist', 'receptionist'), setReferralStatus);

module.exports = router;