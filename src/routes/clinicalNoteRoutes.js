const express = require('express');
const router = express.Router();
const {
  getTemplates, getByPatient, create, update, sign, remove, addAddendum,
} = require('../controllers/clinicalNoteController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Clinical notes are private clinical records: dentists and admins only.
// Patients and receptionists have no access. Writing, editing, signing and
// deleting are dentist-only, and edit / sign / delete are further limited to
// the note's author inside the controller.
router.use(authorizeRoles('admin', 'dentist'));

router.get('/templates', getTemplates);
router.get('/patient/:patientId', getByPatient);
router.post('/patient/:patientId', authorizeRoles('dentist'), create);

router.put('/:id', authorizeRoles('dentist'), update);
router.post('/:id/sign', authorizeRoles('dentist'), sign);
router.delete('/:id', authorizeRoles('dentist'), remove);
router.post('/:id/addenda', addAddendum);

module.exports = router;