(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as adminBilling.js — api.js must load first.
     Payment/STK actions are backend-enforced per role (see
     billRoutes/paymentRoutes/mpesaRoutes); this just keeps
     non-receptionists off the page. Note: voiding a bill is
     admin-only (billRoutes: authorizeRoles('admin')), so this
     page never renders a void action — a receptionist calling
     that endpoint would get a 403 anyway.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'receptionist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    bills: [],
    patients: [],
    patientMap: {},   // id -> { name, phone }
    staffMap: {},      // id -> name
    detail: {},        // billId -> { items, payments, transactions, loaded, open }
    activeFilter: 'all',
    searchTerm: '',
    activePayBill: null,
    activeStkBill: null,
    pollTimer: null,
    pollDeadline: null,
    newBillItemSeq: 0,
  };

  const STATUSES = ['draft', 'unpaid', 'partially_paid', 'paid', 'void'];
  const STATUS_LABEL = { draft: 'Draft', unpaid: 'Unpaid', partially_paid: 'Partial', paid: 'Paid', void: 'Void' };
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 90000; // Daraja STK prompts typically resolve or expire well within this window

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initToolbar();
    initNewBillModal();
    initRecordPayModal();
    initStkModal();
    loadBilling();
  });

  async function loadBilling() {
    try {
      renderTopbarAvatar();

      const [statusResults, patients, staff] = await Promise.all([
        Promise.all(STATUSES.map((s) => fetchMethod(`/bills/status/${s}`, 'GET', null, true).catch(() => []))),
        fetchMethod('/patients', 'GET', null, true).catch(() => []),
        fetchMethod('/staff', 'GET', null, true).catch(() => []),
      ]);

      state.bills = statusResults.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      state.patients = patients;
      state.patientMap = Object.fromEntries(
        patients.map((p) => [String(p.id), { name: `${p.first_name} ${p.last_name}`.trim(), phone: p.phone || '' }])
      );
      state.staffMap = Object.fromEntries(
        staff.map((s) => [String(s.id), `${s.first_name} ${s.last_name}`.trim()])
      );

      renderStats();
      renderBillList();
      populateNewBillPatientSelect();
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
    showToast(err.message || 'Could not load billing data. Please refresh.');
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
    const balanceOf = (b) => Number(b.total_amount) - Number(b.amount_paid || 0);

    const outstanding = state.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'void')
      .reduce((sum, b) => sum + balanceOf(b), 0);
    document.getElementById('statOutstanding').textContent = formatMoney(outstanding);

    const collected = state.bills
      .filter((b) => b.status !== 'void')
      .reduce((sum, b) => sum + Number(b.amount_paid || 0), 0);
    document.getElementById('statCollected').textContent = formatMoney(collected);

    const unpaidCount = state.bills.filter((b) => b.status === 'unpaid' || b.status === 'partially_paid').length;
    document.getElementById('statUnpaid').textContent = unpaidCount;

    document.getElementById('statTotalBills').textContent = state.bills.length;
  }

  /* ============================================================
     TOOLBAR — status tabs + search
     ============================================================ */
  function initToolbar() {
    document.querySelectorAll('#statusTabs .filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#statusTabs .filter-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        state.activeFilter = tab.getAttribute('data-status');
        renderBillList();
      });
    });

    const search = document.getElementById('billSearch');
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.searchTerm = search.value.trim().toLowerCase();
        renderBillList();
      }, 180);
    });
  }

  function visibleBills() {
    return state.bills.filter((bill) => {
      if (state.activeFilter !== 'all' && bill.status !== state.activeFilter) return false;
      if (!state.searchTerm) return true;
      const patient = state.patientMap[String(bill.patient_id)];
      const patientName = patient ? patient.name.toLowerCase() : '';
      const idMatch = String(bill.id).toLowerCase().includes(state.searchTerm);
      return patientName.includes(state.searchTerm) || idMatch;
    });
  }

  /* ============================================================
     BILL LIST
     ============================================================ */
  function renderBillList() {
    const list = document.getElementById('billList');
    list.innerHTML = '';

    const bills = visibleBills();

    if (!bills.length) {
      list.innerHTML = '<div class="empty-state">No bills match this view.</div>';
      return;
    }

    bills.forEach((bill) => {
      const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
      const created = new Date(bill.created_at);
      const day = created.getDate();
      const month = created.toLocaleString('en-US', { month: 'short' });
      const status = STATUS_LABEL[bill.status] ? bill.status : 'unpaid';
      const isOpen = !!(state.detail[bill.id] && state.detail[bill.id].open);

      const patient = state.patientMap[String(bill.patient_id)];
      const patientName = patient ? patient.name : `Patient #${shortId(bill.patient_id)}`;
      const dentistName = state.staffMap[String(bill.created_by)] || `Staff #${shortId(bill.created_by)}`;

      const card = document.createElement('div');
      card.className = 'bill-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-bill-id', bill.id);
      card.innerHTML = `
        <div class="bill-head" data-action="toggle" data-id="${bill.id}">
          <div class="bill-id-block"><div class="d">${day}</div><div class="m">${month}</div></div>
          <div class="bill-mid">
            <p class="t">${escapeHtml(patientName)}</p>
            <p class="s">Bill #${shortId(bill.id)}${bill.appointment_id ? ' · Linked to appointment' : ''}</p>
            <p class="staff-line">Created by <b>${escapeHtml(dentistName)}</b></p>
          </div>
          <span class="badge badge-${status}">${STATUS_LABEL[status] || capitalize(status)}</span>
          <div class="bill-amounts">
            <p class="total">${formatMoney(bill.total_amount)}</p>
            <p class="balance ${balance > 0 && status !== 'void' ? 'has-due' : ''}">
              ${status === 'void' ? 'Voided' : balance > 0 ? formatMoney(balance) + ' due' : 'Settled'}
            </p>
          </div>
          <svg class="bill-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="bill-body" id="billBody-${bill.id}">
          <p class="bill-body-empty">Loading details…</p>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleBill(head.getAttribute('data-id')));
    });

    Object.keys(state.detail).forEach((billId) => {
      if (state.detail[billId].open && state.detail[billId].loaded && document.getElementById(`billBody-${billId}`)) {
        renderBillBody(billId);
      }
    });
  }

  async function toggleBill(billId) {
    const card = document.querySelector(`.bill-card[data-bill-id="${billId}"]`);
    if (!card) return;

    if (!state.detail[billId]) state.detail[billId] = { open: false, loaded: false };
    const d = state.detail[billId];
    d.open = !d.open;
    card.classList.toggle('is-open', d.open);

    if (d.open && !d.loaded) {
      await loadBillDetail(billId);
    }
  }

  async function loadBillDetail(billId) {
    const body = document.getElementById(`billBody-${billId}`);
    try {
      const [items, payments, transactions] = await Promise.all([
        fetchMethod(`/bill-items/bill/${billId}`, 'GET', null, true),
        fetchMethod(`/payments/bill/${billId}`, 'GET', null, true),
        fetchMethod(`/mpesa/bill/${billId}`, 'GET', null, true),
      ]);
      state.detail[billId] = { open: true, loaded: true, items, payments, transactions };
      renderBillBody(billId);
    } catch (err) {
      if (body) body.innerHTML = '<p class="bill-body-empty">Could not load this bill\'s details.</p>';
      showToast(err.message || 'Could not load bill details');
    }
  }

  function renderBillBody(billId) {
    const body = document.getElementById(`billBody-${billId}`);
    if (!body) return;
    const d = state.detail[billId];
    const bill = state.bills.find((b) => String(b.id) === String(billId));
    if (!bill || !d) return;

    const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
    const isVoid = bill.status === 'void';

    const itemsHtml = d.items.length
      ? d.items.map((it) => `
          <div class="line-row" data-item-id="${it.id}">
            <span class="desc">${escapeHtml(it.description || 'Service')}<span class="qty">× ${it.quantity}</span></span>
            <span class="amt">${formatMoney(Number(it.quantity) * Number(it.unit_price))}</span>
            ${!isVoid ? `<button class="item-remove" data-action="remove-item" data-id="${it.id}" data-bill="${bill.id}" title="Remove item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>` : ''}
          </div>
        `).join('')
      : '<p class="bill-body-empty">No line items on this bill.</p>';

    const paymentsHtml = d.payments.length
      ? d.payments.map((p) => `
          <div class="pay-row">
            <span>
              <span class="method">${escapeHtml(p.method)}</span>
              ${p.reference ? `<span class="ref"> · ${escapeHtml(p.reference)}</span>` : ''}
              <span class="ref"> · ${escapeHtml(formatDate(p.paid_at))}</span>
            </span>
            <span class="amt">+${formatMoney(p.amount)}</span>
          </div>
        `).join('')
      : '<p class="bill-body-empty">No payments recorded yet.</p>';

    const txnHtml = d.transactions.length
      ? d.transactions.slice(0, 5).map((t) => `
          <div class="pay-row">
            <span>M-Pesa · ${escapeHtml(formatDate(t.created_at))}${t.mpesa_receipt ? ' · ' + escapeHtml(t.mpesa_receipt) : ''} · ${escapeHtml(t.phone || '')}</span>
            <span class="badge badge-${t.status === 'success' ? 'success' : t.status === 'failed' ? 'failed' : 'pending'}">${capitalize(t.status)}</span>
          </div>
        `).join('')
      : '<p class="bill-body-empty">No M-Pesa activity for this bill.</p>';

    const pendingTxn = d.transactions.find((t) => t.status === 'pending');

    // No void action here — voiding a bill is admin-only (billRoutes.js:
    // authorizeRoles('admin')). Receptionists get record-payment + STK only.
    body.innerHTML = `
      <div class="bill-section">
        <p class="bill-section-title">Line items</p>
        ${itemsHtml}
        ${!isVoid ? `
          <div class="additem-row">
            <input type="text" class="field-input" placeholder="Description" id="addItemDesc-${bill.id}">
            <input type="number" class="field-input" placeholder="Qty" min="1" value="1" id="addItemQty-${bill.id}">
            <input type="number" class="field-input" placeholder="Unit price" min="0" id="addItemPrice-${bill.id}">
            <button class="btn btn-outline btn-sm" data-action="add-item" data-id="${bill.id}">Add</button>
          </div>
        ` : ''}
      </div>
      <div class="bill-section">
        <p class="bill-section-title">Payment history</p>
        ${paymentsHtml}
      </div>
      <div class="bill-section">
        <p class="bill-section-title">M-Pesa activity</p>
        ${txnHtml}
      </div>
      ${!isVoid ? `
        <div class="bill-actions">
          <button class="btn btn-primary btn-sm" data-action="record-pay" data-id="${bill.id}" ${balance <= 0 ? 'disabled' : ''}>
            Record payment
          </button>
          <button class="btn btn-mpesa btn-sm" data-action="stk" data-id="${bill.id}"
            ${balance <= 0 || pendingTxn ? 'disabled' : ''}
            ${pendingTxn ? 'title="A payment is already in progress for this bill"' : ''}>
            Send STK push
          </button>
        </div>
      ` : ''}
    `;

    const addItemBtn = body.querySelector('[data-action="add-item"]');
    if (addItemBtn) addItemBtn.addEventListener('click', () => addLineItem(bill.id));

    body.querySelectorAll('[data-action="remove-item"]').forEach((btn) => {
      btn.addEventListener('click', () => removeLineItem(btn.getAttribute('data-id'), bill.id));
    });

    const payBtn = body.querySelector('[data-action="record-pay"]');
    if (payBtn) payBtn.addEventListener('click', () => openRecordPayModal(bill.id));

    const stkBtn = body.querySelector('[data-action="stk"]');
    if (stkBtn) stkBtn.addEventListener('click', () => openStkModal(bill.id));
  }

  /* ============================================================
     LINE ITEMS
     ============================================================ */
  async function addLineItem(billId) {
    const desc = document.getElementById(`addItemDesc-${billId}`).value.trim();
    const quantity = Number(document.getElementById(`addItemQty-${billId}`).value);
    const unit_price = Number(document.getElementById(`addItemPrice-${billId}`).value);

    if (!desc) return showToast('Enter a description for the line item');
    if (!quantity || quantity <= 0) return showToast('Enter a valid quantity');
    if (!unit_price || unit_price < 0) return showToast('Enter a valid unit price');

    try {
      await fetchMethod('/bill-items', 'POST', { bill_id: billId, description: desc, quantity, unit_price }, true);
      delete state.detail[billId];
      state.detail[billId] = { open: true, loaded: false };
      await refreshBillsAndKeepOpen(billId);
      showToast('Line item added');
    } catch (err) {
      showToast(err.message || 'Could not add the line item');
    }
  }

  async function removeLineItem(itemId, billId) {
    try {
      await fetchMethod(`/bill-items/${itemId}`, 'DELETE', null, true);
      delete state.detail[billId];
      state.detail[billId] = { open: true, loaded: false };
      await refreshBillsAndKeepOpen(billId);
      showToast('Line item removed');
    } catch (err) {
      showToast(err.message || 'Could not remove the line item');
    }
  }

  // Reloads bill totals (trigger-maintained) plus the open bill's detail,
  // without collapsing whatever else the receptionist has expanded.
  async function refreshBillsAndKeepOpen(billId) {
    try {
      const statusResults = await Promise.all(
        STATUSES.map((s) => fetchMethod(`/bills/status/${s}`, 'GET', null, true).catch(() => []))
      );
      state.bills = statusResults.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      renderStats();
      renderBillList();
      await loadBillDetail(billId);
    } catch (err) {
      showToast(err.message || 'Could not refresh billing data');
    }
  }

  /* ============================================================
     NEW BILL MODAL
     ============================================================ */
  function initNewBillModal() {
    const scrim = document.getElementById('newBillModalScrim');
    document.getElementById('newBillBtn').addEventListener('click', openNewBillModal);
    document.getElementById('newBillClose').addEventListener('click', closeNewBillModal);
    document.getElementById('newBillCancel').addEventListener('click', closeNewBillModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeNewBillModal(); });
    document.getElementById('newBillAddItemRow').addEventListener('click', () => addNewBillItemRow());
    document.getElementById('newBillSubmit').addEventListener('click', submitNewBill);
  }

  function populateNewBillPatientSelect() {
    const select = document.getElementById('newBillPatient');
    if (!select) return;
    select.innerHTML = state.patients.length
      ? state.patients.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(`${p.first_name} ${p.last_name}`)}</option>`).join('')
      : '<option value="">No patients found</option>';
  }

  function openNewBillModal() {
    document.getElementById('newBillAppointment').value = '';
    const itemsWrap = document.getElementById('newBillItems');
    itemsWrap.innerHTML = '';
    state.newBillItemSeq = 0;
    addNewBillItemRow();

    const submitBtn = document.getElementById('newBillSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create bill';

    document.getElementById('newBillModalScrim').classList.add('is-open');
  }

  function closeNewBillModal() {
    document.getElementById('newBillModalScrim').classList.remove('is-open');
  }

  function addNewBillItemRow() {
    const rowId = `nbItem-${state.newBillItemSeq++}`;
    const wrap = document.getElementById('newBillItems');
    const row = document.createElement('div');
    row.className = 'newbill-item-row';
    row.setAttribute('data-row-id', rowId);
    row.innerHTML = `
      <input type="text" class="field-input" placeholder="Description" id="${rowId}-desc">
      <input type="number" class="field-input" placeholder="Qty" min="1" value="1" id="${rowId}-qty">
      <input type="number" class="field-input" placeholder="Unit price" min="0" id="${rowId}-price">
      <button class="item-remove" type="button" title="Remove row">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    `;
    row.querySelector('.item-remove').addEventListener('click', () => row.remove());
    wrap.appendChild(row);
  }

  async function submitNewBill() {
    const patient_id = document.getElementById('newBillPatient').value;
    const appointment_id = document.getElementById('newBillAppointment').value.trim() || null;

    if (!patient_id) return showToast('Select a patient');

    const rows = Array.from(document.querySelectorAll('#newBillItems .newbill-item-row'));
    const items = [];
    for (const row of rows) {
      const rowId = row.getAttribute('data-row-id');
      const desc = document.getElementById(`${rowId}-desc`).value.trim();
      const qty = Number(document.getElementById(`${rowId}-qty`).value);
      const price = Number(document.getElementById(`${rowId}-price`).value);
      if (!desc && !qty && !price) continue; // skip fully blank rows
      if (!desc) return showToast('Every line item needs a description');
      if (!qty || qty <= 0) return showToast('Every line item needs a valid quantity');
      if (price === '' || isNaN(price) || price < 0) return showToast('Every line item needs a valid unit price');
      items.push({ description: desc, quantity: qty, unit_price: price });
    }

    const submitBtn = document.getElementById('newBillSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      const bill = await fetchMethod('/bills', 'POST', { patient_id, appointment_id }, true);

      for (const item of items) {
        await fetchMethod('/bill-items', 'POST', { bill_id: bill.id, ...item }, true);
      }

      closeNewBillModal();
      showToast('Bill created');
      await loadBilling();
    } catch (err) {
      showToast(err.message || 'Could not create the bill');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create bill';
    }
  }

  /* ============================================================
     RECORD PAYMENT MODAL (cash / card / bank_transfer / insurance)
     ============================================================ */
  function initRecordPayModal() {
    const scrim = document.getElementById('recordPayModalScrim');
    document.getElementById('recordPayClose').addEventListener('click', closeRecordPayModal);
    document.getElementById('recordPayCancel').addEventListener('click', closeRecordPayModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeRecordPayModal(); });
    document.getElementById('recordPaySubmit').addEventListener('click', submitRecordPay);
  }

  function openRecordPayModal(billId) {
    const bill = state.bills.find((b) => String(b.id) === String(billId));
    if (!bill) return;
    const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
    const patient = state.patientMap[String(bill.patient_id)];

    state.activePayBill = billId;

    document.getElementById('recordPaySummary').innerHTML = `
      <div class="pay-summary-row"><span>Patient</span><b>${escapeHtml(patient ? patient.name : 'Unknown')}</b></div>
      <div class="pay-summary-row"><span>Bill</span><b>#${shortId(bill.id)}</b></div>
      <div class="pay-summary-row"><span>Amount due</span><b>${formatMoney(balance)}</b></div>
    `;

    document.getElementById('recordPayMethod').value = 'cash';
    document.getElementById('recordPayAmount').value = balance > 0 ? Math.round(balance) : '';
    document.getElementById('recordPayReference').value = '';

    const submitBtn = document.getElementById('recordPaySubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Record payment';

    document.getElementById('recordPayModalScrim').classList.add('is-open');
  }

  function closeRecordPayModal() {
    document.getElementById('recordPayModalScrim').classList.remove('is-open');
    state.activePayBill = null;
  }

  async function submitRecordPay() {
    const billId = state.activePayBill;
    const method = document.getElementById('recordPayMethod').value;
    const amount = Number(document.getElementById('recordPayAmount').value);
    const reference = document.getElementById('recordPayReference').value.trim() || null;

    if (!amount || amount <= 0) return showToast('Enter a valid amount');

    const submitBtn = document.getElementById('recordPaySubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Recording…';

    try {
      await fetchMethod('/payments', 'POST', { bill_id: billId, amount, method, reference }, true);
      closeRecordPayModal();
      showToast('Payment recorded');
      await refreshBillsAndKeepOpen(billId);
    } catch (err) {
      showToast(err.message || 'Could not record the payment');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Record payment';
    }
  }

  /* ============================================================
     STK PUSH MODAL — Safaricom themed (receptionist-initiated)
     ============================================================ */
  function initStkModal() {
    const scrim = document.getElementById('stkModalScrim');
    document.getElementById('stkModalClose').addEventListener('click', closeStkModal);
    document.getElementById('stkCancel').addEventListener('click', closeStkModal);
    document.getElementById('stkWaitingCancel').addEventListener('click', closeStkModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeStkModal(); });
    document.getElementById('stkSubmit').addEventListener('click', submitStkPush);
  }

  function openStkModal(billId) {
    const bill = state.bills.find((b) => String(b.id) === String(billId));
    if (!bill) return;
    const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
    const patient = state.patientMap[String(bill.patient_id)];

    state.activeStkBill = billId;

    document.getElementById('stkFormView').style.display = 'block';
    document.getElementById('stkWaitingView').style.display = 'none';

    document.getElementById('stkSummary').innerHTML = `
      <div class="pay-summary-row"><span>Patient</span><b>${escapeHtml(patient ? patient.name : 'Unknown')}</b></div>
      <div class="pay-summary-row"><span>Bill</span><b>#${shortId(bill.id)}</b></div>
      <div class="pay-summary-row"><span>Amount due</span><b>${formatMoney(balance)}</b></div>
    `;

    document.getElementById('stkPhone').value = patient ? patient.phone : '';
    document.getElementById('stkAmount').value = balance > 0 ? Math.round(balance) : '';
    document.getElementById('stkAmount').max = String(Math.round(balance));

    const submitBtn = document.getElementById('stkSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send STK push';

    document.getElementById('stkModalScrim').classList.add('is-open');
  }

  function closeStkModal() {
    document.getElementById('stkModalScrim').classList.remove('is-open');
    stopStkPolling();
    state.activeStkBill = null;
  }

  async function submitStkPush() {
    const phone = document.getElementById('stkPhone').value.trim();
    const amount = Number(document.getElementById('stkAmount').value);
    const billId = state.activeStkBill;

    if (!phone) return showToast('Enter the M-Pesa phone number to charge');
    if (!amount || amount <= 0) return showToast('Enter a valid amount');

    const submitBtn = document.getElementById('stkSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetchMethod('/mpesa/initiate', 'POST', { bill_id: billId, phone, amount }, true);

      document.getElementById('stkFormView').style.display = 'none';
      document.getElementById('stkWaitingView').style.display = 'block';
      document.getElementById('stkWaitingHeadline').textContent = 'Waiting for confirmation…';
      document.getElementById('stkWaitingSub').textContent = 'Ask the patient to enter their M-Pesa PIN on the prompt sent to their phone.';

      startStkPolling(res.transaction.checkout_request_id, billId);
    } catch (err) {
      showToast(err.message || 'Could not start the M-Pesa payment');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send STK push';
    }
  }

  function startStkPolling(checkoutRequestId, billId) {
    stopStkPolling();
    state.pollDeadline = Date.now() + POLL_TIMEOUT_MS;

    const poll = async () => {
      if (Date.now() > state.pollDeadline) {
        document.getElementById('stkWaitingHeadline').textContent = 'Still waiting…';
        document.getElementById('stkWaitingSub').textContent =
          'This is taking longer than usual. Check the bill in a moment — the payment may still land.';
        stopStkPolling();
        return;
      }

      try {
        const txn = await fetchMethod(`/mpesa/status/${checkoutRequestId}`, 'GET', null, true);

        if (txn.status === 'success') {
          stopStkPolling();
          document.getElementById('stkWaitingHeadline').textContent = 'Payment received';
          document.getElementById('stkWaitingSub').textContent = 'The bill has been updated.';
          const spinner = document.querySelector('.mpesa-spinner-green');
          if (spinner) spinner.style.display = 'none';

          delete state.detail[billId];
          await refreshBillsAndKeepOpen(billId);

          setTimeout(() => { closeStkModal(); showToast('Payment received'); }, 1400);
          return;
        }

        if (txn.status === 'failed') {
          stopStkPolling();
          document.getElementById('stkWaitingHeadline').textContent = 'Payment not completed';
          document.getElementById('stkWaitingSub').textContent = txn.result_desc || 'The M-Pesa prompt was cancelled or timed out. You can try again.';
          const spinner = document.querySelector('.mpesa-spinner-green');
          if (spinner) spinner.style.display = 'none';
          return;
        }

        state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  function stopStkPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
    const spinner = document.querySelector('.mpesa-spinner-green');
    if (spinner) spinner.style.display = '';
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

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function shortId(id) { return String(id).slice(0, 8).toUpperCase(); }

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