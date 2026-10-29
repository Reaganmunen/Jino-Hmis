const express = require('express');
const router = express.Router();
const {
  create, getByBill, getByPatient, getCollections, cancel, downloadPdf,
} = require('../controllers/paymentPlanController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

// Reception sets plans up and chases overdue ones; admins can too.
router.post('/', authorizeRoles('admin', 'receptionist'), create);
router.get('/collections', authorizeRoles('admin', 'receptionist'), getCollections);
router.put('/:id/cancel', authorizeRoles('admin', 'receptionist'), cancel);

// Patients can read their own plans; ownership for bill/:id routes is checked in the controller.
router.get('/patient/:patientId', allowSelfOrStaff(STAFF, (req) => req.params.patientId), getByPatient);
router.get('/bill/:billId', getByBill);
router.get('/:id/pdf', downloadPdf);

module.exports = router;
