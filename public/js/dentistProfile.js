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
    profilePictureUrl: null,
  };

  const MAX_PHOTO_DIMENSION = 320; // px — resized client-side before upload, same as patient side
  const PHOTO_JPEG_QUALITY = 0.82;

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPhotoUpload();
    initPasswordForm();
    loadProfile();
  });

  async function loadProfile() {
    try {
      const user = await fetchMethod('/users/me', 'GET', null, true);
      state.profilePictureUrl = user.profile_picture_url || null;
      renderAvatar(user);
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

  function renderAvatar(user) {
    const name = `Dr. ${user.first_name} ${user.last_name}`;
    Avatar.renderAvatarInto(document.getElementById('avatarPreview'), name, state.profilePictureUrl);
    Avatar.renderAvatarInto(document.getElementById('avatarInitials'), name, state.profilePictureUrl);
  }

  /* ============================================================
     PROFILE PICTURE
     No object storage wired up on the backend, so the photo is resized
     down client-side and stored as a base64 data URI directly on
     User.profile_picture_url — same approach as the patient side's
     profile.js, just a different column instead of a PatientFile row
     (dentists don't have a Patient record to attach a file to).
     ============================================================ */
  function initPhotoUpload() {
    document.getElementById('changePhotoBtn').addEventListener('click', () => {
      document.getElementById('photoInput').click();
    });
    document.getElementById('photoInput').addEventListener('change', handlePhotoSelected);
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return showToast('Please choose an image file');
    }

    try {
      const dataUrl = await resizeAndCompressImage(file, MAX_PHOTO_DIMENSION, PHOTO_JPEG_QUALITY);

      const result = await fetchMethod('/users/me/photo', 'PUT', {
        profile_picture_url: dataUrl,
      }, true);

      state.profilePictureUrl = result.profile_picture_url;
      Avatar.renderAvatarInto(document.getElementById('avatarPreview'), 'Profile photo', state.profilePictureUrl);
      Avatar.renderAvatarInto(document.getElementById('avatarInitials'), 'Profile photo', state.profilePictureUrl);

      showToast('Profile photo updated');
    } catch (err) {
      showToast(err.message || 'Could not upload photo. Please try a smaller image.');
    }
  }

  function resizeAndCompressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read that image'));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ============================================================
     CHANGE PASSWORD FORM
     ============================================================ */
  function initPasswordForm() {
    document.getElementById('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const current = document.getElementById('currentPassword').value;
      const next = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;

      if (next.length < 8) return showToast('New password must be at least 8 characters');
      if (next !== confirm) return showToast('New password and confirmation do not match');

      const saveBtn = document.getElementById('savePasswordBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Updating…';

      try {
        await fetchMethod('/users/me/password', 'PUT', {
          current_password: current,
          new_password: next,
        }, true);

        document.getElementById('passwordForm').reset();
        showToast('Password updated');
      } catch (err) {
        showToast(err.message || 'Could not update password. Please try again.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Update password';
      }
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
    return name.replace('Dr. ', '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
})();