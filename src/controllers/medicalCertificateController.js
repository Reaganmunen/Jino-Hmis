const {
  createCertificate, findCertificatesByPatient, findCertificateById, softDeleteCertificate,
} = require('../models/medicalCertificateModel');
const { medicalCertificateHtml } = require('../services/pdfTemplates/medicalCertificateTemplate');
const { sendPdf } = require('../services/pdfService');
// NOTE: I don't have your billController.js / prescriptionController.js in
// front of me, so I can't see exactly how you're currently sourcing
// clinicName/logoUrl for those PDFs. This defaults to an env var so it's
// at least configurable — swap this for whatever those controllers already
// do (a settings table lookup, a hardcoded string, etc.) so all three
// document types stay consistent.
const CLINIC_NAME = process.env.CLINIC_NAME || 'Jino Dental Clinic';
const CLINIC_LOGO_URL = process.env.CLINIC_LOGO_URL || null;

// POST /medical-certificates — dentist fills the form for a patient, we
// persist it AND stream back the generated PDF in the same request, so the
// frontend can trigger a download the moment the form is submitted.
const createMedicalCertificate = (req, res, next) => {
  const { patient_id, appointment_id, visit_date, diagnosis_summary, rest_from, rest_to, notes } = req.body;

  if (!patient_id || !diagnosis_summary || !rest_from || !rest_to) {
    return res.status(400).json({ message: 'patient_id, diagnosis_summary, rest_from, and rest_to are required' });
  }
  if (new Date(rest_to) < new Date(rest_from)) {
    return res.status(400).json({ message: 'rest_to cannot be before rest_from' });
  }

  const dentist_id = req.user.id; // set by verifyToken — always the logged-in dentist, never client-supplied

  createCertificate(
    { patient_id, dentist_id, appointment_id, visit_date, diagnosis_summary, rest_from, rest_to, notes },
    (err, cert) => {
      if (err) return next(err);

      const html = medicalCertificateHtml(cert, CLINIC_NAME, CLINIC_LOGO_URL);
      const filename = `medical-certificate-${cert.patient_last_name}-${cert.visit_date}.pdf`;
      sendPdf(res, next, { html, filename });
    }
  );
};

// GET /medical-certificates/patient/:patientId — feeds the "Sick Off Notes"
// tab in the patient records modal.
const getCertificatesForPatient = (req, res, next) => {
  findCertificatesByPatient(req.params.patientId, (err, certs) => {
    if (err) return next(err);
    res.json(certs);
  });
};

// GET /medical-certificates/:id/pdf — re-download a previously issued
// certificate (e.g. patient lost the printout).
const downloadMedicalCertificate = (req, res, next) => {
  findCertificateById(req.params.id, (err, cert) => {
    if (err) return next(err);
    if (!cert) return res.status(404).json({ message: 'Certificate not found' });

    const html = medicalCertificateHtml(cert, CLINIC_NAME, CLINIC_LOGO_URL);
    const filename = `medical-certificate-${cert.patient_last_name}-${cert.visit_date}.pdf`;
    sendPdf(res, next, { html, filename });
  });
};

const deleteMedicalCertificate = (req, res, next) => {
  softDeleteCertificate(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'Certificate not found' });
    res.json({ message: 'Certificate deleted' });
  });
};

module.exports = {
  createMedicalCertificate,
  getCertificatesForPatient,
  downloadMedicalCertificate,
  deleteMedicalCertificate,
};