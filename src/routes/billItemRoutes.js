const express = require('express');
const router = express.Router();
const { addItem, getItemsByBill, removeItem } = require('../controllers/billItemController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Dentists add line items for services ordered during a visit; removal stays
// admin/receptionist-only (billing corrections, not clinical work).
router.post('/', authorizeRoles('admin', 'receptionist', 'dentist'), addItem);
router.get('/bill/:billId', getItemsByBill);
router.delete('/:id', authorizeRoles('admin', 'receptionist'), removeItem);

module.exports = router;