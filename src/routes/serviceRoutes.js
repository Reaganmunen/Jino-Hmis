const express = require('express');
const router = express.Router();
const { addService, getAllServices, getService, editService } = require('../controllers/serviceController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.get('/', getAllServices); // service catalog, useful for patients browsing prices too
router.get('/:id', getService);
router.post('/', authorizeRoles('admin'), addService);
router.put('/:id', authorizeRoles('admin'), editService);

module.exports = router;