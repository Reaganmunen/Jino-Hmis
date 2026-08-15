const express = require('express');
const router = express.Router();
const { addPayment, getPaymentsByBill } = require('../controllers/paymentController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('admin', 'receptionist'), addPayment); // cash/card/bank/insurance only
router.get('/bill/:billId', getPaymentsByBill);

module.exports = router;