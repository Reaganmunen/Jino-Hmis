const {
  createAppointment, findAppointmentById, findAppointmentsByPatient,
  findAppointmentsByDentist, findAppointmentsByStatus, updateAppointmentStatus,
  rescheduleAppointment, softDeleteAppointment,
} = require('../models/appointmentModel');

// Postgres exclusion_violation (23P01) on overlapping dentist slots is caught
// centrally by errorMiddleware.errorHandler — no special-casing needed here.
const bookAppointment = (req, res, next) => {
  const data = { ...req.body, booked_by: req.user.id };
  createAppointment(data, (err, appointment) => {
    if (err) return next(err);
    res.status(201).json(appointment);
  });
};

const getAppointment = (req, res, next) => {
  findAppointmentById(req.params.id, (err, appointment) => {
    if (err) return next(err);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    res.json(appointment);
  });
};

const getPatientAppointments = (req, res, next) => {
  findAppointmentsByPatient(req.params.patientId, (err, appointments) => {
    if (err) return next(err);
    res.json(appointments);
  });
};

// Query params: ?from=2026-08-01&to=2026-08-31
const getDentistAppointments = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  findAppointmentsByDentist(req.params.dentistId, from, to, (err, appointments) => {
    if (err) return next(err);
    res.json(appointments);
  });
};

const getAppointmentsByStatus = (req, res, next) => {
  findAppointmentsByStatus(req.params.status, (err, appointments) => {
    if (err) return next(err);
    res.json(appointments);
  });
};

const setStatus = (req, res, next) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  updateAppointmentStatus(req.params.id, status, (err, appointment) => {
    if (err) return next(err);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    res.json(appointment);
  });
};

const reschedule = (req, res, next) => {
  const { scheduled_start, scheduled_end } = req.body;
  if (!scheduled_start || !scheduled_end) {
    return res.status(400).json({ message: 'scheduled_start and scheduled_end are required' });
  }
  rescheduleAppointment(req.params.id, scheduled_start, scheduled_end, (err, appointment) => {
    if (err) return next(err);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    res.json(appointment);
  });
};

const cancelAppointment = (req, res, next) => {
  softDeleteAppointment(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'Appointment not found' });
    res.json({ message: 'Appointment cancelled' });
  });
};

module.exports = {
  bookAppointment, getAppointment, getPatientAppointments, getDentistAppointments,
  getAppointmentsByStatus, setStatus, reschedule, cancelAppointment,
};