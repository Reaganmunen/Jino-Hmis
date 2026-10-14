const {
  findNotesByPatient, findNoteById, findAddendaByNoteIds,
  createNote, updateDraft, signNote, deleteDraft,
  createAddendum, findAppointmentPatient,
} = require('../models/clinicalNoteModel');
const { TEMPLATES, TEMPLATE_KEYS } = require('../config/clinicalNoteTemplates');

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

// FDI two-digit notation: permanent 11-48, primary 51-85.
const FDI = /^(?:[1-4][1-8]|[5-8][1-5])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSignRequested = (body) => !!body && (body.sign === true || body.sign === 'true');

// Turns whatever the client sent into a clean row. Unknown teeth, bad dates and
// foreign ids are silently dropped.
const sanitize = (body) => {
  const b = body || {};

  const tooth_numbers = Array.isArray(b.tooth_numbers)
    ? Array.from(new Set(b.tooth_numbers.map((t) => String(t).trim()).filter((t) => FDI.test(t)))).slice(0, 32)
    : [];

  // visit_date must be YYYY-MM-DD and not in the future; default is today.
  let visit_date = new Date().toISOString().slice(0, 10);
  if (typeof b.visit_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date)) {
    const d = new Date(`${b.visit_date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 86400000) visit_date = b.visit_date;
  }

  return {
    appointment_id: typeof b.appointment_id === 'string' && UUID.test(b.appointment_id) ? b.appointment_id : null,
    visit_date,
    tooth_numbers,
    template_key: TEMPLATE_KEYS.has(b.template_key) ? b.template_key : null,
    subjective: clip(b.subjective, 4000),
    objective: clip(b.objective, 4000),
    assessment: clip(b.assessment, 4000),
    plan: clip(b.plan, 4000),
    procedure_done: clip(b.procedure_done, 4000),
  };
};

const hasContent = (d) => !!(d.subjective || d.objective || d.assessment || d.plan || d.procedure_done);
const canSign = (d) => !!(d.assessment || d.procedure_done);

const attachAddenda = (notes, callback) => {
  findAddendaByNoteIds(notes.map((n) => n.id), (err, addenda) => {
    if (err) return callback(err);
    const byNote = {};
    addenda.forEach((a) => { (byNote[a.note_id] = byNote[a.note_id] || []).push(a); });
    callback(null, notes.map((n) => ({ ...n, addenda: byNote[n.id] || [] })));
  });
};

const withAddenda = (note, callback) => attachAddenda([note], (err, rows) => callback(err, rows && rows[0]));

// Checks the appointment (if any) belongs to this patient.
const checkAppointment = (appointment_id, patient_id, callback) => {
  if (!appointment_id) return callback(null, true);
  findAppointmentPatient(appointment_id, (err, appt) => {
    if (err) return callback(err);
    callback(null, !!appt && String(appt.patient_id) === String(patient_id));
  });
};

/* GET /clinical-notes/templates */
const getTemplates = (req, res) => {
  res.json(TEMPLATES);
};

/* GET /clinical-notes/patient/:patientId -> notes newest first, each with addenda[] */
const getByPatient = (req, res, next) => {
  findNotesByPatient(req.params.patientId, (err, notes) => {
    if (err) return next(err);
    attachAddenda(notes, (aErr, full) => {
      if (aErr) return next(aErr);
      res.json(full);
    });
  });
};

/* POST /clinical-notes/patient/:patientId   body: { ...fields, sign: true|false }
   Saves a draft, or saves and signs in one step. */
const create = (req, res, next) => {
  const data = sanitize(req.body);
  const wantsSign = isSignRequested(req.body);

  if (!hasContent(data)) {
    return res.status(400).json({ message: 'Write something in at least one section before saving' });
  }
  if (wantsSign && !canSign(data)) {
    return res.status(400).json({ message: 'To sign a note, fill in the Assessment or the Procedure done' });
  }

  checkAppointment(data.appointment_id, req.params.patientId, (cErr, ok) => {
    if (cErr) return next(cErr);
    if (!ok) return res.status(400).json({ message: 'That appointment does not belong to this patient' });

    createNote({
      ...data,
      patient_id: req.params.patientId,
      dentist_id: req.user.id,
      status: wantsSign ? 'signed' : 'draft',
    }, (err, note) => {
      if (err) return next(err);
      res.status(201).json({ ...note, addenda: [] });
    });
  });
};

// Loads the note and enforces: exists, written by this dentist, still a draft.
const loadOwnDraft = (req, res, next, done) => {
  findNoteById(req.params.id, (err, note) => {
    if (err) return next(err);
    if (!note) return res.status(404).json({ message: 'Note not found' });
    if (String(note.dentist_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only the dentist who wrote this note can change it' });
    }
    if (note.status !== 'draft') {
      return res.status(409).json({ message: 'This note is signed and can no longer be edited. Add an addendum instead.' });
    }
    done(note);
  });
};

/* PUT /clinical-notes/:id   body: { ...fields, sign?: true } (drafts only, author only) */
const update = (req, res, next) => {
  loadOwnDraft(req, res, next, (note) => {
    const data = sanitize(req.body);
    const wantsSign = isSignRequested(req.body);

    if (!hasContent(data)) {
      return res.status(400).json({ message: 'Write something in at least one section before saving' });
    }
    if (wantsSign && !canSign(data)) {
      return res.status(400).json({ message: 'To sign a note, fill in the Assessment or the Procedure done' });
    }

    checkAppointment(data.appointment_id, note.patient_id, (cErr, ok) => {
      if (cErr) return next(cErr);
      if (!ok) return res.status(400).json({ message: 'That appointment does not belong to this patient' });

      updateDraft(note.id, data, (err, updated) => {
        if (err) return next(err);
        if (!updated) return res.status(409).json({ message: 'This note was signed and can no longer be edited' });
        if (!wantsSign) return res.json({ ...updated, addenda: [] });

        signNote(note.id, (sErr, signed) => {
          if (sErr) return next(sErr);
          if (!signed) return res.status(409).json({ message: 'This note was already signed' });
          res.json({ ...signed, addenda: [] });
        });
      });
    });
  });
};

/* POST /clinical-notes/:id/sign  (signs a saved draft as it is) */
const sign = (req, res, next) => {
  loadOwnDraft(req, res, next, (note) => {
    if (!canSign(note)) {
      return res.status(400).json({ message: 'To sign a note, fill in the Assessment or the Procedure done' });
    }
    signNote(note.id, (err, signed) => {
      if (err) return next(err);
      if (!signed) return res.status(409).json({ message: 'This note was already signed' });
      withAddenda(signed, (aErr, full) => {
        if (aErr) return next(aErr);
        res.json(full);
      });
    });
  });
};

/* DELETE /clinical-notes/:id  (drafts only, author only) */
const remove = (req, res, next) => {
  loadOwnDraft(req, res, next, (note) => {
    deleteDraft(note.id, (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(409).json({ message: 'This note was signed and cannot be deleted' });
      res.json({ message: 'Draft deleted' });
    });
  });
};

/* POST /clinical-notes/:id/addenda   body: { body }  (signed notes only; any dentist/admin) */
const addAddendum = (req, res, next) => {
  const body = clip(req.body && req.body.body, 4000);
  if (!body) return res.status(400).json({ message: 'Write the addendum text first' });

  findNoteById(req.params.id, (err, note) => {
    if (err) return next(err);
    if (!note) return res.status(404).json({ message: 'Note not found' });
    if (note.status !== 'signed') {
      return res.status(409).json({ message: 'Addenda can only be added to signed notes. Edit the draft instead.' });
    }
    createAddendum({ note_id: note.id, body, created_by: req.user.id }, (aErr, addendum) => {
      if (aErr) return next(aErr);
      res.status(201).json(addendum);
    });
  });
};

module.exports = { getTemplates, getByPatient, create, update, sign, remove, addAddendum };