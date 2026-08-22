(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors dentistPatients.js's guard, but for the 'admin' role.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'admin') {
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
    recordsCache: {},    // patientId -> { appointments, bills }
    billItemsByBillId: {}, // lazy-loaded on expand, shared across modal opens
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
      // Non-fatal — appointment "with" labels just fall back to "Another dentist".
    }
  }

  function resolveDentistName(dentistId) {
    if (!dentistId) return 'Unknown dentist';
    const d = state.dentistsById[dentistId];
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Another dentist';
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
    input.addEventListener('input', () => {
      state.query = input.value.trim().toLowerCase();
      renderRoster();
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
      list = list.filter((p) => {
        return (
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.phone || '').toLowerCase().includes(q) ||
          (p.national_id || '').toLowerCase().includes(q) ||
          (p.email || '').toLowerCase().includes(q)
        );
      });
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
        : '<div class="empty-state">No patients on record yet. Add the first one to get started.</div>';
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
     ADD PATIENT MODAL
     ------------------------------------------------------------
     Creates the User (role: patient) + linked Patient record in
     one call via POST /auth/register-patient — the same endpoint
     patient self sign-up uses. That endpoint returns a token for
     the new patient; we deliberately ignore it (never saveSession
     here) since saving it would hijack the admin's own session.
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
    document.getElementById('apFirstName').focus();
  }

  function closeAddPatientModal() {
    document.getElementById('addPatientScrim').classList.remove('is-open');
  }

  async function handleAddPatientSubmit(e) {
    e.preventDefault();

    const errorEl = document.getElementById('addPatientError');
    errorEl.style.display = 'none';

    const payload = {
      first_name: document.getElementById('apFirstName').value.trim(),
      last_name: document.getElementById('apLastName').value.trim(),
      email: document.getElementById('apEmail').value.trim(),
      phone: document.getElementById('apPhone').value.trim() || null,
      password: document.getElementById('apPassword').value,
      date_of_birth: document.getElementById('apDob').value || null,
      national_id: document.getElementById('apNationalId').value.trim() || null,
      address: document.getElementById('apAddress').value.trim() || null,
      next_of_kin_name: document.getElementById('apNextKinName').value.trim() || null,
      next_of_kin_phone: document.getElementById('apNextKinPhone').value.trim() || null,
    };

    if (!payload.first_name || !payload.last_name || !payload.email || !payload.password) {
      errorEl.textContent = 'First name, last name, email, and password are required.';
      errorEl.style.display = 'block';
      return;
    }
    if (payload.password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    const submitBtn = document.getElementById('addPatientSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      // auth: false — this is the public registration endpoint, and we must
      // not let its response overwrite the admin's own session/token.
      const result = await fetchMethod('/auth/register-patient', 'POST', payload, false);
      state.patients.unshift(result.patient);
      renderRoster();
      closeAddPatientModal();
      showToast(`${result.patient.first_name} ${result.patient.last_name} added.`);
    } catch (err) {
      errorEl.textContent = err.message || 'Could not create the patient account.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create patient account';
    }
  }

  /* ============================================================
     PATIENT DETAIL MODAL
     ------------------------------------------------------------
     Overview / Appointments / Bills tabs. Appointments + bills are
     fetched once per patient, on first open, and cached in
     state.recordsCache — reopening the same patient's modal reuses
     that data instead of hitting the API again.
     ============================================================ */
  function initDetailModal() {
    const scrim = document.getElementById('detailModalScrim');
    document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeDetailModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeDetailModal();
    });

    document.querySelectorAll('#detailTabs .filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchDetailTab(tab.dataset.tab));
    });

    document.getElementById('deactivatePatientBtn').addEventListener('click', handleDeactivate);
  }

  function openDetailModal(patient) {
    state.activePatientId = patient.id;

    const name = `${patient.first_name} ${patient.last_name}`;
    const age = ageFromDob(patient.date_of_birth);
    const metaParts = [];
    if (age != null) metaParts.push(`${age} yrs`);
    if (patient.phone) metaParts.push(patient.phone);
    if (patient.national_id) metaParts.push(`ID ${patient.national_id}`);

    document.getElementById('detailModalName').textContent = name;
    document.getElementById('detailModalMeta').textContent = metaParts.join(' · ') || 'No contact details on file';
    document.getElementById('detailModalAvatar').innerHTML = Avatar.avatarInnerHtml(name, patient.profile_picture_url);

    const banner = document.getElementById('detailModalAllergyBanner');
    if (hasAllergies(patient)) {
      banner.style.display = 'flex';
      document.getElementById('detailModalAllergyText').textContent = `Allergies: ${patient.allergies}`;
    } else {
      banner.style.display = 'none';
    }

    renderOverviewTab(patient);

    const deactivateBtn = document.getElementById('deactivatePatientBtn');
    if (patient.is_active === false) {
      deactivateBtn.textContent = 'Already deactivated';
      deactivateBtn.disabled = true;
    } else {
      deactivateBtn.textContent = 'Deactivate patient';
      deactivateBtn.disabled = false;
    }

    switchDetailTab('overview');
    document.getElementById('detailModalScrim').classList.add('is-open');

    if (state.recordsCache[patient.id]) {
      renderAppointments(state.recordsCache[patient.id].appointments);
      renderBills(state.recordsCache[patient.id].bills);
    } else {
      showDetailLoading();
      loadPatientRecords(patient.id);
    }
  }

  function closeDetailModal() {
    document.getElementById('detailModalScrim').classList.remove('is-open');
    state.activePatientId = null;
  }

  function switchDetailTab(tabName) {
    document.querySelectorAll('#detailTabs .filter-tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.detail-tab-panel').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.tabPanel === tabName);
    });
  }

  function renderOverviewTab(patient) {
    const rows = [
      ['Email', patient.email],
      ['Phone', patient.phone],
      ['Date of birth', patient.date_of_birth ? formatDate(patient.date_of_birth) : null],
      ['National ID', patient.national_id],
      ['Address', patient.address],
      ['Next of kin', patient.next_of_kin_name],
      ['Next of kin phone', patient.next_of_kin_phone],
      ['Patient since', formatDate(patient.created_at)],
    ];

    document.getElementById('overviewGrid').innerHTML = rows.map(([label, value]) => `
      <div class="detail-cell">
        <p class="label">${escapeHtml(label)}</p>
        <p class="value">${value ? escapeHtml(String(value)) : '—'}</p>
      </div>
    `).join('');
  }

  function showDetailLoading() {
    const spinner = '<div class="records-loading"><div class="spinner"></div>Loading…</div>';
    document.getElementById('modalApptList').innerHTML = spinner;
    document.getElementById('modalBillList').innerHTML = spinner;
  }

  async function loadPatientRecords(patientId) {
    try {
      const [appointments, bills] = await Promise.all([
        fetchMethod(`/appointments/patient/${patientId}`, 'GET', null, true),
        fetchMethod(`/bills/patient/${patientId}`, 'GET', null, true),
      ]);

      const records = { appointments, bills };
      state.recordsCache[patientId] = records;

      // Only render if the admin hasn't already closed or switched patients.
      if (state.activePatientId === patientId) {
        renderAppointments(appointments);
        renderBills(bills);
      }
    } catch (err) {
      const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
      if (authFailures.includes(err.message)) {
        clearSession();
        window.location.href = LOGIN_PATH;
        return;
      }
      const errorMsg = '<div class="empty-state">Could not load records. Please try again.</div>';
      if (state.activePatientId === patientId) {
        document.getElementById('modalApptList').innerHTML = errorMsg;
        document.getElementById('modalBillList').innerHTML = errorMsg;
      }
      showToast(err.message || 'Could not load patient records.');
    }
  }

  function renderAppointments(appointments) {
    const list = document.getElementById('modalApptList');
    if (!appointments.length) {
      list.innerHTML = '<div class="empty-state">No appointments on record for this patient.</div>';
      return;
    }

    list.innerHTML = appointments.map((a) => {
      const date = new Date(a.scheduled_start);
      const day = date.toLocaleDateString('en-US', { day: 'numeric' });
      const month = date.toLocaleDateString('en-US', { month: 'short' });
      const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="appt-item">
          <div class="appt-date"><div class="d">${day}</div><div class="m">${month}</div></div>
          <div class="appt-mid">
            <p class="t">${escapeHtml(a.reason || 'Appointment')}${a.room ? ' · ' + escapeHtml(a.room) : ''}</p>
            <p class="s">${escapeHtml(resolveDentistName(a.dentist_id))} · ${escapeHtml(time)}</p>
          </div>
          <div class="appt-actions">
            <span class="badge badge-${a.status}">${capitalize(String(a.status).replace('_', ' '))}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Bill line items load lazily on expand, same pattern as treatment-plan
  // items on the dentist roster page — avoids N+1 requests up front for
  // patients with a long billing history.
  function renderBills(bills) {
    const list = document.getElementById('modalBillList');
    if (!bills.length) {
      list.innerHTML = '<div class="empty-state">No bills for this patient yet.</div>';
      return;
    }

    list.innerHTML = bills.map((bill) => `
      <div class="bill-card" data-bill-id="${bill.id}">
        <div class="bill-head" data-role="bill-toggle">
          <div class="bill-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </div>
          <div class="bill-mid">
            <p class="t">Bill #${bill.id}</p>
            <p class="s">${formatDate(bill.created_at)}</p>
          </div>
          <div class="bill-amounts">
            <p class="total">${formatKsh(bill.total_amount)}</p>
            <p class="sub"><span class="badge badge-${bill.status}">${capitalize(String(bill.status).replace('_', ' '))}</span></p>
          </div>
          <svg class="bill-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="bill-body">
          <div data-role="bill-items"><div class="empty-state">Loading line items…</div></div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.bill-head').forEach((head) => {
      head.addEventListener('click', () => {
        const card = head.closest('.bill-card');
        const wasOpen = card.classList.contains('is-open');
        card.classList.toggle('is-open');
        if (!wasOpen) loadBillItems(card.dataset.billId, card);
      });
    });
  }

  async function loadBillItems(billId, card) {
    if (state.billItemsByBillId[billId]) {
      renderBillItems(billId, card);
      return;
    }
    try {
      const items = await fetchMethod(`/bill-items/bill/${billId}`, 'GET', null, true);
      state.billItemsByBillId[billId] = items;
      renderBillItems(billId, card);
    } catch (err) {
      card.querySelector('[data-role="bill-items"]').innerHTML =
        '<div class="empty-state">Could not load line items for this bill.</div>';
    }
  }

  function renderBillItems(billId, card) {
    const items = state.billItemsByBillId[billId] || [];
    const itemsHost = card.querySelector('[data-role="bill-items"]');

    if (!items.length) {
      itemsHost.innerHTML = '<div class="empty-state">No line items on this bill.</div>';
      return;
    }

    itemsHost.innerHTML = items.map((item) => `
      <div class="bill-item-row">
        <div class="bill-item-mid">
          <p class="t">${escapeHtml(item.description || 'Service')}</p>
          <p class="s">${escapeHtml(String(item.quantity))} × ${formatKsh(item.unit_price)}</p>
        </div>
        <div class="bill-item-amt">${formatKsh(item.quantity * item.unit_price)}</div>
      </div>
    `).join('');
  }

  /* ============================================================
     DEACTIVATE PATIENT
     ============================================================ */
  async function handleDeactivate() {
    const patientId = state.activePatientId;
    if (!patientId) return;

    const patient = state.patients.find((p) => p.id === patientId);
    const name = patient ? `${patient.first_name} ${patient.last_name}` : 'this patient';
    if (!window.confirm(`Deactivate ${name}? Their account will be disabled and they won't be able to log in.`)) {
      return;
    }

    const btn = document.getElementById('deactivatePatientBtn');
    btn.disabled = true;
    btn.textContent = 'Deactivating…';

    try {
      await fetchMethod(`/patients/${patientId}`, 'DELETE', null, true);
      if (patient) patient.is_active = false;
      renderRoster();
      btn.textContent = 'Already deactivated';
      showToast(`${name} has been deactivated.`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Deactivate patient';
      showToast(err.message || 'Could not deactivate this patient.');
    }
  }

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as dentistPatients.js
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
  function ageFromDob(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatKsh(value) {
    return 'KSh ' + Number(value || 0).toLocaleString('en-KE');
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function initialsOf(name) {
    return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
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