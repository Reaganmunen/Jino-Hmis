(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors dentistDashboard.js's guard.
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
    patients: [],
    query: '',
    activeFilter: 'all', // 'all' | 'allergies'
    dentistsById: {},     // fetched once on page load, reused by every modal open
    recordsCache: {},     // patientId -> { diagnoses, plans, prescriptions, appointments }
    activePatientId: null,
    planItemsByPlanId: {}, // lazy-loaded on expand, shared across modal opens
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initSearch();
    initFilterTabs();
    initRecordsModal();
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
      // Non-fatal — "diagnosed by" labels just fall back to "Another dentist".
    }
  }

  function resolveDentistName(dentistId) {
    if (!dentistId) return 'Unknown dentist';
    if (dentistId === sessionUser.id) return 'You';
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
    const tabs = document.querySelectorAll('.filter-tab');
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
     RENDER
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
        : '<div class="empty-state">No patients on record yet.</div>';
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
        </div>
        <svg class="roster-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;
      row.addEventListener('click', () => openRecordsModal(p));
      list.appendChild(row);
    });
  }

  /* ============================================================
     PATIENT RECORDS MODAL
     ------------------------------------------------------------
     Diagnoses / treatment plans / prescriptions / appointments
     are fetched once per patient, on first open, and cached in
     state.recordsCache — reopening the same patient's modal
     reuses that data instead of hitting the API again.
     ============================================================ */
  function initRecordsModal() {
    const scrim = document.getElementById('recordsModalScrim');
    document.getElementById('recordsModalClose').addEventListener('click', closeRecordsModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeRecordsModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeRecordsModal();
    });

    document.querySelectorAll('#recordsTabs .filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchRecordsTab(tab.dataset.tab));
    });
  }

  function openRecordsModal(patient) {
    state.activePatientId = patient.id;

    const name = `${patient.first_name} ${patient.last_name}`;
    const age = ageFromDob(patient.date_of_birth);
    const metaParts = [];
    if (age != null) metaParts.push(`${age} yrs`);
    if (patient.phone) metaParts.push(patient.phone);
    if (patient.national_id) metaParts.push(`ID ${patient.national_id}`);

    document.getElementById('recordsModalName').textContent = name;
    document.getElementById('recordsModalMeta').textContent = metaParts.join(' · ') || 'No contact details on file';

    const banner = document.getElementById('recordsModalAllergyBanner');
    if (hasAllergies(patient)) {
      banner.style.display = 'flex';
      document.getElementById('recordsModalAllergyText').textContent = `Allergies: ${patient.allergies}`;
    } else {
      banner.style.display = 'none';
    }

    switchRecordsTab('diagnoses');
    document.getElementById('recordsModalScrim').classList.add('is-open');

    if (state.recordsCache[patient.id]) {
      renderAllRecordTabs(state.recordsCache[patient.id]);
    } else {
      showRecordsLoading();
      loadPatientRecords(patient.id);
    }
  }

  function closeRecordsModal() {
    document.getElementById('recordsModalScrim').classList.remove('is-open');
    state.activePatientId = null;
  }

  function switchRecordsTab(tabName) {
    document.querySelectorAll('#recordsTabs .filter-tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.records-tab-panel').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.tabPanel === tabName);
    });
  }

  function showRecordsLoading() {
    const spinner = '<div class="records-loading"><div class="mpesa-spinner"></div>Loading patient records…</div>';
    document.getElementById('modalDiagnosisTimeline').innerHTML = spinner;
    document.getElementById('modalPlanList').innerHTML = spinner;
    document.getElementById('modalRxList').innerHTML = spinner;
    document.getElementById('modalApptList').innerHTML = spinner;
  }

  async function loadPatientRecords(patientId) {
    try {
      const [diagnoses, plans, prescriptions, appointments] = await Promise.all([
        fetchMethod(`/diagnoses/patient/${patientId}`, 'GET', null, true),
        fetchMethod(`/treatment-plans/patient/${patientId}`, 'GET', null, true),
        fetchMethod(`/prescriptions/patient/${patientId}`, 'GET', null, true),
        fetchMethod(`/appointments/patient/${patientId}`, 'GET', null, true),
      ]);

      const records = { diagnoses, plans, prescriptions, appointments };
      state.recordsCache[patientId] = records;

      // Only render if the dentist hasn't already closed or switched patients.
      if (state.activePatientId === patientId) renderAllRecordTabs(records);
    } catch (err) {
      const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
      if (authFailures.includes(err.message)) {
        clearSession();
        window.location.href = LOGIN_PATH;
        return;
      }
      const errorMsg = `<div class="empty-state">Could not load records. Please try again.</div>`;
      if (state.activePatientId === patientId) {
        document.getElementById('modalDiagnosisTimeline').innerHTML = errorMsg;
        document.getElementById('modalPlanList').innerHTML = errorMsg;
        document.getElementById('modalRxList').innerHTML = errorMsg;
        document.getElementById('modalApptList').innerHTML = errorMsg;
      }
      showToast(err.message || 'Could not load patient records.');
    }
  }

  function renderAllRecordTabs(records) {
    renderDiagnosisTimeline(records.diagnoses);
    renderPlans(records.plans);
    renderPrescriptions(records.prescriptions);
    renderAppointments(records.appointments);
  }

  function renderDiagnosisTimeline(diagnoses) {
    const el = document.getElementById('modalDiagnosisTimeline');
    if (!diagnoses.length) {
      el.innerHTML = '<div class="empty-state">No diagnoses logged for this patient yet.</div>';
      return;
    }
    el.innerHTML = diagnoses.map((d) => {
      const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];
      return `
        <div class="timeline-item">
          <div class="timeline-row">
            <span class="timeline-date">${formatDate(d.created_at)}</span>
            <b>${escapeHtml(resolveDentistName(d.dentist_id))}</b>
          </div>
          <div class="timeline-note">
            ${escapeHtml(d.diagnosis_text || '')}
            ${teeth.length ? `<div style="margin-top:6px;">${teeth.map((t) => `<span class="tooth-tag">FDI ${escapeHtml(String(t))}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPlans(plans) {
    const list = document.getElementById('modalPlanList');
    if (!plans.length) {
      list.innerHTML = '<div class="empty-state">No treatment plans for this patient yet.</div>';
      return;
    }

    list.innerHTML = plans.map((plan) => `
      <div class="plan-card" data-plan-id="${plan.id}">
        <div class="plan-head" data-role="plan-toggle">
          <div class="plan-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </div>
          <div class="plan-mid">
            <p class="t">${escapeHtml(plan.description || 'Treatment plan')}</p>
            <p class="s">${escapeHtml(resolveDentistName(plan.dentist_id))} · ${formatDate(plan.created_at)}</p>
          </div>
          <div class="plan-amounts">
            ${plan.estimated_cost != null ? `<p class="total">KSh ${Number(plan.estimated_cost).toLocaleString('en-KE')}</p>` : ''}
            <p class="sub"><span class="badge badge-${plan.status}">${capitalize(String(plan.status).replace('_', ' '))}</span></p>
          </div>
          <svg class="plan-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="plan-body">
          <div class="plan-progress-wrap">
            <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
            <span class="progress-label" data-role="progress-label">Loading items…</span>
          </div>
          <div data-role="plan-items"><div class="empty-state">Loading treatment plan items…</div></div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.plan-head').forEach((head) => {
      head.addEventListener('click', () => {
        const card = head.closest('.plan-card');
        const wasOpen = card.classList.contains('is-open');
        card.classList.toggle('is-open');
        if (!wasOpen) loadPlanItems(card.dataset.planId, card);
      });
    });
  }

  // Route base assumed to be /treatment-plan-items per treatmentPlanItemRoutes.js —
  // double check the mount path in your app.js/index.js if this 404s.
  async function loadPlanItems(planId, card) {
    if (state.planItemsByPlanId[planId]) {
      renderPlanItems(planId, card);
      return;
    }
    try {
      const items = await fetchMethod(`/treatment-plan-items/plan/${planId}`, 'GET', null, true);
      state.planItemsByPlanId[planId] = items;
      renderPlanItems(planId, card);
    } catch (err) {
      card.querySelector('[data-role="plan-items"]').innerHTML =
        `<div class="empty-state">Could not load items for this plan.</div>`;
    }
  }

  function renderPlanItems(planId, card) {
    const items = state.planItemsByPlanId[planId] || [];
    const itemsHost = card.querySelector('[data-role="plan-items"]');
    const progressLabel = card.querySelector('[data-role="progress-label"]');
    const progressFill = card.querySelector('.progress-fill');

    if (!items.length) {
      itemsHost.innerHTML = '<div class="empty-state">No items added to this plan yet.</div>';
      progressLabel.textContent = 'No items';
      progressFill.style.width = '0%';
      return;
    }

    const completed = items.filter((i) => i.status === 'completed').length;
    const pct = Math.round((completed / items.length) * 100);
    progressLabel.textContent = `${completed} / ${items.length} complete`;
    progressFill.style.width = `${pct}%`;

    itemsHost.innerHTML = items
      .slice()
      .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0))
      .map((item, idx) => `
        <div class="tp-item-row${item.status === 'completed' ? ' is-completed' : ''}">
          <div class="tp-item-seq">${item.status === 'completed'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m5 12 5 5 9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : (item.sequence_order ?? idx + 1)}</div>
          <div class="tp-item-mid">
            <p class="t">
              ${item.tooth_number ? `<span class="tooth-tag">FDI ${escapeHtml(String(item.tooth_number))}</span>` : ''}
              ${escapeHtml(item.procedure_name || 'Procedure')}
            </p>
            <p class="s"><span class="badge badge-${item.status}">${capitalize(item.status || 'planned')}</span></p>
          </div>
          ${item.estimated_cost != null ? `<div class="tp-item-amt">KSh ${Number(item.estimated_cost).toLocaleString('en-KE')}</div>` : ''}
        </div>
      `).join('');
  }

  function renderPrescriptions(prescriptions) {
    const list = document.getElementById('modalRxList');
    if (!prescriptions.length) {
      list.innerHTML = '<div class="empty-state">No prescriptions for this patient yet.</div>';
      return;
    }

    list.innerHTML = prescriptions.map((rx) => `
      <div class="rx-card">
        <div class="rx-head" data-role="rx-toggle">
          <div class="rx-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 3h10M9 3v5.5L4.6 16a2.6 2.6 0 0 0 2.2 4h10.4a2.6 2.6 0 0 0 2.2-4L15 8.5V3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6.5 14.5h11" stroke="currentColor" stroke-width="1.7"/></svg>
          </div>
          <div class="rx-mid">
            <p class="t">${escapeHtml(rx.drug_name || 'Prescription')}</p>
            <p class="s">${escapeHtml(resolveDentistName(rx.dentist_id))}</p>
          </div>
          <div class="rx-date">${formatDate(rx.created_at)}</div>
          <svg class="rx-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="rx-body">
          <div class="rx-detail-grid">
            <div class="rx-detail-cell"><p class="label">Dosage</p><p class="value">${escapeHtml(rx.dosage || '—')}</p></div>
            <div class="rx-detail-cell"><p class="label">Frequency</p><p class="value">${escapeHtml(rx.frequency || '—')}</p></div>
            <div class="rx-detail-cell"><p class="label">Duration</p><p class="value">${escapeHtml(rx.duration || '—')}</p></div>
          </div>
          ${rx.notes ? `<div class="diagnosis-note"><span class="label">Notes</span>${escapeHtml(rx.notes)}</div>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.rx-head').forEach((head) => {
      head.addEventListener('click', () => head.closest('.rx-card').classList.toggle('is-open'));
    });
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

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as dentistDashboard.js
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