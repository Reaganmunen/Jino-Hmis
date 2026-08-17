(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as dashboard.js / billing.js / treatmentPlan.js / prescriptions.js.
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
    files: [],
    appointments: [],
    activeFilter: 'all',
  };

  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'];

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initModal();
    loadDocuments();
  });

  async function loadDocuments() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      const [files, appointments] = await Promise.all([
        fetchMethod(`/patient-files/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true).catch(() => []),
      ]);

      state.files = files.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
      state.appointments = appointments;

      // Reuse the files already fetched above instead of a second request —
      // file_type is a Postgres enum without a 'profile_picture' value, so
      // the profile photo is file_type: 'photo' + description: 'Profile Picture'.
      const profilePhoto = state.files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
      renderTopbarAvatar(`${patient.first_name} ${patient.last_name}`, profilePhoto ? profilePhoto.file_url : null);

      try { renderStats(); } catch (e) { console.error('renderStats failed', e); }
      try { renderTabs(); } catch (e) { console.error('renderTabs failed', e); }
      try { renderGrid(); } catch (e) { console.error('renderGrid failed', e); }
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
    showToast(err.message || 'Could not load your files. Please refresh.');
  }

  /* ============================================================
     FILE TYPE HELPERS
     A file is treated as an image either because file_type says so
     (e.g. 'photo', 'xray', 'image') or its URL has an image extension —
     the schema doesn't pin down file_type's exact vocabulary, so this
     covers clinics that store x-rays as a distinct type from photos.
     ============================================================ */
  function isImageFile(file) {
    const type = (file.file_type || '').toLowerCase();
    if (type.includes('image') || type.includes('photo') || type.includes('xray') || type.includes('x-ray')) return true;
    const ext = extensionOf(file.file_url);
    return IMAGE_EXTENSIONS.includes(ext);
  }

  function extensionOf(url) {
    if (!url) return '';
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function fileNameOf(url) {
    if (!url) return 'File';
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('/');
    return parts[parts.length - 1] || 'File';
  }

  function prettyType(type) {
    if (!type) return 'File';
    return type.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalFiles').textContent = state.files.length;

    const imageCount = state.files.filter(isImageFile).length;
    document.getElementById('statImageFiles').textContent = imageCount;
    document.getElementById('statDocFiles').textContent = state.files.length - imageCount;

    document.getElementById('statLastUpload').textContent = state.files.length
      ? formatDate(state.files[0].uploaded_at)
      : '—';
  }

  /* ============================================================
     TABS (built dynamically from whatever file_type values exist)
     ============================================================ */
  function renderTabs() {
    const wrap = document.getElementById('filterTabs');
    const types = Array.from(new Set(state.files.map((f) => f.file_type).filter(Boolean)));

    const tabs = [{ key: 'all', label: 'All' }, ...types.map((t) => ({ key: t, label: prettyType(t) }))];

    wrap.innerHTML = tabs.map((tab) => `
      <button class="filter-tab ${state.activeFilter === tab.key ? 'is-active' : ''}" data-filter="${escapeHtml(tab.key)}">
        ${escapeHtml(tab.label)}
      </button>
    `).join('');

    wrap.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeFilter = btn.getAttribute('data-filter');
        renderTabs();
        renderGrid();
      });
    });
  }

  /* ============================================================
     GRID
     ============================================================ */
  function renderGrid() {
    const grid = document.getElementById('docGrid');
    const visible = state.activeFilter === 'all'
      ? state.files
      : state.files.filter((f) => f.file_type === state.activeFilter);

    if (!visible.length) {
      grid.innerHTML = '<div class="empty-state">No files here yet.</div>';
      return;
    }

    grid.innerHTML = visible.map((file) => {
      const isImg = isImageFile(file);
      const thumb = isImg
        ? `<img src="${escapeAttr(file.file_url)}" alt="${escapeAttr(file.description || fileNameOf(file.file_url))}" loading="lazy">`
        : docIconSvg();

      return `
        <div class="doc-card" data-action="open" data-id="${file.id}">
          <div class="doc-thumb">${thumb}</div>
          <div class="doc-info">
            ${file.file_type ? `<span class="doc-type-chip">${escapeHtml(prettyType(file.file_type))}</span>` : ''}
            <p class="n">${escapeHtml(file.description || fileNameOf(file.file_url))}</p>
            <p class="m">${escapeHtml(formatDate(file.uploaded_at))}</p>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-action="open"]').forEach((card) => {
      card.addEventListener('click', () => openLightbox(card.getAttribute('data-id')));
    });
  }

  function docIconSvg() {
    return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  /* ============================================================
     LIGHTBOX MODAL
     ============================================================ */
  function initModal() {
    const scrim = document.getElementById('docModalScrim');
    document.getElementById('docModalClose').addEventListener('click', closeLightbox);
    document.getElementById('docModalCloseBtn').addEventListener('click', closeLightbox);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeLightbox(); });
  }

  function openLightbox(fileId) {
    const file = state.files.find((f) => String(f.id) === String(fileId));
    if (!file) return;
    const isImg = isImageFile(file);

    document.getElementById('docModalType').textContent = prettyType(file.file_type) || 'File';
    document.getElementById('docModalTitle').textContent = file.description || fileNameOf(file.file_url);
    document.getElementById('docModalPreview').innerHTML = isImg
      ? `<img src="${escapeAttr(file.file_url)}" alt="${escapeAttr(file.description || fileNameOf(file.file_url))}">`
      : `<div style="padding:40px;">${docIconSvg()}</div>`;

    document.getElementById('docModalDate').textContent = formatDate(file.uploaded_at);

    const appt = state.appointments.find((a) => a.id === file.appointment_id);
    document.getElementById('docModalVisit').textContent = appt ? formatDate(appt.scheduled_start) : 'Not linked to a visit';

    document.getElementById('docModalDesc').textContent = file.description || '';
    document.getElementById('docModalDownload').href = file.file_url;

    document.getElementById('docModalScrim').classList.add('is-open');
  }

  function closeLightbox() {
    document.getElementById('docModalScrim').classList.remove('is-open');
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

  function renderTopbarAvatar(name, photoUrl) {
    const el = document.getElementById('avatarInitials');
    if (photoUrl) {
      el.innerHTML = `<img src="${escapeAttr(photoUrl)}" alt="Profile photo">`;
    } else {
      el.textContent = initialsOf(name);
    }
  }
})();