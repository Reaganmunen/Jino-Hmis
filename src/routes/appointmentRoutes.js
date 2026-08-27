const express = require('express');
const router = express.Router();
const {
  bookAppointment, getAppointment, getPatientAppointments, getDentistAppointments,
  getAppointmentsByStatus, setStatus, reschedule, editAppointment, cancelAppointment,
} = require('../controllers/appointmentController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', bookAppointment); // patients can book their own; booked_by is set from req.user
router.get('/status/:status', authorizeRoles(...STAFF), getAppointmentsByStatus);
router.get('/dentist/:dentistId', getDentistAppointments); // ?from=&to=
router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientAppointments,
);
router.get('/:id', getAppointment);
router.put('/:id/status', authorizeRoles(...STAFF), setStatus);
router.put('/:id/reschedule', reschedule); // patient or staff
router.put('/:id', authorizeRoles(...STAFF), editAppointment); // staff-only: reassign dentist / edit room & reason alongside time
router.delete('/:id', cancelAppointment);

module.exports = router;