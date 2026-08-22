const express = require('express');
const router = express.Router();
const { addBill, getBill, getPatientBills, getBillsByStatus, cancelBill } = require('../controllers/billController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

// Dentists can open a bill for a visit (billing for services ordered);
// only admin/receptionist handle payment status changes below.
router.post('/', authorizeRoles('admin', 'receptionist', 'dentist'), addBill);
router.get('/status/:status', authorizeRoles('admin', 'receptionist'), getBillsByStatus);
router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientBills,
);
router.get('/:id', getBill); // ownership checked in controller — no patientId in the URL here
router.put('/:id/void', authorizeRoles('admin'), cancelBill);

module.exports = router;