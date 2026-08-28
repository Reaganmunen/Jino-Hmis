(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as dashboard.js / billing.js / treatmentPlan.js.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'patient') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    patientId: null,
    prescriptions: [],
    dentists: [],
    // rxId -> { open, diagnosis, diagnosisLoaded }
    detail: {},
  };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPrintButton();
    loadPrescriptions();
  });

  function initPrintButton() {
    const btn = document.getElementById('downloadTodayRxBtn');
    if (btn) btn.addEventListener('click', downloadTodayPrescriptionPdf);
  }

  // "The day's prescription" — no date param sent, so the backend defaults
  // to today (Africa/Nairobi). If a patient had more than one visit today
  // this pulls every prescription from today, not just the latest.
  async function downloadTodayPrescriptionPdf() {
    if (!state.patientId) return;
    await downloadPdf(`/prescriptions/patient/${state.patientId}/pdf`, 'prescription-today.pdf');
  }

  // Same pattern/assumptions as billing.js's downloadPdf — see the comment
  // there. Duplicated rather than shared because these two pages don't
  // currently share a common utilities file.
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

  async function loadPrescriptions() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      renderTopbarAvatar(`${patient.first_name} ${patient.last_name}`, await fetchProfilePhotoUrl(patient.id));

      const [prescriptions, dentists] = await Promise.all([
        fetchMethod(`/prescriptions/patient/${patient.id}`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true).catch(() => []),
      ]);

      state.prescriptions = prescriptions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.dentists = dentists;

      renderStats();
      renderRxList();
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
    showToast(err.message || 'Could not load your prescriptions. Please refresh.');
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalRx').textContent = state.prescriptions.length;

    const uniqueDrugs = new Set(state.prescriptions.map((p) => (p.drug_name || '').trim().toLowerCase()));
    document.getElementById('statUniqueDrugs').textContent = uniqueDrugs.size;

    document.getElementById('statLastRx').textContent = state.prescriptions.length
      ? formatDate(state.prescriptions[0].created_at)
      : '—';

    const uniquePrescribers = new Set(state.prescriptions.map((p) => p.dentist_id));
    document.getElementById('statPrescribers').textContent = uniquePrescribers.size;
  }

  /* ============================================================
     LIST
     ============================================================ */
  function renderRxList() {
    const list = document.getElementById('rxList');
    list.innerHTML = '';

    if (!state.prescriptions.length) {
      list.innerHTML = '<div class="empty-state">No prescriptions on record yet.</div>';
      return;
    }

    state.prescriptions.forEach((rx) => {
      const isOpen = !!(state.detail[rx.id] && state.detail[rx.id].open);

      const card = document.createElement('div');
      card.className = 'rx-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-rx-id', rx.id);
      card.innerHTML = `
        <div class="rx-head" data-action="toggle" data-id="${rx.id}">
          <div class="rx-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 3h10M9 3v5.5L4.6 16a2.6 2.6 0 0 0 2.2 4h10.4a2.6 2.6 0 0 0 2.2-4L15 8.5V3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6.5 14.5h11" stroke="currentColor" stroke-width="1.7"/></svg>
          </div>
          <div class="rx-mid">
            <p class="t">${escapeHtml(rx.drug_name)}</p>
            <p class="s">${escapeHtml(rx.dosage || '')}${rx.dosage && rx.frequency ? ' · ' : ''}${escapeHtml(rx.frequency || '')} · ${escapeHtml(dentistNameById(rx.dentist_id))}</p>
          </div>
          <div class="rx-date">${escapeHtml(formatDate(rx.created_at))}</div>
          <svg class="rx-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="rx-body" id="rxBody-${rx.id}">
          <p class="bill-body-empty">Loading details…</p>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleRx(head.getAttribute('data-id')));
    });
  }

  async function toggleRx(rxId) {
    const card = document.querySelector(`.rx-card[data-rx-id="${rxId}"]`);
    if (!card) return;

    if (!state.detail[rxId]) state.detail[rxId] = { open: false, diagnosisLoaded: false };
    const d = state.detail[rxId];
    d.open = !d.open;
    card.classList.toggle('is-open', d.open);

    if (d.open && !d.diagnosisLoaded) {
      await loadRxDiagnosis(rxId);
    }
  }

  async function loadRxDiagnosis(rxId) {
    const rx = state.prescriptions.find((p) => String(p.id) === String(rxId));
    const d = state.detail[rxId];

    if (rx.diagnosis_id) {
      // Best-effort — diagnosis endpoint access may be role-restricted, so a
      // failure here just hides the diagnosis note rather than breaking the page.
      d.diagnosis = await fetchMethod(`/diagnoses/${rx.diagnosis_id}`, 'GET', null, true).catch(() => null);
    } else {
      d.diagnosis = null;
    }
    d.diagnosisLoaded = true;
    renderRxBody(rxId);
  }

  function renderRxBody(rxId) {
    const body = document.getElementById(`rxBody-${rxId}`);
    if (!body) return;
    const rx = state.prescriptions.find((p) => String(p.id) === String(rxId));
    const d = state.detail[rxId] || {};

    const diagnosisHtml = d.diagnosis
      ? `<div class="diagnosis-note"><span class="label">Based on diagnosis</span>${escapeHtml(d.diagnosis.diagnosis_text || '')}</div>`
      : '';

    body.innerHTML = `
      <div class="rx-detail-grid">
        <div class="rx-detail-cell"><p class="label">Dosage</p><p class="value">${escapeHtml(rx.dosage || '—')}</p></div>
        <div class="rx-detail-cell"><p class="label">Frequency</p><p class="value">${escapeHtml(rx.frequency || '—')}</p></div>
        <div class="rx-detail-cell"><p class="label">Duration</p><p class="value">${escapeHtml(rx.duration || '—')}</p></div>
      </div>
      ${diagnosisHtml}
      ${rx.notes ? `
        <div class="bill-section">
          <p class="bill-section-title">Dentist's notes</p>
          <p class="timeline-note" style="margin-top:0;">${escapeHtml(rx.notes)}</p>
        </div>
      ` : ''}
      <div class="plan-meta-row" style="margin-top:${rx.notes ? '14px' : '0'};margin-bottom:0;">
        <span>Prescribed by <b>${escapeHtml(dentistNameById(rx.dentist_id))}</b></span>
        <span>Date <b>${escapeHtml(formatDate(rx.created_at))}</b></span>
      </div>
    `;
  }

  function dentistNameById(id) {
    const d = state.dentists.find((x) => x.id === id);
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Your dentist';
  }

  /* ============================================================
     SIDEBAR
     ============================================================ */
  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('scrim');

    document.getElementById('sideOpen').addEventListener('click', () => {
      sidebar.classList.add('is-open');
      scrim.classList.add('is-open');
    });
    document.getElementById('sideClose').addEventListener('click', closeSidebar);
    scrim.addEventListener('click', closeSidebar);

    function closeSidebar() {
      sidebar.classList.remove('is-open');
      scrim.classList.remove('is-open');
    }

    document.querySelectorAll('.side-logout').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        clearSession();
        window.location.href = LOGIN_PATH;
      });
    });

    document.querySelectorAll('[data-page]').forEach((link) => {
      const hasRealHref = link.tagName === 'A' && link.getAttribute('href') && link.getAttribute('href') !== '#';
      if (hasRealHref) link.addEventListener('click', closeSidebar);
    });
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

  function initialsOf(name) {
    return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // file_type is a Postgres enum without a 'profile_picture' value, so the
  // profile photo is stored as file_type: 'photo' + description: 'Profile
  // Picture' (see profile.js) and found the same way here.
  async function fetchProfilePhotoUrl(patientId) {
    try {
      const files = await fetchMethod(`/patient-files/patient/${patientId}`, 'GET', null, true);
      const photo = files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
      return photo ? photo.file_url : null;
    } catch {
      return null;
    }
  }

  function renderTopbarAvatar(name, photoUrl) {
    const el = document.getElementById('avatarInitials');
    if (photoUrl) {
      el.innerHTML = `<img src="${escapeAttr(photoUrl)}" alt="Profile photo">`;
    } else {
      el.textContent = initialsOf(name);
    }
  }
})();