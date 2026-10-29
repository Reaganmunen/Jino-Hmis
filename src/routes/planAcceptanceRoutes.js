const express = require('express');
const router = express.Router();
const {
  getByPatient, getForPlan, submit, downloadQuotePdf,
} = require('../controllers/planAcceptanceController');
const verifyToken = require('../middleware/authMiddleware');
const { allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.get('/patient/:patientId', allowSelfOrStaff(STAFF, (req) => req.params.patientId), getByPatient);

// The :planId routes check ownership in the controller (the URL has no patient id).
router.get('/:planId', getForPlan);
router.post('/:planId', submit);
router.get('/:planId/quote/pdf', downloadQuotePdf);

module.exports = router;
