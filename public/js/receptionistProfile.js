(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'receptionist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  const MAX_PHOTO_BYTES = 1024 * 1024; // 1 MB — profile_picture_url is stored as a data URL in a text column

  const state = {
    profile: null,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);
    initPhotoUpload();
    loadProfile();
  });

  /* ============================================================
     LOAD PROFILE
     ============================================================ */
  async function loadProfile() {
    try {
      const profile = await fetchMethod('/users/me', 'GET', null, true);
      state.profile = profile;
      renderAccountDetails(profile);
      renderAvatar(profile);
    } catch (err) {
      handleAuthOrToast(err, 'Could not load your profile. Please refresh.');
    }
  }

  function renderAccountDetails(profile) {
    const grid = document.getElementById('accountDetailGrid');
    const cells = [
      ['First name', profile.first_name || '—'],
      ['Last name', profile.last_name || '—'],
      ['Email', profile.email || '—'],
      ['Phone', profile.phone || '—'],
      ['Role', capitalize(profile.role || '—')],
      ['Member since', formatDate(profile.created_at)],
    ];
    grid.innerHTML = cells.map(([label, value]) => `
      <div class="rx-detail-cell">
        <p class="label">${escapeHtml(label)}</p>
        <p class="value">${escapeHtml(value)}</p>
      </div>
    `).join('');
  }

  function renderAvatar(profile) {
    const name = `${profile.first_name} ${profile.last_name}`;
    const xl = document.getElementById('profileAvatarXl');
    xl.innerHTML = Avatar.avatarInnerHtml(name, profile.profile_picture_url);
  }

  /* ============================================================
     PHOTO UPLOAD
     ------------------------------------------------------------
     PUT /users/me/photo stores profile_picture_url as-is — there's
     no separate file-upload endpoint, so the image is read as a
     data URL client-side. Fine for small avatars; swap this for a
     real upload endpoint if larger images are ever needed.
     ============================================================ */
  function initPhotoUpload() {
    const chooseBtn = document.getElementById('choosePhotoBtn');
    const fileInput = document.getElementById('photoFileInput');

    chooseBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = ''; // allow re-selecting the same file later
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file.');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        showToast('That image is too large — please choose one under 1 MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => uploadPhoto(reader.result);
      reader.onerror = () => showToast('Could not read that file. Please try again.');
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto(dataUrl) {
    const chooseBtn = document.getElementById('choosePhotoBtn');
    chooseBtn.disabled = true;
    try {
      const updated = await fetchMethod('/users/me/photo', 'PUT', { profile_picture_url: dataUrl }, true);
      state.profile = updated;
      renderAvatar(updated);
      showToast('Profile photo updated.');
    } catch (err) {
      handleAuthOrToast(err, 'Could not update your photo. Please try again.');
    } finally {
      chooseBtn.disabled = false;
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
  function handleAuthOrToast(err, fallbackMessage) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    showToast(err.message || fallbackMessage);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
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

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }
})();