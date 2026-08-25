(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD — mirrors receptionistDashboard.js's guard.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'receptionist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    patients: [],
    query: '',
    activeFilter: 'all', // 'all' | 'allergies'
    dentistsById: {},    // fetched once on page load, reused by every modal open
    recordsCache: {},    // patientId -> appointments array, fetched once per patient
    activePatientId: null,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);
    initSearch();
    initFilterTabs();
    initAddPatientModal();
    initDetailModal();
    renderSkeleton();
    loadPatients();
    loadDentists();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadPatients() {
    try {
      const patients = await fetchMethod('/patients', 'GET', null, true);
      state.patients = patients;
      renderRoster();
    } catch (err) {
      handleLoadError(err);
    }
  }

  // Fetched once, independent of the roster load, so opening any patient's
  // modal never has to wait on (or re-request) the dentist name list.
  async function loadDentists() {
    try {
      const dentists = await fetchMethod('/users/dentists', 'GET', null, true);
      state.dentistsById = {};
      dentists.forEach((d) => { state.dentistsById[d.id] = d; });
    } catch (err) {
      // Non-fatal — appointment "with" labels just fall back to "Dentist".
    }
  }

  function resolveDentistName(dentistId) {
    if (!dentistId) return 'Dentist';
    const d = state.dentistsById[dentistId];
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Dentist';
  }

  function handleLoadError(err) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    document.getElementById('rosterList').innerHTML =
      '<div class="empty-state">Could not load patients. Please refresh.</div>';
    document.getElementById('rosterCount').textContent = '';
    showToast(err.message || 'Could not load patients. Please refresh.');
  }

  /* ============================================================
     SEARCH + FILTER
     ============================================================ */
  function initSearch() {
    const input = document.getElementById('rosterSearchInput');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.query = input.value.trim().toLowerCase();
        renderRoster();
      }, 150);
    });
  }

  function initFilterTabs() {
    const tabs = document.querySelectorAll('#rosterFilterTabs .filter-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        state.activeFilter = tab.dataset.filter;
        renderRoster();
      });
    });
  }

  function getFilteredPatients() {
    let list = state.patients;

    if (state.activeFilter === 'allergies') {
      list = list.filter((p) => hasAllergies(p));
    }

    if (state.query) {
      const q = state.query;
      list = list.filter((p) => (
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.national_id || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      ));
    }

    return list;
  }

  function hasAllergies(p) {
    if (!p.allergies) return false;
    const val = String(p.allergies).trim().toLowerCase();
    return val !== '' && val !== 'none' && val !== 'n/a' && val !== 'na';
  }

  /* ============================================================
     RENDER — ROSTER
     ============================================================ */
  function renderSkeleton() {
    const list = document.getElementById('rosterList');
    list.innerHTML = Array.from({ length: 6 }).map(() => `
      <div class="roster-skel-row">
        <div class="roster-skel-avatar"></div>
        <div class="roster-skel-line"></div>
      </div>
    `).join('');
    document.getElementById('rosterCount').textContent = '';
  }

  function renderRoster() {
    const list = document.getElementById('rosterList');
    const countEl = document.getElementById('rosterCount');
    const filtered = getFilteredPatients();

    countEl.textContent = `${filtered.length} patient${filtered.length === 1 ? '' : 's'}`;

    list.innerHTML = '';

    if (!filtered.length) {
      list.innerHTML = state.patients.length
        ? '<div class="empty-state">No patients match your search.</div>'
        : '<div class="empty-state">No patients on record yet. Register the first one to get started.</div>';
      return;
    }

    filtered.forEach((p) => {
      const name = `${p.first_name} ${p.last_name}`;
      const age = ageFromDob(p.date_of_birth);
      const metaParts = [];
      if (age != null) metaParts.push(`${age} yrs`);
      if (p.phone) metaParts.push(p.phone);
      if (!p.phone && p.email) metaParts.push(p.email);
      if (p.national_id) metaParts.push(`ID ${p.national_id}`);

      const row = document.createElement('div');
      row.className = 'roster-row';
      row.innerHTML = `
        <div class="roster-avatar">${Avatar.avatarInnerHtml(name, p.profile_picture_url)}</div>
        <div class="roster-mid">
          <p class="t">${escapeHtml(name)}</p>
          <p class="s">${escapeHtml(metaParts.join(' · ') || 'No contact details on file')}</p>
        </div>
        <div class="roster-flags">
          ${hasAllergies(p) ? '<span class="badge badge-allergy">Allergies</span>' : ''}
          ${p.is_active === false ? '<span class="badge badge-inactive">Deactivated</span>' : ''}
        </div>
        <svg class="roster-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;
      row.addEventListener('click', () => openDetailModal(p));
      list.appendChild(row);
    });
  }

  /* ============================================================
     REGISTER WALK-IN PATIENT MODAL
     Hits POST /patients directly (createPatient) — this is a
     front-desk walk-in record, not a login-capable patient
     account, so it does not go through /auth/register-patient
     the way the admin portal's "create account" flow does.
     Mirrors the walk-in modal already on receptionist-dashboard.html.
     ============================================================ */
  function initAddPatientModal() {
    const scrim = document.getElementById('addPatientScrim');
    document.getElementById('openAddPatientBtn').addEventListener('click', openAddPatientModal);
    document.getElementById('addPatientClose').addEventListener('click', closeAddPatientModal);
    document.getElementById('addPatientCancelBtn').addEventListener('click', closeAddPatientModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeAddPatientModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeAddPatientModal();
    });

    document.getElementById('addPatientForm').addEventListener('submit', handleAddPatientSubmit);
  }

  function openAddPatientModal() {
    document.getElementById('addPatientForm').reset();
    document.getElementById('addPatientError').style.display = 'none';
    document.getElementById('addPatientScrim').classList.add('is-open');
    document.getElementById('npFirstName').focus();
  }

  function closeAddPatientModal() {
    document.getElementById('addPatientScrim').classList.remove('is-open');
  }

  async function handleAddPatientSubmit(e) {
    e.preventDefault();

    const errorEl = document.getElementById('addPatientError');
    errorEl.style.display = 'none';

    const first_name = document.getElementById('npFirstName').value.trim();
    const last_name = document.getElementById('npLastName').value.trim();
    const phone = document.getElementById('npPhone').value.trim();

    if (!first_name || !last_name || !phone) {
      errorEl.textContent = 'First name, last name, and phone are required.';
      errorEl.style.display = 'block';
      return;
    }

    const payload = {
      first_name, last_name, phone,
      national_id: document.getElementById('npNationalId').value.trim() || null,
      date_of_birth: document.getElementById('npDob').value || null,
      email: document.getElementById('npEmail').value.trim() || null,
      address: document.getElementById('npAddress').value.trim() || null,
      next_of_kin_name: document.getElementById('npKinName').value.trim() || null,
      next_of_kin_phone: document.getElementById('npKinPhone').value.trim() || null,
      allergies: document.getElementById('npAllergies').value.trim() || null,
    };

    const submitBtn = document.getElementById('addPatientSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering…';

    try {
      const patient = await fetchMethod('/patients', 'POST', payload, true);
      state.patients.unshift(patient);
      renderRoster();
      closeAddPatientModal();
      showToast(`${patient.first_name} ${patient.last_name} registered.`);
    } catch (err) {
      errorEl.textContent = err.message || 'Could not register the patient.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register patient';
    }
  }

  /* ============================================================
     PATIENT QUICK VIEW / EDIT MODAL
     ------------------------------------------------------------
     Appointments are fetched once per patient, on first open, and
     cached in state.recordsCache — reopening the same patient's
     modal reuses that data instead of hitting the API again.
     Booking a new appointment or changing an appointment's status
     needs the dentist picker and inline actions already built on
     the full record page, so this modal links out to
     receptionist-patient.html for those rather than duplicating them.
     ============================================================ */
  function initDetailModal() {
    const scrim = document.getElementById('detailModalScrim');
    document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeDetailModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeDetailModal();
    });

    document.getElementById('detailEditBtn').addEventListener('click', enterEditMode);
    document.getElementById('detailEditCancelBtn').addEventListener('click', exitEditMode);
    document.getElementById('detailEditSaveBtn').addEventListener('click', saveEdit);
  }

  function openDetailModal(patient) {
    state.activePatientId = patient.id;

    const name = `${patient.first_name} ${patient.last_name}`;
    const age = ageFromDob(patient.date_of_birth);
    const metaParts = [];
    if (age != null) metaParts.push(`${age} yrs`);
    if (patient.phone) metaParts.push(patient.phone);
    if (patient.national_id) metaParts.push(`ID ${patient.national_id}`);

    document.getElementById('detailName').textContent = name;
    document.getElementById('detailSub').textContent = metaParts.join(' · ') || 'No contact details on file';
    document.getElementById('detailAvatar').innerHTML = Avatar.avatarInnerHtml(name, patient.profile_picture_url);
    document.getElementById('detailOpenFullBtn').href = `receptionist-patient.html?id=${patient.id}`;

    const allergyBox = document.getElementById('detailAllergyAlert');
    if (hasAllergies(patient)) {
      allergyBox.style.display = 'block';
      allergyBox.innerHTML = `
        <div class="detail-allergy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>
          <span>Allergies: ${escapeHtml(patient.allergies)}</span>
        </div>
      `;
    } else {
      allergyBox.style.display = 'none';
      allergyBox.innerHTML = '';
    }

    renderDetailInfoGrid(patient);
    exitEditMode();
    scrimOpen();

    if (state.recordsCache[patient.id]) {
      renderDetailAppointments(state.recordsCache[patient.id]);
    } else {
      document.getElementById('detailApptList').innerHTML = '<div class="empty-state">Loading…</div>';
      loadPatientAppointments(patient.id);
    }
  }

  function scrimOpen() {
    document.getElementById('detailModalScrim').classList.add('is-open');
  }

  function closeDetailModal() {
    document.getElementById('detailModalScrim').classList.remove('is-open');
    state.activePatientId = null;
  }

  function renderDetailInfoGrid(patient) {
    const grid = document.getElementById('detailInfoGrid');
    grid.innerHTML = '';
    grid.appendChild(detailInfoItem('Date of birth', patient.date_of_birth ? formatDate(patient.date_of_birth) : null));
    grid.appendChild(detailInfoItem('National ID', patient.national_id));
    grid.appendChild(detailInfoItem('Phone', patient.phone));
    grid.appendChild(detailInfoItem('Email', patient.email));
    grid.appendChild(detailInfoItem('Address', patient.address));
    grid.appendChild(detailInfoItem(
      'Next of kin',
      patient.next_of_kin_name ? `${patient.next_of_kin_name}${patient.next_of_kin_phone ? ' · ' + patient.next_of_kin_phone : ''}` : null
    ));
  }

  function detailInfoItem(label, value) {
    const wrap = document.createElement('div');
    const valueHtml = value ? escapeHtml(value) : '<span class="is-empty">Not on file</span>';
    wrap.innerHTML = `<p class="k">${escapeHtml(label)}</p><p class="v${value ? '' : ' is-empty'}">${valueHtml}</p>`;
    return wrap;
  }

  async function loadPatientAppointments(patientId) {
    try {
      const appointments = await fetchMethod(`/appointments/patient/${patientId}`, 'GET', null, true);
      state.recordsCache[patientId] = appointments;
      // Only render if the receptionist hasn't already closed or switched patients.
      if (state.activePatientId === patientId) renderDetailAppointments(appointments);
    } catch (err) {
      const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
      if (authFailures.includes(err.message)) {
        clearSession();
        window.location.href = LOGIN_PATH;
        return;
      }
      if (state.activePatientId === patientId) {
        document.getElementById('detailApptList').innerHTML =
          '<div class="empty-state">Could not load appointments. Please try again.</div>';
      }
    }
  }

  function renderDetailAppointments(appointments) {
    const list = document.getElementById('detailApptList');
    list.innerHTML = '';

    if (!appointments.length) {
      list.innerHTML = '<div class="empty-state">No appointments on record for this patient.</div>';
      return;
    }

    const sorted = [...appointments].sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start));

    sorted.forEach((appt) => {
      const dt = new Date(appt.scheduled_start);
      const row = document.createElement('div');
      row.className = 'sched-item';
      row.innerHTML = `
        <div class="sched-time">${escapeHtml(formatDate(appt.scheduled_start))}<br>${escapeHtml(dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(resolveDentistName(appt.dentist_id))}${appt.room ? ' · ' + escapeHtml(appt.room) : ''}</p>
          <p class="s">${escapeHtml(appt.reason || 'No reason given')}</p>
        </div>
        <div class="sched-flags">
          <span class="badge badge-${appt.status}">${capitalize(appt.status.replace('_', ' '))}</span>
        </div>
      `;
      list.appendChild(row);
    });
  }

  /* ---- inline edit mode ---- */
  function enterEditMode() {
    const p = state.patients.find((x) => x.id === state.activePatientId);
    if (!p) return;

    document.getElementById('deFirstName').value = p.first_name || '';
    document.getElementById('deLastName').value = p.last_name || '';
    document.getElementById('dePhone').value = p.phone || '';
    document.getElementById('deNationalId').value = p.national_id || '';
    document.getElementById('deDob').value = p.date_of_birth ? p.date_of_birth.slice(0, 10) : '';
    document.getElementById('deEmail').value = p.email || '';
    document.getElementById('deAddress').value = p.address || '';
    document.getElementById('deKinName').value = p.next_of_kin_name || '';
    document.getElementById('deKinPhone').value = p.next_of_kin_phone || '';
    document.getElementById('deAllergies').value = p.allergies || '';

    document.getElementById('detailViewSection').style.display = 'none';
    document.getElementById('detailEditSection').style.display = 'block';
    document.getElementById('detailViewFoot').style.display = 'none';
    document.getElementById('detailEditFoot').style.display = 'flex';
  }

  function exitEditMode() {
    document.getElementById('detailViewSection').style.display = 'block';
    document.getElementById('detailEditSection').style.display = 'none';
    document.getElementById('detailViewFoot').style.display = 'flex';
    document.getElementById('detailEditFoot').style.display = 'none';
  }

  // updatePatient sets every column positionally, so this submits the
  // full record, not just changed fields — same constraint as the
  // edit form on receptionist-patient.html.
  async function saveEdit() {
    const patientId = state.activePatientId;
    const first_name = document.getElementById('deFirstName').value.trim();
    const last_name = document.getElementById('deLastName').value.trim();
    const phone = document.getElementById('dePhone').value.trim();

    if (!first_name || !last_name || !phone) {
      return showToast('First name, last name, and phone are required');
    }

    const data = {
      first_name, last_name, phone,
      national_id: document.getElementById('deNationalId').value.trim() || null,
      date_of_birth: document.getElementById('deDob').value || null,
      email: document.getElementById('deEmail').value.trim() || null,
      address: document.getElementById('deAddress').value.trim() || null,
      next_of_kin_name: document.getElementById('deKinName').value.trim() || null,
      next_of_kin_phone: document.getElementById('deKinPhone').value.trim() || null,
      allergies: document.getElementById('deAllergies').value.trim() || null,
    };

    try {
      const updated = await fetchMethod(`/patients/${patientId}`, 'PUT', data, true);
      const idx = state.patients.findIndex((x) => x.id === patientId);
      if (idx !== -1) state.patients[idx] = { ...state.patients[idx], ...updated };
      renderRoster();
      showToast('Patient details updated');
      if (idx !== -1) openDetailModal(state.patients[idx]);
      else closeDetailModal();
    } catch (err) {
      showToast(err.message || 'Could not update patient');
    }
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
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function formatDate(value) {
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function ageFromDob(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = Avatar.initialsOf(name);
  }
})();