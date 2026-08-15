const { addPatientFile, findFilesByPatient, deletePatientFile } = require('../models/patientFileModel');

// Assumes a file-upload middleware (e.g. multer) runs before this and puts the
// stored location on req.file.path or req.body.file_url. Swap that line in once
// you've picked local disk vs S3/Cloudinary for storage.
const uploadFile = (req, res, next) => {
  const data = {
    ...req.body,
    file_url: req.body.file_url || (req.file && req.file.path),
    uploaded_by: req.user.id,
  };
  if (!data.file_url) return res.status(400).json({ message: 'file_url is required' });

  addPatientFile(data, (err, file) => {
    if (err) return next(err);
    res.status(201).json(file);
  });
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