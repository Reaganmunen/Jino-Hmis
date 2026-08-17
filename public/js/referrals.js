(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as billing.js / treatmentPlan.js / prescriptions.js / etc.
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
    referrals: [],
    dentists: [],
    detail: {}, // refId -> { open }
  };

  const KNOWN_STATUS_LABELS = { pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled' };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    loadReferrals();
  });

  async function loadReferrals() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      renderTopbarAvatar(`${patient.first_name} ${patient.last_name}`, await fetchProfilePhotoUrl(patient.id));

      const [referrals, dentists] = await Promise.all([
        fetchMethod(`/referrals/patient/${patient.id}`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true).catch(() => []),
      ]);

      state.referrals = referrals.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.dentists = dentists;

      try { renderStats(); } catch (e) { console.error('renderStats failed', e); }
      try { renderList(); } catch (e) { console.error('renderList failed', e); }
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
    showToast(err.message || 'Could not load your referrals. Please refresh.');
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalRef').textContent = state.referrals.length;

    const pending = state.referrals.filter((r) => (r.status || 'pending') === 'pending').length;
    document.getElementById('statPendingRef').textContent = pending;

    const completed = state.referrals.filter((r) => r.status === 'completed').length;
    document.getElementById('statCompletedRef').textContent = completed;

    document.getElementById('statLastRef').textContent = state.referrals.length
      ? formatDate(state.referrals[0].created_at)
      : '—';
  }

  /* ============================================================
     LIST
     ============================================================ */
  function renderList() {
    const list = document.getElementById('refList');
    list.innerHTML = '';

    if (!state.referrals.length) {
      list.innerHTML = '<div class="empty-state">No referrals on record yet.</div>';
      return;
    }

    state.referrals.forEach((ref) => {
      const isOpen = !!(state.detail[ref.id] && state.detail[ref.id].open);
      const statusKey = ref.status || 'pending';
      const statusLabel = KNOWN_STATUS_LABELS[statusKey] || capitalize(statusKey);

      const card = document.createElement('div');
      card.className = 'rx-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-ref-id', ref.id);
      card.innerHTML = `
        <div class="rx-head" data-action="toggle" data-id="${ref.id}">
          <div class="rx-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 20c.6-3.3 3-5 5.5-5s4.9 1.7 5.5 5M13 15.3c.6-.2 1.3-.3 2-.3 2.5 0 4.9 1.7 5.5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </div>
          <div class="rx-mid">
            <p class="t">${escapeHtml(ref.referred_to_name || 'Referral')}</p>
            <p class="s">${ref.specialty ? escapeHtml(ref.specialty) + ' · ' : ''}${escapeHtml(dentistNameById(ref.referring_dentist_id))}</p>
          </div>
          <span class="badge badge-${statusKey}">${escapeHtml(statusLabel)}</span>
          <div class="rx-date">${escapeHtml(formatDate(ref.created_at))}</div>
          <svg class="rx-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="rx-body" id="refBody-${ref.id}"></div>
      `;
      list.appendChild(card);
      renderRefBody(ref.id);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleRef(head.getAttribute('data-id')));
    });
  }

  function toggleRef(refId) {
    const card = document.querySelector(`.rx-card[data-ref-id="${refId}"]`);
    if (!card) return;
    if (!state.detail[refId]) state.detail[refId] = { open: false };
    state.detail[refId].open = !state.detail[refId].open;
    card.classList.toggle('is-open', state.detail[refId].open);
  }

  function renderRefBody(refId) {
    const body = document.getElementById(`refBody-${refId}`);
    if (!body) return;
    const ref = state.referrals.find((r) => String(r.id) === String(refId));
    if (!ref) return;

    body.innerHTML = `
      <div class="rx-detail-grid">
        <div class="rx-detail-cell"><p class="label">Specialty</p><p class="value">${escapeHtml(ref.specialty || '—')}</p></div>
        <div class="rx-detail-cell"><p class="label">Facility</p><p class="value">${escapeHtml(ref.referred_to_facility || '—')}</p></div>
        <div class="rx-detail-cell"><p class="label">Referred to</p><p class="value">${escapeHtml(ref.referred_to_name || '—')}</p></div>
      </div>
      ${ref.reason ? `
        <div class="bill-section">
          <p class="bill-section-title">Reason for referral</p>
          <p class="timeline-note" style="margin-top:0;">${escapeHtml(ref.reason)}</p>
        </div>
      ` : ''}
      <div class="plan-meta-row" style="margin-top:${ref.reason ? '14px' : '0'};margin-bottom:0;">
        <span>Referred by <b>${escapeHtml(dentistNameById(ref.referring_dentist_id))}</b></span>
        <span>Date <b>${escapeHtml(formatDate(ref.created_at))}</b></span>
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

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—'; // toLocaleDateString throws on an invalid date rather than returning text
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