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
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id,
    patients: [],          // full patient list
    searchQuery: '',
    activePatient: null,
    diagnoses: [],          // active patient's diagnosis history, for the "link to diagnosis" dropdown
    prescriptions: [],      // active patient's prescription history
    editingPrescriptionId: null, // set while rxFormPanel is editing an existing prescription instead of creating one
    templates: [],          // this dentist's saved templates (built-ins live in BUILT_IN_TEMPLATES)
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    document.getElementById('patientSearchInput').addEventListener('input', onSearchInput);
    document.getElementById('switchPatientBtn').addEventListener('click', showPatientPicker);
    document.getElementById('downloadPatientRxBtn').addEventListener('click', downloadActivePatientRx);
    document.getElementById('rxSaveBtn').addEventListener('click', savePrescription);
    document.getElementById('rxCancelEditBtn').addEventListener('click', exitEditMode);
    document.getElementById('rxDrugName').addEventListener('input', updateAllergyBox);
    document.getElementById('rxTemplateSelect').addEventListener('change', onTemplateChange);
    document.getElementById('rxSaveTemplateBtn').addEventListener('click', saveAsTemplate);
    document.getElementById('rxDeleteTemplateBtn').addEventListener('click', deleteSelectedTemplate);
    loadTemplates();
    loadInitialData();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadInitialData() {
    try {
      const patients = await fetchMethod('/patients', 'GET', null, true);
      state.patients = patients.sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
      renderPatientPicker();
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
    showToast(err.message || 'Could not load your patients. Please refresh.');
  }

  /* ============================================================
     PATIENT PICKER
     ============================================================ */
  function onSearchInput(e) {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderPatientPicker();
  }

  function filteredPatients() {
    if (!state.searchQuery) return state.patients;
    return state.patients.filter((p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(state.searchQuery));
  }

  function renderPatientPicker() {
    const list = document.getElementById('patientPickerList');
    const patients = filteredPatients();
    document.getElementById('patientPickerCount').textContent =
      `${patients.length} patient${patients.length === 1 ? '' : 's'}`;

    if (!patients.length) {
      list.innerHTML = '<div class="empty-state">No patients match your search.</div>';
      return;
    }

    list.innerHTML = '';
    patients.forEach((patient) => {
      const name = `${patient.first_name} ${patient.last_name}`;

      const row = document.createElement('div');
      row.className = 'sched-item is-selectable';
      row.innerHTML = `
        <div class="sched-avatar">${initialsOf(name)}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(name)}</p>
          <p class="s">${escapeHtml(patient.phone || patient.email || '')}</p>
        </div>
      `;
      row.addEventListener('click', () => selectPatient(patient));
      list.appendChild(row);
    });
  }

  async function selectPatient(patient) {
    state.activePatient = patient;
    updateAllergyBox();

    document.getElementById('rxFormPanel').style.display = 'block';
    document.getElementById('rxHistoryPanel').style.display = 'block';
    document.getElementById('rxPatientName').textContent = `— ${patient.first_name} ${patient.last_name}`;
    document.getElementById('rxFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    exitEditMode();
    document.getElementById('rxTimeline').innerHTML = '<div class="empty-state">Loading prescription history…</div>';
    document.getElementById('rxDiagnosisSelect').innerHTML = '<option value="">No diagnosis link</option>';

    try {
      const [diagnoses, prescriptions, freshPatient] = await Promise.all([
        fetchMethod(`/diagnoses/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/prescriptions/patient/${patient.id}`, 'GET', null, true),
        // Re-read the patient so the allergy check uses the latest record, not the cached roster row.
        fetchMethod(`/patients/${patient.id}`, 'GET', null, true).catch(() => null),
      ]);

      if (freshPatient && state.activePatient && state.activePatient.id === patient.id) {
        Object.assign(state.activePatient, freshPatient);
        updateAllergyBox();
      }

      state.diagnoses = diagnoses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.prescriptions = prescriptions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      populateDiagnosisSelect();
      renderPrescriptionHistory();
    } catch (err) {
      handleLoadError(err);
    }
  }

  function showPatientPicker() {
    document.getElementById('rxFormPanel').style.display = 'none';
    document.getElementById('rxHistoryPanel').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     "LINK TO DIAGNOSIS" DROPDOWN
     ============================================================ */
  function populateDiagnosisSelect() {
    const select = document.getElementById('rxDiagnosisSelect');
    select.innerHTML = '<option value="">No diagnosis link</option>' +
      state.diagnoses.map((d) => {
        const label = (d.diagnosis_text || 'Diagnosis').slice(0, 60);
        return `<option value="${d.id}">${escapeHtml(formatDate(d.created_at))} — ${escapeHtml(label)}</option>`;
      }).join('');
  }

  /* ============================================================
     NEW PRESCRIPTION FORM
     ============================================================ */
  function resetRxForm() {
    document.getElementById('rxDrugName').value = '';
    document.getElementById('rxDosage').value = '';
    document.getElementById('rxFrequency').value = '';
    document.getElementById('rxDuration').value = '';
    document.getElementById('rxDiagnosisSelect').value = '';
    document.getElementById('rxNotes').value = '';
    document.getElementById('rxTemplateSelect').value = '';
    document.getElementById('rxDeleteTemplateBtn').style.display = 'none';
    updateAllergyBox();
  }

  // Fills the form from an existing prescription and flips it into "edit"
  // mode — savePrescription() below then PUTs instead of POSTs.
  function startEditPrescription(rx) {
    state.editingPrescriptionId = rx.id;
    document.getElementById('rxDrugName').value = rx.drug_name || '';
    document.getElementById('rxDosage').value = rx.dosage || '';
    document.getElementById('rxFrequency').value = rx.frequency || '';
    document.getElementById('rxDuration').value = rx.duration || '';
    document.getElementById('rxDiagnosisSelect').value = rx.diagnosis_id || '';
    document.getElementById('rxNotes').value = rx.notes || '';
    updateAllergyBox();
    document.getElementById('rxFormTitle').textContent = 'Edit prescription';
    document.getElementById('rxSaveBtn').textContent = 'Update prescription';
    document.getElementById('rxCancelEditBtn').style.display = 'inline-flex';
    document.getElementById('rxFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Clears the form and drops back to "new prescription" mode, whether
  // called after a successful save, an explicit cancel, or a patient switch.
  function exitEditMode() {
    state.editingPrescriptionId = null;
    resetRxForm();
    document.getElementById('rxFormTitle').textContent = 'New prescription';
    document.getElementById('rxSaveBtn').textContent = 'Save prescription';
    document.getElementById('rxSaveBtn').disabled = false;
    document.getElementById('rxCancelEditBtn').style.display = 'none';
  }

  async function savePrescription() {
    if (!state.activePatient) return;

    const drug_name = document.getElementById('rxDrugName').value.trim();
    const dosage = document.getElementById('rxDosage').value.trim();
    const frequency = document.getElementById('rxFrequency').value.trim();
    const duration = document.getElementById('rxDuration').value.trim();
    const diagnosisValue = document.getElementById('rxDiagnosisSelect').value;
    const notes = document.getElementById('rxNotes').value.trim();

    if (!drug_name || !dosage || !frequency || !duration) {
      showToast('Drug name, dosage, frequency, and duration are all required.');
      return;
    }

    const allergyHits = AllergyCheck.check(state.activePatient.allergies, drug_name);
    if (allergyHits.length) {
      const lines = allergyHits.map((h) => `• ${h.message}`).join('\n');
      const proceed = window.confirm(
        `ALLERGY WARNING for ${state.activePatient.first_name} ${state.activePatient.last_name}\n\n${lines}\n\nPrescribe ${drug_name} anyway?`,
      );
      if (!proceed) return;
    }

    // Medical-history screening: confirm only on HIGH-level warnings (cautions are shown in the box).
    const mhHigh = (await fetchMedicalDrugAlerts(state.activePatient.id, drug_name)).filter((a) => a.level === 'high');
    if (mhHigh.length) {
      const lines = mhHigh.map((a) => `• ${a.message}`).join('\n');
      const proceedMh = window.confirm(
        `MEDICAL HISTORY WARNING for ${state.activePatient.first_name} ${state.activePatient.last_name}\n\n${lines}\n\nPrescribe ${drug_name} anyway?`,
      );
      if (!proceedMh) return;
    }

    const isEditing = !!state.editingPrescriptionId;
    const saveBtn = document.getElementById('rxSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = isEditing ? 'Updating…' : 'Saving…';

    const payload = {
      patient_id: state.activePatient.id,
      diagnosis_id: diagnosisValue || null,
      drug_name,
      dosage,
      frequency,
      duration,
      notes,
    };

    try {
      if (isEditing) {
        const updated = await fetchMethod(`/prescriptions/${state.editingPrescriptionId}`, 'PUT', payload, true);
        const idx = state.prescriptions.findIndex((rx) => rx.id === updated.id);
        if (idx !== -1) state.prescriptions[idx] = updated;
        showToast('Prescription updated.');
      } else {
        const created = await fetchMethod('/prescriptions', 'POST', payload, true);
        state.prescriptions.unshift(created);
        showToast('Prescription saved.');
      }
      renderPrescriptionHistory();
      exitEditMode();
    } catch (err) {
      showToast(err.message || `Could not ${isEditing ? 'update' : 'save'} this prescription. Please try again.`);
      saveBtn.disabled = false;
      saveBtn.textContent = isEditing ? 'Update prescription' : 'Save prescription';
    }
  }

  /* ============================================================
     TEMPLATES
     ------------------------------------------------------------
     Built-in starting points plus this dentist's own saved ones
     (GET/POST/DELETE /prescription-templates). Picking one only fills
     the form; nothing is saved until the dentist presses Save. The
     built-in doses are common adult starting points — review them
     against your clinic's own protocol before relying on them.
     ============================================================ */
  const BUILT_IN_TEMPLATES = [
    { name: 'Amoxicillin 500mg', drug_name: 'Amoxicillin', dosage: '500mg', frequency: '3 times daily', duration: '5 days', notes: 'Complete the full course even if you feel better.' },
    { name: 'Augmentin 625mg', drug_name: 'Amoxicillin + clavulanic acid (Augmentin)', dosage: '625mg', frequency: '3 times daily', duration: '5 days', notes: 'Take with food. Complete the full course.' },
    { name: 'Metronidazole 400mg', drug_name: 'Metronidazole', dosage: '400mg', frequency: '3 times daily', duration: '5 days', notes: 'Avoid alcohol during treatment and for 48 hours after the last dose.' },
    { name: 'Clindamycin 300mg', drug_name: 'Clindamycin', dosage: '300mg', frequency: '4 times daily', duration: '5 days', notes: 'Take with a full glass of water. Report any severe diarrhoea.' },
    { name: 'Ibuprofen 400mg', drug_name: 'Ibuprofen', dosage: '400mg', frequency: '3 times daily after meals', duration: '3 days', notes: 'Take with food. Stop and contact the clinic if you get stomach pain.' },
    { name: 'Paracetamol 1g', drug_name: 'Paracetamol', dosage: '1g', frequency: 'Every 6 hours when needed', duration: '3 days', notes: 'Do not take more than 4g in 24 hours.' },
    { name: 'Chlorhexidine 0.2% mouthwash', drug_name: 'Chlorhexidine 0.2% mouthwash', dosage: '10ml', frequency: 'Twice daily', duration: '7 days', notes: 'Rinse for 1 minute, then spit out. Do not swallow. Avoid eating or drinking for 30 minutes afterwards.' },
  ];

  async function loadTemplates() {
    try {
      const rows = await fetchMethod('/prescription-templates', 'GET', null, true);
      state.templates = Array.isArray(rows) ? rows : [];
    } catch (err) {
      // Non-fatal: the built-in templates still work if saved ones can't load.
      state.templates = [];
    }
    renderTemplateSelect();
  }

  function renderTemplateSelect() {
    const sel = document.getElementById('rxTemplateSelect');
    const mine = state.templates
      .map((t) => `<option value="c:${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    const common = BUILT_IN_TEMPLATES
      .map((t, i) => `<option value="b:${i}">${escapeHtml(t.name)}</option>`).join('');
    sel.innerHTML = '<option value="">Choose a template…</option>'
      + (mine ? `<optgroup label="My templates">${mine}</optgroup>` : '')
      + `<optgroup label="Common">${common}</optgroup>`;
  }

  // Returns { ...template, custom: boolean } for the current picker value, or null.
  function getSelectedTemplate() {
    const value = document.getElementById('rxTemplateSelect').value;
    if (value.startsWith('b:')) {
      const t = BUILT_IN_TEMPLATES[Number(value.slice(2))];
      return t ? { ...t, custom: false } : null;
    }
    if (value.startsWith('c:')) {
      const t = state.templates.find((x) => String(x.id) === value.slice(2));
      return t ? { ...t, custom: true } : null;
    }
    return null;
  }

  function onTemplateChange() {
    const tpl = getSelectedTemplate();
    document.getElementById('rxDeleteTemplateBtn').style.display = tpl && tpl.custom ? 'inline-flex' : 'none';
    if (!tpl) return;
    document.getElementById('rxDrugName').value = tpl.drug_name || '';
    document.getElementById('rxDosage').value = tpl.dosage || '';
    document.getElementById('rxFrequency').value = tpl.frequency || '';
    document.getElementById('rxDuration').value = tpl.duration || '';
    document.getElementById('rxNotes').value = tpl.notes || '';
    updateAllergyBox();
  }

  async function saveAsTemplate() {
    const drug_name = document.getElementById('rxDrugName').value.trim();
    const dosage = document.getElementById('rxDosage').value.trim();
    const frequency = document.getElementById('rxFrequency').value.trim();
    const duration = document.getElementById('rxDuration').value.trim();
    const notes = document.getElementById('rxNotes').value.trim();

    if (!drug_name || !dosage || !frequency || !duration) {
      showToast('Fill in the drug name, dosage, frequency and duration first, then save it as a template.');
      return;
    }

    const name = (window.prompt('Name this template:', `${drug_name} ${dosage}`.trim()) || '').trim();
    if (!name) return;

    try {
      const created = await fetchMethod(
        '/prescription-templates', 'POST',
        { name, drug_name, dosage, frequency, duration, notes }, true,
      );
      state.templates.push(created);
      state.templates.sort((a, b) => a.name.localeCompare(b.name));
      renderTemplateSelect();
      document.getElementById('rxTemplateSelect').value = `c:${created.id}`;
      document.getElementById('rxDeleteTemplateBtn').style.display = 'inline-flex';
      showToast('Template saved.');
    } catch (err) {
      showToast(err.message || 'Could not save the template.');
    }
  }

  async function deleteSelectedTemplate() {
    const tpl = getSelectedTemplate();
    if (!tpl || !tpl.custom) return;
    if (!window.confirm(`Delete the template "${tpl.name}"? Prescriptions already written are not affected.`)) return;

    try {
      await fetchMethod(`/prescription-templates/${tpl.id}`, 'DELETE', null, true);
      state.templates = state.templates.filter((t) => String(t.id) !== String(tpl.id));
      renderTemplateSelect();
      document.getElementById('rxDeleteTemplateBtn').style.display = 'none';
      showToast('Template deleted.');
    } catch (err) {
      showToast(err.message || 'Could not delete the template.');
    }
  }

  /* ============================================================
     ALLERGY BOX
     ------------------------------------------------------------
     Shows the patient's recorded allergies and, as the drug name is
     typed, any match from allergyCheck.js. savePrescription() asks for
     confirmation before saving a flagged drug. It is a screening aid —
     no warning does not mean the drug is safe for this patient.
     ============================================================ */
  function updateAllergyBox() {
    const box = document.getElementById('rxAllergyBox');
    if (!box) return;
    const patient = state.activePatient;
    if (!patient) { box.innerHTML = ''; return; }

    const allergiesText = (patient.allergies || '').trim();
    const recorded = AllergyCheck.parseAllergies(allergiesText);

    let html = recorded.length
      ? `<div class="rx-allergy-line rx-allergy-record">Allergies on record: ${escapeHtml(allergiesText)}</div>`
      : '<div class="rx-allergy-line rx-allergy-none">No allergies on record for this patient.</div>';

    AllergyCheck.check(allergiesText, document.getElementById('rxDrugName').value).forEach((hit) => {
      html += `<div class="rx-allergy-line rx-allergy-${hit.level}" role="alert">${hit.level === 'high' ? 'Warning' : 'Check'}: ${escapeHtml(hit.message)}</div>`;
    });

    // Medical-history screening (conditions, medicines, pregnancy…) from the server.
    html += medicalAlertsHtml(patient);
    box.innerHTML = html;

    if (!box.dataset.mhBound) {
      box.dataset.mhBound = '1';
      box.addEventListener('click', (e) => {
        if (!e.target.closest('[data-rx-record-history]') || !state.activePatient || !window.MedicalHistory) return;
        const p = state.activePatient;
        window.MedicalHistory.open({
          patientId: p.id,
          patientName: `${p.first_name} ${p.last_name}`,
          onSaved: () => { state.mh = null; updateAllergyBox(); },
        });
      });
    }
    scheduleMedicalAlerts();
  }

  /* ============================================================
     MEDICAL-HISTORY ALERTS
     ------------------------------------------------------------
     state.mh = { key, loaded, data, timer } where key is
     "<patientId>|<drug>". The alerts endpoint is called (debounced)
     whenever the patient or the typed drug changes; the box above
     re-renders from the latest answer. Like the allergy check this
     is a screening aid — no warning does not mean the drug is safe.
     ============================================================ */
  function medicalKey() {
    const p = state.activePatient;
    const drug = (document.getElementById('rxDrugName').value || '').trim().toLowerCase();
    return p ? `${p.id}|${drug}` : '';
  }

  function scheduleMedicalAlerts() {
    if (!window.MedicalHistory || !state.activePatient) return;
    const key = medicalKey();
    state.mh = state.mh || {};
    if (state.mh.key === key) return; // already fetched (or in flight) for this patient + drug
    state.mh.key = key;
    state.mh.loaded = false;
    clearTimeout(state.mh.timer);

    const patientId = state.activePatient.id;
    const drug = key.split('|')[1];
    state.mh.timer = setTimeout(async () => {
      let data = null;
      try { data = await window.MedicalHistory.fetchAlerts(patientId, { drug }); } catch (e) { data = null; }
      if (!state.mh || state.mh.key !== key) return; // patient or drug changed meanwhile
      state.mh.data = data;
      state.mh.loaded = true;
      const box = document.getElementById('rxAllergyBox');
      if (!box || !state.activePatient || state.activePatient.id !== patientId) return;
      // Re-render without re-triggering a fetch (key is unchanged).
      updateAllergyBox();
    }, 350);
  }

  function medicalAlertsHtml(patient) {
    const mh = state.mh;
    if (!window.MedicalHistory || !mh || !mh.loaded || !mh.data) return '';
    if (!mh.key || mh.key.split('|')[0] !== String(patient.id)) return '';
    const d = mh.data;
    let html = '';

    if (!d.has_history) {
      html += `<div class="rx-allergy-line rx-allergy-caution" role="alert">No medical history on file — conditions and current medicines have NOT been screened. <button type="button" class="btn btn-outline btn-sm" data-rx-record-history style="margin-left:8px;">Record now</button></div>`;
      return html;
    }
    if (d.needs_review || d.stale) {
      html += `<div class="rx-allergy-line rx-allergy-caution">${d.needs_review ? 'Medical history has not been reviewed by a clinician yet.' : 'Medical history is more than 6 months old.'} <button type="button" class="btn btn-outline btn-sm" data-rx-record-history style="margin-left:8px;">Review</button></div>`;
    }
    const cls = (level) => (level === 'info' ? 'record' : level);
    const label = (level) => (level === 'high' ? 'Warning' : level === 'caution' ? 'Check' : 'Note');
    (d.drug || []).forEach((a) => {
      html += `<div class="rx-allergy-line rx-allergy-${cls(a.level)}" role="alert">${label(a.level)}: ${escapeHtml(a.message)}</div>`;
    });
    (d.standing || []).filter((a) => a.level === 'high').forEach((a) => {
      html += `<div class="rx-allergy-line rx-allergy-record">On record: ${escapeHtml(a.message)}</div>`;
    });
    return html;
  }

  async function fetchMedicalDrugAlerts(patientId, drug) {
    if (!window.MedicalHistory) return [];
    try {
      const d = await window.MedicalHistory.fetchAlerts(patientId, { drug });
      return Array.isArray(d.drug) ? d.drug : [];
    } catch (e) {
      return []; // never block prescribing because the screening call failed
    }
  }

  /* ============================================================
     PRESCRIPTION HISTORY
     ============================================================ */
  function renderPrescriptionHistory() {
    const el = document.getElementById('rxTimeline');
    if (!state.prescriptions.length) {
      el.innerHTML = '<div class="empty-state">No prescriptions written for this patient yet.</div>';
      return;
    }
    el.innerHTML = state.prescriptions.map((rx) => `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${formatDate(rx.created_at)}</span>
          <button class="panel-link rx-edit-btn" type="button" data-id="${rx.id}">Edit</button>
        </div>
        <div class="timeline-note">
          <div class="rx-drug-name">${escapeHtml(rx.drug_name || '')}</div>
          <div class="rx-meta">
            ${rx.dosage ? `<span class="rx-tag">${escapeHtml(rx.dosage)}</span>` : ''}
            ${rx.frequency ? `<span class="rx-tag">${escapeHtml(rx.frequency)}</span>` : ''}
            ${rx.duration ? `<span class="rx-tag">${escapeHtml(rx.duration)}</span>` : ''}
          </div>
          ${rx.notes ? `<div style="margin-top:6px;">${escapeHtml(rx.notes)}</div>` : ''}
        </div>
      </div>
    `).join('');

    el.querySelectorAll('.rx-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rx = state.prescriptions.find((p) => String(p.id) === btn.dataset.id);
        if (rx) startEditPrescription(rx);
      });
    });
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
     under 'jino_token'. Backend defaults to today's date (Africa/Nairobi)
     when no ?date= is passed, so this prints today's prescriptions for
     the active patient.
     ============================================================ */
  async function downloadActivePatientRx() {
    if (!state.activePatient) return;
    await downloadPdf(
      `/prescriptions/patient/${state.activePatient.id}/pdf`,
      `prescription-${state.activePatient.last_name}.pdf`
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }
})();