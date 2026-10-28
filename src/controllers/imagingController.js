const {
  createStudy, findStudiesByPatient, findStudyById, findStudyBytes,
  setThumb, updateStudyMeta, softDeleteStudy,
} = require('../models/imagingModel');
const { findPatientById } = require('../models/patientModel');

const IMAGE_TYPES = [
  'bitewing', 'periapical', 'panoramic', 'cephalometric', 'cbct',
  'occlusal', 'intraoral_photo', 'extraoral_photo', 'other',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// FDI: permanent 11-18, 21-28, 31-38, 41-48; primary 51-55, 61-65, 71-75, 81-85.
const VALID_TEETH = new Set();
[1, 2, 3, 4].forEach((q) => { for (let i = 1; i <= 8; i += 1) VALID_TEETH.add(`${q}${i}`); });
[5, 6, 7, 8].forEach((q) => { for (let i = 1; i <= 5; i += 1) VALID_TEETH.add(`${q}${i}`); });

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

// Accepts "16,17" or ["16","17"]; drops anything that is not a real FDI number.
const cleanTeeth = (input) => {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  list.forEach((t) => {
    const n = String(t).trim();
    if (VALID_TEETH.has(n) && !out.includes(n)) out.push(n);
  });
  return out.sort();
};

const cleanDate = (v) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) return null; // no future dates
  return String(v);
};

// Don't trust the Content-Type header — check the file's own signature.
const sniffMime = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
};

const checkId = (req, res) => {
  if (!UUID_RE.test(req.params.id || '')) {
    res.status(400).json({ message: 'Invalid id' });
    return false;
  }
  return true;
};

const getByPatient = (req, res, next) => {
  if (!UUID_RE.test(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
  const tooth = VALID_TEETH.has(String(req.query.tooth)) ? String(req.query.tooth) : null;
  const image_type = IMAGE_TYPES.includes(req.query.image_type) ? req.query.image_type : null;
  findStudiesByPatient(req.params.patientId, { tooth, image_type }, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

// POST /imaging/patient/:patientId?image_type=&tooth=16,17&captured_at=&notes=&findings=
// Body: the raw image bytes (Content-Type image/jpeg|png|webp).
const upload = (req, res, next) => {
  const { patientId } = req.params;
  if (!UUID_RE.test(patientId)) return res.status(400).json({ message: 'Invalid patient id' });

  const image_data = req.body;
  if (!Buffer.isBuffer(image_data) || !image_data.length) {
    return res.status(400).json({ message: 'No image received. Send a JPEG, PNG or WebP file.' });
  }
  const mime_type = sniffMime(image_data);
  if (!mime_type) return res.status(415).json({ message: 'Unsupported file. Use JPEG, PNG or WebP.' });

  const image_type = req.query.image_type;
  if (!IMAGE_TYPES.includes(image_type)) return res.status(400).json({ message: 'Choose a valid image type' });

  const captured_at = req.query.captured_at ? cleanDate(req.query.captured_at) : new Date().toISOString().slice(0, 10);
  if (!captured_at) return res.status(400).json({ message: 'Capture date is invalid or in the future' });

  findPatientById(patientId, (err, patient) => {
    if (err) return next(err);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    createStudy({
      patient_id: patientId,
      uploaded_by: req.user.id,
      image_type,
      tooth_numbers: cleanTeeth(req.query.tooth),
      captured_at,
      notes: clip(req.query.notes, 1000),
      findings: clip(req.query.findings, 2000),
      mime_type,
      image_data,
    }, (createErr, study) => {
      if (createErr) return next(createErr);
      res.status(201).json(study);
    });
  });
};

const uploadThumb = (req, res, next) => {
  if (!checkId(req, res)) return;
  const thumb = req.body;
  if (sniffMime(thumb) !== 'image/jpeg') return res.status(415).json({ message: 'Thumbnail must be a JPEG' });
  setThumb(req.params.id, thumb, (err, count) => {
    if (err) return next(err);
    if (!count) return res.status(404).json({ message: 'Image not found' });
    res.json({ message: 'Thumbnail saved' });
  });
};

const sendBytes = (kind) => (req, res, next) => {
  if (!checkId(req, res)) return;
  findStudyBytes(req.params.id, kind, (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ message: 'Image not found' });
    // A thumb is always JPEG; the fallback (full image) keeps its own type.
    res.set('Content-Type', kind === 'thumb' && row.is_own_type ? 'image/jpeg' : row.mime_type);
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(row.data);
  });
};

const update = (req, res, next) => {
  if (!checkId(req, res)) return;
  findStudyById(req.params.id, (err, existing) => {
    if (err) return next(err);
    if (!existing) return res.status(404).json({ message: 'Image not found' });

    const b = req.body || {};
    const image_type = b.image_type === undefined ? existing.image_type : b.image_type;
    if (!IMAGE_TYPES.includes(image_type)) return res.status(400).json({ message: 'Choose a valid image type' });
    const captured_at = b.captured_at === undefined ? existing.captured_at : cleanDate(b.captured_at);
    if (!captured_at) return res.status(400).json({ message: 'Capture date is invalid or in the future' });

    updateStudyMeta(req.params.id, {
      image_type,
      captured_at,
      tooth_numbers: b.tooth_numbers === undefined ? existing.tooth_numbers : cleanTeeth(b.tooth_numbers),
      notes: b.notes === undefined ? existing.notes : clip(b.notes, 1000),
      findings: b.findings === undefined ? existing.findings : clip(b.findings, 2000),
    }, (upErr, study) => {
      if (upErr) return next(upErr);
      if (!study) return res.status(404).json({ message: 'Image not found' });
      res.json(study);
    });
  });
};

const remove = (req, res, next) => {
  if (!checkId(req, res)) return;
  findStudyById(req.params.id, (err, existing) => {
    if (err) return next(err);
    if (!existing) return res.status(404).json({ message: 'Image not found' });
    if (req.user.role !== 'admin' && existing.uploaded_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the dentist who uploaded this image (or an admin) can delete it' });
    }
    softDeleteStudy(req.params.id, req.user.id, (delErr) => {
      if (delErr) return next(delErr);
      res.json({ message: 'Image removed' });
    });
  });
};

module.exports = {
  getByPatient, upload, uploadThumb,
  getImage: sendBytes('image'), getThumb: sendBytes('thumb'),
  update, remove,
};
