const express = require('express');
const router = express.Router();
const {
  getCases, getCase, create, update, finalise, patchProgress, remove,
  getVisits, addVisit, editVisit, removeVisit, getMine,
} = require('../controllers/orthoController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Patient portal: a patient sees only their own finalised cases (resolved server-side from the login).
router.get('/me', authorizeRoles('patient'), getMine);

// Everything else is clinical: dentists and admins read, only dentists write.
router.use(authorizeRoles('admin', 'dentist'));

router.get('/patient/:patientId', getCases);
router.post('/patient/:patientId', authorizeRoles('dentist'), create);

router.get('/cases/:id', getCase);
router.put('/cases/:id', authorizeRoles('dentist'), update);
router.post('/cases/:id/finalise', authorizeRoles('dentist'), finalise);
router.patch('/cases/:id/progress', authorizeRoles('dentist'), patchProgress);
router.delete('/cases/:id', authorizeRoles('dentist'), remove);

router.get('/cases/:id/visits', getVisits);
router.post('/cases/:id/visits', authorizeRoles('dentist'), addVisit);
router.put('/visits/:visitId', authorizeRoles('dentist'), editVisit);
router.delete('/visits/:visitId', authorizeRoles('dentist'), removeVisit);

module.exports = router;