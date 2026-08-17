const express = require('express');
const router = express.Router();
const { uploadFile, getPatientFiles, removeFile } = require('../controllers/patientFileController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Plug your multer (or other upload) middleware in before uploadFile once storage is decided,
// e.g. router.post('/', upload.single('file'), authorizeRoles(...), uploadFile);
router.post('/', authorizeRoles('admin', 'dentist', 'receptionist', 'patient'), uploadFile);
router.get('/patient/:patientId', getPatientFiles);
router.delete('/:id', authorizeRoles('admin', 'dentist'), removeFile);

module.exports = router;