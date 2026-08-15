(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as dashboard.js — api.js must load first.
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
    patientPhone: null,
    bills: [],
    // billId -> { items, payments, transactions, loaded, open }
    detail: {},
    activePayBill: null,
    pollTimer: null,
    pollDeadline: null,
  };

  const STATUS_LABEL = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', void: 'Void' };
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 90000; // Daraja STK prompts typically resolve or expire well within this window

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPayModal();
    loadBilling();
  });

  async function loadBilling() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;
      state.patientPhone = patient.phone || '';

      document.getElementById('avatarInitials').textContent =
        initialsOf(`${patient.first_name} ${patient.last_name}`);

      const bills = await fetchMethod(`/bills/patient/${patient.id}`, 'GET', null, true);
      state.bills = bills.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      renderStats();
      renderBillList();
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
    showToast(err.message || 'Could not load your billing information. Please refresh.');
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    const balanceOf = (b) => Number(b.total_amount) - Number(b.amount_paid || 0);

    const balance = state.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'void')
      .reduce((sum, b) => sum + balanceOf(b), 0);
    document.getElementById('statBalance').textContent = formatMoney(balance);

    const paid = state.bills.reduce((sum, b) => sum + Number(b.amount_paid || 0), 0);
    document.getElementById('statPaid').textContent = formatMoney(paid);

    const pending = state.bills.filter((b) => b.status !== 'paid' && b.status !== 'void').length;
    document.getElementById('statPending').textContent = pending;

    document.getElementById('statLastPayment').textContent = 'Loading…';
    findLastPaymentDate().then((label) => {
      document.getElementById('statLastPayment').textContent = label;
    });
  }

  // Payments live per-bill, so the "last payment" stat has to check each bill's
  // payment history rather than a single endpoint. Cheap enough at portfolio-per-patient scale.
  async function findLastPaymentDate() {
    if (!state.bills.length) return '—';
    try {
      const allPayments = await Promise.all(
        state.bills.map((b) => fetchMethod(`/payments/bill/${b.id}`, 'GET', null, true).catch(() => []))
      );
      const flat = allPayments.flat();
      if (!flat.length) return '—';
      flat.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
      const d = new Date(flat[0].paid_at);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    } catch {
      return '—';
    }
  }

  /* ============================================================
     BILL LIST
     ============================================================ */
  function renderBillList() {
    const list = document.getElementById('billList');
    list.innerHTML = '';

    if (!state.bills.length) {
      list.innerHTML = '<div class="empty-state">No bills on record yet.</div>';
      return;
    }

    state.bills.forEach((bill) => {
      const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
      const created = new Date(bill.created_at);
      const day = created.getDate();
      const month = created.toLocaleString('en-US', { month: 'short' });
      const status = STATUS_LABEL[bill.status] ? bill.status : 'unpaid';
      const isOpen = !!(state.detail[bill.id] && state.detail[bill.id].open);

      const card = document.createElement('div');
      card.className = 'bill-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-bill-id', bill.id);
      card.innerHTML = `
        <div class="bill-head" data-action="toggle" data-id="${bill.id}">
          <div class="bill-id-block"><div class="d">${day}</div><div class="m">${month}</div></div>
          <div class="bill-mid">
            <p class="t">Bill #${shortId(bill.id)}</p>
            <p class="s">${escapeHtml(formatDate(bill.created_at))}${bill.appointment_id ? ' · Linked to appointment' : ''}</p>
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

    // Re-render bodies for any bills already expanded (e.g. after a payment refresh)
    Object.keys(state.detail).forEach((billId) => {
      if (state.detail[billId].open && state.detail[billId].loaded) {
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
      body.innerHTML = '<p class="bill-body-empty">Could not load this bill\'s details.</p>';
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

    const itemsHtml = d.items.length
      ? d.items.map((it) => `
          <div class="line-row">
            <span class="desc">${escapeHtml(it.description || 'Service')}<span class="qty">× ${it.quantity}</span></span>
            <span class="amt">${formatMoney(Number(it.quantity) * Number(it.unit_price))}</span>
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

    const pendingTxn = d.transactions.find((t) => t.status === 'pending');
    const txnHtml = d.transactions.length
      ? d.transactions.slice(0, 3).map((t) => `
          <div class="pay-row">
            <span>M-Pesa · ${escapeHtml(formatDate(t.created_at))}${t.mpesa_receipt ? ' · ' + escapeHtml(t.mpesa_receipt) : ''}</span>
            <span class="badge badge-${t.status === 'success' ? 'success' : t.status === 'failed' ? 'failed' : 'pending'}">${capitalize(t.status)}</span>
          </div>
        `).join('')
      : '';

    body.innerHTML = `
      <div class="bill-section">
        <p class="bill-section-title">Line items</p>
        ${itemsHtml}
      </div>
      <div class="bill-section">
        <p class="bill-section-title">Payment history</p>
        ${paymentsHtml}
      </div>
      ${txnHtml ? `<div class="bill-section"><p class="bill-section-title">M-Pesa activity</p>${txnHtml}</div>` : ''}
      ${bill.status !== 'void' && balance > 0 ? `
        <div class="bill-actions">
          <button class="btn btn-primary btn-sm" data-action="pay" data-id="${bill.id}"
            ${pendingTxn ? 'disabled title="A payment is already in progress for this bill"' : ''}>
            Pay ${formatMoney(balance)} via M-Pesa
          </button>
        </div>
      ` : ''}
    `;

    const payBtn = body.querySelector('[data-action="pay"]');
    if (payBtn) payBtn.addEventListener('click', () => openPayModal(bill.id));
  }

  /* ============================================================
     M-PESA PAY MODAL
     ============================================================ */
  function initPayModal() {
    const scrim = document.getElementById('payModalScrim');
    document.getElementById('payModalClose').addEventListener('click', closePayModal);
    document.getElementById('payCancel').addEventListener('click', closePayModal);
    document.getElementById('payWaitingCancel').addEventListener('click', closePayModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closePayModal(); });
    document.getElementById('paySubmit').addEventListener('click', submitStkPush);
  }

  function openPayModal(billId) {
    const bill = state.bills.find((b) => String(b.id) === String(billId));
    if (!bill) return;
    const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);

    state.activePayBill = billId;

    document.getElementById('payFormView').style.display = 'block';
    document.getElementById('payWaitingView').style.display = 'none';

    document.getElementById('paySummary').innerHTML = `
      <div class="pay-summary-row"><span>Bill</span><b>#${shortId(bill.id)}</b></div>
      <div class="pay-summary-row"><span>Total</span><b>${formatMoney(bill.total_amount)}</b></div>
      <div class="pay-summary-row"><span>Amount due</span><b>${formatMoney(balance)}</b></div>
    `;

    document.getElementById('payPhone').value = state.patientPhone || '';
    document.getElementById('payAmount').value = balance > 0 ? Math.round(balance) : '';
    document.getElementById('payAmount').max = String(Math.round(balance));

    const submitBtn = document.getElementById('paySubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send STK push';

    document.getElementById('payModalScrim').classList.add('is-open');
  }

  function closePayModal() {
    document.getElementById('payModalScrim').classList.remove('is-open');
    stopPolling();
    state.activePayBill = null;
  }

  async function submitStkPush() {
    const phone = document.getElementById('payPhone').value.trim();
    const amount = Number(document.getElementById('payAmount').value);
    const billId = state.activePayBill;

    if (!phone) return showToast('Enter the M-Pesa phone number to charge');
    if (!amount || amount <= 0) return showToast('Enter a valid amount');

    const submitBtn = document.getElementById('paySubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetchMethod('/mpesa/initiate', 'POST', {
        bill_id: billId,
        phone,
        amount,
      }, true);

      document.getElementById('payFormView').style.display = 'none';
      document.getElementById('payWaitingView').style.display = 'block';
      document.getElementById('waitingHeadline').textContent = 'Waiting for confirmation…';
      document.getElementById('waitingSub').textContent = 'Enter your M-Pesa PIN on the prompt sent to your phone.';

      startPolling(res.transaction.checkout_request_id, billId);
    } catch (err) {
      showToast(err.message || 'Could not start the M-Pesa payment');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send STK push';
    }
  }

  function startPolling(checkoutRequestId, billId) {
    stopPolling();
    state.pollDeadline = Date.now() + POLL_TIMEOUT_MS;

    const poll = async () => {
      if (Date.now() > state.pollDeadline) {
        document.getElementById('waitingHeadline').textContent = 'Still waiting…';
        document.getElementById('waitingSub').textContent =
          'This is taking longer than usual. Check the bill in a moment — the payment may still land.';
        stopPolling();
        return;
      }

      try {
        const txn = await fetchMethod(`/mpesa/status/${checkoutRequestId}`, 'GET', null, true);

        if (txn.status === 'success') {
          stopPolling();
          document.getElementById('waitingHeadline').textContent = 'Payment received';
          document.getElementById('waitingSub').textContent = 'Your bill has been updated.';
          document.querySelector('.mpesa-spinner').style.display = 'none';

          delete state.detail[billId]; // force a fresh reload of items/payments/txns
          await loadBilling();
          if (state.detail[billId]) state.detail[billId].open = true;
          renderBillList();

          setTimeout(() => { closePayModal(); showToast('Payment received — thank you!'); }, 1400);
          return;
        }

        if (txn.status === 'failed') {
          stopPolling();
          document.getElementById('waitingHeadline').textContent = 'Payment not completed';
          document.getElementById('waitingSub').textContent = txn.result_desc || 'The M-Pesa prompt was cancelled or timed out. You can try again.';
          document.querySelector('.mpesa-spinner').style.display = 'none';
          return;
        }

        state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
    const spinner = document.querySelector('.mpesa-spinner');
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
})();