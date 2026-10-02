const express = require('express');
const router = express.Router();
const { getLabPartners, addLabPartner, editLabPartner } = require('../controllers/labPartnerController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'dentist', 'receptionist')); // no patient access

router.get('/', getLabPartners);
// Dentists can add/edit labs too — in a small clinic the dentist is often the one who knows the lab.
router.post('/', authorizeRoles('admin', 'dentist'), addLabPartner);
router.put('/:id', authorizeRoles('admin', 'dentist'), editLabPartner);

module.exports = router;