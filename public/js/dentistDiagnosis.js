(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'dentist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     TOOTH REFERENCE DATA
     ============================================================ */
  // Tooth lists, names and layout for BOTH dentitions (permanent 11-48,
  // primary 51-85) live in toothShapes.js under the `Dentition` global.
  // Names can't be derived from the FDI digits alone: position 4/5 is a
  // premolar in quadrants 1-4 but a molar in quadrants 5-8.

  // Condition options are category-scoped: a Medical finding picks from
  // the clinical set below, a Cosmetic finding from the aesthetic set.
  // Both sets get merged into one lookup for parsing diagnosis_text back
  // out (ALL_CONDITION_LABELS) since a stored diagnosis could be either.
  const CONDITION_SETS = {
    medical: { caries: 'Caries', filled: 'Filled / restored', missing: 'Missing / extracted', crown: 'Crown' },
    cosmetic: { whitening: 'Whitening', veneer: 'Veneer', bonding: 'Bonding', contouring: 'Contouring', smile_design: 'Smile Design' },
  };
  // Pediatric/developmental findings (exfoliated, unerupted, sealant,
  // pulpotomy) are defined in toothShapes.js. They're offered under Medical,
  // filtered by the tooth's dentition (see populateConditionOptions), and
  // included here so a saved "Condition: Exfoliated" parses back out.
  const ALL_CONDITION_LABELS = { ...CONDITION_SETS.medical, ...CONDITION_SETS.cosmetic, ...Dentition.conditionLabels() };

  /* ---- Tooth surfaces ----
     M mesial, D distal, O occlusal (back teeth), I incisal (front teeth),
     B buccal/labial, L lingual/palatal. Stored in canonical order so
     "occlusal + distal" is always O, D (charted as "OD"). */
  const SURFACE_ORDER = ['M', 'O', 'I', 'D', 'B', 'L'];
  const SURFACE_NAMES = { M: 'Mesial', O: 'Occlusal', I: 'Incisal', D: 'Distal', B: 'Buccal', L: 'Lingual' };

  function sortSurfaces(list) {
    const set = new Set(list);
    return SURFACE_ORDER.filter((s) => set.has(s));
  }
  function surfaceNames(codes) { return sortSurfaces(codes).map((s) => SURFACE_NAMES[s]).join(', '); }
  function surfaceCode(codes) { return sortSurfaces(codes).join(''); }

  // "Mesial, Occlusal" (or "MO") -> ['M','O']
  function parseSurfaces(text) {
    const m = (text || '').match(/Surfaces:\s*([^·—]+)/i);
    if (!m) return [];
    const found = [];
    m[1].split(/[,/&\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((tok) => {
      const code = SURFACE_ORDER.find((c) => SURFACE_NAMES[c].toLowerCase() === tok);
      if (code) found.push(code);
    });
    return sortSurfaces(found);
  }

  function toothLabel(fdi) {
    const d = Dentition.describe(fdi);
    return { name: d.positionName, quadrant: d.quadrantName, universal: d.universal, isPrimary: d.isPrimary };
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id,
    appointments: [],
    patientsById: {},
    services: [],
    activeAppointment: null,
    activePatient: null,
    diagnoses: [],        // full diagnosis history for the active patient
    files: [],             // patient files (X-rays, etc.) tagged to this appointment
    selectedTooth: null,  // currently open-in-modal tooth (FDI number as string)
    editingDiagnosisId: null, // set while the tooth modal is editing an existing finding instead of creating one
    activeCategory: 'medical', // which category the odontogram/timeline are showing
    dentition: 'permanent',    // which arch is drawn: 'permanent' (32 teeth) or 'primary' (20 teeth)
    pickerTab: 'today',    // 'today' | 'upcoming' | 'past' — ignored while pickerSearch is non-empty
    pickerSearch: '',      // patient-name search, overrides the tab and searches the full fetched range
    selectToken: 0,        // bumped on every patient click so a slow medical-history check can't open a stale chart
  };

  const TAB_LABEL = { today: 'today', upcoming: 'upcoming', past: 'in the past' };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initToothModal();
    initPatientInfoModal();
    initCategoryToggle();
    initDentitionToggle();
    initAppointmentPickerControls();
    initFlow();
    renderLegend();
    document.getElementById('switchPatientBtn').addEventListener('click', showAppointmentPicker);
    document.getElementById('downloadPatientToothChartBtn').addEventListener('click', downloadActivePatientToothChart);
    document.getElementById('checkupSaveBtn').addEventListener('click', saveCheckup);
    document.getElementById('diagnosisFileInput').addEventListener('change', onDiagnosisFileSelected);
    loadInitialData();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadInitialData() {
    try {
      const { from, to } = pickerRangeIso();
      const [appointments, patients, services] = await Promise.all([
        fetchMethod(`/appointments/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
        fetchMethod('/services', 'GET', null, true),
      ]);

      state.appointments = appointments
        .filter((a) => a.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });
      state.services = services;

      renderAppointmentPicker();
      populateProcedureSelect();
    } catch (err) {
      handleLoadError(err);
    }
  }

  function handleLoadError(err) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    showToast(err.message || 'Could not load your schedule. Please refresh.');
  }

  /* ============================================================
     APPOINTMENT PICKER
     ------------------------------------------------------------
     state.appointments holds everything fetched for the wide
     pickerRangeIso() window (past + future). Which subset is shown
     is computed on every render from state.pickerTab / pickerSearch
     rather than re-fetched — the backend already returned the full
     range, so narrowing is just client-side filtering.
     ============================================================ */
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function getFilteredAppointments() {
    const query = state.pickerSearch.trim().toLowerCase();

    if (query) {
      const matches = state.appointments.filter((appt) => {
        const patient = state.patientsById[appt.patient_id];
        const name = patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase() : '';
        return name.includes(query);
      });
      // Searching spans the whole fetched range (any date), so sort by
      // closeness to now rather than status/tab — most clinically
      // relevant appointment (nearest past or next upcoming) first.
      const now = Date.now();
      return [...matches].sort((a, b) =>
        Math.abs(new Date(a.scheduled_start) - now) - Math.abs(new Date(b.scheduled_start) - now));
    }

    const now = new Date();
    if (state.pickerTab === 'upcoming') {
      return state.appointments
        .filter((appt) => new Date(appt.scheduled_start) > now && !isSameDay(new Date(appt.scheduled_start), now))
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
    }
    if (state.pickerTab === 'past') {
      return state.appointments
        .filter((appt) => new Date(appt.scheduled_start) < now && !isSameDay(new Date(appt.scheduled_start), now))
        .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start)); // most recent past first
    }
    // 'today'
    return state.appointments
      .filter((appt) => isSameDay(new Date(appt.scheduled_start), now))
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
  }

  function initAppointmentPickerControls() {
    const tabToggle = document.getElementById('apptTabToggle');
    if (tabToggle) {
      tabToggle.querySelectorAll('.segmented-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          if (tab === state.pickerTab) return;
          state.pickerTab = tab;
          tabToggle.querySelectorAll('.segmented-opt').forEach((b) => b.classList.toggle('is-active', b === btn));
          renderAppointmentPicker();
        });
      });
    }

    const searchInput = document.getElementById('apptSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.pickerSearch = searchInput.value;
        renderAppointmentPicker();
      });
    }
  }

  function renderAppointmentPicker() {
    const list = document.getElementById('apptPickerList');
    const filtered = getFilteredAppointments();
    const query = state.pickerSearch.trim();

    document.getElementById('apptPickerCount').textContent = query
      ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} for "${query}"`
      : `${filtered.length} appointment${filtered.length === 1 ? '' : 's'} ${TAB_LABEL[state.pickerTab]}`;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">${query ? 'No appointments match that name.' : 'Nothing in this range.'}</div>`;
      return;
    }

    // Once we're outside the "today" tab (or searching across all
    // dates), the time alone is ambiguous — show the date too.
    const showDate = !!query || state.pickerTab !== 'today';

    list.innerHTML = '';
    filtered.forEach((appt) => {
      const patient = state.patientsById[appt.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const time = new Date(appt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const timeLabel = showDate ? `${formatDate(appt.scheduled_start)}<br>${time}` : time;

      const row = document.createElement('div');
      row.className = 'sched-item is-selectable';
      if (state.activeAppointment && state.activeAppointment.id === appt.id) row.classList.add('is-active-appt');
      row.innerHTML = `
        <div class="sched-time">${timeLabel}</div>
        <div class="sched-avatar">${initialsOf(patientName)}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(patientName)}</p>
          <p class="s">${escapeHtml(appt.reason || 'Appointment')}${appt.room ? ' · ' + escapeHtml(appt.room) : ''}</p>
        </div>
        <div class="sched-flags">
          <span class="badge badge-${appt.status}">${capitalize(appt.status)}</span>
        </div>
      `;
      row.addEventListener('click', () => selectAppointment(appt));
      list.appendChild(row);
    });
  }

  /* ============================================================
     MEDICAL HISTORY GATE
     ------------------------------------------------------------
     Clicking a patient does NOT open the chart straight away. The
     medical history form comes first (it can't be dismissed), and
     the odontogram only opens once it's saved. The form shows only when:
       1. the patient has no medical history at all, or
       2. the latest history is more than 6 months old.
     Otherwise the chart opens directly — the dentist can still
     open/update the history from "Patient details".
     ============================================================ */
  async function selectAppointment(appt) {
    const patient = state.patientsById[appt.patient_id] || null;
    if (!patient) {
      showToast('Could not find this patient\'s record.');
      return;
    }

    const myToken = ++state.selectToken;

    // Nothing clinical stays on screen from the previous patient while we check.
    setFlowVisible(false);

    let needsForm = true;
    try {
      if (!window.MedicalHistory) throw new Error('The medical history form did not load. Please refresh the page.');
      const data = await window.MedicalHistory.fetchCurrent(patient.id);
      if (myToken !== state.selectToken) return; // dentist clicked someone else meanwhile
      needsForm = !data.current || isOlderThanSixMonths(data.current);
    } catch (err) {
      if (myToken !== state.selectToken) return;
      const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
      if (authFailures.includes(err.message)) { handleLoadError(err); return; }
      showToast(err.message || 'Could not check this patient\'s medical history. Please try again.');
      return;
    }

    if (!needsForm) {
      openCharting(appt, patient);
      return;
    }

    window.MedicalHistory.open({
      patientId: patient.id,
      patientName: `${patient.first_name} ${patient.last_name}`,
      required: true,
      onSaved: async () => {
        // The form may have changed the patient's allergies — pick that up before charting.
        await refreshPatient(patient.id);
        openCharting(appt, state.patientsById[patient.id] || patient);
      },
      onCancel: () => showToast('Complete the medical history to open the chart.'),
    });
  }

  // Age of the latest history, counted from when it was last reviewed (or, if it
  // was never reviewed, when it was recorded). 180 days, same as the server's rule.
  function isOlderThanSixMonths(current) {
    const when = new Date(current.reviewed_at || current.created_at);
    if (isNaN(when.getTime())) return true; // unreadable date: safer to ask again
    return (Date.now() - when.getTime()) / 86400000 > 180;
  }

  async function refreshPatient(patientId) {
    try {
      const fresh = await fetchMethod(`/patients/${patientId}`, 'GET', null, true);
      state.patientsById[patientId] = { ...state.patientsById[patientId], ...fresh };
    } catch (err) { /* keep the copy we already have */ }
  }

  async function openCharting(appt, patient) {
    state.activeAppointment = appt;
    state.activePatient = patient;
    state.selectedTooth = null;

    // Open on the dentition that fits the patient's age (primary under 6);
    // the dentist can still flip it with the toggle for mixed dentition.
    state.dentition = Dentition.suggestFor(state.activePatient);
    syncDentitionToggle();
    renderLegend();

    renderAppointmentPicker();

    resetFlow();
    setFlowVisible(true);
    document.getElementById('chartingPatientName').textContent = `— ${state.activePatient.first_name} ${state.activePatient.last_name}`;
    renderChartingAllergy();

    document.getElementById('odontogramHost').innerHTML = '<div class="empty-state">Loading diagnosis history…</div>';
    document.getElementById('diagnosisTimeline').innerHTML = '';
    document.getElementById('checkupTimeline').innerHTML = '';
    document.getElementById('diagnosisFileList').innerHTML = '<div class="empty-state">Loading files…</div>';
    resetCheckupForm();

    try {
      const [diagnoses, files] = await Promise.all([
        fetchMethod(`/diagnoses/patient/${state.activePatient.id}`, 'GET', null, true),
        fetchMethod(`/patient-files/patient/${state.activePatient.id}`, 'GET', null, true),
      ]);
      // Sort newest-first explicitly rather than trusting API order —
      // latestConditionForTooth() depends on this to pick the true
      // latest finding per tooth (e.g. caries superseded by a later fill).
      state.diagnoses = diagnoses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.files = files;
      renderOdontogram();
      renderDiagnosisTimeline();
      renderToothDetail();
      renderCheckupTimeline();
      renderDiagnosisFiles();
      updateFlowStatus();
    } catch (err) {
      handleLoadError(err);
    }
  }

  /* ============================================================
     PATIENT DETAILS MODAL
     ------------------------------------------------------------
     The bio data the receptionist captured at registration, kept
     in a modal so it doesn't crowd the charting page. Allergies
     are the one exception: they also show as a thin strip above
     the odontogram whenever the patient has any.
     ============================================================ */
  function hasAllergies(p) {
    if (!p || !p.allergies) return false;
    const v = String(p.allergies).trim().toLowerCase();
    return v !== '' && v !== 'none' && v !== 'n/a' && v !== 'na' && v !== 'nil';
  }

  function ageFromDob(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }

  const WARN_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 16.5v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.4 3.9 2.7 18a1.8 1.8 0 0 0 1.6 2.7h15.4a1.8 1.8 0 0 0 1.6-2.7L13.6 3.9a1.8 1.8 0 0 0-3.2 0Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  function renderChartingAllergy() {
    const el = document.getElementById('chartingAllergyAlert');
    const p = state.activePatient;
    if (hasAllergies(p)) {
      el.innerHTML = `${WARN_ICON}<span>Allergies: ${escapeHtml(p.allergies)}</span>`;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  function initPatientInfoModal() {
    const scrim = document.getElementById('patientInfoScrim');
    const close = () => scrim.classList.remove('is-open');
    document.getElementById('patientInfoBtn').addEventListener('click', openPatientInfo);
    document.getElementById('patientInfoClose').addEventListener('click', close);
    document.getElementById('patientInfoDoneBtn').addEventListener('click', close);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) close();
    });

    // Open the shared medical history form on top (not a gate here — it can be closed).
    document.getElementById('patientInfoMedicalBtn').addEventListener('click', () => {
      const p = state.activePatient;
      if (!p || !window.MedicalHistory) return;
      window.MedicalHistory.open({
        patientId: p.id,
        patientName: `${p.first_name} ${p.last_name}`,
        onSaved: async () => {
          await refreshPatient(p.id);
          if (state.activePatient && state.activePatient.id === p.id) {
            state.activePatient = state.patientsById[p.id] || state.activePatient;
            renderChartingAllergy();
            renderPatientInfo();
          }
          showToast('Medical history saved.');
        },
      });
    });
  }

  function openPatientInfo() {
    if (!state.activePatient) return;
    renderPatientInfo();
    document.getElementById('patientInfoScrim').classList.add('is-open');
  }

  function renderPatientInfo() {
    const p = state.activePatient;
    if (!p) return;
    const age = ageFromDob(p.date_of_birth);

    document.getElementById('patientInfoName').textContent = `${p.first_name} ${p.last_name}`;
    document.getElementById('patientInfoMeta').textContent =
      [age != null ? `${age} yrs` : null, p.phone].filter(Boolean).join(' · ');

    const allergyEl = document.getElementById('patientInfoAllergy');
    if (hasAllergies(p)) {
      allergyEl.innerHTML = `${WARN_ICON}<span>Allergies: ${escapeHtml(p.allergies)}</span>`;
      allergyEl.style.display = 'flex';
    } else {
      allergyEl.style.display = 'none';
      allergyEl.innerHTML = '';
    }

    const rows = [
      ['Full name', `${p.first_name} ${p.last_name}`],
      ['Date of birth', p.date_of_birth ? `${formatDate(p.date_of_birth)}${age != null ? ` (${age} yrs)` : ''}` : null],
      ['Phone', p.phone],
      ['Email', p.email],
      ['National ID', p.national_id],
      ['Address', p.address],
      ['Next of kin', p.next_of_kin_name],
      ['Next of kin phone', p.next_of_kin_phone],
      ['Allergies', hasAllergies(p) ? p.allergies : null, 'None recorded'],
      ['Registered on', p.created_at ? formatDate(p.created_at) : null],
    ];
    document.getElementById('patientInfoGrid').innerHTML = rows.map(([label, value, emptyText]) => `
      <div class="pinfo-cell">
        <p class="pinfo-label">${escapeHtml(label)}</p>
        <p class="pinfo-value">${value ? escapeHtml(String(value)) : escapeHtml(emptyText || '—')}</p>
      </div>
    `).join('');
  }

  function showAppointmentPicker() {
    setFlowVisible(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  /* ============================================================
     VISIT FLOW
     ------------------------------------------------------------
     Once an appointment is picked, the visit runs as five steps
     on this one page — no pop-up windows for the big forms:
       1. History & exam   (PC, HoPC, PMH, PDH, gums, bite, TMJ…)
       2. Tooth chart      (per-tooth findings)
       3. Perio chart      (embedded full-mouth probing chart)
       4. X-rays & files
       5. SOAP note        (embedded; pre-filled from steps 1–4, then signed)
     The perio chart and SOAP note are mounted lazily the first
     time their step is opened, and kept (with anything half-typed)
     while the dentist moves around.
     ============================================================ */
  const FLOW_STEPS = [
    // `optional: true` steps get a "Skip this step" button. History & exam and the SOAP note
    // are always done; change a flag here if your clinic wants a different set.
    { key: 'exam',    label: 'History & exam' },
    { key: 'teeth',   label: 'Tooth chart',    optional: true },
    { key: 'perio',   label: 'Perio chart',    optional: true },
    { key: 'ortho',   label: 'Orthodontics',   optional: true },
    { key: 'imaging', label: 'X-rays & files', optional: true },
    { key: 'soap',    label: 'SOAP note' },
    { key: 'review',  label: 'Review & sign' },
  ];
  const flow = { step: 'exam', perioMounted: false, orthoMounted: false, soapMounted: false, perio: null, ortho: null, soap: null, completing: false, skipped: {}, returnTo: false };

  function setFlowVisible(on) {
    document.getElementById('visitFlow').classList.toggle('is-open', !!on);
    document.body.style.overflow = on ? 'hidden' : '';
  }

  // Closing the visit window. Anything already saved stays saved; an unsigned, half-written
  // SOAP note is the only thing that can be lost, so ask first in that case.
  function requestCloseFlow() {
    const hasUnsavedSoap = flow.soapMounted && !(flow.soap && flow.soap.signed) &&
      ['cnS', 'cnO', 'cnA', 'cnP', 'cnProc'].some((id) => { const el = document.getElementById(id); return el && el.value.trim(); }) &&
      !(flow.soap && flow.soap.draft);
    if (hasUnsavedSoap && !window.confirm('Close this visit? The SOAP note you are writing has not been saved.')) return;
    setFlowVisible(false);
  }

  function resetFlow() {
    flow.step = 'exam';
    flow.perioMounted = false;
    flow.soapMounted = false;
    flow.perio = null;
    flow.orthoMounted = false;
    flow.ortho = null;
    flow.soap = null;
    flow.completing = false;
    flow.skipped = {};
    flow.returnTo = false;
    document.getElementById('flowReviewHost').innerHTML = '';
    document.getElementById('flowPerioHost').innerHTML = '';
    document.getElementById('flowOrthoHost').innerHTML = '';
    document.getElementById('flowSoapHost').innerHTML = '';
    showStep('exam');
    updateFlowStatus();
  }

  function initFlow() {
    const nav = document.getElementById('vfSteps');
    nav.innerHTML = FLOW_STEPS.map((st, i) => `
      <button type="button" class="vf-step-btn${i === 0 ? ' is-active' : ''}" data-step="${st.key}">
        <span class="vf-num">${i + 1}</span>
        <span class="vf-label">${st.label}</span>
        <span class="vf-status" data-status="${st.key}"></span>
      </button>`).join('');
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.vf-step-btn');
      if (btn) goStep(btn.dataset.step);
    });
    document.getElementById('vfBack').addEventListener('click', () => stepBy(-1));
    document.getElementById('vfNext').addEventListener('click', onNext);
    document.getElementById('vfClose').addEventListener('click', requestCloseFlow);
    document.getElementById('vfSkip').addEventListener('click', () => {
      flow.skipped[flow.step] = true;
      updateFlowStatus();
      stepBy(1);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // Let the smaller pop-ups (tooth finding, patient details, medical history) close first.
      if (document.querySelector('.modal-scrim.is-open:not(.vf-scrim)')) return;
      if (document.getElementById('visitFlow').classList.contains('is-open')) requestCloseFlow();
    });
  }

  // Next / "Back to review" / "Complete & sign", depending on where the dentist is.
  function onNext() {
    // Came here from an Edit button on the review page: go straight back to it.
    if (flow.returnTo && flow.step !== 'review') { goStep('review'); return; }
    if (flow.step !== 'review') { stepBy(1); return; }

    // Review step: sign the SOAP note, then close the visit.
    const signBtn = document.querySelector('#flowSoapHost #cnSaveSign');
    if (signBtn) {
      flow.completing = true;
      signBtn.click(); // runs the note's own checks; a problem shows up synchronously
      const err = document.getElementById('cnError');
      if (err && err.style.display === 'block') {
        flow.completing = false;
        showToast('The SOAP note needs attention before it can be signed.');
        flow.returnTo = true;
        goStep('soap');
      }
      return;
    }
    if (flow.soap && flow.soap.signed) {
      setFlowVisible(false);
      showToast('Visit complete.');
      return;
    }
    showToast('The note is still loading — try again in a moment.');
  }

  function stepBy(delta) {
    const i = FLOW_STEPS.findIndex((s) => s.key === flow.step);
    const target = FLOW_STEPS[i + delta];
    if (target) goStep(target.key);
  }

  function checkupHasInput() {
    const ids = ['checkupPC', 'checkupHoPC', 'checkupPmhx', 'checkupPdhx', 'checkupTxPlan', 'checkupTxDone',
      'checkupTca', 'checkupGums', 'checkupBite', 'checkupSoftTissue', 'checkupHygiene', 'checkupTmj', 'checkupNotes'];
    return ids.some((id) => document.getElementById(id).value.trim());
  }

  async function goStep(key) {
    if (key === flow.step) return;
    // Leaving the history step with something typed: save it so nothing is lost.
    if (flow.step === 'exam' && checkupHasInput()) {
      await saveCheckup();
      if (checkupHasInput()) return; // the save failed; stay so the dentist sees the message
    }
    if (key === 'review') flow.returnTo = false;
    showStep(key);
    document.getElementById('vfBody').scrollTop = 0;
  }

  function showStep(key) {
    flow.step = key;
    document.querySelectorAll('#visitFlow .vf-step').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.step === key);
    });
    document.querySelectorAll('#vfSteps .vf-step-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.step === key);
    });
    const i = FLOW_STEPS.findIndex((s) => s.key === key);
    document.getElementById('vfBack').style.visibility = i === 0 ? 'hidden' : 'visible';
    const next = document.getElementById('vfNext');
    const isLast = i === FLOW_STEPS.length - 1;
    if (flow.returnTo && !isLast) next.textContent = 'Back to review →';
    else next.textContent = isLast ? 'Complete & sign' : `Next: ${FLOW_STEPS[i + 1].label} →`;
    next.classList.toggle('is-final', isLast);
    document.getElementById('vfSkip').style.display = (FLOW_STEPS[i].optional && !flow.returnTo) ? '' : 'none';
    document.getElementById('vfNavLabel').textContent = `Step ${i + 1} of ${FLOW_STEPS.length}`;

    if (key !== 'review') flow.completing = false;
    if (key === 'perio') mountPerio();
    if (key === 'ortho') mountOrtho();
    if (key === 'soap') mountSoap();
    if (key === 'review') { mountSoap(); renderReview(); }
  }

  function patientDisplayName() {
    const p = state.activePatient;
    return p ? `${p.first_name} ${p.last_name}` : '';
  }

  function mountPerio() {
    if (flow.perioMounted || !state.activePatient) return;
    const host = document.getElementById('flowPerioHost');
    if (!window.PerioChart || !window.PerioSummary) {
      host.innerHTML = '<div class="empty-state">The perio chart module could not be loaded. Please refresh the page.</div>';
      return;
    }
    flow.perioMounted = true;
    window.PerioChart.render(host, {
      patientId: state.activePatient.id,
      patientName: patientDisplayName(),
      inline: true,
      onLoaded: (charts) => { flow.perio = charts; updateFlowStatus(); },
    });
  }

  function mountOrtho() {
    if (flow.orthoMounted || !state.activePatient) return;
    const host = document.getElementById('flowOrthoHost');
    if (!window.Orthodontics) {
      host.innerHTML = '<div class="empty-state">The orthodontics module could not be loaded. Please refresh the page.</div>';
      return;
    }
    flow.orthoMounted = true;
    window.Orthodontics.render(host, {
      patientId: state.activePatient.id,
      patientName: patientDisplayName(),
      onLoaded: (cases) => { flow.ortho = cases; updateFlowStatus(); },
    });
  }

  function mountSoap() {
    if (flow.soapMounted || !state.activePatient || !state.activeAppointment) return;
    const host = document.getElementById('flowSoapHost');
    if (!window.ClinicalNotes) {
      host.innerHTML = '<div class="empty-state">The clinical notes module could not be loaded. Please refresh the page.</div>';
      return;
    }
    flow.soapMounted = true;
    window.ClinicalNotes.render(host, {
      patientId: state.activePatient.id,
      patientName: patientDisplayName(),
      visit: { appointment: state.activeAppointment, getPrefill: buildSoapPrefill, onReady: () => { if (flow.step === 'review') renderReview(); } },
      onLoaded: (info) => {
        flow.soap = info;
        updateFlowStatus();
        // The note was just signed from "Complete & sign": the visit is done.
        if (flow.completing && info.signed) {
          flow.completing = false;
          setFlowVisible(false);
          showToast('Visit complete — note signed.');
        } else if (flow.step === 'review') {
          renderReview();
        }
      },
    });
  }

  // Small dot / count on each step so the dentist can see at a glance what's been done.
  function updateFlowStatus() {
    const appt = state.activeAppointment;
    if (!appt) return;
    const apptId = String(appt.id);
    const mine = state.diagnoses.filter((d) => String(d.appointment_id) === apptId);
    const set = (key, text, done) => {
      const el = document.querySelector(`#vfSteps [data-status="${key}"]`);
      if (!el) return;
      // Skipped and nothing recorded: say so. Recording something later overrides it.
      el.textContent = (!text && flow.skipped[key]) ? 'skipped' : text;
      el.classList.toggle('is-done', !!done);
      el.classList.toggle('is-skipped', !text && !!flow.skipped[key]);
    };
    const checkups = mine.filter(isCheckupDiagnosis).length;
    set('exam', checkups ? '✓' : '', checkups);

    const findings = mine.filter((d) => !isCheckupDiagnosis(d)).length;
    set('teeth', findings ? String(findings) : '', findings);

    if (!flow.perio) set('perio', '', false);
    if (flow.perio) {
      const finals = flow.perio.filter((c) => c.status === 'final').length;
      const drafts = flow.perio.filter((c) => c.status === 'draft').length;
      set('perio', drafts ? 'draft' : (finals ? `${finals}` : ''), finals && !drafts);
    }

    if (!flow.ortho) set('ortho', '', false);
    if (flow.ortho) {
      const open = flow.ortho.filter((c) => ['planning', 'active', 'retention'].includes(c.status)).length;
      set('ortho', open ? 'active' : (flow.ortho.length ? String(flow.ortho.length) : ''), open);
    }

    const files = state.files.filter((f) => String(f.appointment_id) === apptId).length;
    set('imaging', files ? String(files) : '', files);

    const nextBtn = document.getElementById('vfNext');
    if (flow.step === 'review' && flow.soap && flow.soap.signed) nextBtn.textContent = 'Finish';
    if (flow.soap) set('soap', flow.soap.signed ? 'signed' : (flow.soap.draft ? 'draft' : ''), flow.soap.signed);
  }


  /* ---------- Review & sign: everything recorded for this visit, with Edit buttons ---------- */
  const CHECKUP_LABELS = [
    ['pc', 'Presenting complaint'], ['hopc', 'History of presenting complaint'], ['pmhx', 'Past medical history'],
    ['pdhx', 'Past dental history'], ['gums', 'Gums / periodontal'], ['hygiene', 'Oral hygiene'], ['bite', 'Bite / occlusion'],
    ['soft', 'Tongue & soft tissue'], ['tmj', 'TMJ'], ['txPlan', 'Treatment plan'], ['txDone', 'Treatment done'],
    ['tca', 'To come again'], ['notes', 'Notes'],
  ];

  async function renderReview() {
    const host = document.getElementById('flowReviewHost');
    const appt = state.activeAppointment;
    const patient = state.activePatient;
    if (!appt || !patient) return;
    const apptId = String(appt.id);

    // Perio charts: use what the perio step already loaded, otherwise fetch once.
    if (!flow.perio) {
      try { flow.perio = await fetchMethod(`/perio-charts/patient/${patient.id}`, 'GET', null, true); } catch (e) { flow.perio = []; }
    }
    if (flow.step !== 'review') return;

    const mine = state.diagnoses.filter((d) => String(d.appointment_id) === apptId).slice().reverse();
    const cu = {};
    mine.filter(isCheckupDiagnosis).forEach((d) => Object.assign(cu, parseCheckup(d.diagnosis_text)));
    const findings = mine.filter((d) => !isCheckupDiagnosis(d) && Array.isArray(d.tooth_refs) && d.tooth_refs.length);
    const files = state.files.filter((f) => String(f.appointment_id) === apptId);
    const perio = (flow.perio || []).find((c) => c.summary && c.summary.sites_measured) || (flow.perio || [])[0] || null;

    // SOAP: what's in the editor right now, else the saved note.
    const fieldVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
    const hasEditor = fieldVal('cnS') !== null;
    let soap = null;
    let soapState = '';
    if (hasEditor) {
      soap = { subjective: fieldVal('cnS'), objective: fieldVal('cnO'), assessment: fieldVal('cnA'), procedure_done: fieldVal('cnProc'), plan: fieldVal('cnP') };
      soapState = 'Not signed yet';
    } else if (flow.soap && flow.soap.current) {
      soap = flow.soap.current;
      soapState = flow.soap.signed ? 'Signed' : 'Draft';
    }

    const row = (label, value) => `<div class="vf-rv-row"><span class="vf-rv-k">${escapeHtml(label)}</span><span class="vf-rv-v">${escapeHtml(value)}</span></div>`;
    const block = (key, title, chip, chipClass, bodyHtml) => `
      <article class="vf-rv-card">
        <div class="vf-rv-head">
          <h3>${escapeHtml(title)}</h3>
          <span class="vf-rv-chip ${chipClass || ''}">${escapeHtml(chip)}</span>
          <button type="button" class="btn btn-outline btn-sm" data-vf-edit="${key}">Edit</button>
        </div>
        <div class="vf-rv-body">${bodyHtml}</div>
      </article>`;
    const none = (skippedKey) => `<p class="vf-rv-empty">${flow.skipped[skippedKey] ? 'Skipped for this visit.' : 'Nothing recorded.'}</p>`;

    /* 1. History & exam */
    const examRows = CHECKUP_LABELS.filter(([k]) => cu[k]).map(([k, l]) => row(l, cu[k])).join('');
    const exam = block('exam', 'History & examination', examRows ? 'Recorded' : 'Empty', examRows ? 'is-done' : '', examRows || '<p class="vf-rv-empty">Nothing recorded.</p>');

    /* 2. Tooth chart */
    const teeth = block('teeth', 'Tooth chart', findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : (flow.skipped.teeth ? 'Skipped' : 'None'), findings.length ? 'is-done' : '',
      findings.length ? findings.map((d) => row(`Tooth ${d.tooth_refs.join(', ')}`, findingBody(d.diagnosis_text))).join('') : none('teeth'));

    /* 3. Perio */
    let perioBody = none('perio');
    let perioChip = flow.skipped.perio ? 'Skipped' : 'None';
    if (perio) {
      const sm = perio.summary || {};
      const dx = perio.diagnosis && window.PerioChart ? window.PerioChart.diagnosisText(perio) : '';
      perioChip = perio.status === 'draft' ? 'Draft' : 'Finalised';
      perioBody = [
        row('Exam date', String(perio.exam_date || '').slice(0, 10)),
        dx ? row('Diagnosis', dx) : '',
        sm.sites_measured ? row('Probing', `Mean PD ${sm.mean_pd} mm · sites ≥ 4 mm ${sm.pd_4_5 + sm.pd_6_plus} (${sm.pct_pd_4_plus}%) · bleeding ${sm.bop_pct}% · plaque ${sm.plaque_pct}%`) : '',
        perio.recall_interval_months ? row('Recall', `Every ${perio.recall_interval_months} month(s)`) : '',
        perio.treatment_notes ? row('Notes', perio.treatment_notes) : '',
      ].join('');
    }
    const perioCard = block('perio', 'Periodontal chart', perioChip, perio ? 'is-done' : '', perioBody);

    /* 4. Files */
    const filesCard = block('imaging', 'X-rays & files', files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : (flow.skipped.imaging ? 'Skipped' : 'None'), files.length ? 'is-done' : '',
      files.length ? files.map((f) => row(f.file_type || 'File', f.description || 'Uploaded file')).join('') : none('imaging'));

    /* 5. SOAP */
    const soapRows = soap ? [
      ['Subjective', soap.subjective], ['Objective', soap.objective], ['Assessment', soap.assessment],
      ['Procedure done', soap.procedure_done], ['Plan', soap.plan],
    ].filter(([, v]) => v).map(([l, v]) => `<div class="vf-rv-row"><span class="vf-rv-k">${l}</span><span class="vf-rv-v vf-rv-pre">${escapeHtml(v)}</span></div>`).join('') : '';
    const soapCard = block('soap', 'SOAP note', soapRows ? soapState : 'Not written', soapRows ? (soapState === 'Signed' ? 'is-done' : 'is-warn') : 'is-warn',
      soapRows || '<p class="vf-rv-empty">The SOAP note is empty. Go back and write it (or use “Fill from this visit”) before signing.</p>');

    host.innerHTML = `<div class="vf-rv">${exam}${teeth}${perioCard}${filesCard}${soapCard}</div>
      <p class="cn-hint" style="margin-top:12px;">“Complete &amp; sign” signs the SOAP note above and closes the visit. A signed note is locked; later corrections are added as addenda.</p>`;

    host.querySelectorAll('[data-vf-edit]').forEach((b) => {
      b.addEventListener('click', () => { flow.returnTo = true; goStep(b.dataset.vfEdit); });
    });
  }

  /* ---------- SOAP pre-fill: turn this visit's charting into a first draft ---------- */
  const CHECKUP_KEYS = {
    'PC': 'pc', 'HoPC': 'hopc', 'Pmhx': 'pmhx', 'Pdhx': 'pdhx', 'Gums': 'gums', 'Bite': 'bite',
    'Soft tissue': 'soft', 'Hygiene': 'hygiene', 'TMJ': 'tmj', 'Tx plan': 'txPlan', 'Tx done': 'txDone', 'Tca': 'tca',
  };

  function parseCheckup(text) {
    const out = {};
    let body = String(text || '').replace(/^Type:\s*Oral Checkup\s*·?\s*/i, '');
    if (body.startsWith('— ')) body = ` ${body}`;
    const n = body.indexOf(' — ');
    if (n !== -1) { out.notes = body.slice(n + 3).trim(); body = body.slice(0, n); }
    body.split(' · ').forEach((part) => {
      const m = part.match(/^([^:]+):\s*([\s\S]*)$/);
      const key = m && CHECKUP_KEYS[m[1].trim()];
      if (key) out[key] = m[2].trim();
    });
    return out;
  }

  function findingBody(text) {
    return String(text || '').replace(/^Category:\s*\w+\s*·?\s*/i, '').trim();
  }

  async function buildSoapPrefill() {
    const appt = state.activeAppointment;
    const patient = state.activePatient;
    if (!appt || !patient) return null;
    const apptId = String(appt.id);

    // What's been saved for this visit, oldest first, with anything still typed on top.
    const mine = state.diagnoses.filter((d) => String(d.appointment_id) === apptId).slice().reverse();
    const cu = {};
    mine.filter(isCheckupDiagnosis).forEach((d) => Object.assign(cu, parseCheckup(d.diagnosis_text)));
    const live = {
      pc: 'checkupPC', hopc: 'checkupHoPC', pmhx: 'checkupPmhx', pdhx: 'checkupPdhx', txPlan: 'checkupTxPlan',
      txDone: 'checkupTxDone', tca: 'checkupTca', gums: 'checkupGums', bite: 'checkupBite',
      soft: 'checkupSoftTissue', hygiene: 'checkupHygiene', tmj: 'checkupTmj', notes: 'checkupNotes',
    };
    Object.keys(live).forEach((k) => { const v = document.getElementById(live[k]).value.trim(); if (v) cu[k] = v; });

    const findings = mine.filter((d) => !isCheckupDiagnosis(d) && Array.isArray(d.tooth_refs) && d.tooth_refs.length);
    const files = state.files.filter((f) => String(f.appointment_id) === apptId);

    // Latest perio chart on file for this patient.
    let perio = null;
    try {
      const charts = await fetchMethod(`/perio-charts/patient/${patient.id}`, 'GET', null, true);
      perio = (charts || []).find((c) => c.summary && c.summary.sites_measured) || (charts || [])[0] || null;
    } catch (e) { perio = null; }

    /* Subjective */
    const S = [];
    if (cu.pc) S.push(`PC: ${cu.pc}`); else if (appt.reason) S.push(`Booked for: ${appt.reason}`);
    if (cu.hopc) S.push(`HoPC: ${cu.hopc}`);
    if (cu.pmhx) S.push(`PMHx: ${cu.pmhx}`);
    if (cu.pdhx) S.push(`PDHx: ${cu.pdhx}`);
    if (hasAllergies(patient)) S.push(`Allergies: ${patient.allergies}`);

    /* Objective */
    const O = [];
    const exam = [];
    if (cu.gums) exam.push(`gums ${cu.gums.toLowerCase()}`);
    if (cu.hygiene) exam.push(`oral hygiene ${cu.hygiene.toLowerCase()}`);
    if (cu.bite) exam.push(`occlusion ${cu.bite.toLowerCase()}`);
    if (cu.soft) exam.push(`soft tissue ${cu.soft.toLowerCase()}`);
    if (cu.tmj) exam.push(`TMJ ${cu.tmj.toLowerCase()}`);
    if (exam.length) O.push(`Exam: ${exam.join('; ')}.`);
    if (findings.length) {
      O.push('Tooth findings:');
      findings.forEach((d) => O.push(`• ${d.tooth_refs.join(', ')} — ${findingBody(d.diagnosis_text)}`));
    }
    if (perio && perio.summary && perio.summary.sites_measured) {
      const sm = perio.summary;
      const bits = [`mean PD ${sm.mean_pd} mm`, `sites ≥ 4 mm ${sm.pd_4_5 + sm.pd_6_plus} (${sm.pct_pd_4_plus}%)`, `bleeding ${sm.bop_pct}%`, `plaque ${sm.plaque_pct}%`];
      if (sm.max_cal != null) bits.push(`max CAL ${sm.max_cal} mm (tooth ${sm.max_cal_tooth})`);
      if (sm.mobile_teeth) bits.push(`${sm.mobile_teeth} mobile tooth/teeth`);
      if (sm.furcation_teeth) bits.push(`furcation involvement ${sm.furcation_teeth}`);
      const when = perio.exam_date ? String(perio.exam_date).slice(0, 10) : '';
      O.push(`Perio chart${when ? ` (${when}${perio.status === 'draft' ? ', draft' : ''})` : ''}: ${bits.join('; ')}.`);
    }
    if (files.length) O.push(`Radiographs / files this visit: ${files.map((f) => f.description || f.file_type || 'file').join(', ')}.`);
    if (cu.notes) O.push(`Remarks: ${cu.notes}`);

    /* Assessment: findings grouped by condition, plus the periodontal diagnosis */
    const A = [];
    const byCondition = {};
    findings.forEach((d) => {
      const key = parseCondition(d.diagnosis_text);
      if (!key || parseCategory(d.diagnosis_text) !== 'medical') return;
      const label = ALL_CONDITION_LABELS[key];
      (byCondition[label] = byCondition[label] || []);
      d.tooth_refs.forEach((t) => { if (!byCondition[label].includes(String(t))) byCondition[label].push(String(t)); });
    });
    Object.keys(byCondition).forEach((label) => A.push(`${label}: ${byCondition[label].join(', ')}`));
    if (perio && perio.diagnosis && window.PerioChart && window.PerioChart.diagnosisText) {
      A.push(`Periodontal: ${window.PerioChart.diagnosisText(perio)}`);
    } else if (cu.gums && cu.gums !== 'Healthy') {
      A.push(`Gums: ${cu.gums}`);
    }

    /* Procedure done */
    const P = [];
    if (cu.txDone) P.push(cu.txDone);
    findings.forEach((d) => {
      const proc = (d.diagnosis_text.match(/Procedure:\s*([^·—]+)/i) || [])[1];
      if (!proc) return;
      const surf = (d.diagnosis_text.match(/Surfaces:\s*([^·—]+)/i) || [])[1];
      const mat = (d.diagnosis_text.match(/Material:\s*([^·—]+)/i) || [])[1];
      P.push(`${d.tooth_refs.join(', ')} — ${proc.trim()}${surf ? ` (${surf.trim()})` : ''}${mat ? `, ${mat.trim()}` : ''}`);
    });

    /* Plan */
    const L = [];
    if (cu.txPlan) L.push(cu.txPlan);
    if (perio && perio.treatment_notes) L.push(`Periodontal: ${perio.treatment_notes}`);
    if (perio && perio.recall_interval_months) L.push(`Periodontal maintenance recall every ${perio.recall_interval_months} month(s).`);
    if (cu.tca) L.push(`TCA: ${cu.tca}`);

    const teeth = [];
    findings.forEach((d) => d.tooth_refs.forEach((t) => {
      const v = String(t);
      if (/^(?:[1-4][1-8]|[5-8][1-5])$/.test(v) && !teeth.includes(v)) teeth.push(v);
    }));

    return {
      subjective: S.join('\n'),
      objective: O.join('\n'),
      assessment: A.join('\n'),
      procedure_done: P.join('\n'),
      plan: L.join('\n'),
      tooth_numbers: teeth,
    };
  }

  /* ============================================================
     CONDITION + CATEGORY ENCODING
     ------------------------------------------------------------
     Diagnosis has no structured `condition` or `category` column —
     just free-text diagnosis_text. We write both in a predictable
     shape so it reads fine anywhere else it's displayed (patient
     chart modal, etc.) and so we can parse them back out here to
     color/filter teeth by category.
     ============================================================ */
  function composeDiagnosisText({ category, condition, procedureName, surfaces = [], material = '', notes }) {
    const parts = [];
    parts.push(`Category: ${category === 'cosmetic' ? 'Cosmetic' : 'Medical'}`);
    if (condition) parts.push(`Condition: ${ALL_CONDITION_LABELS[condition]}`);
    if (procedureName) parts.push(`Procedure: ${procedureName}`);
    if (surfaces.length) parts.push(`Surfaces: ${surfaceNames(surfaces)}`);
    if (material) parts.push(`Material: ${material}`);
    let text = parts.join(' · ');
    if (notes) text = text ? `${text} — ${notes}` : notes;
    return text || 'No additional notes.';
  }

  // Fallback keywords for diagnoses that never went through the
  // structured "Condition: X" prefix — typed straight into Notes with
  // no dropdown selection, or logged before this modal existed. Without
  // this, those findings parse to null and the tooth silently reverts
  // to healthy even though a real diagnosis is on file for it.
  const CONDITION_KEYWORDS = {
    caries: ['caries', 'cavity', 'decay'],
    filled: ['filled', 'filling', 'restoration', 'restored'],
    missing: ['missing', 'extracted', 'extraction'],
    crown: ['crown'],
    whitening: ['whiten', 'bleach'],
    veneer: ['veneer'],
    bonding: ['bonding'],
    contouring: ['contour'],
    smile_design: ['smile design'],
    exfoliated: ['exfoliat'],
    unerupted: ['unerupted', 'not yet erupted'],
    sealant: ['sealant', 'fissure seal'],
    pulpotomy: ['pulpotomy'],
  };

  function parseCondition(diagnosisText) {
    if (!diagnosisText) return null;

    const match = diagnosisText.match(/Condition:\s*([^·—]+)/i);
    if (match) {
      const label = match[1].trim().toLowerCase();
      const key = Object.keys(ALL_CONDITION_LABELS).find((k) => ALL_CONDITION_LABELS[k].toLowerCase() === label);
      if (key) return key;
    }

    const lower = diagnosisText.toLowerCase();
    for (const key of Object.keys(CONDITION_KEYWORDS)) {
      if (CONDITION_KEYWORDS[key].some((kw) => lower.includes(kw))) return key;
    }
    return null;
  }

  // Same structured-prefix-first, keyword-fallback pattern as
  // parseCondition — covers diagnoses logged before the category field
  // existed, or ones where a condition keyword alone implies a category
  // (e.g. "veneer" implies cosmetic even with no explicit prefix).
  const COSMETIC_KEYWORDS = ['whiten', 'veneer', 'bonding', 'contour', 'cosmetic', 'bleach', 'smile design'];

  function parseCategory(diagnosisText) {
    if (!diagnosisText) return 'medical';
    const match = diagnosisText.match(/Category:\s*(Medical|Cosmetic)/i);
    if (match) return match[1].toLowerCase();
    const lower = diagnosisText.toLowerCase();
    return COSMETIC_KEYWORDS.some((kw) => lower.includes(kw)) ? 'cosmetic' : 'medical';
  }

  /* ============================================================
     ODONTOGRAM
     ------------------------------------------------------------
     Real anatomical layout — same TOOTH_SHAPES / QUADRANT_TRANSFORM
     data (toothShapes.js) and the same tooth-svg/cond-* markup
     pattern as the patient-side odontogram (toothChart.js), so it
     picks up the existing dashboard.css tooth styling unchanged.
     Condition source: this dentist's own diagnoses for the active
     patient, filtered to whichever category tab (Medical/Cosmetic)
     is active — same split as the patient-side toggle, and the same
     binary "cond-cosmetic" indicator for the Cosmetic tab (specific
     cosmetic procedures aren't individually color-coded, matching
     how tooth-chart.css only styles one cosmetic color).
     ============================================================ */
  function latestConditionForTooth(tooth, category) {
    const matches = state.diagnoses.filter((d) =>
      (Array.isArray(d.tooth_refs) ? d.tooth_refs : []).some((t) => String(t) === String(tooth)) &&
      parseCategory(d.diagnosis_text) === category);
    if (!matches.length) return null;
    // state.diagnoses is sorted newest-first in selectAppointment().
    for (const d of matches) {
      const cond = parseCondition(d.diagnosis_text);
      if (cond) return cond;
    }
    return null;
  }

  function renderOdontogram() {
    const dentition = Dentition.get(state.dentition);
    const host = document.getElementById('odontogramHost');
    // The primary chart's viewBox is shorter than the permanent one (20
    // teeth in a smaller arch), so it's set per dentition, not hard-coded.
    host.innerHTML = `<svg id="odontogramSvg" viewBox="${dentition.viewBox}"></svg>`;
    const svg = document.getElementById('odontogramSvg');

    [...dentition.upper, ...dentition.lower].forEach((num) => {
      const placement = Dentition.place(num);
      if (!placement) return;
      const { shape } = placement;

      const rawCondition = latestConditionForTooth(num, state.activeCategory);
      const condition = state.activeCategory === 'medical'
        ? (rawCondition || 'healthy')
        : (rawCondition ? 'cosmetic' : 'healthy');
      const toothStr = String(num);

      // Same split as toothChart.js: the outer <g> only ever carries the
      // quadrant-mirroring transform attribute, kept separate from the
      // inner group's class-driven hover-scale CSS transform.
      // A middle group carries the primary teeth's reposition/scale (empty
      // for permanent teeth) so it too stays off the hover-scale element.
      const quadrantGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      quadrantGroup.setAttribute('transform', placement.quadrantTransform);
      const placementGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (placement.placementTransform) placementGroup.setAttribute('transform', placement.placementTransform);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `tooth-svg cond-${condition}` + (state.selectedTooth === toothStr ? ' is-selected' : ''));
      g.setAttribute('data-tooth', toothStr);
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      const { name, quadrant: quadrantName } = toothLabel(toothStr);
      g.setAttribute('aria-label', `Tooth ${toothStr}, ${quadrantName} ${name}`);

      const highlightPaths = Array.isArray(shape.highlight) ? shape.highlight : [shape.highlight];
      g.innerHTML = `
        <path class="tooth-outline" d="${shape.outline}"></path>
        <path class="tooth-fill" d="${shape.fill}"></path>
        ${highlightPaths.map((d) => `<path class="tooth-highlight" d="${d}"></path>`).join('')}
      `;
      g.addEventListener('click', () => focusTooth(toothStr));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusTooth(toothStr); }
      });

      placementGroup.appendChild(g);
      quadrantGroup.appendChild(placementGroup);
      svg.appendChild(quadrantGroup);
    });

    applySelectedToothStyle();
  }

  // Renders into the static <div class="legend" id="legend"> — options
  // differ by category, same pattern as the patient-side toggle.
  function renderLegend() {
    const legend = document.getElementById('legend');
    if (!legend) return;
    const items = state.activeCategory === 'medical'
      ? [
          { cond: 'healthy', label: 'No findings' },
          { cond: 'caries', label: 'Caries' },
          { cond: 'filled', label: 'Filled' },
          { cond: 'missing', label: 'Missing' },
          { cond: 'crown', label: 'Crown' },
          ...Dentition.conditionsFor(state.dentition).map((c) => ({ cond: c.key, label: c.label })),
        ]
      : [
          { cond: 'healthy', label: 'No cosmetic work' },
          { cond: 'cosmetic', label: 'Cosmetic work done' },
        ];
    legend.innerHTML = items.map((it) => `<span><span class="dot dot-${it.cond}"></span>${it.label}</span>`).join('');
  }

  function initCategoryToggle() {
    const toggle = document.getElementById('categoryToggle');
    if (!toggle) return;
    toggle.querySelectorAll('.segmented-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-category');
        if (category === state.activeCategory) return;
        state.activeCategory = category;
        toggle.querySelectorAll('.segmented-opt').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderLegend();
        if (state.activePatient) {
          renderOdontogram();
          renderToothDetail();
          renderDiagnosisTimeline();
        }
      });
    });
  }

  /* ---- Permanent / Primary dentition toggle ---- */
  function initDentitionToggle() {
    const toggle = document.getElementById('dentitionToggle');
    if (!toggle) return;
    toggle.querySelectorAll('.segmented-opt').forEach((btn) => {
      btn.addEventListener('click', () => setDentition(btn.getAttribute('data-dentition')));
    });
  }

  function setDentition(key) {
    if (!Dentition.get(key) || key === state.dentition) return;
    state.dentition = key;
    // A tooth from the other dentition isn't on the chart any more, so it
    // can't stay selected.
    if (state.selectedTooth && Dentition.of(state.selectedTooth) !== key) state.selectedTooth = null;
    syncDentitionToggle();
    renderLegend();
    if (state.activePatient) {
      renderOdontogram();
      renderToothDetail();
    }
  }

  // Keeps the buttons in step with state.dentition when it changes for a
  // reason other than a click (e.g. a new patient's age picks the default).
  function syncDentitionToggle() {
    const toggle = document.getElementById('dentitionToggle');
    if (!toggle) return;
    toggle.querySelectorAll('.segmented-opt').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-dentition') === state.dentition);
    });
  }

  function applySelectedToothStyle() {
    document.querySelectorAll('#odontogramHost .tooth-svg').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.tooth === state.selectedTooth);
    });
  }

  // Clicking a tooth focuses it (shows its history in the side panel);
  // logging a new finding happens via the "Log a finding" button there,
  // which opens the modal. Keeps a single click from immediately
  // popping a modal over teeth you're just browsing.
  function focusTooth(tooth) {
    state.selectedTooth = tooth;
    applySelectedToothStyle();
    renderToothDetail();
  }

  function renderToothDetail() {
    const col = document.getElementById('toothDetailCol');

    if (!state.selectedTooth) {
      col.innerHTML = '<p class="tooth-detail-empty">Click a tooth to log a finding.</p>';
      return;
    }

    const tooth = state.selectedTooth;
    const { name, quadrant, universal, isPrimary } = toothLabel(tooth);
    // Primary teeth are also charted by letter (A-T) in the Universal system.
    const sub = [`FDI ${tooth}`, isPrimary ? `Universal ${universal}` : null, quadrant].filter(Boolean).join(' · ');
    const matches = state.diagnoses.filter((d) =>
      (Array.isArray(d.tooth_refs) ? d.tooth_refs : []).some((t) => String(t) === String(tooth)) &&
      parseCategory(d.diagnosis_text) === state.activeCategory);

    const items = matches.length
      ? matches.map((d) => `
          <div class="timeline-item">
            <div class="timeline-row">
              <span class="timeline-date">${formatDate(d.created_at)}</span>
              <button class="panel-link tooth-finding-edit-btn" type="button" data-id="${d.id}">Edit</button>
            </div>
            <div class="timeline-note">${escapeHtml(d.diagnosis_text || '')}</div>
          </div>
        `).join('')
      : '<p class="tooth-detail-empty">No findings logged for this tooth yet.</p>';

    col.innerHTML = `
      <p class="tooth-detail-title">${escapeHtml(name)}</p>
      <p class="tooth-detail-sub">${escapeHtml(sub)}</p>
      <button class="tooth-add-btn" type="button" id="toothAddFindingBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Log a finding
      </button>
      <div class="tooth-detail-list"><div class="timeline">${items}</div></div>
    `;
    document.getElementById('toothAddFindingBtn').addEventListener('click', () => openToothModal(tooth));
    col.querySelectorAll('.tooth-finding-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = state.diagnoses.find((x) => String(x.id) === btn.dataset.id);
        if (d) openToothModal(tooth, d);
      });
    });
  }

  /* ============================================================
     DIAGNOSIS HISTORY (full timeline, all teeth)
     ============================================================ */
  function renderDiagnosisTimeline() {
    const el = document.getElementById('diagnosisTimeline');
    const items = state.diagnoses.filter((d) =>
      !isCheckupDiagnosis(d) && parseCategory(d.diagnosis_text) === state.activeCategory);
    if (!items.length) {
      el.innerHTML = `<div class="empty-state">No ${state.activeCategory} diagnoses logged for this patient yet.</div>`;
      return;
    }
    el.innerHTML = items.map((d) => {
      const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];
      return `
        <div class="timeline-item">
          <div class="timeline-row">
            <span class="timeline-date">${formatDate(d.created_at)}</span>
            ${teeth.length ? `<button class="panel-link diag-edit-btn" type="button" data-id="${d.id}">Edit</button>` : ''}
          </div>
          <div class="timeline-note">
            ${escapeHtml(d.diagnosis_text || '')}
            ${teeth.length ? `<div style="margin-top:6px;">${teeth.map((t) => `<span class="tooth-tag">FDI ${escapeHtml(String(t))}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Editing from this all-teeth timeline needs the modal open on the
    // right tooth — findings here are always single-tooth (tooth_refs[0]),
    // same assumption the "log a finding" flow makes when saving one.
    el.querySelectorAll('.diag-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = state.diagnoses.find((x) => String(x.id) === btn.dataset.id);
        if (!d) return;
        const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];
        if (!teeth.length) return;
        const tooth = String(teeth[0]);
        focusTooth(tooth);
        openToothModal(tooth, d);
      });
    });
  }

  /* ============================================================
     ORAL CHECKUP
     ------------------------------------------------------------
     Whole-mouth screening (gums, bite, soft tissue, hygiene, TMJ) —
     not tied to any single tooth. Reuses the Diagnosis table (no
     backend changes needed): tooth_refs is stored empty, and a
     "Type: Oral Checkup" prefix marks it so it can be told apart
     from per-tooth findings and kept out of the tooth timeline.
     ============================================================ */
  function isCheckupDiagnosis(d) {
    return (!Array.isArray(d.tooth_refs) || d.tooth_refs.length === 0) &&
      /Type:\s*Oral Checkup/i.test(d.diagnosis_text || '');
  }

  function composeCheckupText({ pc, hopc, pmhx, pdhx, txPlan, txDone, tca, gums, bite, softTissue, hygiene, tmj, notes }) {
    const parts = ['Type: Oral Checkup'];
    if (pc) parts.push(`PC: ${pc}`);
    if (hopc) parts.push(`HoPC: ${hopc}`);
    if (pmhx) parts.push(`Pmhx: ${pmhx}`);
    if (pdhx) parts.push(`Pdhx: ${pdhx}`);
    if (gums) parts.push(`Gums: ${gums}`);
    if (bite) parts.push(`Bite: ${bite}`);
    if (softTissue) parts.push(`Soft tissue: ${softTissue}`);
    if (hygiene) parts.push(`Hygiene: ${hygiene}`);
    if (tmj) parts.push(`TMJ: ${tmj}`);
    if (txPlan) parts.push(`Tx plan: ${txPlan}`);
    if (txDone) parts.push(`Tx done: ${txDone}`);
    if (tca) parts.push(`Tca: ${tca}`);
    let text = parts.join(' · ');
    if (notes) text = `${text} — ${notes}`;
    return text;
  }

  function resetCheckupForm() {
    ['checkupPC', 'checkupHoPC', 'checkupPmhx', 'checkupPdhx', 'checkupTxPlan', 'checkupTxDone'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('checkupTca').value = '';
    ['checkupGums', 'checkupBite', 'checkupSoftTissue', 'checkupHygiene', 'checkupTmj'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('checkupNotes').value = '';
  }

  function renderCheckupTimeline() {
    const el = document.getElementById('checkupTimeline');
    const items = state.diagnoses.filter(isCheckupDiagnosis);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state">No checkups logged for this patient yet.</div>';
      return;
    }
    el.innerHTML = items.map((d) => `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${formatDate(d.created_at)}</span>
        </div>
        <div class="timeline-note">${escapeHtml((d.diagnosis_text || '').replace(/^Type:\s*Oral Checkup\s*·?\s*/i, ''))}</div>
      </div>
    `).join('');
  }

  async function saveCheckup() {
    if (!state.activePatient || !state.activeAppointment) return;

    const pc = document.getElementById('checkupPC').value.trim();
    const hopc = document.getElementById('checkupHoPC').value.trim();
    const pmhx = document.getElementById('checkupPmhx').value.trim();
    const pdhx = document.getElementById('checkupPdhx').value.trim();
    const txPlan = document.getElementById('checkupTxPlan').value.trim();
    const txDone = document.getElementById('checkupTxDone').value.trim();
    const tca = document.getElementById('checkupTca').value.trim();
    const gums = document.getElementById('checkupGums').value;
    const bite = document.getElementById('checkupBite').value;
    const softTissue = document.getElementById('checkupSoftTissue').value;
    const hygiene = document.getElementById('checkupHygiene').value;
    const tmj = document.getElementById('checkupTmj').value;
    const notes = document.getElementById('checkupNotes').value.trim();

    if (!pc && !hopc && !pmhx && !pdhx && !txPlan && !txDone && !tca &&
        !gums && !bite && !softTissue && !hygiene && !tmj && !notes) {
      showToast('Assess at least one area, fill in a note, or add a remark before saving.');
      return;
    }

    const diagnosis_text = composeCheckupText({
      pc, hopc, pmhx, pdhx, txPlan, txDone, tca, gums, bite, softTissue, hygiene, tmj, notes,
    });
    const saveBtn = document.getElementById('checkupSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const created = await fetchMethod('/diagnoses', 'POST', {
        patient_id: state.activePatient.id,
        appointment_id: state.activeAppointment.id,
        tooth_refs: [],
        diagnosis_text,
      }, true);

      state.diagnoses.unshift(created);
      renderCheckupTimeline();
      resetCheckupForm();
      updateFlowStatus();
      showToast('Checkup saved.');
    } catch (err) {
      showToast(err.message || 'Could not save this checkup. Please try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save checkup';
    }
  }

  /* ============================================================
     TOOTH FINDING MODAL
     ============================================================ */
  function populateProcedureSelect() {
    const select = document.getElementById('procedureSelect');
    state.services.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.price != null ? `${s.name} — KSh ${Number(s.price).toLocaleString('en-KE')}` : s.name;
      select.appendChild(opt);
    });
  }

  function initToothModal() {
    document.getElementById('toothModalCancel').addEventListener('click', closeToothModal);
    document.getElementById('toothModalScrim').addEventListener('click', (e) => {
      if (e.target.id === 'toothModalScrim') closeToothModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('toothModalScrim').classList.contains('is-open')) closeToothModal();
    });
    document.getElementById('categorySelect').addEventListener('change', (e) => {
      populateConditionOptions(e.target.value);
    });
    document.getElementById('toothModalSave').addEventListener('click', saveToothFinding);
    document.getElementById('surfacePicker').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-surface]');
      if (!btn) return;
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      updateSurfaceSummary();
    });
  }

  /* ---- Surface picker ----
     Classic five-zone tooth diagram. Mesial faces the midline, so it
     sits on the right for teeth in quadrants 1/4/5/8 (patient's right,
     drawn on the left of the chart) and on the left for 2/3/6/7.
     Front teeth (FDI x1-x3) have an incisal edge instead of an
     occlusal surface. */
  function buildSurfacePicker(tooth, selected) {
    const quadrant = Number(String(tooth).charAt(0));
    const position = Number(String(tooth).charAt(1));
    const mesialOnRight = [1, 4, 5, 8].includes(quadrant);
    const centre = position <= 3 ? 'I' : 'O';
    const cell = (code, cls) => `
      <button type="button" class="surf ${cls}${selected.includes(code) ? ' is-on' : ''}"
        data-surface="${code}" aria-pressed="${selected.includes(code)}"
        title="${SURFACE_NAMES[code]}${code === 'B' && position <= 3 ? ' (labial)' : ''}${code === 'L' && quadrant <= 2 ? ' (palatal)' : ''}">${code}</button>`;
    document.getElementById('surfacePicker').innerHTML =
      cell('B', 'surf-top') +
      cell(mesialOnRight ? 'D' : 'M', 'surf-left') +
      cell(centre, 'surf-mid') +
      cell(mesialOnRight ? 'M' : 'D', 'surf-right') +
      cell('L', 'surf-bottom');
    updateSurfaceSummary();
  }

  function selectedSurfaces() {
    return sortSurfaces(Array.from(document.querySelectorAll('#surfacePicker .surf.is-on')).map((b) => b.dataset.surface));
  }

  function updateSurfaceSummary() {
    const sel = selectedSurfaces();
    document.getElementById('surfaceSummary').textContent = sel.length
      ? `${surfaceNames(sel)} (${surfaceCode(sel)})`
      : 'No surface selected.';
  }

  // Condition options are scoped to whichever category is picked in the
  // modal, so a dentist can't accidentally file a cosmetic procedure
  // (e.g. Veneer) under a Medical finding or vice versa.
  function populateConditionOptions(category) {
    const select = document.getElementById('conditionSelect');
    const set = CONDITION_SETS[category] || CONDITION_SETS.medical;
    let options = '<option value="">No condition (healthy)</option>' +
      Object.keys(set).map((key) => `<option value="${key}">${escapeHtml(set[key])}</option>`).join('');

    // Medical findings also offer the pediatric/developmental set, filtered
    // to what's valid for the selected tooth's dentition -- e.g. "Exfoliated"
    // only appears for primary teeth.
    if (category === 'medical') {
      const extras = Dentition.conditionsFor(Dentition.of(state.selectedTooth));
      if (extras.length) {
        options += '<optgroup label="Pediatric &amp; developmental">' +
          extras.map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('') +
          '</optgroup>';
      }
    }
    select.innerHTML = options;
  }

  // Pass `existing` (a diagnosis row) to open the modal in edit mode,
  // pre-filled with what was saved before. Category/condition parse the
  // same way the odontogram does (parseCategory/parseCondition); procedure
  // and notes are pulled back out of composeDiagnosisText's own format,
  // so this only round-trips cleanly for findings logged through this
  // modal — free-text edits made elsewhere may not parse back perfectly.
  function openToothModal(tooth, existing) {
    state.editingDiagnosisId = existing ? existing.id : null;

    const { name } = toothLabel(tooth);
    document.getElementById('toothModalTitle').textContent = name;
    document.getElementById('toothModalFdiBadge').textContent = `FDI ${tooth}`;
    document.getElementById('toothModalKicker').textContent = existing ? 'Edit finding' : 'Log a finding';

    const category = existing ? parseCategory(existing.diagnosis_text) : state.activeCategory;
    document.getElementById('categorySelect').value = category;
    populateConditionOptions(category);
    document.getElementById('conditionSelect').value = existing ? (parseCondition(existing.diagnosis_text) || '') : '';

    let procedureName = '';
    let notes = '';
    let material = '';
    let surfaces = [];
    if (existing) {
      const text = existing.diagnosis_text || '';
      const procMatch = text.match(/Procedure:\s*([^·—]+)/i);
      if (procMatch) procedureName = procMatch[1].trim();
      const matMatch = text.match(/Material:\s*([^·—]+)/i);
      if (matMatch) material = matMatch[1].trim();
      surfaces = parseSurfaces(text);
      const notesMatch = text.match(/—\s*(.+)$/s);
      if (notesMatch) notes = notesMatch[1].trim();
    }
    document.getElementById('procedureSelect').value = procedureName;
    document.getElementById('materialInput').value = material;
    buildSurfacePicker(tooth, surfaces);
    document.getElementById('notesInput').value = notes;

    document.getElementById('toothModalSave').textContent = existing ? 'Update finding' : 'Save finding';
    document.getElementById('toothModalScrim').classList.add('is-open');
  }

  function closeToothModal() {
    document.getElementById('toothModalScrim').classList.remove('is-open');
    state.editingDiagnosisId = null;
  }

  async function saveToothFinding() {
    if (!state.activePatient || !state.activeAppointment || !state.selectedTooth) return;

    const category = document.getElementById('categorySelect').value || 'medical';
    const condition = document.getElementById('conditionSelect').value;
    const procedureName = document.getElementById('procedureSelect').value;
    const notes = document.getElementById('notesInput').value.trim();
    const surfaces = selectedSurfaces();
    // "·" and "—" are the separators in diagnosis_text, so keep them out of free text.
    const material = document.getElementById('materialInput').value.replace(/[·—]/g, '-').trim();

    const diagnosis_text = composeDiagnosisText({ category, condition, procedureName, surfaces, material, notes });
    const isEditing = !!state.editingDiagnosisId;
    const saveBtn = document.getElementById('toothModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = isEditing ? 'Updating…' : 'Saving…';

    try {
      if (isEditing) {
        const updated = await fetchMethod(`/diagnoses/${state.editingDiagnosisId}`, 'PUT', {
          tooth_refs: [Number(state.selectedTooth)],
          diagnosis_text,
        }, true);
        const idx = state.diagnoses.findIndex((d) => d.id === updated.id);
        if (idx !== -1) state.diagnoses[idx] = updated; else state.diagnoses.unshift(updated);
      } else {
        const created = await fetchMethod('/diagnoses', 'POST', {
          patient_id: state.activePatient.id,
          appointment_id: state.activeAppointment.id,
          tooth_refs: [Number(state.selectedTooth)],
          diagnosis_text,
        }, true);
        state.diagnoses.unshift(created);
      }

      // ToothChart's condition column only recognizes the medical set
      // (healthy/caries/filled/missing/crown) -- that's also all the
      // patient-side odontogram's CONDITION_LABEL recognizes there, so a
      // cosmetic value would just get silently dropped to "healthy" on
      // that end. We only sync medical findings here; cosmetic findings
      // stay Diagnosis-only until there's a real place for them to live
      // (either a schema change or wiring through Treatment Plan items,
      // which is what the patient page's own Cosmetic tab reads from).
      //
      // ToothChart itself is an append-only observation history, not a
      // single editable row per tooth — there's no linked ToothChart id
      // to update in place even when we're editing the Diagnosis record.
      // So an edit, like a new finding, just appends a fresh ToothChart
      // entry reflecting the corrected condition; the earlier entry this
      // finding originally wrote stays in that history as-is.
      if (category === 'medical') {
        try {
          await fetchMethod('/tooth-chart', 'POST', {
            patient_id: state.activePatient.id,
            appointment_id: state.activeAppointment.id,
            tooth_number: Number(state.selectedTooth),
            condition: condition || 'healthy',
            notes,
            surfaces,
            procedure_name: procedureName || null,
            material: material || null,
          }, true);
        } catch (toothChartErr) {
          showToast('Finding saved, but the patient-facing chart could not be updated.');
        }
      }

      renderOdontogram();
      renderToothDetail();
      renderDiagnosisTimeline();
      updateFlowStatus();
      closeToothModal();
      showToast(isEditing ? 'Finding updated.' : 'Finding saved.');
    } catch (err) {
      showToast(err.message || `Could not ${isEditing ? 'update' : 'save'} this finding. Please try again.`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = isEditing ? 'Update finding' : 'Save finding';
    }
  }

  /* ============================================================
     X-RAYS & FILES
     ------------------------------------------------------------
     Tagged to the active appointment (via appointment_id) so a
     file is traceable to the specific visit it was taken during,
     not just the patient generally.

     No object storage is wired up on the backend — matching the
     patient side's own upload pattern (profile.js), images are
     resized/compressed client-side and sent as a base64 data URI
     in file_url. PDFs and other non-image files are read as a data
     URI as-is (no canvas resize possible for those).
     ============================================================ */
  const MAX_XRAY_DIMENSION = 1600; // larger than profile.js's 320 — clinical detail matters here
  const XRAY_JPEG_QUALITY = 0.88;

  async function onDiagnosisFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !state.activePatient || !state.activeAppointment) return;

    try {
      const isImage = file.type && file.type.startsWith('image/');
      const dataUrl = isImage
        ? await resizeAndCompressImage(file, MAX_XRAY_DIMENSION, XRAY_JPEG_QUALITY)
        : await readFileAsDataUrl(file);

      const created = await fetchMethod('/patient-files', 'POST', {
        patient_id: state.activePatient.id,
        appointment_id: state.activeAppointment.id,
        file_type: isImage ? 'xray' : 'document',
        file_url: dataUrl,
        description: file.name,
      }, true);

      state.files.unshift(created);
      renderDiagnosisFiles();
      updateFlowStatus();
      showToast('File uploaded.');
    } catch (err) {
      showToast(err.message || 'Could not upload file. Please try a smaller file.');
    }
  }

  function resizeAndCompressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read that image'));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function renderDiagnosisFiles() {
    const el = document.getElementById('diagnosisFileList');
    if (!state.files.length) {
      el.innerHTML = '<div class="empty-state">No X-rays or files uploaded for this patient yet.</div>';
      return;
    }
    el.innerHTML = state.files.map((f) => `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${formatDate(f.uploaded_at)}</span>
          <b>${escapeHtml(f.file_type || 'File')}</b>
        </div>
        <div class="timeline-note">
          <a href="${escapeHtml(f.file_url)}" target="_blank" rel="noopener">${escapeHtml(f.description || 'View file')}</a>
        </div>
      </div>
    `).join('');
  }

  /* ============================================================
     SIDEBAR (mobile open/close)
     ============================================================ */
  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('scrim');
    const openBtn = document.getElementById('sideOpen');
    const closeBtn = document.getElementById('sideClose');
    if (!sidebar || !openBtn) return;

    const open = () => { sidebar.classList.add('is-open'); scrim.style.display = 'block'; };
    const close = () => { sidebar.classList.remove('is-open'); scrim.style.display = 'none'; };

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);
  }

  /* ============================================================
     PDF DOWNLOAD
     Same pattern used across the patient portal's billing/tooth-chart/
     prescriptions pages — api.js exposes API_BASE and stores the JWT
     under 'jino_token'.
     ============================================================ */
  async function downloadActivePatientToothChart() {
    if (!state.activePatient) return;
    await downloadPdf(
      `/tooth-chart/patient/${state.activePatient.id}/history/pdf`,
      `tooth-chart-${state.activePatient.last_name}.pdf`
    );
  }

  async function downloadPdf(path, filename) {
    try {
      const token = localStorage.getItem('jino_token');
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Could not generate the PDF. Please try again.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || 'Could not download the PDF');
    }
  }

  /* ============================================================
     UTILITIES
     ============================================================ */
  // Wide enough that "Past" and "Upcoming" (and cross-date search) have
  // real data to show, without pulling the dentist's entire appointment
  // history on every page load. Adjust the day counts if a clinic needs
  // to look back further than a year.
  function pickerRangeIso() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(startOfToday.getTime() - 365 * 24 * 60 * 60 * 1000);
    const to = new Date(startOfToday.getTime() + 91 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function initialsOf(name) {
    return name.replace('Dr. ', '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }
})();