(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors adminDashboard.js's guard, for the 'admin' role.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'admin') {
    window.location.href = LOGIN_PATH;
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initLogout();
    loadProfile();
    initPasswordForm();
  });

  /* ============================================================
     LOAD ACCOUNT INFO — GET /users/me
     ============================================================ */
  async function loadProfile() {
    try {
      renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);

      const user = await fetchMethod('/users/me', 'GET', null, true);

      document.getElementById('profFirstName').value = user.first_name || '';
      document.getElementById('profLastName').value = user.last_name || '';
      document.getElementById('profEmail').value = user.email || '';
      document.getElementById('profPhone').value = user.phone || '—';
      document.getElementById('profRole').value = capitalize(user.role || '');
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
    showToast(err.message || 'Could not load your profile. Please refresh.');
  }

  /* ============================================================
     CHANGE PASSWORD — PUT /auth/change-password
     ============================================================ */
  function initPasswordForm() {
    const form = document.getElementById('passwordForm');
    const errorEl = document.getElementById('passwordError');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const current_password = document.getElementById('currentPassword').value;
      const new_password = document.getElementById('newPassword').value;
      const confirm_password = document.getElementById('confirmPassword').value;

      if (!current_password || !new_password || !confirm_password) {
        return showFieldError('Please fill in all three fields.');
      }
      if (new_password.length < 8) {
        return showFieldError('New password must be at least 8 characters.');
      }
      if (new_password !== confirm_password) {
        return showFieldError('New password and confirmation do not match.');
      }

      const submitBtn = document.getElementById('passwordSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating…';

      try {
        await fetchMethod('/auth/change-password', 'PUT', { current_password, new_password }, true);
        form.reset();
        showToast('Password updated successfully.');
      } catch (err) {
        showFieldError(err.message || 'Could not update your password.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update password';
      }
    });

    function showFieldError(message) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
    function hideError() {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  /* ============================================================
     LOGOUT
     ============================================================ */
  function initLogout() {
    const logoutLink = document.getElementById('logoutLink');
    if (!logoutLink) return;
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      clearSession();
      window.location.href = LOGIN_PATH;
    });
  }

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as adminDashboard.js
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

  function initialsOf(name) {
    return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }
})();