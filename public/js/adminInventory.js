(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     inventoryItemRoutes allows admin/dentist/receptionist to view,
     but add/edit/restock are admin-only server-side. This page is
     reached from the admin sidebar, so guard on admin here too.
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
    items: [],
    usage: {},          // itemId -> { entries, loaded, open }
    activeFilter: 'all', // all | low | out
    searchTerm: '',
    categoryFilter: '',
    editingItemId: null,  // null => Add mode, else Edit mode
    activeRestockItem: null,
    activeUsageItem: null,
  };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initToolbar();
    initItemFormModal();
    initRestockModal();
    initUsageModal();
    loadInventory();
  });

  async function loadInventory() {
    try {
      renderTopbarName();
      const items = await fetchMethod('/inventory-items', 'GET', null, true);
      state.items = items.sort((a, b) => a.name.localeCompare(b.name));
      renderStats();
      populateCategoryFilter();
      renderInvList();
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
    showToast(err.message || 'Could not load inventory. Please refresh.');
  }

  function renderTopbarName() {
    const avatar = document.getElementById('avatarInitials');
    if (avatar && sessionUser.first_name) {
      avatar.textContent = initialsOf(`${sessionUser.first_name} ${sessionUser.last_name || ''}`);
    }
  }

  /* ============================================================
     STOCK HELPERS
     ============================================================ */
  function stockStatus(item) {
    const qty = Number(item.quantity);
    const reorder = Number(item.reorder_level);
    if (qty <= 0) return 'out_of_stock';
    if (qty <= reorder) return 'low_stock';
    return 'in_stock';
  }

  const STATUS_LABEL = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalItems').textContent = state.items.length;

    const low = state.items.filter((i) => stockStatus(i) === 'low_stock').length;
    document.getElementById('statLowStock').textContent = low;

    const out = state.items.filter((i) => stockStatus(i) === 'out_of_stock').length;
    document.getElementById('statOutOfStock').textContent = out;

    const value = state.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost || 0), 0);
    document.getElementById('statStockValue').textContent = formatMoney(value);
  }

  /* ============================================================
     TOOLBAR — stock tabs, category filter, search
     ============================================================ */
  function initToolbar() {
    document.querySelectorAll('#stockTabs .filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#stockTabs .filter-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        state.activeFilter = tab.getAttribute('data-tab');
        renderInvList();
      });
    });

    document.getElementById('categoryFilter').addEventListener('change', (e) => {
      state.categoryFilter = e.target.value;
      renderInvList();
    });

    const search = document.getElementById('itemSearch');
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.searchTerm = search.value.trim().toLowerCase();
        renderInvList();
      }, 180);
    });
  }

  function populateCategoryFilter() {
    const select = document.getElementById('categoryFilter');
    const categories = Array.from(new Set(state.items.map((i) => i.category).filter(Boolean))).sort();
    const current = select.value;
    select.innerHTML = '<option value="">All categories</option>' +
      categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    if (categories.includes(current)) select.value = current;

    // Keep the Add/Edit item modal's category datalist in sync too.
    document.getElementById('categoryOptions').innerHTML =
      categories.map((c) => `<option value="${escapeAttr(c)}">`).join('');
  }

  function visibleItems() {
    return state.items.filter((item) => {
      const status = stockStatus(item);
      if (state.activeFilter === 'low' && status !== 'low_stock') return false;
      if (state.activeFilter === 'out' && status !== 'out_of_stock') return false;
      if (state.categoryFilter && item.category !== state.categoryFilter) return false;
      if (!state.searchTerm) return true;
      const haystack = `${item.name} ${item.supplier || ''}`.toLowerCase();
      return haystack.includes(state.searchTerm);
    });
  }

  /* ============================================================
     ITEM LIST
     ============================================================ */
  function renderInvList() {
    const list = document.getElementById('invList');
    list.innerHTML = '';

    const items = visibleItems();

    if (!items.length) {
      list.innerHTML = '<div class="empty-state">No items match this view.</div>';
      return;
    }

    items.forEach((item) => {
      const status = stockStatus(item);
      const isOpen = !!(state.usage[item.id] && state.usage[item.id].open);

      const card = document.createElement('div');
      card.className = `inv-card${isOpen ? ' is-open' : ''}${status === 'low_stock' ? ' is-low' : ''}${status === 'out_of_stock' ? ' is-out' : ''}`;
      card.setAttribute('data-item-id', item.id);
      card.innerHTML = `
        <div class="inv-head" data-action="toggle" data-id="${item.id}">
          <div class="inv-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 8l9-5 9 5-9 5-9-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 8v9l9 5 9-5V8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </div>
          <div class="inv-mid">
            <p class="t">${escapeHtml(item.name)}</p>
            <p class="s">${escapeHtml(item.category || 'Uncategorized')}${item.supplier ? ' · ' + escapeHtml(item.supplier) : ''}</p>
          </div>
          <span class="badge badge-${status}">${STATUS_LABEL[status]}</span>
          <div class="inv-qty-block">
            <p class="q">${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit || '')}</p>
            <p class="r">Reorder at ${escapeHtml(String(item.reorder_level))}</p>
          </div>
          <svg class="inv-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="inv-body" id="invBody-${item.id}">
          <p class="bill-body-empty">Loading details…</p>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleItem(head.getAttribute('data-id')));
    });

    Object.keys(state.usage).forEach((itemId) => {
      if (state.usage[itemId].open && state.usage[itemId].loaded && document.getElementById(`invBody-${itemId}`)) {
        renderItemBody(itemId);
      }
    });
  }

  async function toggleItem(itemId) {
    const card = document.querySelector(`.inv-card[data-item-id="${itemId}"]`);
    if (!card) return;

    if (!state.usage[itemId]) state.usage[itemId] = { open: false, loaded: false, entries: [] };
    const u = state.usage[itemId];
    u.open = !u.open;
    card.classList.toggle('is-open', u.open);

    if (u.open && !u.loaded) {
      await loadItemUsage(itemId);
    }
  }

  async function loadItemUsage(itemId) {
    const body = document.getElementById(`invBody-${itemId}`);
    try {
      const entries = await fetchMethod(`/inventory-usage/item/${itemId}`, 'GET', null, true);
      state.usage[itemId] = { open: true, loaded: true, entries };
      renderItemBody(itemId);
    } catch (err) {
      if (body) body.innerHTML = '<p class="bill-body-empty">Could not load usage history.</p>';
      showToast(err.message || 'Could not load usage history');
    }
  }

  function renderItemBody(itemId) {
    const body = document.getElementById(`invBody-${itemId}`);
    if (!body) return;
    const item = state.items.find((i) => String(i.id) === String(itemId));
    const u = state.usage[itemId];
    if (!item || !u) return;

    const usageHtml = u.entries.length
      ? u.entries.slice(0, 8).map((e) => `
          <div class="usage-row">
            <span class="meta">${escapeHtml(formatDate(e.recorded_at))} · Appointment ${escapeHtml(shortId(e.appointment_id))}</span>
            <span class="amt">−${escapeHtml(String(e.quantity_used))} ${escapeHtml(item.unit || '')}</span>
          </div>
        `).join('')
      : '<p class="bill-body-empty">No usage logged for this item yet.</p>';

    body.innerHTML = `
      <div class="bill-section">
        <p class="bill-section-title">Item details</p>
        <div class="inv-detail-grid">
          <div class="inv-detail-cell"><p class="label">Unit</p><p class="value">${escapeHtml(item.unit || '—')}</p></div>
          <div class="inv-detail-cell"><p class="label">Unit cost</p><p class="value">${formatMoney(item.unit_cost)}</p></div>
          <div class="inv-detail-cell"><p class="label">Reorder level</p><p class="value">${escapeHtml(String(item.reorder_level))}</p></div>
          <div class="inv-detail-cell"><p class="label">Supplier</p><p class="value">${escapeHtml(item.supplier || '—')}</p></div>
        </div>
      </div>
      <div class="bill-section">
        <p class="bill-section-title">Recent usage</p>
        ${usageHtml}
      </div>
      <div class="inv-actions">
        <button class="btn btn-primary btn-sm" data-action="restock" data-id="${item.id}">Restock</button>
        <button class="btn btn-outline btn-sm" data-action="log-usage" data-id="${item.id}">Log usage</button>
        <button class="btn btn-outline btn-sm" data-action="edit" data-id="${item.id}">Edit item</button>
      </div>
    `;

    body.querySelector('[data-action="restock"]').addEventListener('click', () => openRestockModal(item.id));
    body.querySelector('[data-action="log-usage"]').addEventListener('click', () => openUsageModal(item.id));
    body.querySelector('[data-action="edit"]').addEventListener('click', () => openItemFormModal(item.id));
  }

  // Reloads the item catalog and keeps whatever card the admin has open expanded.
  async function refreshItemsAndKeepOpen(itemId) {
    try {
      const items = await fetchMethod('/inventory-items', 'GET', null, true);
      state.items = items.sort((a, b) => a.name.localeCompare(b.name));
      renderStats();
      populateCategoryFilter();
      renderInvList();
      if (itemId) {
        delete state.usage[itemId];
        state.usage[itemId] = { open: true, loaded: false, entries: [] };
        const card = document.querySelector(`.inv-card[data-item-id="${itemId}"]`);
        if (card) card.classList.add('is-open');
        await loadItemUsage(itemId);
      }
    } catch (err) {
      showToast(err.message || 'Could not refresh inventory');
    }
  }

  /* ============================================================
     ADD / EDIT ITEM MODAL
     ============================================================ */
  function initItemFormModal() {
    const scrim = document.getElementById('itemFormModalScrim');
    document.getElementById('addItemBtn').addEventListener('click', () => openItemFormModal(null));
    document.getElementById('itemFormClose').addEventListener('click', closeItemFormModal);
    document.getElementById('itemFormCancel').addEventListener('click', closeItemFormModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeItemFormModal(); });
    document.getElementById('itemFormSubmit').addEventListener('click', submitItemForm);
  }

  function openItemFormModal(itemId) {
    state.editingItemId = itemId;
    const isEdit = !!itemId;
    const item = isEdit ? state.items.find((i) => String(i.id) === String(itemId)) : null;

    document.getElementById('itemFormKicker').textContent = isEdit ? 'Edit Item' : 'New Item';
    document.getElementById('itemFormTitle').textContent = isEdit ? 'Edit inventory item' : 'Add inventory item';

    document.getElementById('itemName').value = item ? item.name : '';
    document.getElementById('itemCategory').value = item ? (item.category || '') : '';
    document.getElementById('itemUnit').value = item ? (item.unit || '') : '';
    document.getElementById('itemQuantity').value = item ? item.quantity : '';
    document.getElementById('itemReorderLevel').value = item ? item.reorder_level : '';
    document.getElementById('itemUnitCost').value = item ? item.unit_cost : '';
    document.getElementById('itemSupplier').value = item ? (item.supplier || '') : '';

    const submitBtn = document.getElementById('itemFormSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save changes' : 'Add item';

    document.getElementById('itemFormModalScrim').classList.add('is-open');
  }

  function closeItemFormModal() {
    document.getElementById('itemFormModalScrim').classList.remove('is-open');
    state.editingItemId = null;
  }

  async function submitItemForm() {
    const name = document.getElementById('itemName').value.trim();
    const category = document.getElementById('itemCategory').value.trim() || null;
    const unit = document.getElementById('itemUnit').value.trim();
    const quantity = Number(document.getElementById('itemQuantity').value);
    const reorder_level = Number(document.getElementById('itemReorderLevel').value);
    const unit_cost = Number(document.getElementById('itemUnitCost').value);
    const supplier = document.getElementById('itemSupplier').value.trim() || null;

    if (!name) return showToast('Enter the item name');
    if (!unit) return showToast('Enter a unit (box, pcs, ml…)');
    if (quantity === '' || isNaN(quantity) || quantity < 0) return showToast('Enter a valid quantity');
    if (reorder_level === '' || isNaN(reorder_level) || reorder_level < 0) return showToast('Enter a valid reorder level');
    if (unit_cost === '' || isNaN(unit_cost) || unit_cost < 0) return showToast('Enter a valid unit cost');

    const payload = { name, category, quantity, unit, reorder_level, unit_cost, supplier };
    const isEdit = !!state.editingItemId;

    const submitBtn = document.getElementById('itemFormSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? 'Saving…' : 'Adding…';

    try {
      if (isEdit) {
        await fetchMethod(`/inventory-items/${state.editingItemId}`, 'PUT', payload, true);
      } else {
        await fetchMethod('/inventory-items', 'POST', payload, true);
      }
      const editedId = state.editingItemId;
      closeItemFormModal();
      showToast(isEdit ? 'Item updated' : 'Item added');
      await refreshItemsAndKeepOpen(editedId);
    } catch (err) {
      showToast(err.message || 'Could not save this item');
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Add item';
    }
  }

  /* ============================================================
     RESTOCK MODAL — manual delta adjustment
     ============================================================ */
  function initRestockModal() {
    const scrim = document.getElementById('restockModalScrim');
    document.getElementById('restockClose').addEventListener('click', closeRestockModal);
    document.getElementById('restockCancel').addEventListener('click', closeRestockModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeRestockModal(); });
    document.getElementById('restockSubmit').addEventListener('click', submitRestock);
  }

  function openRestockModal(itemId) {
    const item = state.items.find((i) => String(i.id) === String(itemId));
    if (!item) return;

    state.activeRestockItem = itemId;

    document.getElementById('restockSummary').innerHTML = `
      <div class="pay-summary-row"><span>Item</span><b>${escapeHtml(item.name)}</b></div>
      <div class="pay-summary-row"><span>Current stock</span><b>${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit || '')}</b></div>
    `;

    document.getElementById('restockDelta').value = '';

    const submitBtn = document.getElementById('restockSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save adjustment';

    document.getElementById('restockModalScrim').classList.add('is-open');
  }

  function closeRestockModal() {
    document.getElementById('restockModalScrim').classList.remove('is-open');
    state.activeRestockItem = null;
  }

  async function submitRestock() {
    const itemId = state.activeRestockItem;
    const delta = Number(document.getElementById('restockDelta').value);

    if (!delta || isNaN(delta)) return showToast('Enter a non-zero adjustment');

    const submitBtn = document.getElementById('restockSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      await fetchMethod(`/inventory-items/${itemId}/restock`, 'PUT', { delta }, true);
      closeRestockModal();
      showToast('Stock adjusted');
      await refreshItemsAndKeepOpen(itemId);
    } catch (err) {
      showToast(err.message || 'Could not adjust stock');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save adjustment';
    }
  }

  /* ============================================================
     LOG USAGE MODAL — transactional, tied to an appointment
     ============================================================ */
  function initUsageModal() {
    const scrim = document.getElementById('usageModalScrim');
    document.getElementById('usageModalClose').addEventListener('click', closeUsageModal);
    document.getElementById('usageCancel').addEventListener('click', closeUsageModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeUsageModal(); });
    document.getElementById('usageSubmit').addEventListener('click', submitUsage);
  }

  function openUsageModal(itemId) {
    const item = state.items.find((i) => String(i.id) === String(itemId));
    if (!item) return;

    state.activeUsageItem = itemId;

    document.getElementById('usageSummary').innerHTML = `
      <div class="pay-summary-row"><span>Item</span><b>${escapeHtml(item.name)}</b></div>
      <div class="pay-summary-row"><span>In stock</span><b>${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit || '')}</b></div>
    `;

    document.getElementById('usageAppointmentId').value = '';
    document.getElementById('usageQuantityUsed').value = '1';

    const submitBtn = document.getElementById('usageSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log usage';

    document.getElementById('usageModalScrim').classList.add('is-open');
  }

  function closeUsageModal() {
    document.getElementById('usageModalScrim').classList.remove('is-open');
    state.activeUsageItem = null;
  }

  async function submitUsage() {
    const inventory_item_id = state.activeUsageItem;
    const appointment_id = document.getElementById('usageAppointmentId').value.trim();
    const quantity_used = Number(document.getElementById('usageQuantityUsed').value);

    if (!appointment_id) return showToast('Enter the appointment ID this usage is tied to');
    if (!quantity_used || quantity_used < 1) return showToast('Enter a valid quantity');

    const submitBtn = document.getElementById('usageSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging…';

    try {
      const { item } = await fetchMethod('/inventory-usage', 'POST', {
        inventory_item_id, appointment_id, quantity_used,
      }, true);

      closeUsageModal();
      showToast(`Logged. ${item.quantity} ${item.unit} left in stock.`);
      await refreshItemsAndKeepOpen(inventory_item_id);
    } catch (err) {
      // Backend returns 400 "Not enough stock available" when the transactional
      // decrement would go negative — surface that message as-is.
      showToast(err.message || 'Could not log usage');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log usage';
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

  function shortId(id) { return id == null ? '—' : String(id).slice(0, 8).toUpperCase(); }

  function formatMoney(n) { return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); }

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
})();