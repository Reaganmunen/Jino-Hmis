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
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    document.getElementById('patientSearchInput').addEventListener('input', onSearchInput);
    document.getElementById('switchPatientBtn').addEventListener('click', showPatientPicker);
    document.getElementById('downloadPatientRxBtn').addEventListener('click', downloadActivePatientRx);
    document.getElementById('rxSaveBtn').addEventListener('click', savePrescription);
    document.getElementById('rxCancelEditBtn').addEventListener('click', exitEditMode);
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

    document.getElementById('rxFormPanel').style.display = 'block';
    document.getElementById('rxHistoryPanel').style.display = 'block';
    document.getElementById('rxPatientName').textContent = `— ${patient.first_name} ${patient.last_name}`;
    document.getElementById('rxFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    exitEditMode();
    document.getElementById('rxTimeline').innerHTML = '<div class="empty-state">Loading prescription history…</div>';
    document.getElementById('rxDiagnosisSelect').innerHTML = '<option value="">No diagnosis link</option>';

    try {
      const [diagnoses, prescriptions] = await Promise.all([
        fetchMethod(`/diagnoses/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/prescriptions/patient/${patient.id}`, 'GET', null, true),
      ]);

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