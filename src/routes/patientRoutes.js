const express = require('express');
const router = express.Router();
const {
  addPatient, getPatient, getMyPatientRecord, search, getAllPatients, editPatient, removePatient,
} = require('../controllers/patientController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.get('/me', getMyPatientRecord); // logged-in patient's own record
router.get('/search', authorizeRoles(...STAFF), search);
router.get('/', authorizeRoles(...STAFF), getAllPatients);
router.post('/', authorizeRoles('admin', 'receptionist'), addPatient);
router.get('/:id', allowSelfOrStaff(STAFF, (req) => req.params.id), getPatient);
router.put('/:id', authorizeRoles(...STAFF), editPatient);
router.delete('/:id', authorizeRoles('admin'), removePatient);

module.exports = router;