const express = require('express');
const router = express.Router();
const {
  getCatalogue, getCurrent, getHistory, saveHistory, confirmHistory, getAlerts,
} = require('../controllers/medicalHistoryController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Medical history is clinical data. Only dentists and admins can read or
// write it; receptionists only capture bio data at registration and have no
// access here. A patient may read/submit only their own.
const CLINICIANS = ['admin', 'dentist'];
const INTAKE = CLINICIANS;
const selfOrIntake = allowSelfOrStaff(INTAKE, (req) => req.params.patientId);

router.get('/catalogue', getCatalogue);

router.get('/patient/:patientId', selfOrIntake, getCurrent);
router.post('/patient/:patientId', selfOrIntake, saveHistory);

router.get('/patient/:patientId/history', authorizeRoles(...CLINICIANS), getHistory);
router.post('/patient/:patientId/confirm', authorizeRoles(...CLINICIANS), confirmHistory);
router.get('/patient/:patientId/alerts', authorizeRoles(...CLINICIANS), getAlerts);

module.exports = router;
