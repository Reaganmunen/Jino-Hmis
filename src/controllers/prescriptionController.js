const {
  createPrescription, findPrescriptionsByPatient, findPrescriptionsByDentist, findPrescriptionsByPatientOnDate,
} = require('../models/prescriptionModel');
const { findPatientById } = require('../models/patientModel');
const { sendPdf } = require('../services/pdfService');
const { prescriptionHtml } = require('../services/pdfTemplates/prescriptionTemplate');

const STAFF = ['admin', 'dentist', 'receptionist'];

const addPrescription = (req, res, next) => {
  const data = { ...req.body, dentist_id: req.user.id };
  createPrescription(data, (err, prescription) => {
    if (err) return next(err);
    res.status(201).json(prescription);
  });
};

const getPatientPrescriptions = (req, res, next) => {
  findPrescriptionsByPatient(req.params.patientId, (err, prescriptions) => {
    if (err) return next(err);
    res.json(prescriptions);
  });
};

// Query params: ?from=2026-08-17T00:00:00&to=2026-08-18T00:00:00
const getDentistPrescriptions = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  findPrescriptionsByDentist(req.params.dentistId, from, to, (err, prescriptions) => {
    if (err) return next(err);
    res.json(prescriptions);
  });
};

// GET /prescriptions/patient/:patientId/pdf?date=YYYY-MM-DD
// Defaults to today (Africa/Nairobi) if no date is given — "print today's prescription".
const downloadPrescriptionPdf = (req, res, next) => {
  const { patientId } = req.params;
  const isSelf = req.user.role === 'patient' && String(req.user.patient_id) === String(patientId);
  if (!STAFF.includes(req.user.role) && !isSelf) {
    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  }

  const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }); // en-CA gives YYYY-MM-DD

  findPatientById(patientId, (patErr, patient) => {
    if (patErr) return next(patErr);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    findPrescriptionsByPatientOnDate(patientId, date, (rxErr, rows) => {
      if (rxErr) return next(rxErr);

      const prescriptions = rows.map((rx) => ({
        ...rx,
        dentist_name: `${rx.dentist_first_name} ${rx.dentist_last_name}`,
      }));

      const html = prescriptionHtml(
        { patient, prescriptions, date },
        process.env.CLINIC_NAME,
        process.env.CLINIC_LOGO_URL,
      );
      sendPdf(res, next, { html, filename: `prescription-${patient.last_name}-${date}.pdf` });
    });
  });
};

module.exports = { addPrescription, getPatientPrescriptions, getDentistPrescriptions, downloadPrescriptionPdf };