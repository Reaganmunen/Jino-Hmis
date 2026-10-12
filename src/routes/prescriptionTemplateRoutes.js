const express = require('express');
const router = express.Router();
const { getTemplates, addTemplate, removeTemplate } = require('../controllers/prescriptionTemplateController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('dentist')); // templates are a dentist's own shortcuts; ownership is enforced in the model

router.get('/', getTemplates);
router.post('/', addTemplate);
router.delete('/:id', removeTemplate);

module.exports = router;
