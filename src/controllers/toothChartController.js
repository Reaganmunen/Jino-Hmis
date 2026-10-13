const {
  addToothChartEntry, findToothChartByPatient, findCurrentToothChart, findToothHistory,
  findProcedureHistory,
} = require('../models/toothChartModel');
const { findPatientById } = require('../models/patientModel');
const { sendPdf } = require('../services/pdfService');
const { toothChartHtml } = require('../services/pdfTemplates/toothChartTemplate');

const STAFF = ['admin', 'dentist', 'receptionist'];

// M mesial, D distal, O occlusal, I incisal, B buccal/labial, L lingual/palatal.
// Stored in this canonical order so "occlusal + distal" is always ['O','D'].
const SURFACE_ORDER = ['M', 'O', 'I', 'D', 'B', 'L'];

const cleanSurfaces = (input) => {
  const list = Array.isArray(input) ? input : [];
  const wanted = new Set(list.map((s) => String(s).trim().toUpperCase()));
  return SURFACE_ORDER.filter((s) => wanted.has(s));
};

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

const addEntry = (req, res, next) => {
  const data = {
    ...req.body,
    surfaces: cleanSurfaces(req.body.surfaces),
    procedure_name: clip(req.body.procedure_name, 150),
    material: clip(req.body.material, 100),
    recorded_by: req.user.id,
  };
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

// Restorative history — every procedure / surface entry for the patient.
const getProcedureHistory = (req, res, next) => {
  findProcedureHistory(req.params.patientId, (err, entries) => {
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

module.exports = {
  addEntry, getFullChart, getCurrentChart, getToothHistory, getProcedureHistory, downloadToothChartPdf,
};