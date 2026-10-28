const express = require('express');
const router = express.Router();
const {
  getByPatient, upload, uploadThumb, getImage, getThumb, update, remove,
} = require('../controllers/imagingController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Radiographs are clinical records: dentists and admins read; only dentists add / edit.
router.use(authorizeRoles('admin', 'dentist'));

// Raw image bytes in the request body (no multer / base64). Only runs for image/* content,
// so the app-wide JSON parser (100 kb) is untouched. Images are resized in the browser first.
const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '12mb' });
const rawThumb = express.raw({ type: ['image/jpeg'], limit: '1mb' });

router.get('/patient/:patientId', getByPatient);
router.post('/patient/:patientId', authorizeRoles('dentist'), rawImage, upload);

router.get('/:id/image', getImage);
router.get('/:id/thumb', getThumb);
router.put('/:id/thumb', authorizeRoles('dentist'), rawThumb, uploadThumb);
router.patch('/:id', authorizeRoles('dentist'), update);
router.delete('/:id', authorizeRoles('dentist', 'admin'), remove);

module.exports = router;
