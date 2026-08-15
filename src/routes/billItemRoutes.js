const express = require('express');
const router = express.Router();
const { addItem, getItemsByBill, removeItem } = require('../controllers/billItemController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('admin', 'receptionist'), addItem);
router.get('/bill/:billId', getItemsByBill);
router.delete('/:id', authorizeRoles('admin', 'receptionist'), removeItem);

module.exports = router;