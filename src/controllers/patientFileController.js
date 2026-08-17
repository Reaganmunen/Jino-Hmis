const { addPatientFile, findFilesByPatient, deletePatientFile } = require('../models/patientFileModel');
const { findPatientByUserId } = require('../models/patientModel');

// Staff (admin/dentist/receptionist) pass any patient_id from the form.
// A patient uploading their own file (e.g. a profile picture) can't be
// trusted to submit someone else's patient_id, so it's resolved server-side.
//
// Assumes a file-upload middleware (e.g. multer) runs before this and puts the
// stored location on req.file.path or req.body.file_url. Swap that line in once
// you've picked local disk vs S3/Cloudinary for storage.
const uploadFile = (req, res, next) => {
  const finalize = (patient_id) => {
    const data = {
      ...req.body,
      patient_id,
      file_url: req.body.file_url || (req.file && req.file.path),
      uploaded_by: req.user.id,
    };
    if (!data.file_url) return res.status(400).json({ message: 'file_url is required' });

    addPatientFile(data, (err, file) => {
      if (err) return next(err);
      res.status(201).json(file);
    });
  };

  if (req.user.role === 'patient') {
    findPatientByUserId(req.user.id, (err, patient) => {
      if (err) return next(err);
      if (!patient) return res.status(404).json({ message: 'Patient record not found' });
      finalize(patient.id);
    });
  } else {
    finalize(req.body.patient_id);
  }
};

const getPatientFiles = (req, res, next) => {
  findFilesByPatient(req.params.patientId, (err, files) => {
    if (err) return next(err);
    res.json(files);
  });
};

const removeFile = (req, res, next) => {
  deletePatientFile(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'File not found' });
    res.json({ message: 'File removed' });
  });
};

module.exports = { uploadFile, getPatientFiles, removeFile };