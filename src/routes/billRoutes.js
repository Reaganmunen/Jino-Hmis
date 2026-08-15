const express = require('express');
const router = express.Router();
const { addBill, getBill, getPatientBills, getBillsByStatus, cancelBill } = require('../controllers/billController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('admin', 'receptionist'), addBill);
router.get('/status/:status', authorizeRoles('admin', 'receptionist'), getBillsByStatus);
router.get('/patient/:patientId', getPatientBills);
router.get('/:id', getBill);
router.put('/:id/void', authorizeRoles('admin'), cancelBill);

module.exports = router;