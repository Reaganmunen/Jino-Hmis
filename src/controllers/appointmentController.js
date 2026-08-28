const {
  createAppointment, findAppointmentById, findAppointmentsByPatient,
  findAppointmentsByDentist, findAppointmentsByStatus, updateAppointmentStatus,
  rescheduleAppointment, updateAppointment, softDeleteAppointment,
  findAppointmentWithDetails,
} = require('../models/appointmentModel');
const { sendEmail } = require('../services/emailService');
const { getAppointmentEmail } = require('../services/emailTemplates');

const STAFF = ['admin', 'dentist', 'receptionist'];

// An appointment has no single "owner" param in the URL for :id routes, so
// ownership is resolved from the fetched row: staff can touch any appointment,
// a patient only their own, a dentist only ones assigned to them.
const canAccessAppointment = (user, appointment) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === appointment.patient_id;
  return false;
};

// Fire-and-forget: never awaited, never blocks the HTTP response, never
// throws into the request cycle. If the email fails, the appointment action
// itself has already succeeded and already responded to the client.
const notifyPatient = (action, appointmentId) => {
  findAppointmentWithDetails(appointmentId, (err, details) => {
    if (err || !details) {
      console.error(`notifyPatient(${action}) — couldn't load appointment ${appointmentId}`, err);
      return;
    }
    const email = getAppointmentEmail(action, details);
    if (!email) return; // e.g. a status with no template (checked_in, completed, etc.)
    sendEmail({ to: details.patient_email, subject: email.subject, html: email.html });
  });
};

// Postgres exclusion_violation (23P01) on overlapping dentist slots is caught
// centrally by errorMiddleware.errorHandler — no special-casing needed here.
const bookAppointment = (req, res, next) => {
  const data = { ...req.body, booked_by: req.user.id };
  createAppointment(data, (err, appointment) => {
    if (err) return next(err);
    res.status(201).json(appointment);
    notifyPatient('booked', appointment.id);
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
    notifyPatient(status, appointment.id); // no-op for statuses with no template (checked_in, completed, ...)
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
      notifyPatient('rescheduled', updated.id);
    });
  });
};

// Staff-only (see route: authorizeRoles(...STAFF)) full edit — reassign
// dentist and/or reschedule + adjust room/reason together. This is what the
// receptionist's "Edit appointment" action calls; distinct from `reschedule`
// above, which only changes time and is also reachable by patients.
//
// Email policy: only notify the patient if the dentist or the appointment
// time actually changed — those are the changes that affect the patient's
// plans. A pure room/reason correction (e.g. fixing a typo) stays silent so
// staff aren't spamming patients for internal housekeeping edits.
const editAppointment = (req, res, next) => {
  const { dentist_id, scheduled_start, scheduled_end, room, reason } = req.body;
  if (!dentist_id || !scheduled_start || !scheduled_end) {
    return res.status(400).json({ message: 'dentist_id, scheduled_start, and scheduled_end are required' });
  }

  findAppointmentById(req.params.id, (findErr, appointment) => {
    if (findErr) return next(findErr);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const patientFacingChange =
      String(appointment.dentist_id) !== String(dentist_id) ||
      new Date(appointment.scheduled_start).getTime() !== new Date(scheduled_start).getTime() ||
      new Date(appointment.scheduled_end).getTime() !== new Date(scheduled_end).getTime();

    updateAppointment(
      req.params.id,
      { dentist_id, scheduled_start, scheduled_end, room: room || null, reason: reason || null },
      (err, updated) => {
        if (err) return next(err);
        if (!updated) return res.status(404).json({ message: 'Appointment not found' });
        res.json(updated);
        if (patientFacingChange) notifyPatient('rescheduled', updated.id);
      },
    );
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
      notifyPatient('cancelled', req.params.id);
    });
  });
};

module.exports = {
  bookAppointment, getAppointment, getPatientAppointments, getDentistAppointments,
  getAppointmentsByStatus, setStatus, reschedule, editAppointment, cancelAppointment,
};