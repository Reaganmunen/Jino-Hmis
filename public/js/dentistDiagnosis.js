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
  const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const POSITION_NAMES = [
    '', 'Central Incisor', 'Lateral Incisor', 'Canine', '1st Premolar',
    '2nd Premolar', '1st Molar', '2nd Molar', '3rd Molar',
  ];
  const QUADRANT_NAMES = { 1: 'Upper Right', 2: 'Upper Left', 3: 'Lower Left', 4: 'Lower Right' };

  // Condition options are category-scoped: a Medical finding picks from
  // the clinical set below, a Cosmetic finding from the aesthetic set.
  // Both sets get merged into one lookup for parsing diagnosis_text back
  // out (ALL_CONDITION_LABELS) since a stored diagnosis could be either.
  const CONDITION_SETS = {
    medical: { caries: 'Caries', filled: 'Filled / restored', missing: 'Missing / extracted', crown: 'Crown' },
    cosmetic: { whitening: 'Whitening', veneer: 'Veneer', bonding: 'Bonding', contouring: 'Contouring', smile_design: 'Smile Design' },
  };
  const ALL_CONDITION_LABELS = { ...CONDITION_SETS.medical, ...CONDITION_SETS.cosmetic };

  function toothLabel(fdi) {
    const str = String(fdi);
    const quadrant = Number(str[0]);
    const position = Number(str[1]);
    return {
      name: POSITION_NAMES[position] || 'Tooth',
      quadrant: QUADRANT_NAMES[quadrant] || '',
    };
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
    activeCategory: 'medical', // which category the odontogram/timeline are showing
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initToothModal();
    initCategoryToggle();
    renderLegend();
    document.getElementById('switchPatientBtn').addEventListener('click', showAppointmentPicker);
    document.getElementById('checkupSaveBtn').addEventListener('click', saveCheckup);
    document.getElementById('diagnosisFileInput').addEventListener('change', onDiagnosisFileSelected);
    loadInitialData();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadInitialData() {
    try {
      const { from, to } = todayRangeIso();
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
     ============================================================ */
  function renderAppointmentPicker() {
    const list = document.getElementById('apptPickerList');
    document.getElementById('apptPickerCount').textContent =
      `${state.appointments.length} appointment${state.appointments.length === 1 ? '' : 's'} today`;

    if (!state.appointments.length) {
      list.innerHTML = '<div class="empty-state">No appointments scheduled for today.</div>';
      return;
    }

    list.innerHTML = '';
    state.appointments.forEach((appt) => {
      const patient = state.patientsById[appt.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const time = new Date(appt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const row = document.createElement('div');
      row.className = 'sched-item is-selectable';
      if (state.activeAppointment && state.activeAppointment.id === appt.id) row.classList.add('is-active-appt');
      row.innerHTML = `
        <div class="sched-time">${escapeHtml(time)}</div>
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

  async function selectAppointment(appt) {
    state.activeAppointment = appt;
    state.activePatient = state.patientsById[appt.patient_id] || null;
    state.selectedTooth = null;

    renderAppointmentPicker();

    if (!state.activePatient) {
      showToast('Could not find this patient\'s record.');
      return;
    }

    const chartingPanel = document.getElementById('chartingPanel');
    chartingPanel.style.display = 'block';
    document.getElementById('checkupPanel').style.display = 'block';
    document.getElementById('chartingPatientName').textContent = `— ${state.activePatient.first_name} ${state.activePatient.last_name}`;
    chartingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
    } catch (err) {
      handleLoadError(err);
    }
  }

  function showAppointmentPicker() {
    document.getElementById('chartingPanel').style.display = 'none';
    document.getElementById('checkupPanel').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
  function composeDiagnosisText({ category, condition, procedureName, notes }) {
    const parts = [];
    parts.push(`Category: ${category === 'cosmetic' ? 'Cosmetic' : 'Medical'}`);
    if (condition) parts.push(`Condition: ${ALL_CONDITION_LABELS[condition]}`);
    if (procedureName) parts.push(`Procedure: ${procedureName}`);
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
  const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

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
    const host = document.getElementById('odontogramHost');
    host.innerHTML = '<svg id="odontogramSvg" viewBox="0 0 409 694"></svg>';
    const svg = document.getElementById('odontogramSvg');

    ALL_TEETH.forEach((num) => {
      const quadrant = Math.floor(num / 10);
      const position = num % 10;
      const shape = TOOTH_SHAPES[position];
      if (!shape) return;

      const rawCondition = latestConditionForTooth(num, state.activeCategory);
      const condition = state.activeCategory === 'medical'
        ? (rawCondition || 'healthy')
        : (rawCondition ? 'cosmetic' : 'healthy');
      const toothStr = String(num);

      // Same split as toothChart.js: the outer <g> only ever carries the
      // quadrant-mirroring transform attribute, kept separate from the
      // inner group's class-driven hover-scale CSS transform.
      const quadrantGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      quadrantGroup.setAttribute('transform', QUADRANT_TRANSFORM[quadrant] || '');

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

      quadrantGroup.appendChild(g);
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
    const { name, quadrant } = toothLabel(tooth);
    const matches = state.diagnoses.filter((d) =>
      (Array.isArray(d.tooth_refs) ? d.tooth_refs : []).some((t) => String(t) === String(tooth)) &&
      parseCategory(d.diagnosis_text) === state.activeCategory);

    const items = matches.length
      ? matches.map((d) => `
          <div class="timeline-item">
            <div class="timeline-row">
              <span class="timeline-date">${formatDate(d.created_at)}</span>
            </div>
            <div class="timeline-note">${escapeHtml(d.diagnosis_text || '')}</div>
          </div>
        `).join('')
      : '<p class="tooth-detail-empty">No findings logged for this tooth yet.</p>';

    col.innerHTML = `
      <p class="tooth-detail-title">${escapeHtml(name)}</p>
      <p class="tooth-detail-sub">FDI ${escapeHtml(tooth)} · ${escapeHtml(quadrant)}</p>
      <button class="tooth-add-btn" type="button" id="toothAddFindingBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Log a finding
      </button>
      <div class="tooth-detail-list"><div class="timeline">${items}</div></div>
    `;
    document.getElementById('toothAddFindingBtn').addEventListener('click', () => openToothModal(tooth));
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
          </div>
          <div class="timeline-note">
            ${escapeHtml(d.diagnosis_text || '')}
            ${teeth.length ? `<div style="margin-top:6px;">${teeth.map((t) => `<span class="tooth-tag">FDI ${escapeHtml(String(t))}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
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

  function composeCheckupText({ gums, bite, softTissue, hygiene, tmj, notes }) {
    const parts = ['Type: Oral Checkup'];
    if (gums) parts.push(`Gums: ${gums}`);
    if (bite) parts.push(`Bite: ${bite}`);
    if (softTissue) parts.push(`Soft tissue: ${softTissue}`);
    if (hygiene) parts.push(`Hygiene: ${hygiene}`);
    if (tmj) parts.push(`TMJ: ${tmj}`);
    let text = parts.join(' · ');
    if (notes) text = `${text} — ${notes}`;
    return text;
  }

  function resetCheckupForm() {
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

    const gums = document.getElementById('checkupGums').value;
    const bite = document.getElementById('checkupBite').value;
    const softTissue = document.getElementById('checkupSoftTissue').value;
    const hygiene = document.getElementById('checkupHygiene').value;
    const tmj = document.getElementById('checkupTmj').value;
    const notes = document.getElementById('checkupNotes').value.trim();

    if (!gums && !bite && !softTissue && !hygiene && !tmj && !notes) {
      showToast('Assess at least one area, or add a note, before saving.');
      return;
    }

    const diagnosis_text = composeCheckupText({ gums, bite, softTissue, hygiene, tmj, notes });
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
  }

  // Condition options are scoped to whichever category is picked in the
  // modal, so a dentist can't accidentally file a cosmetic procedure
  // (e.g. Veneer) under a Medical finding or vice versa.
  function populateConditionOptions(category) {
    const select = document.getElementById('conditionSelect');
    const set = CONDITION_SETS[category] || CONDITION_SETS.medical;
    select.innerHTML = '<option value="">No condition (healthy)</option>' +
      Object.keys(set).map((key) => `<option value="${key}">${escapeHtml(set[key])}</option>`).join('');
  }

  function openToothModal(tooth) {
    const { name } = toothLabel(tooth);
    document.getElementById('toothModalTitle').textContent = name;
    document.getElementById('toothModalFdiBadge').textContent = `FDI ${tooth}`;
    document.getElementById('categorySelect').value = state.activeCategory;
    populateConditionOptions(state.activeCategory);
    document.getElementById('procedureSelect').value = '';
    document.getElementById('notesInput').value = '';
    document.getElementById('toothModalScrim').classList.add('is-open');
  }

  function closeToothModal() {
    document.getElementById('toothModalScrim').classList.remove('is-open');
  }

  async function saveToothFinding() {
    if (!state.activePatient || !state.activeAppointment || !state.selectedTooth) return;

    const category = document.getElementById('categorySelect').value || 'medical';
    const condition = document.getElementById('conditionSelect').value;
    const procedureName = document.getElementById('procedureSelect').value;
    const notes = document.getElementById('notesInput').value.trim();

    const diagnosis_text = composeDiagnosisText({ category, condition, procedureName, notes });
    const saveBtn = document.getElementById('toothModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const created = await fetchMethod('/diagnoses', 'POST', {
        patient_id: state.activePatient.id,
        appointment_id: state.activeAppointment.id,
        tooth_refs: [Number(state.selectedTooth)],
        diagnosis_text,
      }, true);

      state.diagnoses.unshift(created);

      // ToothChart's condition column only recognizes the medical set
      // (healthy/caries/filled/missing/crown) -- that's also all the
      // patient-side odontogram's CONDITION_LABEL recognizes there, so a
      // cosmetic value would just get silently dropped to "healthy" on
      // that end. We only sync medical findings here; cosmetic findings
      // stay Diagnosis-only until there's a real place for them to live
      // (either a schema change or wiring through Treatment Plan items,
      // which is what the patient page's own Cosmetic tab reads from).
      if (category === 'medical') {
        try {
          await fetchMethod('/tooth-chart', 'POST', {
            patient_id: state.activePatient.id,
            appointment_id: state.activeAppointment.id,
            tooth_number: Number(state.selectedTooth),
            condition: condition || 'healthy',
            notes,
          }, true);
        } catch (toothChartErr) {
          showToast('Finding saved, but the patient-facing chart could not be updated.');
        }
      }

      renderOdontogram();
      renderToothDetail();
      renderDiagnosisTimeline();
      closeToothModal();
      showToast('Finding saved.');
    } catch (err) {
      showToast(err.message || 'Could not save this finding. Please try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save finding';
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
     UTILITIES
     ============================================================ */
  function todayRangeIso() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
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