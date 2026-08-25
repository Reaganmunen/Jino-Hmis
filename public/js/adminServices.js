(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as adminBilling.js / adminInventory.js. Create/edit
     are backend-enforced admin-only (serviceRoutes.js: authorizeRoles
     ('admin') on POST/PUT) — this just keeps non-admins off the page.
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
    services: [],
    searchTerm: '',
    editingId: null, // null = "add" mode, otherwise the service being edited
  };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initToolbar();
    initServiceFormModal();
    renderTopbarAvatar();
    loadServices();
  });

  async function loadServices() {
    try {
      const services = await fetchMethod('/services', 'GET', null, true);
      state.services = services;
      renderStats();
      renderList();
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
    showToast(err.message || 'Could not load the service catalog. Please refresh.');
  }

  function renderTopbarAvatar() {
    const avatar = document.getElementById('avatarInitials');
    if (avatar && sessionUser.first_name) {
      avatar.textContent = initialsOf(`${sessionUser.first_name} ${sessionUser.last_name || ''}`);
    }
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalServices').textContent = state.services.length;

    const avg = state.services.length
      ? state.services.reduce((sum, s) => sum + Number(s.price || 0), 0) / state.services.length
      : 0;
    document.getElementById('statAvgPrice').textContent = formatMoney(avg);
  }

  /* ============================================================
     TOOLBAR — search
     ============================================================ */
  function initToolbar() {
    const search = document.getElementById('serviceSearch');
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.searchTerm = search.value.trim().toLowerCase();
        renderList();
      }, 180);
    });
  }

  function visibleServices() {
    return state.services
      .filter((s) => {
        if (!state.searchTerm) return true;
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        return name.includes(state.searchTerm) || desc.includes(state.searchTerm);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  /* ============================================================
     LIST
     ============================================================ */
  function renderList() {
    const list = document.getElementById('svcCatalogList');
    list.innerHTML = '';

    const services = visibleServices();

    if (!services.length) {
      list.innerHTML = `<div class="empty-state">${
        state.services.length ? 'No services match your search.' : 'No services yet — add the clinic\u2019s first one.'
      }</div>`;
      return;
    }

    services.forEach((service) => {
      const card = document.createElement('div');
      card.className = 'svc-card';
      card.setAttribute('data-service-id', service.id);
      card.innerHTML = `
        <div class="svc-mid">
          <p class="t">${escapeHtml(service.name)}</p>
          ${service.description ? `<p class="s">${escapeHtml(service.description)}</p>` : ''}
        </div>
        <div class="svc-price">${formatMoney(service.price)}</div>
        <div class="svc-actions">
          <button class="btn btn-outline btn-sm" data-action="edit" data-id="${service.id}">Edit</button>
          <button class="btn btn-sm btn-danger-outline" data-action="delete" data-id="${service.id}">Delete</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openServiceModal('edit', btn.getAttribute('data-id')));
    });
    list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteService(btn.getAttribute('data-id')));
    });
  }

  /* ============================================================
     ADD / EDIT SERVICE MODAL
     Both create and edit share one modal — editService() (PUT) requires
     the full row (name/description/price/is_active), since the model
     writes all four columns positionally, so edit-mode submits every
     field even if only one changed.
     ============================================================ */
  function initServiceFormModal() {
    const scrim = document.getElementById('serviceFormModalScrim');
    document.getElementById('addServiceBtn').addEventListener('click', () => openServiceModal('add'));
    document.getElementById('serviceFormClose').addEventListener('click', closeServiceModal);
    document.getElementById('serviceFormCancel').addEventListener('click', closeServiceModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeServiceModal(); });
    document.getElementById('serviceFormSubmit').addEventListener('click', submitServiceForm);
  }

  function openServiceModal(mode, serviceId) {
    const isEdit = mode === 'edit';
    state.editingId = isEdit ? serviceId : null;

    const service = isEdit ? state.services.find((s) => String(s.id) === String(serviceId)) : null;
    if (isEdit && !service) return;

    document.getElementById('serviceFormKicker').textContent = isEdit ? 'Edit Service' : 'New Service';
    document.getElementById('serviceFormTitle').textContent = isEdit ? 'Edit service' : 'Add a service';

    document.getElementById('serviceName').value = service ? service.name : '';
    document.getElementById('serviceDescription').value = service ? (service.description || '') : '';
    document.getElementById('servicePrice').value = service ? service.price : '';

    const submitBtn = document.getElementById('serviceFormSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save changes' : 'Add service';

    document.getElementById('serviceFormModalScrim').classList.add('is-open');
  }

  function closeServiceModal() {
    document.getElementById('serviceFormModalScrim').classList.remove('is-open');
    state.editingId = null;
  }

  async function submitServiceForm() {
    const name = document.getElementById('serviceName').value.trim();
    const description = document.getElementById('serviceDescription').value.trim() || null;
    const price = Number(document.getElementById('servicePrice').value);

    if (!name) return showToast('Enter a service name');
    if (price === '' || isNaN(price) || price < 0) return showToast('Enter a valid price');

    const submitBtn = document.getElementById('serviceFormSubmit');
    const isEdit = !!state.editingId;
    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? 'Saving…' : 'Adding…';

    try {
      if (isEdit) {
        await fetchMethod(`/services/${state.editingId}`, 'PUT', { name, description, price, is_active: true }, true);
        showToast('Service updated');
      } else {
        await fetchMethod('/services', 'POST', { name, description, price }, true);
        showToast('Service added');
      }
      closeServiceModal();
      await loadServices();
    } catch (err) {
      showToast(err.message || (isEdit ? 'Could not update the service' : 'Could not add the service'));
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Add service';
    }
  }

  /* ============================================================
     DELETE (soft) — there's no DELETE route; removing a service from
     the catalog means setting is_active = false via the same PUT
     the edit form uses. listServices()/findServiceById() both filter
     on is_active = TRUE, so it simply stops showing up afterward.
     ============================================================ */
  async function deleteService(serviceId) {
    const service = state.services.find((s) => String(s.id) === String(serviceId));
    if (!service) return;

    if (!window.confirm(`Remove "${service.name}" from the service catalog?`)) return;

    try {
      await fetchMethod(
        `/services/${serviceId}`,
        'PUT',
        { name: service.name, description: service.description, price: service.price, is_active: false },
        true
      );
      showToast('Service removed');
      await loadServices();
    } catch (err) {
      showToast(err.message || 'Could not remove this service');
    }
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
      if (hasRealHref) {
        link.addEventListener('click', closeSidebar);
      }
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

  function formatMoney(n) { return 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 }); }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();