const {
  createLabOrder, findLabOrderById, updateLabOrder, changeLabOrderStatus,
  findLabOrdersByPatient, findLabOrdersByDentist, findOpenLabOrders, findLabOrderHistory,
} = require('../models/labOrderModel');

const WORK_TYPES = [
  'crown', 'bridge', 'veneer', 'inlay_onlay', 'denture_full', 'denture_partial',
  'implant_restoration', 'night_guard', 'retainer', 'orthodontic_appliance',
  'surgical_guide', 'other',
];

// Where an order is allowed to go next. 'adjustment' = sent back to the lab
// for a remake/tweak after a try-in; it comes back through 'received'.
const TRANSITIONS = {
  draft: ['sent', 'cancelled'],
  sent: ['received', 'cancelled'],
  received: ['try_in', 'adjustment', 'completed'],
  try_in: ['completed', 'adjustment'],
  adjustment: ['received', 'cancelled'],
  completed: [],
  cancelled: [],
};

// Statuses that need a reason on record (why it was cancelled / what to fix).
const NOTES_REQUIRED = ['cancelled', 'adjustment'];

// Receptionists run the front desk: they hand work to the courier and book it
// back in, but clinical decisions (try-in, adjustment, completion) stay with
// the dentist/admin.
const RECEPTIONIST_TARGETS = ['sent', 'received'];

const isTerminal = (status) => status === 'completed' || status === 'cancelled';

// Dentists work on their own orders; admins on anything.
const canModify = (user, order) =>
  user.role === 'admin' || (user.role === 'dentist' && order.dentist_id === user.id);

// Patients see what's happening with their work — never costs, the lab, or
// the clinical instructions/notes.
const toPatientView = (order) => {
  const {
    lab_cost, lab_paid, patient_charge, lab_partner_id, lab_name, lab_phone,
    instructions, notes, treatment_plan_item_id, ...safe
  } = order;
  return safe;
};

// Accepts [36, 37] or "36, 37". Returns a clean array or throws a 400-style error.
const parseTeeth = (input) => {
  if (input == null || input === '') return [];
  const list = Array.isArray(input) ? input : String(input).split(/[,\s]+/).filter(Boolean);
  const teeth = list.map(Number);
  const valid = teeth.every((n) => Number.isInteger(n) && n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8);
  if (!valid) {
    const err = new Error('tooth_numbers must be valid FDI tooth numbers (11-18, 21-28, 31-38, 41-48)');
    err.statusCode = 400;
    throw err;
  }
  return [...new Set(teeth)];
};

