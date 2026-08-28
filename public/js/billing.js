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
    providers: [],
    providerMap: {},
    // billId -> { items, payments, transactions, claim, loaded, open }
    detail: {},
    activePayBill: null,
    activeClaimBill: null,
    pollTimer: null,
    pollDeadline: null,
  };

  const STATUS_LABEL = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', void: 'Void' };

  // Claim statuses a patient can start a fresh claim over — 'rejected' lets them
  // try again (different provider, corrected policy number); every other status
  // means a claim is already active for that bill.
  const CLAIM_LABEL = {
    draft: 'Submitted — pending review',
    submitted: 'Submitted to insurer',
    under_review: 'Under review',
    approved: 'Approved',
    partially_approved: 'Partially approved',
    rejected: 'Rejected',
    paid: 'Paid by insurer',
  };
  const CLAIM_RESUBMITTABLE_STATUSES = ['rejected'];

  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 90000; // Daraja STK prompts typically resolve or expire well within this window

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPayModal();
    initClaimModal();
    initStatementButton();
    loadBilling();
  });

  function initStatementButton() {
    const btn = document.getElementById('downloadStatementBtn');
    if (btn) btn.addEventListener('click', () => downloadStatementPdf());
  }

  async function downloadStatementPdf() {
    if (!state.patientId) return;
    await downloadPdf(`/bills/patient/${state.patientId}/statement/pdf`, `statement.pdf`);
  }

  async function downloadBillPdf(billId) {
    await downloadPdf(`/bills/${billId}/pdf`, `invoice-${shortId(billId)}.pdf`);
  }

  // Shared PDF-download helper: fetchMethod isn't used here because it
  // expects a JSON body, not a binary blob. This hits the API directly with
  // the same bearer token fetchMethod uses, then triggers a normal browser
  // "Save As" via a throwaway <a> — matches the "download then print" flow
  // the receptionist asked for (patient's own browser/PDF viewer handles print).
  //
  // ASSUMPTION: reuses whatever token key api.js's fetchMethod reads from
  // localStorage. If fetchMethod uses a different key or an auth header
  // helper, swap the `localStorage.getItem('token')` line below to match.
  async function downloadPdf(path, filename) {
    try {
      const token = localStorage.getItem('jino_token');
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Could not generate the PDF. Please try again.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || 'Could not download the PDF');
    }
  }

  async function loadBilling() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;
      state.patientPhone = patient.phone || '';

      renderTopbarAvatar(`${patient.first_name} ${patient.last_name}`, await fetchProfilePhotoUrl(patient.id));

      const [bills, providers] = await Promise.all([
        fetchMethod(`/bills/patient/${patient.id}`, 'GET', null, true),
        fetchMethod('/insurance-providers', 'GET', null, true).catch(() => []),
      ]);
      state.bills = bills.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.providers = providers;
      state.providerMap = Object.fromEntries(providers.map((p) => [String(p.id), p.name]));

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
      const [items, payments, transactions, claim] = await Promise.all([
        fetchMethod(`/bill-items/bill/${billId}`, 'GET', null, true),
        fetchMethod(`/payments/bill/${billId}`, 'GET', null, true),
        fetchMethod(`/mpesa/bill/${billId}`, 'GET', null, true),
        fetchMethod(`/insurance-claims/bill/${billId}`, 'GET', null, true).catch(() => null),
      ]);
      state.detail[billId] = { open: true, loaded: true, items, payments, transactions, claim };
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

    const claim = d.claim;
    const claimHtml = claim ? `
      <div class="bill-section">
        <p class="bill-section-title">Insurance claim</p>
        <div class="pay-summary">
          <div class="pay-summary-row"><span>Provider</span><b>${escapeHtml(state.providerMap[String(claim.insurance_provider_id)] || 'Unknown provider')}</b></div>
          <div class="pay-summary-row"><span>Policy number</span><b>${escapeHtml(claim.policy_number)}</b></div>
          <div class="pay-summary-row"><span>Claimed</span><b>${formatMoney(claim.claim_amount)}</b></div>
          ${claim.approved_amount != null ? `<div class="pay-summary-row"><span>Approved</span><b>${formatMoney(claim.approved_amount)}</b></div>` : ''}
          <div class="pay-summary-row"><span>Status</span><span class="badge badge-${claim.status}">${CLAIM_LABEL[claim.status] || capitalize(claim.status)}</span></div>
        </div>
      </div>
    ` : '';

    const canStartClaim = !claim || CLAIM_RESUBMITTABLE_STATUSES.includes(claim.status);

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
      ${claimHtml}
      <div class="bill-actions">
        ${bill.status !== 'void' && balance > 0 ? `
          <button class="btn btn-primary btn-sm" data-action="pay" data-id="${bill.id}"
            ${pendingTxn ? 'disabled title="A payment is already in progress for this bill"' : ''}>
            Pay ${formatMoney(balance)} via M-Pesa
          </button>
          ${canStartClaim ? `
            <button class="btn btn-outline btn-sm" data-action="claim" data-id="${bill.id}">
              ${claim ? 'Submit a new claim' : 'Pay with insurance'}
            </button>
          ` : ''}
        ` : ''}
        <button class="btn btn-outline btn-sm" data-action="print-bill" data-id="${bill.id}">
          Download invoice
        </button>
      </div>
    `;

    const payBtn = body.querySelector('[data-action="pay"]');
    if (payBtn) payBtn.addEventListener('click', () => openPayModal(bill.id));

    const claimBtn = body.querySelector('[data-action="claim"]');
    if (claimBtn) claimBtn.addEventListener('click', () => openClaimModal(bill.id));

    const printBtn = body.querySelector('[data-action="print-bill"]');
    if (printBtn) printBtn.addEventListener('click', () => downloadBillPdf(bill.id));
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
     INSURANCE CLAIM MODAL
     Submitting here only ever creates a 'draft' claim (the DB column
     default) — front desk staff review and submit it to the insurer from
     their side. Unlike M-Pesa there's no external prompt to wait on, so
     this is a single request/response, no polling.
     ============================================================ */
  function initClaimModal() {
    const scrim = document.getElementById('claimModalScrim');
    document.getElementById('claimModalClose').addEventListener('click', closeClaimModal);
    document.getElementById('claimCancel').addEventListener('click', closeClaimModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeClaimModal(); });
    document.getElementById('claimSubmit').addEventListener('click', submitClaim);
  }

  function openClaimModal(billId) {
    const bill = state.bills.find((b) => String(b.id) === String(billId));
    if (!bill) return;
    const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);

    state.activeClaimBill = billId;

    document.getElementById('claimSummary').innerHTML = `
      <div class="pay-summary-row"><span>Bill</span><b>#${shortId(bill.id)}</b></div>
      <div class="pay-summary-row"><span>Amount due</span><b>${formatMoney(balance)}</b></div>
    `;

    const providerSelect = document.getElementById('claimProvider');
    providerSelect.innerHTML = state.providers.length
      ? state.providers.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">No providers on file — contact the clinic</option>';

    document.getElementById('claimPolicyNumber').value = '';
    document.getElementById('claimAmount').value = balance > 0 ? Math.round(balance) : '';
    document.getElementById('claimAmount').max = String(Math.round(balance));

    const submitBtn = document.getElementById('claimSubmit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit claim';

    document.getElementById('claimModalScrim').classList.add('is-open');
  }

  function closeClaimModal() {
    document.getElementById('claimModalScrim').classList.remove('is-open');
    state.activeClaimBill = null;
  }

  async function submitClaim() {
    const billId = state.activeClaimBill;
    const insurance_provider_id = document.getElementById('claimProvider').value;
    const policy_number = document.getElementById('claimPolicyNumber').value.trim();
    const claim_amount = Number(document.getElementById('claimAmount').value);

    if (!insurance_provider_id) return showToast('Select an insurance provider');
    if (!policy_number) return showToast('Enter the policy number');
    if (!claim_amount || claim_amount <= 0) return showToast('Enter a valid claim amount');

    const submitBtn = document.getElementById('claimSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      await fetchMethod('/insurance-claims', 'POST', {
        bill_id: billId,
        insurance_provider_id,
        policy_number,
        claim_amount,
      }, true);

      closeClaimModal();
      showToast('Claim submitted — our team will review and send it to your insurer.');

      delete state.detail[billId]; // force a fresh reload so the new claim shows up
      await loadBilling();
      if (state.detail[billId]) state.detail[billId].open = true;
      else state.detail[billId] = { open: true, loaded: false };
      renderBillList();
      await loadBillDetail(billId);
    } catch (err) {
      showToast(err.message || 'Could not submit the insurance claim');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit claim';
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

  // file_type is a Postgres enum without a 'profile_picture' value, so the
  // profile photo is stored as file_type: 'photo' + description: 'Profile
  // Picture' (see profile.js) and found the same way here.
  async function fetchProfilePhotoUrl(patientId) {
    try {
      const files = await fetchMethod(`/patient-files/patient/${patientId}`, 'GET', null, true);
      const photo = files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
      return photo ? photo.file_url : null;
    } catch {
      return null;
    }
  }

  function renderTopbarAvatar(name, photoUrl) {
    const el = document.getElementById('avatarInitials');
    if (photoUrl) {
      el.innerHTML = `<img src="${escapeAttr(photoUrl)}" alt="Profile photo">`;
    } else {
      el.textContent = initialsOf(name);
    }
  }
})();