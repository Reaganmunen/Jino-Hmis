const express = require('express');
const router = express.Router();
const {
  addOrder, getOrder, getPatientOrders, getDentistOrders, getOpenOrders, editOrder, setStatus,
} = require('../controllers/labOrderController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff, allowDentistSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

router.post('/', authorizeRoles('admin', 'dentist'), addOrder);

// Clinic-wide "what's still out at the labs" board — static path, must stay above /:id.
router.get('/open', authorizeRoles(...STAFF), getOpenOrders);

// A dentist's own orders (admin/receptionist can look at anyone's).
router.get(
  '/dentist/:dentistId',
  allowDentistSelfOrStaff(['admin', 'receptionist'], (req) => req.params.dentistId),
  getDentistOrders,
);

// Patients see only their own, with costs/lab/instructions stripped in the controller.
router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientOrders,
);

router.get('/:id', getOrder); // ownership checked in controller
router.put('/:id/status', authorizeRoles(...STAFF), setStatus); // per-role transition rules in controller
router.put('/:id', authorizeRoles('admin', 'dentist'), editOrder); // owner-or-admin checked in controller

module.exports = router;