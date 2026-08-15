const express = require('express');
const router = express.Router();
const {
  addItem, getItem, getAllItems, getLowStock, editItem, restockItem,
} = require('../controllers/inventoryItemController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'dentist', 'receptionist')); // no patient access to inventory

router.get('/low-stock', getLowStock);
router.get('/', getAllItems);
router.post('/', authorizeRoles('admin'), addItem);
router.get('/:id', getItem);
router.put('/:id', authorizeRoles('admin'), editItem);
router.put('/:id/restock', authorizeRoles('admin'), restockItem);

module.exports = router;