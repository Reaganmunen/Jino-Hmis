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
     STATUS DISPLAY
     ------------------------------------------------------------
     Appointment.status is a free-text column set by setStatus /
     rescheduleAppointment ('confirmed') / softDeleteAppointment
     ('cancelled') — no enum visible from the routes/models, so this
     maps the statuses we know are used and falls back gracefully
     for anything else instead of assuming a fixed set.
     ============================================================ */
  const STATUS_META = {
    pending: { label: 'Pending', className: 'status-pending' },
    confirmed: { label: 'Confirmed', className: 'status-confirmed' },
    checked_in: { label: 'Checked in', className: 'status-checked_in' },
    completed: { label: 'Completed', className: 'status-completed' },
    no_show: { label: 'No-show', className: 'status-no_show' },
    cancelled: { label: 'Cancelled', className: 'status-cancelled' },
  };
  function statusMeta(status) {
    return STATUS_META[status] || { label: capitalize(status || 'Unknown'), className: 'status-default' };
  }
  const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_show'];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id,
    patientsById: {},
    appointments: [],   // whatever range is currently loaded (day or week)
    viewMode: 'day',     // 'day' | 'week'
    currentDate: new Date(), // anchor date — the day, or a day inside the active week
    activeReschedule: null,  // appointment currently open in the reschedule modal
    activeReassign: null,    // appointment currently open in the reassign modal
    dentists: [],            // other active dentists, for the reassign picker
  };

  // Day view hour rows. Adjust to match your clinic's actual hours.
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 18;

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initToolbar();
    initRescheduleModal();
    initReassignModal();
    loadPatientsThenAppointments();
  });

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadPatientsThenAppointments() {
    try {
      const patients = await fetchMethod('/patients', 'GET', null, true);
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });
      await loadAppointmentsForRange();
    } catch (err) {
      handleLoadError(err);
    }
  }

  async function loadAppointmentsForRange() {
    const { from, to } = state.viewMode === 'day' ? dayRangeIso(state.currentDate) : weekRangeIso(state.currentDate);
    try {
      const appointments = await fetchMethod(
        `/appointments/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true,
      );
      state.appointments = appointments.sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      render();
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
     TOOLBAR (Today / prev / next / Day-Week toggle)
     ============================================================ */
  function initToolbar() {
    document.getElementById('todayBtn').addEventListener('click', () => {
      state.currentDate = new Date();
      loadAppointmentsForRange();
    });
    document.getElementById('prevBtn').addEventListener('click', () => shiftDate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => shiftDate(1));

    document.querySelectorAll('#viewToggle .segmented-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view === state.viewMode) return;
        state.viewMode = view;
        document.querySelectorAll('#viewToggle .segmented-opt').forEach((b) => b.classList.toggle('is-active', b === btn));
        document.getElementById('dayTimeline').style.display = view === 'day' ? 'flex' : 'none';
        document.getElementById('weekGrid').style.display = view === 'week' ? 'grid' : 'none';
        loadAppointmentsForRange();
      });
    });
  }

  function shiftDate(direction) {
    const days = state.viewMode === 'day' ? 1 : 7;
    state.currentDate = new Date(state.currentDate.getTime() + direction * days * 24 * 60 * 60 * 1000);
    loadAppointmentsForRange();
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    renderDateLabel();
    document.getElementById('apptCount').textContent =
      `${state.appointments.length} appointment${state.appointments.length === 1 ? '' : 's'}`;
    if (state.viewMode === 'day') {
      renderDayView();
    } else {
      renderWeekView();
    }
  }

  function renderDateLabel() {
    const label = document.getElementById('dateLabel');
    if (state.viewMode === 'day') {
      label.textContent = state.currentDate.toLocaleDateString('en-US', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      });
      return;
    }
    const { start, end } = weekBounds(state.currentDate);
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString('en-US', { day: 'numeric', month: sameMonth ? undefined : 'short' });
    const endStr = end.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    label.textContent = `${startStr} – ${endStr}`;
  }

  function patientName(patientId) {
    const p = state.patientsById[patientId];
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown patient';
  }

  function renderDayView() {
    const el = document.getElementById('dayTimeline');
    const rows = [];
    for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour += 1) {
      const hourAppts = state.appointments.filter((a) => new Date(a.scheduled_start).getHours() === hour);
      rows.push(`
        <div class="hour-row">
          <div class="hour-label">${formatHourLabel(hour)}</div>
          <div class="hour-cards">
            ${hourAppts.length ? hourAppts.map(renderApptCard).join('') : '<span class="hour-empty">—</span>'}
          </div>
        </div>
      `);
    }
    el.innerHTML = rows.join('');
    bindApptActionButtons(el);
  }

  function renderWeekView() {
    const el = document.getElementById('weekGrid');
    const { start } = weekBounds(state.currentDate);
    const today = new Date();
    const cols = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const dayAppts = state.appointments.filter((a) => sameDay(new Date(a.scheduled_start), day));
      const isToday = sameDay(day, today);
      cols.push(`
        <div class="week-day-col">
          <div class="week-day-head${isToday ? ' is-today' : ''}">
            ${day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
          </div>
          ${dayAppts.length
            ? dayAppts.map((a) => `
                <div class="week-appt-chip ${statusMeta(a.status).className}" data-jump-date="${toDateInputValue(new Date(a.scheduled_start))}" title="Open this day to manage the appointment">
                  ${escapeHtml(formatTime(a.scheduled_start))} · ${escapeHtml(patientName(a.patient_id))}
                </div>
              `).join('')
            : '<span class="week-day-empty">No appointments</span>'}
        </div>
      `);
    }
    el.innerHTML = cols.join('');
    // Actions (complete / reschedule / reassign / cancel) live on the day view,
    // so clicking a chip in the week view jumps straight to that day.
    el.querySelectorAll('[data-jump-date]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const [y, m, d] = chip.getAttribute('data-jump-date').split('-').map(Number);
        state.currentDate = new Date(y, m - 1, d);
        document.querySelector('#viewToggle [data-view="day"]').click();
      });
    });
  }

  function renderApptCard(a) {
    const meta = statusMeta(a.status);
    const isTerminal = TERMINAL_STATUSES.includes(a.status);
    return `
      <div class="appt-card ${meta.className}" data-appt-id="${a.id}">
        <div class="appt-card-top">
          <div>
            <div class="appt-patient-name">${escapeHtml(patientName(a.patient_id))}</div>
            <div class="appt-time">${escapeHtml(formatTime(a.scheduled_start))} – ${escapeHtml(formatTime(a.scheduled_end))}${a.room ? ` · Room ${escapeHtml(a.room)}` : ''}</div>
          </div>
          <span class="appt-status-badge">${escapeHtml(meta.label)}</span>
        </div>
        ${a.reason ? `<span class="appt-reason-chip">${escapeHtml(a.reason)}</span>` : ''}
        ${isTerminal ? '' : `
          <div class="appt-actions">
            <button class="appt-action-btn complete" data-action="complete" data-appt-id="${a.id}" type="button">Mark completed</button>
            ${a.status === 'pending' ? `<button class="appt-action-btn confirm" data-action="confirm" data-appt-id="${a.id}" type="button">Confirm</button>` : ''}
            <button class="appt-action-btn" data-action="reschedule" data-appt-id="${a.id}" type="button">Reschedule</button>
            <button class="appt-action-btn reassign" data-action="reassign" data-appt-id="${a.id}" type="button">Assign to another dentist</button>
            <button class="appt-action-btn cancel" data-action="cancel" data-appt-id="${a.id}" type="button">Cancel</button>
          </div>
        `}
      </div>
    `;
  }

  function bindApptActionButtons(scope) {
    scope.querySelectorAll('[data-action]').forEach((btn) => {
      const apptId = btn.getAttribute('data-appt-id');
      const appt = state.appointments.find((a) => String(a.id) === String(apptId));
      if (!appt) return;
      const action = btn.getAttribute('data-action');
      if (action === 'confirm') btn.addEventListener('click', () => confirmAppointment(appt));
      if (action === 'complete') btn.addEventListener('click', () => completeAppointment(appt));
      if (action === 'reassign') btn.addEventListener('click', () => openReassignModal(appt));
      if (action === 'reschedule') btn.addEventListener('click', () => openRescheduleModal(appt));
      if (action === 'cancel') btn.addEventListener('click', () => cancelAppointmentAction(appt));
    });
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  async function confirmAppointment(appt) {
    try {
      const updated = await fetchMethod(`/appointments/${appt.id}/status`, 'PUT', { status: 'confirmed' }, true);
      Object.assign(appt, updated);
      render();
      showToast('Appointment confirmed.');
    } catch (err) {
      showToast(err.message || 'Could not confirm this appointment.');
    }
  }

  async function completeAppointment(appt) {
    const ok = window.confirm(`Mark the appointment with ${patientName(appt.patient_id)} as completed?`);
    if (!ok) return;
    try {
      const updated = await fetchMethod(`/appointments/${appt.id}/status`, 'PUT', { status: 'completed' }, true);
      Object.assign(appt, updated);
      render();
      showToast('Appointment marked as completed.');
    } catch (err) {
      showToast(err.message || 'Could not mark this appointment as completed.');
    }
  }

  async function cancelAppointmentAction(appt) {
    const ok = window.confirm(`Cancel the appointment with ${patientName(appt.patient_id)}?`);
    if (!ok) return;
    try {
      await fetchMethod(`/appointments/${appt.id}`, 'DELETE', null, true);
      appt.status = 'cancelled';
      render();
      showToast('Appointment cancelled.');
    } catch (err) {
      showToast(err.message || 'Could not cancel this appointment.');
    }
  }

  function initRescheduleModal() {
    document.getElementById('rescheduleModalCancel').addEventListener('click', closeRescheduleModal);
    document.getElementById('rescheduleModalScrim').addEventListener('click', (e) => {
      if (e.target.id === 'rescheduleModalScrim') closeRescheduleModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('rescheduleModalScrim').classList.contains('is-open')) closeRescheduleModal();
    });
    document.getElementById('rescheduleModalSave').addEventListener('click', saveReschedule);
  }

  function openRescheduleModal(appt) {
    state.activeReschedule = appt;
    document.getElementById('rescheduleModalTitle').textContent = patientName(appt.patient_id);
    const start = new Date(appt.scheduled_start);
    const end = new Date(appt.scheduled_end);
    document.getElementById('rescheduleDate').value = toDateInputValue(start);
    document.getElementById('rescheduleStart').value = toTimeInputValue(start);
    document.getElementById('rescheduleEnd').value = toTimeInputValue(end);
    document.getElementById('rescheduleModalScrim').classList.add('is-open');
  }

  function closeRescheduleModal() {
    state.activeReschedule = null;
    document.getElementById('rescheduleModalScrim').classList.remove('is-open');
  }

  async function saveReschedule() {
    const appt = state.activeReschedule;
    if (!appt) return;

    const dateVal = document.getElementById('rescheduleDate').value;
    const startVal = document.getElementById('rescheduleStart').value;
    const endVal = document.getElementById('rescheduleEnd').value;
    if (!dateVal || !startVal || !endVal) {
      showToast('Pick a date, start time, and end time.');
      return;
    }

    const scheduled_start = new Date(`${dateVal}T${startVal}`).toISOString();
    const scheduled_end = new Date(`${dateVal}T${endVal}`).toISOString();
    if (new Date(scheduled_end) <= new Date(scheduled_start)) {
      showToast('End time must be after the start time.');
      return;
    }

    const saveBtn = document.getElementById('rescheduleModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const updated = await fetchMethod(`/appointments/${appt.id}/reschedule`, 'PUT', { scheduled_start, scheduled_end }, true);
      // The new time may fall outside the currently loaded day/week range —
      // simplest correct thing is to reload the active range from the server.
      closeRescheduleModal();
      await loadAppointmentsForRange();
      showToast('Appointment rescheduled.');
    } catch (err) {
      showToast(err.message || 'Could not reschedule this appointment.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save new time';
    }
  }

  /* ============================================================
     REASSIGN TO ANOTHER DENTIST
     ============================================================ */
  function initReassignModal() {
    document.getElementById('reassignModalCancel').addEventListener('click', closeReassignModal);
    document.getElementById('reassignModalScrim').addEventListener('click', (e) => {
      if (e.target.id === 'reassignModalScrim') closeReassignModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('reassignModalScrim').classList.contains('is-open')) closeReassignModal();
    });
    document.getElementById('reassignModalSave').addEventListener('click', saveReassign);
  }

  // Dentist list is fetched once, on first open, then reused.
  async function ensureDentistsLoaded() {
    if (state.dentists.length) return;
    const all = await fetchMethod('/users/dentists', 'GET', null, true);
    state.dentists = all.filter((d) => d.is_active !== false && String(d.id) !== String(state.dentistId));
  }

  async function openReassignModal(appt) {
    state.activeReassign = appt;
    document.getElementById('reassignModalTitle').textContent = patientName(appt.patient_id);
    document.getElementById('reassignSummary').textContent =
      `${new Date(appt.scheduled_start).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}, ` +
      `${formatTime(appt.scheduled_start)} – ${formatTime(appt.scheduled_end)}`;

    const select = document.getElementById('reassignDentist');
    select.innerHTML = '<option value="">Loading dentists…</option>';
    document.getElementById('reassignModalScrim').classList.add('is-open');

    try {
      await ensureDentistsLoaded();
    } catch (err) {
      closeReassignModal();
      showToast(err.message || 'Could not load the list of dentists.');
      return;
    }

    if (!state.dentists.length) {
      select.innerHTML = '<option value="">No other dentists available</option>';
      return;
    }
    select.innerHTML = '<option value="">Select a dentist…</option>' + state.dentists
      .map((d) => `<option value="${escapeHtml(d.id)}">Dr. ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name)}</option>`)
      .join('');
  }

  function closeReassignModal() {
    state.activeReassign = null;
    document.getElementById('reassignModalScrim').classList.remove('is-open');
  }

  async function saveReassign() {
    const appt = state.activeReassign;
    if (!appt) return;

    const dentistId = document.getElementById('reassignDentist').value;
    if (!dentistId) {
      showToast('Choose the dentist to hand this appointment to.');
      return;
    }

    const saveBtn = document.getElementById('reassignModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Assigning…';

    try {
      await fetchMethod(`/appointments/${appt.id}/reassign`, 'PUT', { dentist_id: dentistId }, true);
      const target = state.dentists.find((d) => String(d.id) === String(dentistId));
      closeReassignModal();
      // The appointment now belongs to the other dentist, so it leaves this schedule.
      await loadAppointmentsForRange();
      showToast(`Appointment assigned to Dr. ${target ? target.last_name : 'colleague'}.`);
    } catch (err) {
      showToast(err.message || 'Could not reassign this appointment.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Assign dentist';
    }
  }

  /* ============================================================
     DATE / TIME UTILITIES
     ============================================================ */
  function dayRangeIso(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  // Week runs Monday–Sunday.
  function weekBounds(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = d.getDay(); // 0 = Sunday
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const start = new Date(d.getTime() + diffToMonday * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }

  function weekRangeIso(date) {
    const { start, end } = weekBounds(date);
    return { from: start.toISOString(), to: new Date(end.getTime() + 1).toISOString() };
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatHourLabel(hour) {
    const period = hour >= 12 ? 'pm' : 'am';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}${period}`;
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function toDateInputValue(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function toTimeInputValue(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
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