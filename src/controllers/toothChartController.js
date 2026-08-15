const {
  addToothChartEntry, findToothChartByPatient, findCurrentToothChart, findToothHistory,
} = require('../models/toothChartModel');

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

module.exports = { addEntry, getFullChart, getCurrentChart, getToothHistory };