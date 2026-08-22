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
    completed: { label: 'Completed', className: 'status-completed' },
    cancelled: { label: 'Cancelled', className: 'status-cancelled' },
  };
  function statusMeta(status) {
    return STATUS_META[status] || { label: capitalize(status || 'Unknown'), className: 'status-default' };
  }
  const TERMINAL_STATUSES = ['completed', 'cancelled'];

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
  };

  // Day view hour rows. Adjust to match your clinic's actual hours.
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 18;

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initToolbar();
    initRescheduleModal();
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
                <div class="week-appt-chip ${statusMeta(a.status).className}">
                  ${escapeHtml(formatTime(a.scheduled_start))} · ${escapeHtml(patientName(a.patient_id))}
                </div>
              `).join('')
            : '<span class="week-day-empty">No appointments</span>'}
        </div>
      `);
    }
    el.innerHTML = cols.join('');
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
            ${a.status !== 'confirmed' ? `<button class="appt-action-btn confirm" data-action="confirm" data-appt-id="${a.id}" type="button">Confirm</button>` : ''}
            <button class="appt-action-btn" data-action="reschedule" data-appt-id="${a.id}" type="button">Reschedule</button>
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