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
    dentistId: sessionUser.id,
    appointments: [],
    patientsById: {},
    services: [],
    activeAppointment: null,
    activePatient: null,
    bills: [],        // this patient's full bill history
    activeBill: null,  // the bill tied to the active appointment, if one exists
    items: [],         // line items on the active bill
    inventoryItems: [], // clinic consumables catalog
    usage: [],          // consumables logged against the active appointment
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    document.getElementById('switchPatientBtn').addEventListener('click', showAppointmentPicker);
    document.getElementById('startBillBtn').addEventListener('click', startBill);
    document.getElementById('addItemBtn').addEventListener('click', addItem);
    document.getElementById('itemServiceSelect').addEventListener('change', onServiceSelected);
    document.getElementById('recordUsageBtn').addEventListener('click', recordUsage);
    loadInitialData();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadInitialData() {
    try {
      const { from, to } = todayRangeIso();
      const [appointments, patients, services, inventoryItems] = await Promise.all([
        fetchMethod(`/appointments/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
        fetchMethod('/services', 'GET', null, true),
        fetchMethod('/inventory-items', 'GET', null, true),
      ]);

      state.appointments = appointments
        .filter((a) => a.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });
      state.services = services;
      state.inventoryItems = inventoryItems;

      renderAppointmentPicker();
      populateServiceSelect();
      populateUsageSelect();
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
    showToast(err.message || 'Could not load your schedule. Please refresh.');
  }

  /* ============================================================
     APPOINTMENT PICKER
     ============================================================ */
  function renderAppointmentPicker() {
    const list = document.getElementById('apptPickerList');
    document.getElementById('apptPickerCount').textContent =
      `${state.appointments.length} appointment${state.appointments.length === 1 ? '' : 's'} today`;

    if (!state.appointments.length) {
      list.innerHTML = '<div class="empty-state">No appointments scheduled for today.</div>';
      return;
    }

    list.innerHTML = '';
    state.appointments.forEach((appt) => {
      const patient = state.patientsById[appt.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const time = new Date(appt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const row = document.createElement('div');
      row.className = 'sched-item is-selectable';
      if (state.activeAppointment && state.activeAppointment.id === appt.id) row.classList.add('is-active-appt');
      row.innerHTML = `
        <div class="sched-time">${escapeHtml(time)}</div>
        <div class="sched-avatar">${initialsOf(patientName)}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(patientName)}</p>
          <p class="s">${escapeHtml(appt.reason || 'Appointment')}${appt.room ? ' · ' + escapeHtml(appt.room) : ''}</p>
        </div>
        <div class="sched-flags">
          <span class="badge badge-${appt.status}">${capitalize(appt.status)}</span>
        </div>
      `;
      row.addEventListener('click', () => selectAppointment(appt));
      list.appendChild(row);
    });
  }

  async function selectAppointment(appt) {
    state.activeAppointment = appt;
    state.activePatient = state.patientsById[appt.patient_id] || null;
    state.activeBill = null;
    state.items = [];
    state.usage = [];

    renderAppointmentPicker();

    if (!state.activePatient) {
      showToast('Could not find this patient\'s record.');
      return;
    }

    document.getElementById('billPanel').style.display = 'block';
    document.getElementById('billHistoryPanel').style.display = 'block';
    document.getElementById('billPatientName').textContent = `— ${state.activePatient.first_name} ${state.activePatient.last_name}`;
    document.getElementById('billPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('billHistoryTimeline').innerHTML = '<div class="empty-state">Loading bill history…</div>';
    showStartBillState();
    resetItemForm();

    try {
      const [bills, usage] = await Promise.all([
        fetchMethod(`/bills/patient/${state.activePatient.id}`, 'GET', null, true),
        fetchMethod(`/inventory-usage/appointment/${appt.id}`, 'GET', null, true),
      ]);
      state.bills = bills.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.usage = usage;
      renderBillHistory();
      renderUsageList();

      const existing = state.bills.find((b) => b.appointment_id === appt.id && b.status !== 'void');
      if (existing) {
        await loadActiveBill(existing.id);
      }
    } catch (err) {
      handleLoadError(err);
    }
  }

  function showAppointmentPicker() {
    document.getElementById('billPanel').style.display = 'none';
    document.getElementById('billHistoryPanel').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     ACTIVE BILL (for the selected appointment)
     ============================================================ */
  function showStartBillState() {
    document.getElementById('startBillState').style.display = 'block';
    document.getElementById('activeBillState').style.display = 'none';
  }

  function showActiveBillState() {
    document.getElementById('startBillState').style.display = 'none';
    document.getElementById('activeBillState').style.display = 'block';
  }

  async function loadActiveBill(billId) {
    try {
      const [bill, items] = await Promise.all([
        fetchMethod(`/bills/${billId}`, 'GET', null, true),
        fetchMethod(`/bill-items/bill/${billId}`, 'GET', null, true),
      ]);
      state.activeBill = bill;
      state.items = items;
      // Keep the history list's copy of this bill in sync (total_amount changes as items are added).
      const idx = state.bills.findIndex((b) => b.id === bill.id);
      if (idx >= 0) state.bills[idx] = bill; else state.bills.unshift(bill);

      renderActiveBill();
      renderBillHistory();
      showActiveBillState();
    } catch (err) {
      handleLoadError(err);
    }
  }

  async function startBill() {
    if (!state.activePatient || !state.activeAppointment) return;

    const btn = document.getElementById('startBillBtn');
    btn.disabled = true;
    btn.textContent = 'Starting…';

    try {
      const bill = await fetchMethod('/bills', 'POST', {
        patient_id: state.activePatient.id,
        appointment_id: state.activeAppointment.id,
      }, true);

      await loadActiveBill(bill.id);
      showToast('Bill started for this visit.');
    } catch (err) {
      showToast(err.message || 'Could not start a bill for this visit. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Start bill for this visit';
    }
  }

  function renderActiveBill() {
    const bill = state.activeBill;
    const badge = document.getElementById('billStatusBadge');
    badge.textContent = formatStatus(bill.status);
    badge.setAttribute('data-status', bill.status || '');

    document.getElementById('billTotal').textContent = `Total: ${formatCurrency(bill.total_amount)}`;
    const paid = Number(bill.amount_paid || 0);
    document.getElementById('billPaid').textContent = paid > 0 ? `Paid: ${formatCurrency(bill.amount_paid)}` : '';

    renderBillItems();
  }

  function renderBillItems() {
    const el = document.getElementById('billItemsList');
    if (!state.items.length) {
      el.innerHTML = '<p class="empty-state">No services added to this bill yet.</p>';
      return;
    }
    el.innerHTML = state.items.map((item) => {
      const lineTotal = Number(item.quantity) * Number(item.unit_price);
      return `
        <div class="bill-item-row">
          <div>
            <p class="bill-item-desc">${escapeHtml(item.description || 'Service')}</p>
            <p class="bill-item-meta">${escapeHtml(String(item.quantity))} × ${formatCurrency(item.unit_price)}</p>
          </div>
          <div class="bill-item-line-total">${formatCurrency(lineTotal)}</div>
        </div>
      `;
    }).join('');
  }

  /* ============================================================
     ADD ITEM FORM
     ============================================================ */
  function populateServiceSelect() {
    const select = document.getElementById('itemServiceSelect');
    state.services.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.price != null ? `${s.name} — KSh ${Number(s.price).toLocaleString('en-KE')}` : s.name;
      select.appendChild(opt);
    });
  }

  function onServiceSelected(e) {
    const service = state.services.find((s) => String(s.id) === e.target.value);
    if (!service) return;
    document.getElementById('itemDescription').value = service.name;
    if (service.price != null) document.getElementById('itemUnitPrice').value = service.price;
  }

  function resetItemForm() {
    document.getElementById('itemServiceSelect').value = '';
    document.getElementById('itemDescription').value = '';
    document.getElementById('itemQuantity').value = '1';
    document.getElementById('itemUnitPrice').value = '';
  }

  async function addItem() {
    if (!state.activeBill) return;

    const service_id = document.getElementById('itemServiceSelect').value || null;
    const description = document.getElementById('itemDescription').value.trim();
    const quantity = Number(document.getElementById('itemQuantity').value);
    const unit_price = Number(document.getElementById('itemUnitPrice').value);

    if (!description || !quantity || quantity < 1 || !(unit_price >= 0)) {
      showToast('Add a description, a quantity of at least 1, and a unit price.');
      return;
    }

    const btn = document.getElementById('addItemBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';

    try {
      await fetchMethod('/bill-items', 'POST', {
        bill_id: state.activeBill.id,
        service_id,
        description,
        quantity,
        unit_price,
      }, true);

      // total_amount is trigger-maintained on the Bill row, so reload both
      // the bill and its items rather than trying to compute the new total client-side.
      await loadActiveBill(state.activeBill.id);
      resetItemForm();
      showToast('Service added to bill.');
    } catch (err) {
      showToast(err.message || 'Could not add this item. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add to bill';
    }
  }

  /* ============================================================
     CONSUMABLES USED (inventory tracking)
     ------------------------------------------------------------
     Separate from the bill's line items — this logs stock usage
     against the appointment via POST /inventory-usage, which
     transactionally decrements InventoryItem.quantity server-side.
     Doesn't require an open bill; can be logged as soon as an
     appointment is selected.
     ============================================================ */
  function populateUsageSelect() {
    const select = document.getElementById('usageItemSelect');
    state.inventoryItems.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = `${item.name} (${item.quantity} ${item.unit} in stock)`;
      select.appendChild(opt);
    });
  }

  async function recordUsage() {
    if (!state.activeAppointment) return;

    const inventory_item_id = document.getElementById('usageItemSelect').value;
    const quantity_used = Number(document.getElementById('usageQuantity').value);

    if (!inventory_item_id || !quantity_used || quantity_used < 1) {
      showToast('Select an item and a valid quantity.');
      return;
    }

    const btn = document.getElementById('recordUsageBtn');
    btn.disabled = true;
    btn.textContent = 'Logging…';

    try {
      const { usage, item } = await fetchMethod('/inventory-usage', 'POST', {
        inventory_item_id,
        appointment_id: state.activeAppointment.id,
        quantity_used,
      }, true);

      state.usage.unshift(usage);
      // Keep the dropdown's stock counts current without a full refetch.
      const idx = state.inventoryItems.findIndex((i) => i.id === item.id);
      if (idx >= 0) state.inventoryItems[idx] = item;
      document.getElementById('usageItemSelect').innerHTML = '<option value="">Select an item…</option>';
      populateUsageSelect();

      renderUsageList();
      document.getElementById('usageQuantity').value = '1';
      showToast(`Logged. ${item.quantity} ${item.unit} left in stock.`);
    } catch (err) {
      showToast(err.message || 'Could not log usage. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log usage';
    }
  }

  function renderUsageList() {
    const el = document.getElementById('usageList');
    if (!state.usage.length) {
      el.innerHTML = '<p class="empty-state">No consumables logged for this visit yet.</p>';
      return;
    }
    el.innerHTML = state.usage.map((u) => {
      const item = state.inventoryItems.find((i) => i.id === u.inventory_item_id);
      return `
        <div class="bill-item-row">
          <div>
            <p class="bill-item-desc">${escapeHtml(item ? item.name : 'Item')}</p>
          </div>
          <div class="bill-item-line-total">${escapeHtml(String(u.quantity_used))} ${escapeHtml(item ? item.unit : '')}</div>
        </div>
      `;
    }).join('');
  }

  /* ============================================================
     BILL HISTORY
     ============================================================ */
  function renderBillHistory() {
    const el = document.getElementById('billHistoryTimeline');
    if (!state.bills.length) {
      el.innerHTML = '<div class="empty-state">No bills on file for this patient yet.</div>';
      return;
    }
    el.innerHTML = state.bills.map((bill) => `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${formatDate(bill.created_at)}</span>
          <span class="bill-badge" data-status="${escapeHtml(bill.status || '')}">${escapeHtml(formatStatus(bill.status))}</span>
        </div>
        <div class="timeline-note">
          <span class="bill-history-total">${formatCurrency(bill.total_amount)}</span>
          ${Number(bill.amount_paid) > 0 ? ` · Paid ${formatCurrency(bill.amount_paid)}` : ''}
        </div>
      </div>
    `).join('');
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
  function todayRangeIso() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatCurrency(amount) {
    return `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
  }

  function formatStatus(status) {
    if (!status) return '—';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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