const parseMoney = (value, field) => {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${field} must be a number of 0 or more`);
    err.statusCode = 400;
    throw err;
  }
  return n;
};

// Column sizes from LabOrder (shade varchar(30), material varchar(80)) — fail with a
// clear message instead of letting Postgres throw "value too long".
const checkLengths = (body) => {
  if (body.shade && String(body.shade).length > 30) return 'shade must be 30 characters or fewer';
  if (body.material && String(body.material).length > 80) return 'material must be 80 characters or fewer';
  return null;
};

const addOrder = (req, res, next) => {
  try {
    const body = req.body;
    const tooLong = checkLengths(body);
    if (tooLong) return res.status(400).json({ message: tooLong });
    // A dentist always orders as themselves; an admin may order on a dentist's behalf.
    const dentist_id = req.user.role === 'admin' ? body.dentist_id : req.user.id;

    if (!body.patient_id || !dentist_id || !body.work_type) {
      return res.status(400).json({ message: 'patient_id, work_type and dentist are required' });
    }
    if (!WORK_TYPES.includes(body.work_type)) {
      return res.status(400).json({ message: `work_type must be one of: ${WORK_TYPES.join(', ')}` });
    }

    const data = {
      ...body,
      dentist_id,
      tooth_numbers: parseTeeth(body.tooth_numbers),
      lab_cost: parseMoney(body.lab_cost, 'lab_cost'),
      patient_charge: parseMoney(body.patient_charge, 'patient_charge'),
    };

    createLabOrder(data, (err, order) => {
      if (err) return next(err);
      res.status(201).json(order);
    });
  } catch (err) {
    next(err);
  }
};

const getOrder = (req, res, next) => {
  findLabOrderById(req.params.id, (err, order) => {
    if (err) return next(err);
    if (!order) return res.status(404).json({ message: 'Lab order not found' });

    const isPatient = req.user.role === 'patient';
    if (isPatient && (req.user.patient_id !== order.patient_id || order.status === 'draft')) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }

    findLabOrderHistory(order.id, (histErr, history) => {
      if (histErr) return next(histErr);
      if (isPatient) {
        return res.json({
          ...toPatientView(order),
          history: history.map(({ status, changed_at }) => ({ status, changed_at })),
        });
      }
      res.json({ ...order, history });
    });
  });
};

// Route already confirmed this is the patient themself or staff (allowSelfOrStaff).
const getPatientOrders = (req, res, next) => {
  findLabOrdersByPatient(req.params.patientId, (err, orders) => {
    if (err) return next(err);
    if (req.user.role === 'patient') {
      return res.json(orders.filter((o) => o.status !== 'draft').map(toPatientView));
    }
    res.json(orders);
  });
};

const getDentistOrders = (req, res, next) => {
  findLabOrdersByDentist(req.params.dentistId, (err, orders) => {
    if (err) return next(err);
    res.json(orders);
  });
};

const getOpenOrders = (req, res, next) => {
  findOpenLabOrders((err, orders) => {
    if (err) return next(err);
    res.json(orders);
  });
};

const editOrder = (req, res, next) => {
  findLabOrderById(req.params.id, (findErr, order) => {
    if (findErr) return next(findErr);
    if (!order) return res.status(404).json({ message: 'Lab order not found' });
    if (!canModify(req.user, order)) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    try {
      const body = req.body;
      const tooLong = checkLengths(body);
      if (tooLong) return res.status(400).json({ message: tooLong });
      const incoming = {};

      // Money/payment fields stay editable after the work is finished (the lab
      // is often paid weeks later); everything clinical locks once it's closed.
      if ('lab_cost' in body) incoming.lab_cost = parseMoney(body.lab_cost, 'lab_cost');
      if ('lab_paid' in body) incoming.lab_paid = Boolean(body.lab_paid);
      if ('notes' in body) incoming.notes = body.notes;

      if (!isTerminal(order.status)) {
        if ('work_type' in body) {
          if (!WORK_TYPES.includes(body.work_type)) {
            return res.status(400).json({ message: `work_type must be one of: ${WORK_TYPES.join(', ')}` });
          }
          incoming.work_type = body.work_type;
        }
        if ('tooth_numbers' in body) incoming.tooth_numbers = parseTeeth(body.tooth_numbers);
        if ('patient_charge' in body) incoming.patient_charge = parseMoney(body.patient_charge, 'patient_charge');
        ['lab_partner_id', 'appointment_id', 'treatment_plan_item_id', 'shade', 'material', 'instructions', 'due_date']
          .forEach((field) => { if (field in body) incoming[field] = body[field]; });
      }

      const merged = { ...order, ...incoming };
      // parseMoney returns undefined for blank input — fall back to what's stored.
      merged.lab_cost = merged.lab_cost ?? order.lab_cost;
      merged.patient_charge = merged.patient_charge ?? order.patient_charge;

      updateLabOrder(order.id, merged, (err, updated) => {
        if (err) return next(err);
        res.json(updated);
      });
    } catch (err) {
      next(err);
    }
  });
};

const setStatus = (req, res, next) => {
  const { status, notes } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  if (!Object.keys(TRANSITIONS).includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${Object.keys(TRANSITIONS).join(', ')}` });
  }

  findLabOrderById(req.params.id, (findErr, order) => {
    if (findErr) return next(findErr);
    if (!order) return res.status(404).json({ message: 'Lab order not found' });

    const allowed =
      canModify(req.user, order) ||
      (req.user.role === 'receptionist' && RECEPTIONIST_TARGETS.includes(status));
    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' });
    }

    if (!TRANSITIONS[order.status].includes(status)) {
      return res.status(400).json({
        message: `Cannot move a ${order.status.replace('_', ' ')} order to ${status.replace('_', ' ')}`,
      });
    }
    if (NOTES_REQUIRED.includes(status) && !(notes && notes.trim())) {
      return res.status(400).json({ message: `A note is required when marking an order as ${status.replace('_', ' ')}` });
    }
    if (status === 'sent' && !order.lab_partner_id) {
      return res.status(400).json({ message: 'Choose a lab before sending this order' });
    }

    changeLabOrderStatus(order.id, order.status, status, notes && notes.trim(), req.user.id, (err, updated) => {
      if (err) return next(err);
      if (!updated) {
        return res.status(409).json({ message: 'This order was just updated by someone else. Refresh and try again.' });
      }
      res.json(updated);
    });
  });
};

module.exports = { addOrder, getOrder, getPatientOrders, getDentistOrders, getOpenOrders, editOrder, setStatus };