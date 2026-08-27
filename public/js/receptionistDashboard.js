(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD — mirrors adminDashboard.js's guard, for 'receptionist'.
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
    appointments: [],   // combined result of the per-status fetches below
    bills: [],          // draft + unpaid + partial bills, joined with patient info
    dentists: [],
    bookSelectedPatient: null,
    activeBillForModal: null,
    activeMpesaTransaction: null,
    activeApptForEdit: null,
  };

  // NOTE: there is no single "today's clinic-wide schedule" endpoint exposed
  // to the receptionist role (the admin dashboard's /admin/schedule is
  // presumably admin-only). This reuses the existing STAFF-authorized
  // GET /appointments/status/:status route once per status and filters
  // client-side. Fine for a single clinic's daily volume; if this ever gets
  // slow, the real fix is a dedicated endpoint (e.g. GET /appointments/today)
  // that filters by date in SQL instead of over the wire.
  const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled'];

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initModals();
    initTopSearch();
    loadDashboard();
  });

  /* ============================================================
     LOAD
     ============================================================ */
  async function loadDashboard() {
    try {
      document.getElementById('receptionistName').textContent = sessionUser.first_name;
      document.getElementById('greetingText').textContent = getGreeting();
      renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);

      const [apptResults, draftBills, unpaidBills, partialBills, dentists] = await Promise.all([
        Promise.all(APPOINTMENT_STATUSES.map((s) =>
          fetchMethod(`/appointments/status/${s}`, 'GET', null, true).catch(() => [])
        )),
        fetchMethod('/bills/status/draft', 'GET', null, true).catch(() => []),
        fetchMethod('/bills/status/unpaid', 'GET', null, true).catch(() => []),
        fetchMethod('/bills/status/partially_paid', 'GET', null, true).catch(() => []),
        fetchMethod('/users/dentists', 'GET', null, true).catch(() => []),
      ]);

      state.appointments = apptResults.flat();
      state.bills = [...draftBills, ...unpaidBills, ...partialBills].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
      state.dentists = dentists;

      renderStats();
      renderTodaySchedule();
      renderUpcoming();
      renderPaymentsDue();
      populateDentistList();
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
    showToast(err.message || 'Could not load the dashboard. Please refresh.');
  }

  /* ============================================================
     DATE HELPERS
     ============================================================ */
  function isToday(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function isWithinNextDays(dateStr, days) {
    const d = new Date(dateStr);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 + days);
    return d >= start && d < end;
  }

  function todaysAppointments() {
    return state.appointments
      .filter((a) => isToday(a.scheduled_start) && a.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
  }

  /* ============================================================
     STAT CARDS
     ============================================================ */
  function renderStats() {
    const today = todaysAppointments();
    const confirmed = today.filter((a) => a.status === 'confirmed').length;
    const pending = today.filter((a) => a.status === 'pending').length;
    const checkedIn = today.filter((a) => a.status === 'checked_in').length;
    const noShow = today.filter((a) => a.status === 'no_show').length;

    document.getElementById('statApptsToday').textContent = today.length;
    document.getElementById('statApptsConfirmed').textContent = confirmed;
    document.getElementById('statApptsPending').textContent = pending;
    document.getElementById('statCheckedIn').textContent = checkedIn;
    document.getElementById('statNoShows').textContent = noShow;

    const pendingTotal = state.bills.reduce(
      (sum, b) => sum + (Number(b.total_amount) - Number(b.amount_paid)), 0
    );
    document.getElementById('statPendingAmount').textContent = formatKsh(pendingTotal);
    document.getElementById('statPendingCount').textContent = state.bills.length;

    document.getElementById('alertDot').style.display = state.bills.length ? 'block' : 'none';
  }

  /* ============================================================
     TODAY'S SCHEDULE — with check-in / no-show / cancel actions
     ============================================================ */
  function renderTodaySchedule() {
    const list = document.getElementById('schedList');
    list.innerHTML = '';

    const today = todaysAppointments();
    if (!today.length) {
      list.innerHTML = '<div class="empty-state">No appointments booked today.</div>';
      return;
    }

    today.forEach((appt) => {
      list.appendChild(buildScheduleRow(appt, true));
    });
  }

  function renderUpcoming() {
    const list = document.getElementById('upcomingList');
    list.innerHTML = '';

    const upcoming = state.appointments
      .filter((a) => isWithinNextDays(a.scheduled_start, 3) && a.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

    if (!upcoming.length) {
      list.innerHTML = '<div class="empty-state">Nothing booked in the next 3 days.</div>';
      return;
    }

    upcoming.forEach((appt) => {
      list.appendChild(buildScheduleRow(appt, false));
    });
  }

  function buildScheduleRow(appt, withActions) {
    const patientName = `${appt.patient_first_name} ${appt.patient_last_name}`;
    const dentistName = `Dr. ${appt.dentist_last_name}`;
    const time = new Date(appt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const row = document.createElement('div');
    row.className = 'sched-item';
    row.innerHTML = `
      <div class="sched-time">${escapeHtml(time)}</div>
      <div class="sched-avatar">${initialsOf(patientName)}</div>
      <div class="sched-mid">
        <p class="t">${escapeHtml(patientName)}</p>
        <p class="s">${escapeHtml(dentistName)}${appt.room ? ' · ' + escapeHtml(appt.room) : ''}</p>
      </div>
      <div class="sched-flags">
        <span class="badge badge-${appt.status}">${capitalize(appt.status.replace('_', ' '))}</span>
      </div>
    `;

    if (!['completed', 'cancelled', 'no_show'].includes(appt.status)) {
      const actions = document.createElement('div');
      actions.className = 'sched-actions';

      if (withActions && appt.status !== 'checked_in') {
        actions.appendChild(makeActionBtn('Check in', () => setApptStatus(appt.id, 'checked_in')));
      }
      if (withActions) {
        actions.appendChild(makeActionBtn('No-show', () => setApptStatus(appt.id, 'no_show')));
      }
      actions.appendChild(makeActionBtn('Edit', () => openEditApptModal(appt)));
      actions.appendChild(makeActionBtn('Cancel', () => cancelAppt(appt.id)));

      row.appendChild(actions);
    }

    return row;
  }

  function makeActionBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sched-action-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  async function setApptStatus(id, status) {
    try {
      // NOTE: 'checked_in' assumes the Appointment.status check constraint
      // (or enum, wherever it's defined in schema.sql) already permits this
      // value. setStatus itself does no allow-listing, so this will 500 at
      // the DB layer if 'checked_in' isn't a permitted status yet — that's a
      // one-line migration, not a code change, if it comes up.
      await fetchMethod(`/appointments/${id}/status`, 'PUT', { status }, true);
      showToast(status === 'checked_in' ? 'Patient checked in' : 'Marked as no-show');
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Could not update appointment');
    }
  }

  async function cancelAppt(id) {
    if (!confirm('Cancel this appointment?')) return;
    try {
      await fetchMethod(`/appointments/${id}`, 'DELETE', null, true);
      showToast('Appointment cancelled');
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Could not cancel appointment');
    }
  }

  /* ============================================================
     PAYMENTS DUE
     ============================================================ */
  function renderPaymentsDue() {
    const list = document.getElementById('payDueList');
    list.innerHTML = '';

    if (!state.bills.length) {
      list.innerHTML = '<div class="empty-state">No outstanding bills right now.</div>';
      return;
    }

    state.bills.forEach((bill) => {
      const patientName = `${bill.patient_first_name} ${bill.patient_last_name}`;
      const balance = Number(bill.total_amount) - Number(bill.amount_paid);

      const row = document.createElement('div');
      row.className = 'pay-due-row';
      row.innerHTML = `
        <div class="sched-avatar">${initialsOf(patientName)}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(patientName)}</p>
          <p class="s">Balance due · <span class="mono">${formatKsh(balance)}</span></p>
        </div>
        <div class="pay-due-actions"></div>
      `;

      const actions = row.querySelector('.pay-due-actions');

      const mpesaBtn = document.createElement('button');
      mpesaBtn.type = 'button';
      mpesaBtn.className = 'btn btn-primary btn-sm';
      mpesaBtn.textContent = 'Send M-Pesa prompt';
      mpesaBtn.addEventListener('click', () => openMpesaModal(bill, balance));

      const recordBtn = document.createElement('button');
      recordBtn.type = 'button';
      recordBtn.className = 'btn btn-outline btn-sm';
      recordBtn.textContent = 'Record payment';
      recordBtn.addEventListener('click', () => openPaymentModal(bill, balance));

      actions.appendChild(mpesaBtn);
      actions.appendChild(recordBtn);
      list.appendChild(row);
    });
  }

  /* ============================================================
     TOP-BAR PATIENT SEARCH
     ============================================================ */
  function initTopSearch() {
    const input = document.getElementById('patientSearchInput');
    const results = document.getElementById('patientSearchResults');
    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) { results.classList.remove('is-open'); results.innerHTML = ''; return; }

      debounceTimer = setTimeout(async () => {
        try {
          const patients = await fetchMethod(`/patients/search?q=${encodeURIComponent(q)}`, 'GET', null, true);
          renderTopSearchResults(patients);
        } catch (err) {
          results.classList.remove('is-open');
        }
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!document.getElementById('patientSearchWrap').contains(e.target)) {
        results.classList.remove('is-open');
      }
    });

    function renderTopSearchResults(patients) {
      results.innerHTML = '';
      if (!patients.length) {
        results.innerHTML = '<div class="empty-state">No matching patients.</div>';
        results.classList.add('is-open');
        return;
      }
      patients.slice(0, 8).forEach((p) => {
        const row = document.createElement('a');
        row.href = `receptionist-patient.html?id=${p.id}`;
        row.className = 'search-result-row';
        row.innerHTML = `
          <div class="sched-avatar">${initialsOf(p.first_name + ' ' + p.last_name)}</div>
          <div class="sched-mid">
            <p class="t">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</p>
            <p class="s">${escapeHtml(p.phone || '')}</p>
          </div>
        `;
        results.appendChild(row);
      });
      results.classList.add('is-open');
    }
  }

  /* ============================================================
     MODAL: BOOK APPOINTMENT
     (Simple version — direct datetime input rather than a live slot
     picker. A proper open-slots grid needs the dentist-availability
     endpoint that appointmentController.js flags as not yet split out
     from GET /appointments/dentist/:dentistId; wire that in later.)
     ============================================================ */
  function initModals() {
    bindModal('bookModalScrim', 'btnBookAppt', 'bookModalClose', 'bookCancelBtn', resetBookModal);
    bindModal('walkinModalScrim', 'btnWalkIn', 'walkinModalClose', 'walkinCancelBtn', resetWalkinModal);
    bindModal('mpesaModalScrim', null, 'mpesaModalClose', 'mpesaCancelBtn', resetMpesaModal);
    bindModal('paymentModalScrim', null, 'paymentModalClose', 'paymentCancelBtn', resetPaymentModal);
    bindModal('editApptModalScrim', null, 'editApptModalClose', 'editApptCancelBtn', resetEditApptModal);

    document.getElementById('mpesaCloseWaitingBtn').addEventListener('click', () => closeModal('mpesaModalScrim'));

    document.getElementById('bookPatientSearch').addEventListener('input', debounce(onBookPatientSearch, 250));
    document.getElementById('bookSubmitBtn').addEventListener('click', submitBooking);
    document.getElementById('walkinSubmitBtn').addEventListener('click', submitWalkin);
    document.getElementById('mpesaSendBtn').addEventListener('click', submitMpesaPrompt);
    document.getElementById('paymentSubmitBtn').addEventListener('click', submitManualPayment);
    document.getElementById('editApptSubmitBtn').addEventListener('click', submitApptEdit);
  }

  function bindModal(scrimId, openBtnId, closeBtnId, cancelBtnId, onClose) {
    const scrim = document.getElementById(scrimId);
    if (openBtnId) document.getElementById(openBtnId).addEventListener('click', () => scrim.classList.add('is-open'));
    document.getElementById(closeBtnId).addEventListener('click', () => { scrim.classList.remove('is-open'); onClose(); });
    document.getElementById(cancelBtnId).addEventListener('click', () => { scrim.classList.remove('is-open'); onClose(); });
    scrim.addEventListener('click', (e) => { if (e.target === scrim) { scrim.classList.remove('is-open'); onClose(); } });
  }

  function closeModal(scrimId) {
    document.getElementById(scrimId).classList.remove('is-open');
  }

  async function onBookPatientSearch(e) {
    const q = e.target.value.trim();
    const container = document.getElementById('bookPatientResults');
    if (!q) { container.innerHTML = ''; return; }

    try {
      const patients = await fetchMethod(`/patients/search?q=${encodeURIComponent(q)}`, 'GET', null, true);
      container.innerHTML = '';
      patients.slice(0, 6).forEach((p) => {
        const opt = document.createElement('div');
        opt.className = 'dentist-opt';
        opt.innerHTML = `
          <div class="dentist-avatar">${initialsOf(p.first_name + ' ' + p.last_name)}</div>
          <div>
            <p class="t">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</p>
            <p class="s">${escapeHtml(p.phone || '')}</p>
          </div>
        `;
        opt.addEventListener('click', () => selectBookPatient(p));
        container.appendChild(opt);
      });
    } catch (err) {
      container.innerHTML = '';
    }
  }

  function selectBookPatient(p) {
    state.bookSelectedPatient = p;
    document.getElementById('bookPatientResults').innerHTML = '';
    document.getElementById('bookPatientSearch').value = '';
    const selectedBox = document.getElementById('bookPatientSelected');
    selectedBox.style.display = 'block';
    selectedBox.innerHTML = `
      <div class="dentist-opt is-selected">
        <div class="dentist-avatar">${initialsOf(p.first_name + ' ' + p.last_name)}</div>
        <div>
          <p class="t">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</p>
          <p class="s">${escapeHtml(p.phone || '')} · selected</p>
        </div>
      </div>
    `;
  }

  function populateDentistList() {
    const container = document.getElementById('bookDentistList');
    container.innerHTML = '';
    if (!state.dentists.length) {
      container.innerHTML = '<div class="empty-state">No dentists on staff yet.</div>';
      return;
    }
    state.dentists.forEach((d) => {
      const opt = document.createElement('div');
      opt.className = 'dentist-opt';
      opt.dataset.dentistId = d.id;
      opt.innerHTML = `
        <div class="dentist-avatar">${initialsOf(d.first_name + ' ' + d.last_name)}</div>
        <div><p class="t">Dr. ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name)}</p></div>
      `;
      opt.addEventListener('click', () => {
        container.querySelectorAll('.dentist-opt').forEach((el) => el.classList.remove('is-selected'));
        opt.classList.add('is-selected');
      });
      container.appendChild(opt);
    });
  }

  async function submitBooking() {
    const patient = state.bookSelectedPatient;
    const dentistOpt = document.querySelector('#bookDentistList .dentist-opt.is-selected');
    const start = document.getElementById('bookStart').value;
    const end = document.getElementById('bookEnd').value;
    const room = document.getElementById('bookRoom').value.trim();
    const reason = document.getElementById('bookReason').value.trim();

    if (!patient) return showToast('Select a patient first');
    if (!dentistOpt) return showToast('Select a dentist');
    if (!start || !end) return showToast('Start and end time are required');

    try {
      await fetchMethod('/appointments', 'POST', {
        patient_id: patient.id,
        dentist_id: dentistOpt.dataset.dentistId,
        scheduled_start: new Date(start).toISOString(),
        scheduled_end: new Date(end).toISOString(),
        room: room || null,
        reason: reason || null,
      }, true);
      showToast('Appointment booked');
      closeModal('bookModalScrim');
      resetBookModal();
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Could not book appointment');
    }
  }

  function resetBookModal() {
    state.bookSelectedPatient = null;
    document.getElementById('bookPatientSearch').value = '';
    document.getElementById('bookPatientResults').innerHTML = '';
    document.getElementById('bookPatientSelected').style.display = 'none';
    document.getElementById('bookPatientSelected').innerHTML = '';
    document.getElementById('bookStart').value = '';
    document.getElementById('bookEnd').value = '';
    document.getElementById('bookRoom').value = '';
    document.getElementById('bookReason').value = '';
    document.querySelectorAll('#bookDentistList .dentist-opt').forEach((el) => el.classList.remove('is-selected'));
  }

  /* ============================================================
     MODAL: EDIT APPOINTMENT
     (Reassign dentist and/or reschedule time for an existing
     appointment — mirrors the Book modal's dentist grid, but
     pre-selects the current dentist and pre-fills current times.
     Requires a general PUT /appointments/:id route on the backend;
     only /appointments/:id/status and DELETE /appointments/:id
     exist today.)
     ============================================================ */
  function openEditApptModal(appt) {
    state.activeApptForEdit = appt;
    const patientName = `${appt.patient_first_name} ${appt.patient_last_name}`;

    document.getElementById('editApptSummary').innerHTML = `
      <div class="pay-summary-row"><span>Patient</span><b>${escapeHtml(patientName)}</b></div>
      <div class="pay-summary-row"><span>Current</span><b>Dr. ${escapeHtml(appt.dentist_last_name)} · ${escapeHtml(new Date(appt.scheduled_start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</b></div>
    `;

    populateEditDentistList(appt.dentist_id);
    document.getElementById('editApptStart').value = toDatetimeLocalValue(appt.scheduled_start);
    document.getElementById('editApptEnd').value = toDatetimeLocalValue(appt.scheduled_end);
    document.getElementById('editApptRoom').value = appt.room || '';
    document.getElementById('editApptReason').value = appt.reason || '';

    document.getElementById('editApptModalScrim').classList.add('is-open');
  }

  function populateEditDentistList(selectedDentistId) {
    const container = document.getElementById('editApptDentistList');
    container.innerHTML = '';
    if (!state.dentists.length) {
      container.innerHTML = '<div class="empty-state">No dentists on staff yet.</div>';
      return;
    }
    state.dentists.forEach((d) => {
      const opt = document.createElement('div');
      opt.className = 'dentist-opt' + (String(d.id) === String(selectedDentistId) ? ' is-selected' : '');
      opt.dataset.dentistId = d.id;
      opt.innerHTML = `
        <div class="dentist-avatar">${initialsOf(d.first_name + ' ' + d.last_name)}</div>
        <div><p class="t">Dr. ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name)}</p></div>
      `;
      opt.addEventListener('click', () => {
        container.querySelectorAll('.dentist-opt').forEach((el) => el.classList.remove('is-selected'));
        opt.classList.add('is-selected');
      });
      container.appendChild(opt);
    });
  }

  async function submitApptEdit() {
    const appt = state.activeApptForEdit;
    const dentistOpt = document.querySelector('#editApptDentistList .dentist-opt.is-selected');
    const start = document.getElementById('editApptStart').value;
    const end = document.getElementById('editApptEnd').value;
    const room = document.getElementById('editApptRoom').value.trim();
    const reason = document.getElementById('editApptReason').value.trim();

    if (!dentistOpt) return showToast('Select a dentist');
    if (!start || !end) return showToast('Start and end time are required');
    if (new Date(end) <= new Date(start)) return showToast('End time must be after start time');

    try {
      await fetchMethod(`/appointments/${appt.id}`, 'PUT', {
        dentist_id: dentistOpt.dataset.dentistId,
        scheduled_start: new Date(start).toISOString(),
        scheduled_end: new Date(end).toISOString(),
        room: room || null,
        reason: reason || null,
      }, true);
      showToast('Appointment updated');
      closeModal('editApptModalScrim');
      resetEditApptModal();
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Could not update appointment');
    }
  }

  function resetEditApptModal() {
    state.activeApptForEdit = null;
    document.getElementById('editApptStart').value = '';
    document.getElementById('editApptEnd').value = '';
    document.getElementById('editApptRoom').value = '';
    document.getElementById('editApptReason').value = '';
    document.querySelectorAll('#editApptDentistList .dentist-opt').forEach((el) => el.classList.remove('is-selected'));
  }

  /* ============================================================
     MODAL: REGISTER WALK-IN PATIENT
     ============================================================ */
  async function submitWalkin() {
    const first_name = document.getElementById('wiFirstName').value.trim();
    const last_name = document.getElementById('wiLastName').value.trim();
    const phone = document.getElementById('wiPhone').value.trim();

    if (!first_name || !last_name || !phone) {
      return showToast('First name, last name, and phone are required');
    }

    const data = {
      first_name, last_name, phone,
      national_id: document.getElementById('wiNationalId').value.trim() || null,
      date_of_birth: document.getElementById('wiDob').value || null,
      email: document.getElementById('wiEmail').value.trim() || null,
      address: document.getElementById('wiAddress').value.trim() || null,
      next_of_kin_name: document.getElementById('wiKinName').value.trim() || null,
      next_of_kin_phone: document.getElementById('wiKinPhone').value.trim() || null,
      allergies: document.getElementById('wiAllergies').value.trim() || null,
    };

    try {
      await fetchMethod('/patients', 'POST', data, true);
      showToast('Patient registered');
      closeModal('walkinModalScrim');
      resetWalkinModal();
    } catch (err) {
      showToast(err.message || 'Could not register patient');
    }
  }

  function resetWalkinModal() {
    ['wiFirstName', 'wiLastName', 'wiPhone', 'wiNationalId', 'wiDob', 'wiEmail', 'wiAddress', 'wiKinName', 'wiKinPhone', 'wiAllergies']
      .forEach((id) => { document.getElementById(id).value = ''; });
  }

  /* ============================================================
     MODAL: SEND M-PESA PROMPT
     ============================================================ */
  function openMpesaModal(bill, balance) {
    state.activeBillForModal = bill;
    const patientName = `${bill.patient_first_name} ${bill.patient_last_name}`;

    document.getElementById('mpesaSummary').innerHTML = `
      <div class="pay-summary-row"><span>Patient</span><b>${escapeHtml(patientName)}</b></div>
      <div class="pay-summary-row"><span>Balance due</span><b>${formatKsh(balance)}</b></div>
    `;
    document.getElementById('mpesaPhone').value = bill.patient_phone || '';
    document.getElementById('mpesaAmount').value = balance;
    document.getElementById('mpesaFormStep').style.display = 'block';
    document.getElementById('mpesaWaitingStep').style.display = 'none';
    document.getElementById('mpesaModalScrim').classList.add('is-open');
  }

  async function submitMpesaPrompt() {
    const bill = state.activeBillForModal;
    const phone = document.getElementById('mpesaPhone').value.trim();
    const amount = Number(document.getElementById('mpesaAmount').value);

    if (!phone) return showToast('Phone number is required');
    if (!amount || amount <= 0) return showToast('Enter a valid amount');

    try {
      const res = await fetchMethod('/mpesa/initiate', 'POST', { bill_id: bill.id, phone, amount }, true);
      state.activeMpesaTransaction = res.transaction;
      document.getElementById('mpesaFormStep').style.display = 'none';
      document.getElementById('mpesaWaitingStep').style.display = 'block';
      pollMpesaStatus(res.transaction.checkout_request_id);
    } catch (err) {
      showToast(err.message || 'Could not send M-Pesa prompt');
    }
  }

  // Polls checkStatus every 4s for up to ~2 minutes. The Daraja callback
  // (mpesaController.handleCallback) is what actually confirms payment
  // server-side — this is just to let the receptionist know without
  // manually refreshing the dashboard.
  function pollMpesaStatus(checkoutRequestId) {
    let attempts = 0;
    const maxAttempts = 30;

    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const tx = await fetchMethod(`/mpesa/status/${checkoutRequestId}`, 'GET', null, true);
        if (tx.status === 'success') {
          clearInterval(interval);
          showToast('Payment received');
          closeModal('mpesaModalScrim');
          resetMpesaModal();
          loadDashboard();
        } else if (tx.status === 'failed') {
          clearInterval(interval);
          showToast(tx.result_desc || 'Payment failed or was cancelled');
          resetMpesaModal();
          document.getElementById('mpesaFormStep').style.display = 'block';
          document.getElementById('mpesaWaitingStep').style.display = 'none';
        }
      } catch (err) {
        // transient — keep polling until maxAttempts
      }

      if (attempts >= maxAttempts) clearInterval(interval);
    }, 4000);
  }

  function resetMpesaModal() {
    state.activeBillForModal = null;
    state.activeMpesaTransaction = null;
    document.getElementById('mpesaPhone').value = '';
    document.getElementById('mpesaAmount').value = '';
  }

  /* ============================================================
     MODAL: RECORD MANUAL PAYMENT
     ============================================================ */
  function openPaymentModal(bill, balance) {
    state.activeBillForModal = bill;
    const patientName = `${bill.patient_first_name} ${bill.patient_last_name}`;

    document.getElementById('paymentSummary').innerHTML = `
      <div class="pay-summary-row"><span>Patient</span><b>${escapeHtml(patientName)}</b></div>
      <div class="pay-summary-row"><span>Balance due</span><b>${formatKsh(balance)}</b></div>
    `;
    document.getElementById('paymentAmount').value = balance;
    document.getElementById('paymentModalScrim').classList.add('is-open');
  }

  async function submitManualPayment() {
    const bill = state.activeBillForModal;
    const method = document.getElementById('paymentMethod').value;
    const amount = Number(document.getElementById('paymentAmount').value);
    const reference = document.getElementById('paymentReference').value.trim();

    if (!amount || amount <= 0) return showToast('Enter a valid amount');

    try {
      await fetchMethod('/payments', 'POST', {
        bill_id: bill.id, amount, method, reference: reference || null,
      }, true);
      showToast('Payment recorded');
      closeModal('paymentModalScrim');
      resetPaymentModal();
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Could not record payment');
    }
  }

  function resetPaymentModal() {
    state.activeBillForModal = null;
    document.getElementById('paymentAmount').value = '';
    document.getElementById('paymentReference').value = '';
    document.getElementById('paymentMethod').value = 'cash';
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
  function formatKsh(value) {
    return 'KSh ' + Number(value || 0).toLocaleString('en-KE');
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // datetime-local inputs need 'YYYY-MM-DDTHH:mm' in *local* time — toISOString()
  // gives UTC, which would silently shift the displayed time for the receptionist.
  function toDatetimeLocalValue(dateStr) {
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
})();