/* ============================================================
   CLINICAL NOTES (SOAP / progress notes) — dentist side
   ------------------------------------------------------------
     ClinicalNotes.render(container, { patientId, patientName, onChange })
         Draws the notes list for one patient, with "New note",
         Edit / Sign / Delete for the author's own drafts, and
         "Add addendum" for signed notes.

   Signed notes are locked: corrections are added as dated addenda.

   Needs api.js (fetchMethod, getStoredUser) and dashboard.css
   (modal, btn, field-*). Styles live in clinical-notes.css.
   ============================================================ */
(function () {
  'use strict';

  const call = (path, method, body) => fetchMethod(path, method || 'GET', body || null, true);

  /* ---------- helpers ---------- */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  // The "date" column comes back as a full ISO timestamp; keep only the calendar day.
  function dayOnly(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function todayStr() { return dayOnly(new Date()); }
  function me() { return (typeof getStoredUser === 'function') ? getStoredUser() : null; }
  function isMine(note) { const u = me(); return !!u && String(u.id) === String(note.dentist_id); }
  function isDentist() { const u = me(); return !!u && u.role === 'dentist'; }

  // FDI tooth numbers: permanent 11-48, primary 51-85.
  const FDI = /^(?:[1-4][1-8]|[5-8][1-5])$/;
  function parseTeeth(text) {
    const parts = String(text || '').split(/[\s,;]+/).filter(Boolean);
    const valid = [];
    const invalid = [];
    parts.forEach((p) => {
      if (FDI.test(p)) { if (!valid.includes(p)) valid.push(p); } else { invalid.push(p); }
    });
    return { valid, invalid };
  }

  /* ---------- API ---------- */
  let templatesPromise = null;
  function loadTemplates() {
    if (!templatesPromise) {
      templatesPromise = call('/clinical-notes/templates').catch((e) => { templatesPromise = null; throw e; });
    }
    return templatesPromise;
  }
  const fetchNotes = (patientId) => call(`/clinical-notes/patient/${patientId}`);

  /* ---------- note card ---------- */
  const SECTIONS = [
    ['subjective', 'Subjective — what the patient reports'],
    ['objective', 'Objective — findings'],
    ['assessment', 'Assessment'],
    ['plan', 'Plan'],
  ];

  function cardHtml(note) {
    const draft = note.status === 'draft';
    const author = [note.dentist_first_name, note.dentist_last_name].filter(Boolean).join(' ');
    const meta = [`Dr. ${esc(author)}`];
    if (note.appointment_start) {
      meta.push(`Appointment ${esc(fmtDate(note.appointment_start))}${note.appointment_reason ? ` — ${esc(note.appointment_reason)}` : ''}`);
    }
    if (!draft && note.signed_at) meta.push(`Signed ${esc(fmtDateTime(note.signed_at))}`);

    const teeth = Array.isArray(note.tooth_numbers) && note.tooth_numbers.length
      ? `<div class="cn-teeth">${note.tooth_numbers.map((t) => `<span class="cn-tooth">${esc(t)}</span>`).join('')}</div>`
      : '';

    const sections = SECTIONS
      .filter(([key]) => note[key])
      .map(([key, label]) => `
        <div class="cn-section">
          <p class="cn-label">${esc(label)}</p>
          <p class="cn-text">${esc(note[key])}</p>
        </div>`).join('');

    const procedure = note.procedure_done
      ? `<div class="cn-procedure"><p class="cn-label">Procedure done</p><p class="cn-text">${esc(note.procedure_done)}</p></div>`
      : '';

    const addenda = (note.addenda || []).length
      ? `<div class="cn-addenda">${note.addenda.map((a) => `
          <div class="cn-addendum">
            <p class="cn-addendum-meta">Addendum — Dr. ${esc([a.author_first_name, a.author_last_name].filter(Boolean).join(' '))} · ${esc(fmtDateTime(a.created_at))}</p>
            <p class="cn-text">${esc(a.body)}</p>
          </div>`).join('')}</div>`
      : '';

    let actions = '';
    if (draft && isMine(note)) {
      actions = `
        <div class="cn-actions">
          <button type="button" class="btn btn-outline btn-sm" data-cn-edit="${esc(note.id)}">Edit</button>
          <button type="button" class="btn btn-primary btn-sm" data-cn-sign="${esc(note.id)}">Sign note</button>
          <button type="button" class="cn-btn-danger" data-cn-delete="${esc(note.id)}">Delete draft</button>
        </div>`;
    } else if (!draft) {
      actions = `
        <div class="cn-actions">
          <button type="button" class="btn btn-outline btn-sm" data-cn-addendum-toggle="${esc(note.id)}">Add addendum</button>
        </div>
        <div class="cn-addendum-form" data-cn-addendum-form="${esc(note.id)}">
          <textarea class="field-input" maxlength="4000" placeholder="Correction or additional information. The original note stays unchanged."></textarea>
          <div class="cn-error" data-cn-addendum-error style="display:none;"></div>
          <div class="cn-form-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cn-addendum-save="${esc(note.id)}">Save addendum</button>
            <button type="button" class="btn btn-outline btn-sm" data-cn-addendum-toggle="${esc(note.id)}">Cancel</button>
          </div>
        </div>`;
    }

    return `
      <article class="cn-card${draft ? ' is-draft' : ''}" data-cn-card="${esc(note.id)}">
        <div class="cn-head">
          <div>
            <p class="cn-date">${esc(fmtDate(dayOnly(note.visit_date) ? `${dayOnly(note.visit_date)}T12:00:00` : note.visit_date))}</p>
            <p class="cn-meta">${meta.join(' · ')}</p>
          </div>
          <span class="cn-badge${draft ? ' is-draft' : ''}">${draft ? 'Draft' : 'Signed'}</span>
        </div>
        ${teeth}
        ${sections}
        ${procedure}
        ${addenda}
        ${actions}
      </article>`;
  }

  /* ---------- shared card wiring ---------- */
  function wireCards(container, byId, { edit, reload }) {
    container.querySelectorAll('[data-cn-edit]').forEach((b) => {
      b.addEventListener('click', () => edit(byId[b.dataset.cnEdit]));
    });

    container.querySelectorAll('[data-cn-sign]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!window.confirm('Sign this note? Once signed it cannot be edited or deleted. You can only add addenda.')) return;
        b.disabled = true;
        try {
          await call(`/clinical-notes/${b.dataset.cnSign}/sign`, 'POST', {});
          reload();
        } catch (err) {
          b.disabled = false;
          window.alert(err.message || 'Could not sign the note');
        }
      });
    });

    container.querySelectorAll('[data-cn-delete]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!window.confirm('Delete this draft? This cannot be undone.')) return;
        b.disabled = true;
        try {
          await call(`/clinical-notes/${b.dataset.cnDelete}`, 'DELETE');
          reload();
        } catch (err) {
          b.disabled = false;
          window.alert(err.message || 'Could not delete the draft');
        }
      });
    });

    container.querySelectorAll('[data-cn-addendum-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const form = container.querySelector(`[data-cn-addendum-form="${b.dataset.cnAddendumToggle}"]`);
        if (form) form.classList.toggle('is-open');
      });
    });

    container.querySelectorAll('[data-cn-addendum-save]').forEach((b) => {
      b.addEventListener('click', async () => {
        const form = container.querySelector(`[data-cn-addendum-form="${b.dataset.cnAddendumSave}"]`);
        const errEl = form.querySelector('[data-cn-addendum-error]');
        const body = form.querySelector('textarea').value.trim();
        errEl.style.display = 'none';
        if (!body) { errEl.textContent = 'Write the addendum text first'; errEl.style.display = 'block'; return; }
        b.disabled = true;
        try {
          await call(`/clinical-notes/${b.dataset.cnAddendumSave}/addenda`, 'POST', { body });
          reload();
        } catch (err) {
          b.disabled = false;
          errEl.textContent = err.message || 'Could not save the addendum';
          errEl.style.display = 'block';
        }
      });
    });
  }

  /* ---------- tab render ----------
     Two modes:
       - list mode (default): list of notes, "New clinical note" opens the modal editor.
       - visit mode (opts.visit = { appointment, getPrefill }): the SOAP editor for THIS
         appointment is embedded directly on the page, with earlier notes listed below it.
         No modal is used. */
  function render(container, opts) {
    const { patientId, patientName, onChange, visit } = opts;
    const reload = () => (typeof onChange === 'function' ? onChange() : render(container, opts));

    container.innerHTML = '<div class="records-loading"><div class="mpesa-spinner"></div>Loading clinical notes…</div>';

    return fetchNotes(patientId).then((notes) => {
      const byId = {};
      notes.forEach((n) => { byId[n.id] = n; });

      if (visit && visit.appointment) {
        renderVisit(container, opts, notes, byId, reload);
        return;
      }

      const drafts = notes.filter((n) => n.status === 'draft').length;
      container.innerHTML = `
        <div class="cn-toolbar">
          <p class="cn-count">${notes.length} note${notes.length === 1 ? '' : 's'}${drafts ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}</p>
          ${isDentist() ? '<button type="button" class="btn btn-primary btn-sm" data-cn-new>+ New clinical note</button>' : ''}
        </div>
        <div class="cn-list">
          ${notes.length ? notes.map(cardHtml).join('') : '<div class="empty-state">No clinical notes yet for this patient.</div>'}
        </div>`;

      const newBtn = container.querySelector('[data-cn-new]');
      if (newBtn) newBtn.addEventListener('click', () => openEditor({ patientId, patientName, note: null, onSaved: reload }));

      wireCards(container, byId, {
        reload,
        edit: (note) => openEditor({ patientId, patientName, note, onSaved: reload }),
      });
    }).catch(() => {
      container.innerHTML = '<div class="empty-state">Could not load clinical notes. Please try again.</div>';
    });
  }

  function renderVisit(container, opts, notes, byId, reload) {
    const { patientId, patientName, visit, onLoaded } = opts;
    const appt = visit.appointment;
    const apptId = String(appt.id);

    const here = notes.filter((n) => String(n.appointment_id) === apptId);
    const signedHere = here.filter((n) => n.status !== 'draft');
    const draftHere = here.find((n) => n.status === 'draft' && isMine(n)) || null;
    const hereIds = new Set(here.map((n) => String(n.id)));
    const others = notes.filter((n) => !hereIds.has(String(n.id)));

    if (typeof onLoaded === 'function') {
      try { onLoaded({ notes, signed: signedHere.length > 0, draft: !!draftHere, current: signedHere[0] || draftHere || null }); } catch (e) { /* never block the render */ }
    }

    const canWrite = isDentist();
    container.innerHTML = `
      <div class="cn-visit">
        ${signedHere.length ? `
          <div class="cn-notice cn-notice-ok">This visit's note is signed and locked. Use “Add addendum” for any correction.</div>
          <div class="cn-list">${signedHere.map(cardHtml).join('')}</div>`
          : (canWrite ? '<div data-cn-visit-editor></div>' : '<div class="empty-state">No clinical note has been written for this visit yet.</div>')}
        ${others.length ? `
          <h3 class="chart-subhead">Previous notes <span class="cn-count-inline">(${others.length})</span></h3>
          <div class="cn-list">${others.map(cardHtml).join('')}</div>` : ''}
      </div>`;

    const host = container.querySelector('[data-cn-visit-editor]');
    const showEditor = (note) => {
      renderEditor(host, {
        patientId,
        note,
        appointment: appt,
        getPrefill: visit.getPrefill,
        onReady: visit.onReady,
        autoPrefill: !note,
        onSaved: reload,
        onCancel: note && draftHere && note.id !== draftHere.id ? () => showEditor(draftHere) : (note && !draftHere ? () => showEditor(null) : null),
        inline: true,
      });
    };
    if (host) showEditor(draftHere);

    wireCards(container, byId, {
      reload,
      edit: (note) => {
        if (!host) { openEditor({ patientId, patientName, note, onSaved: reload }); return; }
        showEditor(note);
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
  }

  /* ---------- editor (modal wrapper) ---------- */
  const editor = { built: false, els: {}, ctx: null };

  function buildEditorShell() {
    if (editor.built) return;
    editor.built = true;

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim cn-scrim';
    scrim.innerHTML = `
      <div class="modal modal-lg cn-modal" role="dialog" aria-modal="true" aria-labelledby="cnTitle">
        <div class="modal-head">
          <div>
            <p class="modal-kicker" id="cnKicker">Clinical note</p>
            <h2 id="cnTitle">—</h2>
          </div>
          <button class="icon-link-btn" id="cnClose" type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="cnBody"></div>
      </div>`;
    document.body.appendChild(scrim);

    editor.els = {
      scrim,
      kicker: scrim.querySelector('#cnKicker'),
      title: scrim.querySelector('#cnTitle'),
      body: scrim.querySelector('#cnBody'),
      close: scrim.querySelector('#cnClose'),
    };

    editor.els.close.addEventListener('click', closeEditor);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeEditor(); });
    // Capture phase so Escape closes only this editor, not the patient modal behind it.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editor.els.scrim.classList.contains('is-open')) {
        e.stopPropagation();
        closeEditor();
      }
    }, true);
  }

  function closeEditor() {
    if (editor.els.scrim) editor.els.scrim.classList.remove('is-open');
  }

  async function openEditor({ patientId, patientName, note, onSaved }) {
    buildEditorShell();
    const { els } = editor;
    els.kicker.textContent = note ? 'Edit draft' : 'New clinical note';
    els.title.textContent = patientName || 'Patient';
    els.scrim.classList.add('is-open');
    await renderEditor(els.body, { patientId, note, onSaved, onCancel: closeEditor, onClosed: closeEditor, inline: false });
  }

  /* ---------- the SOAP form itself (used inline and in the modal) ---------- */
  async function renderEditor(body, o) {
    const { patientId, note, appointment, getPrefill, autoPrefill, onSaved, onCancel, onClosed, inline } = o;
    const editing = !!note;
    body.innerHTML = '<div class="records-loading"><div class="mpesa-spinner"></div>Loading…</div>';

    let templates = [];
    let appointments = [];
    try {
      const results = await Promise.all([
        loadTemplates().catch(() => []),
        call(`/appointments/patient/${patientId}`).catch(() => []),
      ]);
      templates = Array.isArray(results[0]) ? results[0] : [];
      appointments = Array.isArray(results[1]) ? results[1] : [];
    } catch (e) { /* the form still works without templates or the appointment list */ }

    const cur = note || {};
    const apptDay = appointment ? dayOnly(appointment.scheduled_start) : '';
    // The date picker can't go past today, so a future appointment falls back to today.
    const visitDate = dayOnly(cur.visit_date) || (apptDay && apptDay <= todayStr() ? apptDay : todayStr());
    const selAppt = cur.appointment_id != null ? String(cur.appointment_id) : (appointment ? String(appointment.id) : '');

    let recentAppts = appointments
      .filter((a) => a.status !== 'cancelled')
      .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start))
      .slice(0, 15);
    if (appointment && !recentAppts.some((a) => String(a.id) === String(appointment.id))) recentAppts = [appointment, ...recentAppts];

    const letter = (l) => `<span class="cn-letter">${l}</span>`;
    body.innerHTML = `
      <div class="cn-form${inline ? ' cn-form-inline' : ''}">
        ${inline ? `
          <div class="cn-visit-bar">
            <div>
              <p class="cn-visit-title">${editing ? 'Draft note' : 'SOAP note for this visit'}</p>
              <p class="cn-hint" style="margin:2px 0 0;">Nothing is final until you sign.</p>
            </div>
            ${getPrefill ? '<button type="button" class="btn btn-outline btn-sm" id="cnPull">Fill from this visit</button>' : ''}
          </div>
          <div class="cn-notice" id="cnPulled" style="display:none;"></div>`
          : (editing ? '' : '<div class="cn-notice">Pick a template to pre-fill the boxes with a visit structure, or write from scratch. Nothing is final until you sign.</div>')}
        <div class="cn-row3">
          <div class="cn-field">
            <label class="field-label" for="cnTemplate">Template</label>
            <select class="field-input" id="cnTemplate">
              <option value="">— No template —</option>
              ${templates.map((t) => `<option value="${esc(t.key)}"${cur.template_key === t.key ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="cn-field">
            <label class="field-label" for="cnDate">Visit date</label>
            <input class="field-input" id="cnDate" type="date" max="${esc(todayStr())}" value="${esc(visitDate)}">
          </div>
          <div class="cn-field">
            <label class="field-label" for="cnAppt">Appointment</label>
            <select class="field-input" id="cnAppt">
              <option value="">— Not linked —</option>
              ${recentAppts.map((a) => `<option value="${esc(a.id)}"${selAppt === String(a.id) ? ' selected' : ''}>${esc(fmtDate(a.scheduled_start))}${a.reason ? ` — ${esc(String(a.reason).slice(0, 40))}` : ''}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="cn-field">
          <label class="field-label" for="cnTeeth">Teeth involved (FDI numbers)</label>
          <input class="field-input" id="cnTeeth" placeholder="e.g. 36, 37  (primary teeth 51–85)" value="${esc((cur.tooth_numbers || []).join(', '))}">
          <div class="cn-teeth-preview" id="cnTeethPreview"></div>
          <p class="cn-hint" id="cnTeethHint"></p>
        </div>

        <div class="cn-field">
          <label class="field-label" for="cnS">${letter('S')} Subjective — what the patient reports</label>
          <textarea class="field-input" id="cnS" maxlength="4000" rows="${inline ? 4 : 3}" placeholder="Complaint, history, pain, relevant changes">${esc(cur.subjective || '')}</textarea>
        </div>
        <div class="cn-field">
          <label class="field-label" for="cnO">${letter('O')} Objective — clinical findings</label>
          <textarea class="field-input" id="cnO" maxlength="4000" rows="${inline ? 5 : 3}" placeholder="Examination, tests, radiographs">${esc(cur.objective || '')}</textarea>
        </div>
        <div class="cn-field">
          <label class="field-label" for="cnA">${letter('A')} Assessment — diagnosis</label>
          <textarea class="field-input" id="cnA" maxlength="4000" rows="3">${esc(cur.assessment || '')}</textarea>
        </div>
        <div class="cn-field">
          <label class="field-label" for="cnProc">Procedure done</label>
          <textarea class="field-input" id="cnProc" maxlength="4000" rows="4" placeholder="What was actually performed today: anaesthetic, materials, technique, complications">${esc(cur.procedure_done || '')}</textarea>
        </div>
        <div class="cn-field">
          <label class="field-label" for="cnP">${letter('P')} Plan — advice and next steps</label>
          <textarea class="field-input" id="cnP" maxlength="4000" rows="3">${esc(cur.plan || '')}</textarea>
        </div>

        <div class="cn-error" id="cnError" style="display:none;"></div>
        <div class="cn-foot">
          <p class="cn-hint" style="margin:0;">To sign, fill in the Assessment or the Procedure done.</p>
          <div class="cn-foot-right">
            ${onCancel ? '<button type="button" class="btn btn-outline" id="cnCancel">Cancel</button>' : ''}
            <button type="button" class="btn btn-outline" id="cnSaveDraft">Save draft</button>
            <button type="button" class="btn btn-primary" id="cnSaveSign">Save &amp; sign</button>
          </div>
        </div>
      </div>`;

    const $ = (id) => body.querySelector(id);
    const fields = {
      template: $('#cnTemplate'), date: $('#cnDate'), appt: $('#cnAppt'), teeth: $('#cnTeeth'),
      s: $('#cnS'), o: $('#cnO'), a: $('#cnA'), p: $('#cnP'), proc: $('#cnProc'),
    };
    const errEl = $('#cnError');
    const showError = (msg) => { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; };
    const anyTyped = () => [fields.s, fields.o, fields.a, fields.p, fields.proc].some((f) => f.value.trim());

    // Live tooth chips + warning for numbers that aren't valid FDI teeth.
    const refreshTeeth = () => {
      const { valid, invalid } = parseTeeth(fields.teeth.value);
      $('#cnTeethPreview').innerHTML = valid.map((t) => `<span class="cn-tooth">${esc(t)}</span>`).join('');
      $('#cnTeethHint').textContent = invalid.length ? `Not valid tooth numbers (ignored): ${invalid.join(', ')}` : '';
    };
    fields.teeth.addEventListener('input', refreshTeeth);
    refreshTeeth();

    // Applying a template fills the boxes. If the dentist already typed something,
    // ask before overwriting it.
    fields.template.addEventListener('change', () => {
      const t = templates.find((x) => x.key === fields.template.value);
      if (!t) return;
      if (anyTyped() && !window.confirm('Replace what you have written with this template?')) {
        fields.template.value = (cur.template_key || '');
        return;
      }
      fields.s.value = t.subjective || '';
      fields.o.value = t.objective || '';
      fields.a.value = t.assessment || '';
      fields.p.value = t.plan || '';
      fields.proc.value = t.procedure_done || '';
    });

    // Pull this visit's charting into the boxes (history, exam, tooth findings, perio, plan).
    const pulled = $('#cnPulled');
    const applyPrefill = async (force) => {
      if (typeof getPrefill !== 'function') return;
      let p = null;
      try { p = await getPrefill(); } catch (e) { p = null; }
      if (!p) return;
      if (anyTyped()) {
        if (!force) return;
        if (!window.confirm('Replace what you have written with a fresh summary of this visit?')) return;
      }
      fields.s.value = p.subjective || '';
      fields.o.value = p.objective || '';
      fields.a.value = p.assessment || '';
      fields.p.value = p.plan || '';
      fields.proc.value = p.procedure_done || '';
      if (Array.isArray(p.tooth_numbers) && p.tooth_numbers.length) { fields.teeth.value = p.tooth_numbers.join(', '); refreshTeeth(); }
      if (pulled) {
        const any = [p.subjective, p.objective, p.assessment, p.plan, p.procedure_done].some(Boolean);
        pulled.textContent = any
          ? 'Pre-filled from what you charted in this visit. Review and edit each section before signing.'
          : 'Nothing has been charted for this visit yet. Complete the earlier steps, or write the note by hand.';
        pulled.style.display = 'block';
      }
    };
    const pullBtn = $('#cnPull');
    if (pullBtn) pullBtn.addEventListener('click', async () => { pullBtn.disabled = true; await applyPrefill(true); pullBtn.disabled = false; });
    // Tell the host page once the boxes hold their starting text (used by the Review step).
    const ready = () => { if (typeof o.onReady === 'function') { try { o.onReady(); } catch (e) { /* ignore */ } } };
    if (autoPrefill && !editing) applyPrefill(false).then(ready, ready); else ready();

    const collect = (sign) => ({
      template_key: fields.template.value || null,
      visit_date: fields.date.value || todayStr(),
      appointment_id: fields.appt.value || null,
      tooth_numbers: parseTeeth(fields.teeth.value).valid,
      subjective: fields.s.value,
      objective: fields.o.value,
      assessment: fields.a.value,
      plan: fields.p.value,
      procedure_done: fields.proc.value,
      sign,
    });

    const buttons = [$('#cnSaveDraft'), $('#cnSaveSign'), $('#cnCancel')].filter(Boolean);
    const save = async (sign) => {
      showError('');
      const payload = collect(sign);
      if (![payload.subjective, payload.objective, payload.assessment, payload.plan, payload.procedure_done].some((v) => v.trim())) {
        showError('Write something in at least one section before saving');
        return;
      }
      if (sign) {
        if (!payload.assessment.trim() && !payload.procedure_done.trim()) {
          showError('To sign, fill in the Assessment or the Procedure done');
          return;
        }
        if (!window.confirm('Sign this note? Once signed it cannot be edited or deleted. You can only add addenda.')) return;
      }
      buttons.forEach((b) => { b.disabled = true; });
      try {
        if (editing) await call(`/clinical-notes/${note.id}`, 'PUT', payload);
        else await call(`/clinical-notes/patient/${patientId}`, 'POST', payload);
        if (typeof onClosed === 'function') onClosed();
        if (typeof onSaved === 'function') onSaved();
      } catch (err) {
        buttons.forEach((b) => { b.disabled = false; });
        showError(err.message || 'Could not save the note');
      }
    };

    $('#cnSaveDraft').addEventListener('click', () => save(false));
    $('#cnSaveSign').addEventListener('click', () => save(true));
    const cancelBtn = $('#cnCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
  }

  window.ClinicalNotes = { render, openEditor, fetchNotes };
})();
