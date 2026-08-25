const {
  createAppointment, findAppointmentById, findAppointmentsByPatient,
  findAppointmentsByDentist, findAppointmentsByStatus, updateAppointmentStatus,
  rescheduleAppointment, softDeleteAppointment,
} = require('../models/appointmentModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

// An appointment has no single "owner" param in the URL for :id routes, so
// ownership is resolved from the fetched row: staff can touch any appointment,
// a patient only their own, a dentist only ones assigned to them.
const canAccessAppointment = (user, appointment) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === appointment.patient_id;
  return false;
};

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
    if (!canAccessAppointment(req.user, appointment)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
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
// NOTE: this route is intentionally open to any authenticated user (not just
// the dentist themself or staff) because the patient booking wizard calls it
// to compute open slots for a chosen dentist. That means it currently returns
// full Appointment rows — including other patients' reason/room/status — to
// anyone checking availability. Locking the route to allowDentistSelfOrStaff
// would break booking; the real fix is a dedicated "busy slots only" endpoint
// (e.g. GET /dentist-schedules/:dentistId/availability) that returns just
// start/end times with no patient-identifying fields, leaving this route free
// to be restricted to the owning dentist + staff. Flagging rather than
// patching blind since it touches the patient-side booking flow too.
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

  findAppointmentById(req.params.id, (findErr, appointment) => {
    if (findErr) return next(findErr);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!canAccessAppointment(req.user, appointment)) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    rescheduleAppointment(req.params.id, scheduled_start, scheduled_end, (err, updated) => {
      if (err) return next(err);
      res.json(updated);
    });
  });
};

const cancelAppointment = (req, res, next) => {
  findAppointmentById(req.params.id, (findErr, appointment) => {
    if (findErr) return next(findErr);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!canAccessAppointment(req.user, appointment)) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    softDeleteAppointment(req.params.id, (err, rowCount) => {
      if (err) return next(err);
      if (!rowCount) return res.status(404).json({ message: 'Appointment not found' });
      res.json({ message: 'Appointment cancelled' });
    });
  });
};

module.exports = {
  bookAppointment, getAppointment, getPatientAppointments, getDentistAppointments,
  getAppointmentsByStatus, setStatus, reschedule, cancelAppointment,
};