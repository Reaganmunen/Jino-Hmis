/* ============================================================
   PATIENT DETAILS MODAL (shared, dentist side)
   ------------------------------------------------------------
   One modal any dentist page can open:

     PatientDetails.open({ patientId, appointmentId, diagnosisId, tab })

   - appointmentId  -> the appointment is shown in full at the top,
                       together with the diagnosis logged for it.
   - diagnosisId    -> the diagnosis is shown in full at the top,
                       together with its appointment and prescriptions.
   - neither        -> opens on the patient's details.

   Any element with data-patient-id (and optionally data-appointment-id /
   data-diagnosis-id) opens it on click, so pages can wire rows up with
   markup alone.

   Needs api.js (fetchMethod, getStoredUser) and dashboard.css (modal,
   badge and filter-tab classes). Styles live in patient-details.css.
   Uses only endpoints that already exist; nothing here writes data.
   ============================================================ */
(function () {
  'use strict';

  const TABS = [
    { id: 'patient', label: 'Patient' },
    { id: 'medical', label: 'Medical history' },
    { id: 'diagnoses', label: 'Diagnoses' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'prescriptions', label: 'Prescriptions' },
    { id: 'plans', label: 'Treatment plans' },
  ];

  const session = (typeof getStoredUser === 'function') ? getStoredUser() : null;

  const state = {
    token: 0,            // bumped on every open, so a slow response for an old patient can't overwrite a newer one
    built: false,
    patient: null,
    appointments: [],
    diagnoses: [],
    prescriptions: [],
    plans: [],
    medical: null,       // { ok, data, alerts } from loadMedical()
    focus: null,         // { type: 'appointment' | 'diagnosis', id }
    activeTab: 'patient',
    dentistsById: null,  // lazy, fetched once
    lastTrigger: null,   // element to return focus to on close
  };

  const els = {};

  /* ============================================================
     PUBLIC API
     ============================================================ */
  async function open({ patientId, appointmentId = null, diagnosisId = null, tab = null } = {}) {
    if (!patientId) return;
    build();

    state.lastTrigger = document.activeElement;
    state.focus = appointmentId
      ? { type: 'appointment', id: appointmentId }
      : diagnosisId ? { type: 'diagnosis', id: diagnosisId } : null;
    state.activeTab = tab || (state.focus ? (state.focus.type === 'appointment' ? 'appointments' : 'diagnoses') : 'patient');
    state.patient = null;
    state.appointments = [];
    state.diagnoses = [];
    state.prescriptions = [];
    state.plans = [];
    state.medical = null;

    const myToken = ++state.token;

    els.name.textContent = 'Loading…';
    els.meta.textContent = '';
    els.allergy.style.display = 'none';
    els.mhAlerts.style.display = 'none';
    els.mhAlerts.innerHTML = '';
    els.focus.innerHTML = '';
    setLoading();
    selectTab(state.activeTab);
    els.scrim.classList.add('is-open');
    document.body.classList.add('pd-open');
    els.close.focus();

    // Each request fails on its own: a missing prescriptions list should
    // not stop the patient's name and appointments from showing.
    const get = (path) => fetchMethod(path, 'GET', null, true);
    const [patient, appts, diagnoses, rx, plans, medical] = await Promise.all([
      get(`/patients/${patientId}`).catch((e) => ({ __error: e })),
      get(`/appointments/patient/${patientId}`).catch(() => null),
      get(`/diagnoses/patient/${patientId}`).catch(() => null),
      get(`/prescriptions/patient/${patientId}`).catch(() => null),
      get(`/treatment-plans/patient/${patientId}`).catch(() => null),
      loadMedical(patientId),
      loadDentists(),
    ]);

    if (myToken !== state.token) return; // a newer open() took over

    if (patient && patient.__error) {
      els.name.textContent = 'Patient not available';
      setPanelsMessage(patient.__error.message || 'Could not load this patient.');
      return;
    }

    state.patient = patient;
    state.appointments = Array.isArray(appts) ? appts : [];
    state.diagnoses = Array.isArray(diagnoses) ? diagnoses : [];
    state.prescriptions = Array.isArray(rx) ? rx : [];
    state.plans = Array.isArray(plans) ? plans : [];
    state.failed = {
      appointments: appts === null, diagnoses: diagnoses === null,
      prescriptions: rx === null, plans: plans === null,
      medical: !medical.ok,
    };
    state.medical = medical;

    renderAll();
  }

  function close() {
    if (!state.built) return;
    state.token++; // discard any in-flight responses
    els.scrim.classList.remove('is-open');
    document.body.classList.remove('pd-open');
    if (state.lastTrigger && typeof state.lastTrigger.focus === 'function') state.lastTrigger.focus();
    state.lastTrigger = null;
  }

  window.PatientDetails = { open, close };

  /* ============================================================
     DOM
     ============================================================ */
  function build() {
    if (state.built) return;
    state.built = true;

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim pd-scrim';
    scrim.innerHTML = `
      <div class="modal modal-lg pd-modal" role="dialog" aria-modal="true" aria-labelledby="pdName">
        <div class="modal-head">
          <div>
            <p class="modal-kicker">Patient details</p>
            <h2 id="pdName">—</h2>
            <p class="pd-meta" id="pdMeta"></p>
          </div>
          <button class="icon-link-btn" id="pdClose" type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="pd-allergy" id="pdAllergy" style="display:none;"></div>
        <div class="mh-standing" id="pdMhAlerts" style="display:none;"></div>
        <div id="pdFocus"></div>
        <div class="pd-tabs" id="pdTabs" role="tablist">
          ${TABS.map((t) => `<button class="filter-tab" role="tab" data-tab="${t.id}" type="button">${t.label}</button>`).join('')}
        </div>
        <div class="pd-body">
          ${TABS.map((t) => `<div class="pd-panel" data-panel="${t.id}"></div>`).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(scrim);

    els.scrim = scrim;
    els.name = scrim.querySelector('#pdName');
    els.meta = scrim.querySelector('#pdMeta');
    els.allergy = scrim.querySelector('#pdAllergy');
    els.mhAlerts = scrim.querySelector('#pdMhAlerts');
    els.focus = scrim.querySelector('#pdFocus');
    els.close = scrim.querySelector('#pdClose');
    els.tabs = scrim.querySelector('#pdTabs');
    els.panels = {};
    scrim.querySelectorAll('.pd-panel').forEach((p) => { els.panels[p.dataset.panel] = p; });

    els.close.addEventListener('click', close);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    els.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) selectTab(btn.dataset.tab);
    });
    // Rows inside the modal that point at another record (a diagnosis' appointment, etc.)
    scrim.addEventListener('click', (e) => {
      const row = e.target.closest('[data-focus-type]');
      if (!row) return;
      setFocus(row.dataset.focusType, row.dataset.focusId);
    });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('[data-focus-type]');
        if (row) { e.preventDefault(); setFocus(row.dataset.focusType, row.dataset.focusId); }
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.scrim.classList.contains('is-open')) close();
    });
  }

  // Declarative triggers: <div data-patient-id="…" data-appointment-id="…">
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-patient-id]');
    if (!trigger || trigger.closest('.pd-scrim')) return;
    if (e.target.closest('a[href], button, input, select, textarea') && !trigger.matches('a, button')) return;
    e.preventDefault();
    open({
      patientId: trigger.dataset.patientId,
      appointmentId: trigger.dataset.appointmentId || null,
      diagnosisId: trigger.dataset.diagnosisId || null,
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const trigger = e.target.closest && e.target.closest('[data-patient-id]');
    // Only when the trigger itself has focus, so Enter on a button inside it still just presses that button.
    if (!trigger || e.target !== trigger || trigger.closest('.pd-scrim')) return;
    e.preventDefault();
    open({
      patientId: trigger.dataset.patientId,
      appointmentId: trigger.dataset.appointmentId || null,
      diagnosisId: trigger.dataset.diagnosisId || null,
    });
  });

  /* ============================================================
     RENDER
     ============================================================ */
  function renderAll() {
    const p = state.patient;
    els.name.textContent = `${p.first_name} ${p.last_name}`;
    const bits = [];
    const age = ageOf(p.date_of_birth);
    if (age != null) bits.push(`${age} yrs`);
    if (p.phone) bits.push(p.phone);
    els.meta.textContent = bits.join(' · ');

    const allergies = (p.allergies || '').trim();
    if (allergies) {
      els.allergy.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 16.5v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.4 3.9 2.7 18a1.8 1.8 0 0 0 1.6 2.7h15.4a1.8 1.8 0 0 0 1.6-2.7L13.6 3.9a1.8 1.8 0 0 0-3.2 0Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        <span>Allergies: ${esc(allergies)}</span>`;
      els.allergy.style.display = 'flex';
    } else {
      els.allergy.style.display = 'none';
    }

    renderFocus();
    renderPatientPanel();
    renderDiagnosesPanel();
    renderAppointmentsPanel();
    renderPrescriptionsPanel();
    renderPlansPanel();
    renderMedicalAlerts();
    renderMedicalPanel();
    selectTab(state.activeTab);
  }

  function setFocus(type, id) {
    state.focus = { type, id };
    renderFocus();
    if (typeof els.focus.scrollIntoView === 'function') els.focus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---- focus card: the clicked appointment / diagnosis, in full ---- */
  function renderFocus() {
    const f = state.focus;
    if (!f) { els.focus.innerHTML = ''; return; }

    if (f.type === 'appointment') {
      const a = state.appointments.find((x) => String(x.id) === String(f.id));
      if (!a) { els.focus.innerHTML = notFoundCard('appointment'); return; }
      const dx = state.diagnoses.filter((d) => String(d.appointment_id) === String(a.id));
      const rx = state.prescriptions.filter((r) => dx.some((d) => String(d.id) === String(r.diagnosis_id)));
      const needsNotes = a.status === 'completed' && !dx.length;

      els.focus.innerHTML = `
        <section class="pd-focus" aria-label="Appointment details">
          <div class="pd-focus-head">
            <p class="pd-focus-kicker">Appointment</p>
            <span class="badge badge-${esc(a.status)}">${esc(cap(String(a.status).replace('_', ' ')))}</span>
          </div>
          <dl class="pd-grid">
            ${field('Date', fmtDate(a.scheduled_start))}
            ${field('Time', timeRange(a.scheduled_start, a.scheduled_end))}
            ${field('Reason', a.reason || '—')}
            ${field('Room', a.room || '—')}
            ${field('Dentist', dentistName(a.dentist_id))}
          </dl>
          <p class="pd-sub">Diagnosis for this visit</p>
          ${dx.length
            ? dx.map((d) => diagnosisBlock(d)).join('')
            : `<p class="pd-muted">${needsNotes ? 'Completed, but no diagnosis has been logged yet.' : 'No diagnosis logged for this appointment.'}</p>`}
          ${rx.length ? `<p class="pd-sub">Prescribed</p>${rx.map((r) => rxLine(r)).join('')}` : ''}
        </section>`;
      return;
    }

    const d = state.diagnoses.find((x) => String(x.id) === String(f.id));
    if (!d) { els.focus.innerHTML = notFoundCard('diagnosis'); return; }
    const appt = d.appointment_id ? state.appointments.find((x) => String(x.id) === String(d.appointment_id)) : null;
    const rx = state.prescriptions.filter((r) => String(r.diagnosis_id) === String(d.id));

    els.focus.innerHTML = `
      <section class="pd-focus" aria-label="Diagnosis details">
        <div class="pd-focus-head">
          <p class="pd-focus-kicker">Diagnosis</p>
          <span class="pd-when">${esc(fmtDate(d.created_at))}</span>
        </div>
        ${diagnosisBlock(d, { bare: true })}
        <dl class="pd-grid">
          ${field('Diagnosed by', dentistName(d.dentist_id))}
        </dl>
        ${appt ? `
          <p class="pd-sub">Visit</p>
          <div class="pd-row" role="button" tabindex="0" data-focus-type="appointment" data-focus-id="${esc(appt.id)}">
            <div class="pd-row-main">
              <p class="pd-row-t">${esc(fmtDate(appt.scheduled_start))} · ${esc(timeRange(appt.scheduled_start, appt.scheduled_end))}</p>
              <p class="pd-row-s">${esc(appt.reason || 'Appointment')}${appt.room ? ' · ' + esc(appt.room) : ''}</p>
            </div>
            <span class="badge badge-${esc(appt.status)}">${esc(cap(String(appt.status).replace('_', ' ')))}</span>
          </div>` : ''}
        <p class="pd-sub">Prescribed with this diagnosis</p>
        ${rx.length ? rx.map((r) => rxLine(r)).join('') : '<p class="pd-muted">No prescriptions linked to this diagnosis.</p>'}
      </section>`;
  }

  function diagnosisBlock(d, { bare = false } = {}) {
    const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];
    return `
      <div class="${bare ? 'pd-dx-bare' : 'pd-dx'}">
        <p class="pd-dx-text">${esc(d.diagnosis_text || 'No notes')}</p>
        ${teeth.length ? `<div class="pd-pills">${teeth.map((t) => `<span class="pd-pill">FDI ${esc(String(t))}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function rxLine(r) {
    const detail = [r.dosage, r.frequency, r.duration].filter(Boolean).join(' · ');
    return `
      <div class="pd-rx">
        <p class="pd-row-t">${esc(r.drug_name)}</p>
        <p class="pd-row-s">${esc(detail || '—')}${r.notes ? ' — ' + esc(r.notes) : ''}</p>
      </div>`;
  }

  function notFoundCard(kind) {
    return `<section class="pd-focus"><p class="pd-muted">That ${kind} could not be found in this patient's records.</p></section>`;
  }

  /* ---- tab panels ---- */
  function renderPatientPanel() {
    const p = state.patient;
    const age = ageOf(p.date_of_birth);
    els.panels.patient.innerHTML = `
      <dl class="pd-grid pd-grid-2">
        ${field('Full name', `${p.first_name} ${p.last_name}`)}
        ${field('Date of birth', p.date_of_birth ? `${fmtDate(p.date_of_birth)}${age != null ? ` (${age} yrs)` : ''}` : '—')}
        ${field('Phone', p.phone || '—')}
        ${field('Email', p.email || '—')}
        ${field('National ID', p.national_id || '—')}
        ${field('Address', p.address || '—')}
        ${field('Next of kin', p.next_of_kin_name || '—')}
        ${field('Next of kin phone', p.next_of_kin_phone || '—')}
        ${field('Allergies', (p.allergies || '').trim() || 'None recorded')}
      </dl>`;
  }

  /* ---- medical history (module: medicalHistory.js, loaded on demand) ---- */
  let mhLoader = null;
  function ensureMedicalHistory() {
    if (window.MedicalHistory) return Promise.resolve(true);
    if (!mhLoader) {
      mhLoader = new Promise((resolve) => {
        if (!document.querySelector('link[data-mh-css]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = '/css/medical-history.css';
          link.setAttribute('data-mh-css', '1');
          document.head.appendChild(link);
        }
        const s = document.createElement('script');
        s.src = '/js/medicalHistory.js';
        s.onload = () => resolve(true);
        s.onerror = () => { mhLoader = null; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return mhLoader;
  }

  // Never throws: { ok:false } when the module or the endpoints are unavailable.
  async function loadMedical(patientId) {
    const loaded = await ensureMedicalHistory();
    if (!loaded) return { ok: false, data: null, alerts: null };
    try {
      const [data, alerts] = await Promise.all([
        window.MedicalHistory.fetchCurrent(patientId),
        window.MedicalHistory.fetchAlerts(patientId).catch(() => null),
      ]);
      return { ok: true, data, alerts };
    } catch (e) {
      return { ok: false, data: null, alerts: null };
    }
  }

  async function reloadMedical() {
    if (!state.patient) return;
    const myToken = state.token;
    const fresh = await loadMedical(state.patient.id);
    if (myToken !== state.token) return;
    state.medical = fresh;
    state.failed.medical = !fresh.ok;
    renderMedicalAlerts();
    renderMedicalPanel();
  }

  function renderMedicalAlerts() {
    const m = state.medical;
    const list = m && m.ok && m.alerts && Array.isArray(m.alerts.standing) ? m.alerts.standing : [];
    if (!list.length || !window.MedicalHistory) {
      els.mhAlerts.style.display = 'none';
      els.mhAlerts.innerHTML = '';
      return;
    }
    els.mhAlerts.innerHTML = window.MedicalHistory.alertsHtml(list);
    els.mhAlerts.style.display = 'flex';
  }

  function renderMedicalPanel() {
    const el = els.panels.medical;
    const m = state.medical;
    if (!m || !m.ok || !window.MedicalHistory) {
      el.innerHTML = '<p class="pd-muted">Medical history is not available right now (you may not have permission to view it).</p>';
      return;
    }
    const p = state.patient;
    window.MedicalHistory.renderSummary(el, {
      patientId: p.id,
      patientName: `${p.first_name} ${p.last_name}`,
      data: m.data,
      alerts: m.alerts,
      onChange: reloadMedical,
    });
  }

  function renderDiagnosesPanel() {
    const el = els.panels.diagnoses;
    if (state.failed.diagnoses) { el.innerHTML = errorLine('diagnoses'); return; }
    if (!state.diagnoses.length) { el.innerHTML = '<p class="pd-muted">No diagnoses recorded for this patient.</p>'; return; }
    el.innerHTML = state.diagnoses.map((d) => {
      const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];
      return `
        <div class="pd-row" role="button" tabindex="0" data-focus-type="diagnosis" data-focus-id="${esc(d.id)}">
          <div class="pd-row-main">
            <p class="pd-row-t">${esc(truncate(d.diagnosis_text || 'No notes', 90))}</p>
            <p class="pd-row-s">${esc(fmtDate(d.created_at))} · ${esc(dentistName(d.dentist_id))}${teeth.length ? ' · FDI ' + esc(teeth.join(', ')) : ''}</p>
          </div>
          <span class="pd-chev" aria-hidden="true">›</span>
        </div>`;
    }).join('');
  }

  function renderAppointmentsPanel() {
    const el = els.panels.appointments;
    if (state.failed.appointments) { el.innerHTML = errorLine('appointments'); return; }
    if (!state.appointments.length) { el.innerHTML = '<p class="pd-muted">No appointments for this patient.</p>'; return; }
    el.innerHTML = state.appointments.map((a) => `
      <div class="pd-row" role="button" tabindex="0" data-focus-type="appointment" data-focus-id="${esc(a.id)}">
        <div class="pd-row-main">
          <p class="pd-row-t">${esc(fmtDate(a.scheduled_start))} · ${esc(timeRange(a.scheduled_start, a.scheduled_end))}</p>
          <p class="pd-row-s">${esc(a.reason || 'Appointment')}${a.room ? ' · ' + esc(a.room) : ''} · ${esc(dentistName(a.dentist_id))}</p>
        </div>
        <span class="badge badge-${esc(a.status)}">${esc(cap(String(a.status).replace('_', ' ')))}</span>
      </div>`).join('');
  }

  function renderPrescriptionsPanel() {
    const el = els.panels.prescriptions;
    if (state.failed.prescriptions) { el.innerHTML = errorLine('prescriptions'); return; }
    if (!state.prescriptions.length) { el.innerHTML = '<p class="pd-muted">No prescriptions for this patient.</p>'; return; }
    el.innerHTML = state.prescriptions.map((r) => `
      <div class="pd-rx">
        <p class="pd-row-t">${esc(r.drug_name)} <span class="pd-when">${esc(fmtDate(r.created_at))}</span></p>
        <p class="pd-row-s">${esc([r.dosage, r.frequency, r.duration].filter(Boolean).join(' · ') || '—')}${r.notes ? ' — ' + esc(r.notes) : ''}</p>
      </div>`).join('');
  }

  function renderPlansPanel() {
    const el = els.panels.plans;
    if (state.failed.plans) { el.innerHTML = errorLine('treatment plans'); return; }
    if (!state.plans.length) { el.innerHTML = '<p class="pd-muted">No treatment plans for this patient.</p>'; return; }
    el.innerHTML = state.plans.map((pl) => {
      const cost = pl.estimated_cost != null ? 'KSh ' + Number(pl.estimated_cost).toLocaleString('en-KE') : '';
      return `
        <div class="pd-rx">
          <div class="pd-focus-head">
            <p class="pd-row-t">${esc(truncate(pl.description || 'No description', 90))}</p>
            <span class="badge badge-${esc(pl.status)}">${esc(cap(String(pl.status).replace('_', ' ')))}</span>
          </div>
          <p class="pd-row-s">${esc(fmtDate(pl.created_at))}${cost ? ' · ' + esc(cost) : ''}</p>
        </div>`;
    }).join('');
  }

  /* ============================================================
     TABS / LOADING
     ============================================================ */
  function selectTab(id) {
    state.activeTab = id;
    els.tabs.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(els.panels).forEach((k) => els.panels[k].classList.toggle('is-active', k === id));
  }

  function setLoading() {
    Object.values(els.panels).forEach((p) => { p.innerHTML = '<p class="pd-muted pd-loading">Loading…</p>'; });
  }

  function setPanelsMessage(msg) {
    Object.values(els.panels).forEach((p) => { p.innerHTML = `<p class="pd-muted">${esc(msg)}</p>`; });
    els.focus.innerHTML = '';
  }

  function errorLine(what) {
    return `<p class="pd-muted">Could not load ${what}. Close and reopen to try again.</p>`;
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  async function loadDentists() {
    if (state.dentistsById) return;
    try {
      const list = await fetchMethod('/users/dentists', 'GET', null, true);
      state.dentistsById = {};
      list.forEach((d) => { state.dentistsById[d.id] = d; });
    } catch (e) {
      state.dentistsById = {}; // non-fatal: labels fall back to "Another dentist"
    }
  }

  function dentistName(id) {
    if (!id) return 'Unknown dentist';
    if (session && id === session.id) return 'You';
    const d = state.dentistsById && state.dentistsById[id];
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Another dentist';
  }

  function field(label, value) {
    return `<div class="pd-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  }

  function timeRange(start, end) {
    if (!start) return '—';
    return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start);
  }

  function ageOf(dob) {
    if (!dob) return null;
    const b = new Date(dob);
    if (Number.isNaN(b.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 ? age : null;
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();
