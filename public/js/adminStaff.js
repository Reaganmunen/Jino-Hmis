(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors adminPatients.js's guard.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'admin') {
    window.location.href = LOGIN_PATH;
    return;
  }

  const STAFF_ROLES = ['dentist', 'receptionist', 'admin'];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    staff: [],
    query: '',
    activeFilter: 'all', // 'all' | 'dentist' | 'receptionist' | 'admin'
    activeStaffId: null,
    editMode: false,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);
    initSearch();
    initFilterTabs();
    initAddStaffModal();
    initDetailModal();
    renderSkeleton();
    loadStaff();
  });

  /* ============================================================
     LOAD
     ------------------------------------------------------------
     There's no single "all staff" endpoint — only GET /users/role/:role
     — so we fetch each staff role in parallel and merge. Each row
     already comes back with its own `role` field from findUsersByRole.
     ============================================================ */
  async function loadStaff() {
    try {
      const lists = await Promise.all(
        STAFF_ROLES.map((role) => fetchMethod(`/users/role/${role}`, 'GET', null, true))
      );
      state.staff = lists.flat().sort((a, b) => a.first_name.localeCompare(b.first_name));
      renderRoster();
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
    document.getElementById('rosterList').innerHTML =
      '<div class="empty-state">Could not load staff. Please refresh.</div>';
    document.getElementById('rosterCount').textContent = '';
    showToast(err.message || 'Could not load staff. Please refresh.');
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

  function getFilteredStaff() {
    let list = state.staff;

    if (state.activeFilter !== 'all') {
      list = list.filter((s) => s.role === state.activeFilter);
    }

    if (state.query) {
      const q = state.query;
      list = list.filter((s) => {
        return (
          `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
          (s.phone || '').toLowerCase().includes(q) ||
          (s.email || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
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
    const filtered = getFilteredStaff();

    countEl.textContent = `${filtered.length} staff member${filtered.length === 1 ? '' : 's'}`;

    list.innerHTML = '';

    if (!filtered.length) {
      list.innerHTML = state.staff.length
        ? '<div class="empty-state">No staff match your search.</div>'
        : '<div class="empty-state">No staff on record yet. Add the first one to get started.</div>';
      return;
    }

    filtered.forEach((s) => {
      const name = roleLabel(s.role) === 'Dentist' ? `Dr. ${s.first_name} ${s.last_name}` : `${s.first_name} ${s.last_name}`;
      const metaParts = [];
      if (s.phone) metaParts.push(s.phone);
      if (!s.phone && s.email) metaParts.push(s.email);

      const row = document.createElement('div');
      row.className = 'roster-row';
      row.innerHTML = `
        <div class="roster-avatar">${Avatar.avatarInnerHtml(name, s.profile_picture_url)}</div>
        <div class="roster-mid">
          <p class="t">${escapeHtml(name)}</p>
          <p class="s">${escapeHtml(metaParts.join(' · ') || 'No contact details on file')}</p>
        </div>
        <div class="roster-flags">
          <span class="badge badge-role-${escapeHtml(s.role)}">${escapeHtml(roleLabel(s.role))}</span>
          ${s.is_active === false ? '<span class="badge badge-inactive">Deactivated</span>' : ''}
        </div>
        <svg class="roster-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;
      row.addEventListener('click', () => openDetailModal(s));
      list.appendChild(row);
    });
  }

  /* ============================================================
     ADD STAFF MODAL
     ------------------------------------------------------------
     POST /auth/register creates the staff User account directly
     (admin/dentist/receptionist — patients use a separate flow).
     That endpoint returns a token for the NEW staff member; we
     deliberately ignore it (never saveSession here) since saving
     it would hijack the admin's own session.
     ============================================================ */
  function initAddStaffModal() {
    const scrim = document.getElementById('addStaffScrim');
    document.getElementById('openAddStaffBtn').addEventListener('click', openAddStaffModal);
    document.getElementById('addStaffClose').addEventListener('click', closeAddStaffModal);
    document.getElementById('addStaffCancelBtn').addEventListener('click', closeAddStaffModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeAddStaffModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeAddStaffModal();
    });

    document.getElementById('addStaffForm').addEventListener('submit', handleAddStaffSubmit);
  }

  function openAddStaffModal() {
    document.getElementById('addStaffForm').reset();
    document.getElementById('addStaffError').style.display = 'none';
    document.getElementById('addStaffScrim').classList.add('is-open');
    document.getElementById('asFirstName').focus();
  }

  function closeAddStaffModal() {
    document.getElementById('addStaffScrim').classList.remove('is-open');
  }

  async function handleAddStaffSubmit(e) {
    e.preventDefault();

    const errorEl = document.getElementById('addStaffError');
    errorEl.style.display = 'none';

    const payload = {
      role: document.getElementById('asRole').value,
      first_name: document.getElementById('asFirstName').value.trim(),
      last_name: document.getElementById('asLastName').value.trim(),
      email: document.getElementById('asEmail').value.trim(),
      phone: document.getElementById('asPhone').value.trim() || null,
      password: document.getElementById('asPassword').value,
    };

    if (!payload.role || !payload.first_name || !payload.last_name || !payload.email || !payload.password) {
      errorEl.textContent = 'Role, first name, last name, email, and password are required.';
      errorEl.style.display = 'block';
      return;
    }
    if (payload.password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    const submitBtn = document.getElementById('addStaffSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      // auth: true — /auth/register is admin-only, unlike patient self-registration.
      // We still never save the returned token/user into this session.
      const result = await fetchMethod('/auth/register', 'POST', payload, true);
      state.staff.push(result.user);
      state.staff.sort((a, b) => a.first_name.localeCompare(b.first_name));
      renderRoster();
      closeAddStaffModal();
      showToast(`${result.user.first_name} ${result.user.last_name} added as ${roleLabel(result.user.role).toLowerCase()}.`);
    } catch (err) {
      errorEl.textContent = err.message || 'Could not create the staff account.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create staff account';
    }
  }

  /* ============================================================
     STAFF DETAIL MODAL — view, edit, deactivate
     ============================================================ */
  function initDetailModal() {
    const scrim = document.getElementById('detailModalScrim');
    document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeDetailModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeDetailModal();
    });

    document.getElementById('editStaffBtn').addEventListener('click', enterEditMode);
    document.getElementById('cancelEditBtn').addEventListener('click', exitEditMode);
    document.getElementById('editStaffForm').addEventListener('submit', handleEditSubmit);
    document.getElementById('deactivateStaffBtn').addEventListener('click', handleDeactivate);
  }

  function openDetailModal(staff) {
    state.activeStaffId = staff.id;
    state.editMode = false;

    renderDetailView(staff);
    exitEditMode();
    document.getElementById('detailModalScrim').classList.add('is-open');
  }

  function closeDetailModal() {
    document.getElementById('detailModalScrim').classList.remove('is-open');
    state.activeStaffId = null;
  }

  function currentStaff() {
    return state.staff.find((s) => s.id === state.activeStaffId);
  }

  function renderDetailView(staff) {
    const name = roleLabel(staff.role) === 'Dentist' ? `Dr. ${staff.first_name} ${staff.last_name}` : `${staff.first_name} ${staff.last_name}`;

    document.getElementById('detailModalName').textContent = name;
    document.getElementById('detailModalMeta').textContent = roleLabel(staff.role) + (staff.is_active === false ? ' · Deactivated' : '');
    document.getElementById('detailModalAvatar').innerHTML = Avatar.avatarInnerHtml(name, staff.profile_picture_url);

    document.getElementById('overviewGrid').innerHTML = [
      ['Role', roleLabel(staff.role)],
      ['Email', staff.email],
      ['Phone', staff.phone],
      ['Status', staff.is_active === false ? 'Deactivated' : 'Active'],
    ].map(([label, value]) => `
      <div class="detail-cell">
        <p class="label">${escapeHtml(label)}</p>
        <p class="value">${value ? escapeHtml(String(value)) : '—'}</p>
      </div>
    `).join('');

    const isSelf = staff.id === sessionUser.id;
    const deactivateBtn = document.getElementById('deactivateStaffBtn');
    if (isSelf) {
      deactivateBtn.style.display = 'none';
    } else if (staff.is_active === false) {
      deactivateBtn.style.display = '';
      deactivateBtn.textContent = 'Already deactivated';
      deactivateBtn.disabled = true;
    } else {
      deactivateBtn.style.display = '';
      deactivateBtn.textContent = 'Deactivate staff member';
      deactivateBtn.disabled = false;
    }

    const editBtn = document.getElementById('editStaffBtn');
    editBtn.style.display = staff.is_active === false ? 'none' : '';
  }

  function enterEditMode() {
    const staff = currentStaff();
    if (!staff) return;
    state.editMode = true;

    document.getElementById('esFirstName').value = staff.first_name;
    document.getElementById('esLastName').value = staff.last_name;
    document.getElementById('esPhone').value = staff.phone || '';
    document.getElementById('editStaffError').style.display = 'none';

    document.getElementById('overviewPanel').style.display = 'none';
    document.getElementById('editPanel').style.display = 'block';
  }

  function exitEditMode() {
    state.editMode = false;
    document.getElementById('overviewPanel').style.display = 'block';
    document.getElementById('editPanel').style.display = 'none';
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const staff = currentStaff();
    if (!staff) return;

    const errorEl = document.getElementById('editStaffError');
    errorEl.style.display = 'none';

    const payload = {
      first_name: document.getElementById('esFirstName').value.trim(),
      last_name: document.getElementById('esLastName').value.trim(),
      phone: document.getElementById('esPhone').value.trim() || null,
      // updateUser's SQL sets is_active unconditionally from this payload —
      // omitting it here would NULL the column out, so we always resend the
      // current value. This form only ever edits active staff (the Edit
      // button is hidden once deactivated), so this is always true.
      is_active: true,
    };

    if (!payload.first_name || !payload.last_name) {
      errorEl.textContent = 'First name and last name are required.';
      errorEl.style.display = 'block';
      return;
    }

    const submitBtn = document.getElementById('saveEditBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const updated = await fetchMethod(`/users/${staff.id}`, 'PUT', payload, true);
      Object.assign(staff, updated);
      renderRoster();
      renderDetailView(staff);
      exitEditMode();
      showToast('Staff details updated.');
    } catch (err) {
      errorEl.textContent = err.message || 'Could not update staff details.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save changes';
    }
  }

  /* ============================================================
     DEACTIVATE STAFF
     ------------------------------------------------------------
     Irreversible from the UI: softDeleteUser sets deleted_at, and
     every read/update query filters WHERE deleted_at IS NULL — so
     there's currently no endpoint that can bring the account back.
     ============================================================ */
  async function handleDeactivate() {
    const staffId = state.activeStaffId;
    if (!staffId) return;

    const staff = currentStaff();
    const name = staff ? `${staff.first_name} ${staff.last_name}` : 'this staff member';
    if (!window.confirm(`Deactivate ${name}? This can't be undone from here — their account will be permanently disabled and they won't be able to log in.`)) {
      return;
    }

    const btn = document.getElementById('deactivateStaffBtn');
    btn.disabled = true;
    btn.textContent = 'Deactivating…';

    try {
      await fetchMethod(`/users/${staffId}`, 'DELETE', null, true);
      if (staff) staff.is_active = false;
      renderRoster();
      if (staff) renderDetailView(staff);
      showToast(`${name} has been deactivated.`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Deactivate staff member';
      showToast(err.message || 'Could not deactivate this staff member.');
    }
  }

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as other admin pages
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
  function roleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'dentist') return 'Dentist';
    if (role === 'receptionist') return 'Receptionist';
    return capitalize(role || '');
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