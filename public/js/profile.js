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
    profilePictureUrl: null,
  };

  const MAX_PHOTO_DIMENSION = 320; // px — resized client-side before upload
  const PHOTO_JPEG_QUALITY = 0.82;

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPhotoUpload();
    initProfileForm();
    initPasswordForm();
    loadProfile();
  });

  async function loadProfile() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      fillForm(patient);

      // Best-effort — if this patient has no files yet, or the endpoint
      // errors for some reason, we just fall back to initials.
      // file_type is a Postgres enum without a 'profile_picture' value, so
      // this uses 'photo' + a fixed description to tell it apart from other
      // dental photos staff may upload under the same file_type.
      const files = await fetchMethod(`/patient-files/patient/${patient.id}`, 'GET', null, true).catch(() => []);
      const latestPhoto = files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];

      state.profilePictureUrl = latestPhoto ? latestPhoto.file_url : null;
      renderAvatar(patient);
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

  function fillForm(patient) {
    document.getElementById('firstName').value = patient.first_name || '';
    document.getElementById('lastName').value = patient.last_name || '';
    document.getElementById('dob').value = patient.date_of_birth ? String(patient.date_of_birth).slice(0, 10) : '';
    document.getElementById('phone').value = patient.phone || '';
    document.getElementById('email').value = patient.email || '';
    document.getElementById('nationalId').value = patient.national_id || '';
    document.getElementById('address').value = patient.address || '';
    document.getElementById('nokName').value = patient.next_of_kin_name || '';
    document.getElementById('nokPhone').value = patient.next_of_kin_phone || '';
    document.getElementById('allergies').value = patient.allergies || '';
  }

  function renderAvatar(patient) {
    const initials = initialsOf(`${patient.first_name} ${patient.last_name}`);
    const preview = document.getElementById('avatarPreview');
    const topbar = document.getElementById('avatarInitials');

    if (state.profilePictureUrl) {
      const img = `<img src="${escapeAttr(state.profilePictureUrl)}" alt="Profile photo">`;
      preview.innerHTML = img;
      topbar.innerHTML = img;
    } else {
      preview.innerHTML = escapeHtml(initials);
      topbar.textContent = initials;
    }
  }

  /* ============================================================
     PROFILE PICTURE
     No object storage is wired up on the backend yet, so photos are resized
     down client-side and stored as a base64 data URI in PatientFile.file_url.
     This is a stopgap — swap for real signed-upload storage when available.
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

      const result = await fetchMethod('/patient-files', 'POST', {
        file_type: 'photo',
        file_url: dataUrl,
        description: 'Profile Picture',
      }, true);

      state.profilePictureUrl = result.file_url;
      const img = `<img src="${escapeAttr(result.file_url)}" alt="Profile photo">`;
      document.getElementById('avatarPreview').innerHTML = img;
      document.getElementById('avatarInitials').innerHTML = img;

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
     PROFILE DETAILS FORM
     ============================================================ */
  function initProfileForm() {
    document.getElementById('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.patientId) return;

      const saveBtn = document.getElementById('saveProfileBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      const payload = {
        first_name: document.getElementById('firstName').value.trim(),
        last_name: document.getElementById('lastName').value.trim(),
        date_of_birth: document.getElementById('dob').value || null,
        phone: document.getElementById('phone').value.trim(),
        email: document.getElementById('email').value.trim(),
        national_id: document.getElementById('nationalId').value.trim(),
        address: document.getElementById('address').value.trim(),
        next_of_kin_name: document.getElementById('nokName').value.trim(),
        next_of_kin_phone: document.getElementById('nokPhone').value.trim(),
        allergies: document.getElementById('allergies').value.trim(),
      };

      try {
        const updated = await fetchMethod(`/patients/${state.patientId}`, 'PUT', payload, true);
        fillForm(updated);
        renderAvatar(updated);
        showToast('Profile updated');
      } catch (err) {
        showToast(err.message || 'Could not save changes. Please try again.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save changes';
      }
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
        await fetchMethod('/auth/change-password', 'PUT', {
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
})();