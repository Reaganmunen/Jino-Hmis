const {
  addToothChartEntry, findToothChartByPatient, findCurrentToothChart, findToothHistory,
} = require('../models/toothChartModel');
const { findPatientById } = require('../models/patientModel');
const { sendPdf } = require('../services/pdfService');
const { toothChartHtml } = require('../services/pdfTemplates/toothChartTemplate');

const STAFF = ['admin', 'dentist', 'receptionist'];

const addEntry = (req, res, next) => {
  const data = { ...req.body, recorded_by: req.user.id };
  addToothChartEntry(data, (err, entry) => {
    if (err) return next(err);
    res.status(201).json(entry);
  });
};

// Full observation history, every tooth
const getFullChart = (req, res, next) => {
  findToothChartByPatient(req.params.patientId, (err, entries) => {
    if (err) return next(err);
    res.json(entries);
  });
};

// Latest condition per tooth — what the FDI chart UI should render
const getCurrentChart = (req, res, next) => {
  findCurrentToothChart(req.params.patientId, (err, entries) => {
    if (err) return next(err);
    res.json(entries);
  });
};

const getToothHistory = (req, res, next) => {
  findToothHistory(req.params.patientId, req.params.toothNumber, (err, entries) => {
    if (err) return next(err);
    res.json(entries);
  });
};

// GET /tooth-chart/patient/:patientId/history/pdf — full observation history,
// every tooth, "everything that's been done" — reuses the same query as
// getFullChart above, just rendered as a PDF instead of JSON.
const downloadToothChartPdf = (req, res, next) => {
  const { patientId } = req.params;
  const isSelf = req.user.role === 'patient' && String(req.user.patient_id) === String(patientId);
  if (!STAFF.includes(req.user.role) && !isSelf) {
    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  }

  findPatientById(patientId, (patErr, patient) => {
    if (patErr) return next(patErr);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    findToothChartByPatient(patientId, (chartErr, entries) => {
      if (chartErr) return next(chartErr);

      const html = toothChartHtml(
        { patient, entries },
        process.env.CLINIC_NAME,
        process.env.CLINIC_LOGO_URL,
      );
      sendPdf(res, next, { html, filename: `tooth-chart-${patient.last_name}.pdf` });
    });
  });
};

module.exports = { addEntry, getFullChart, getCurrentChart, getToothHistory, downloadToothChartPdf };