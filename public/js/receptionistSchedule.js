(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'receptionist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATUS DISPLAY
     Same free-text status column as the dentist portal's schedule,
     plus checked_in / no_show, which are front-desk-specific and
     don't show up on the dentist's own day view.
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
  const TERMINAL_STATUSES = ['completed', 'cancelled'];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentists: [],
    selectedDentistId: 'all', // 'all' | dentist id (week view forces a real id)
    patientsById: {},
    appointmentsByDentist: {}, // dentistId -> appointments for the current day range
    weekAppointments: [],      // for week view of a single dentist
    monthAppointmentsByDentist: {}, // dentistId -> appointments for the current month
    yearAppointmentsByDentist: {},  // dentistId -> appointments for the current year
    scheduleByDentist: {},     // dentistId -> weekly recurring slots (cached — doesn't change with date nav)
    viewMode: 'day',           // 'day' | 'week' | 'month' | 'year'
    currentDate: new Date(),
    activeReschedule: null,
  };

  // Day view hour rows. Adjust to match your clinic's actual hours.
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 18;

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);
    initToolbar();
    initRescheduleModal();
    loadInitialData();
  });

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadInitialData() {
    try {
      const [dentists, patients] = await Promise.all([
        fetchMethod('/users/dentists', 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
      ]);
      state.dentists = dentists;
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });
      populateDentistFilter();
      await loadRange();
    } catch (err) {
      handleLoadError(err);
    }
  }

  function populateDentistFilter() {
    const select = document.getElementById('dentistFilter');
    state.dentists.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `Dr. ${d.first_name} ${d.last_name}`;
      select.appendChild(opt);
    });
  }

  // Weekly recurring availability doesn't change when the receptionist
  // navigates between dates, so it's fetched once per dentist and reused.
  async function ensureScheduleLoaded(dentistId) {
    if (state.scheduleByDentist[dentistId]) return;
    try {
      const slots = await fetchMethod(`/dentist-schedules/${dentistId}`, 'GET', null, true);
      state.scheduleByDentist[dentistId] = slots;
    } catch (err) {
      // Fail quiet — an unreadable schedule just renders that dentist's
      // column as unavailable rather than breaking the whole grid.
      state.scheduleByDentist[dentistId] = [];
    }
  }

  async function loadRange() {
    const isDayView = state.viewMode === 'day';
    const isWeekView = state.viewMode === 'week';
    const isMonthView = state.viewMode === 'month';
    const { from, to } = isDayView ? dayRangeIso(state.currentDate)
      : isWeekView ? weekRangeIso(state.currentDate)
      : isMonthView ? monthRangeIso(state.currentDate)
      : yearRangeIso(state.currentDate);
    // Week view's per-day columns only make sense for one dentist; Day,
    // Month, and Year all support "All dentists" and just aggregate.
    const shownDentists = isWeekView ? [getSingleWeekDentist()].filter(Boolean) : currentlyShownDentists();

    if (!shownDentists.length) {
      renderDateLabel();
      document.getElementById('apptCount').textContent = '';
      showNoDentistsMessage();
      return;
    }

    try {
      await Promise.all(shownDentists.map(async (d) => {
        const tasks = [fetchMethod(`/appointments/dentist/${d.id}?from=${from}&to=${to}`, 'GET', null, true)];
        // Hour-by-hour availability shading is only used by Day view.
        if (isDayView) tasks.push(ensureScheduleLoaded(d.id));
        const [appts] = await Promise.all(tasks);
        const sorted = appts.sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
        if (isDayView) state.appointmentsByDentist[d.id] = sorted;
        else if (isWeekView) state.weekAppointments = sorted;
        else if (isMonthView) state.monthAppointmentsByDentist[d.id] = sorted;
        else state.yearAppointmentsByDentist[d.id] = sorted;
      }));
      renderDateLabel();
      render();
    } catch (err) {
      handleLoadError(err);
    }
  }

  function showNoDentistsMessage() {
    const targetId = { day: 'dayGrid', week: 'weekGrid', month: 'monthGrid', year: 'yearGrid' }[state.viewMode] || 'dayGrid';
    document.getElementById(targetId).innerHTML = '<div class="msched-empty-state">No dentists on staff yet.</div>';
  }

  // Merges a dentistId -> appointments map down to a flat list for
  // whichever dentists are currently shown (used by Month/Year, which —
  // unlike Week — support viewing all dentists combined).
  function mergeShownAppointments(byDentist, dentists) {
    const merged = [];
    dentists.forEach((d) => { (byDentist[d.id] || []).forEach((a) => merged.push(a)); });
    return merged;
  }

  function currentlyShownDentists() {
    if (state.selectedDentistId === 'all') return state.dentists;
    return state.dentists.filter((d) => String(d.id) === String(state.selectedDentistId));
  }

  function getSingleWeekDentist() {
    return state.dentists.find((d) => String(d.id) === String(state.selectedDentistId)) || state.dentists[0];
  }

  function handleLoadError(err) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    showToast(err.message || 'Could not load the schedule. Please refresh.');
  }

  /* ============================================================
     TOOLBAR (Today / prev / next / dentist filter / Day-Week toggle)
     ============================================================ */
  function initToolbar() {
    document.getElementById('todayBtn').addEventListener('click', () => {
      state.currentDate = new Date();
      loadRange();
    });
    document.getElementById('prevBtn').addEventListener('click', () => shiftDate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => shiftDate(1));

    document.getElementById('dentistFilter').addEventListener('change', (e) => {
      state.selectedDentistId = e.target.value;
      loadRange();
    });

    document.querySelectorAll('#viewToggle .segmented-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view === state.viewMode) return;
        applyViewMode(view);
        loadRange();
      });
    });
  }

  // Shared by the toolbar toggle above and by drillToDay()/drillToMonth()
  // below, so clicking into a day from Month view (or a month from Year
  // view) goes through the exact same panel-visibility / dentist-filter
  // logic as clicking the toggle by hand.
  function applyViewMode(view) {
    state.viewMode = view;
    document.querySelectorAll('#viewToggle .segmented-opt').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-view') === view));
    document.getElementById('dayWrap').style.display = view === 'day' ? 'block' : 'none';
    document.getElementById('weekGrid').style.display = view === 'week' ? 'grid' : 'none';
    document.getElementById('monthGrid').style.display = view === 'month' ? 'grid' : 'none';
    document.getElementById('yearGrid').style.display = view === 'year' ? 'grid' : 'none';

    // Week view shows one dentist's column-per-day layout — "All
    // dentists" doesn't map onto that shape, so lock it out and
    // fall back to whichever dentist was selected (or the first one).
    // Day, Month, and Year all support "All dentists" fine.
    const allOption = document.querySelector('#dentistFilter option[value="all"]');
    if (view === 'week') {
      allOption.disabled = true;
      if (state.selectedDentistId === 'all' && state.dentists.length) {
        state.selectedDentistId = String(state.dentists[0].id);
        document.getElementById('dentistFilter').value = state.selectedDentistId;
        showToast(`Week view shows one dentist at a time — showing Dr. ${state.dentists[0].first_name} ${state.dentists[0].last_name}`);
      }
    } else {
      allOption.disabled = false;
    }
  }

  // Drill-down from Month view: click a day, land on Day view for it.
  function drillToDay(date) {
    state.currentDate = date;
    applyViewMode('day');
    loadRange();
  }

  // Drill-down from Year view: click a month, land on Month view for it.
  function drillToMonth(date) {
    state.currentDate = new Date(date.getFullYear(), date.getMonth(), 1);
    applyViewMode('month');
    loadRange();
  }

  function shiftDate(direction) {
    if (state.viewMode === 'day') {
      state.currentDate = new Date(state.currentDate.getTime() + direction * 24 * 60 * 60 * 1000);
    } else if (state.viewMode === 'week') {
      state.currentDate = new Date(state.currentDate.getTime() + direction * 7 * 24 * 60 * 60 * 1000);
    } else if (state.viewMode === 'month') {
      // Calendar-correct step — a fixed day-count would drift across
      // months of different lengths (e.g. Jan 31 + 30 days lands in March).
      state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() + direction, 1);
    } else {
      state.currentDate = new Date(state.currentDate.getFullYear() + direction, state.currentDate.getMonth(), 1);
    }
    loadRange();
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    if (state.viewMode === 'day') renderDayGrid();
    else if (state.viewMode === 'week') renderWeekView();
    else if (state.viewMode === 'month') renderMonthGrid();
    else renderYearGrid();
  }

  function renderDateLabel() {
    const label = document.getElementById('dateLabel');
    if (state.viewMode === 'day') {
      label.textContent = state.currentDate.toLocaleDateString('en-US', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      });
      return;
    }
    if (state.viewMode === 'week') {
      const { start, end } = weekBounds(state.currentDate);
      const sameMonth = start.getMonth() === end.getMonth();
      const startStr = start.toLocaleDateString('en-US', { day: 'numeric', month: sameMonth ? undefined : 'short' });
      const endStr = end.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      label.textContent = `${startStr} – ${endStr}`;
      return;
    }
    if (state.viewMode === 'month') {
      label.textContent = state.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return;
    }
    label.textContent = String(state.currentDate.getFullYear());
  }

  function patientName(patientId) {
    const p = state.patientsById[patientId];
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown patient';
  }

  function dentistLabel(d) {
    return `Dr. ${d.first_name} ${d.last_name}`;
  }

  /* ---- day view: hour rows × dentist columns ---- */
  function renderDayGrid() {
    const dentists = currentlyShownDentists();
    const grid = document.getElementById('dayGrid');
    const dayOfWeek = state.currentDate.getDay();

    const totalAppts = dentists.reduce((sum, d) => sum + (state.appointmentsByDentist[d.id] || []).length, 0);
    document.getElementById('apptCount').textContent = `${totalAppts} appointment${totalAppts === 1 ? '' : 's'}`;

    if (!dentists.length) {
      grid.innerHTML = '<div class="msched-empty-state">No dentists on staff yet.</div>';
      return;
    }

    grid.style.setProperty('--col-count', dentists.length);

    const cells = [];

    cells.push('<div class="msched-corner"></div>');
    dentists.forEach((d) => {
      const name = dentistLabel(d);
      const count = (state.appointmentsByDentist[d.id] || []).length;
      cells.push(`
        <div class="msched-dentist-head">
          <div class="msched-dentist-avatar">${Avatar.avatarInnerHtml(name, d.profile_picture_url)}</div>
          <div>
            <p class="msched-dentist-name">${escapeHtml(name)}</p>
            <p class="msched-dentist-meta">${count} patient${count === 1 ? '' : 's'} today</p>
          </div>
        </div>
      `);
    });

    for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour += 1) {
      cells.push(`<div class="msched-hour-label">${formatHourLabel(hour)}</div>`);
      dentists.forEach((d) => {
        if (!isDentistAvailable(d.id, dayOfWeek, hour)) {
          cells.push('<div class="msched-cell not-available"><span class="na-label">Not available</span></div>');
          return;
        }
        const hourAppts = (state.appointmentsByDentist[d.id] || []).filter(
          (a) => new Date(a.scheduled_start).getHours() === hour
        );
        cells.push(`<div class="msched-cell" data-dentist-id="${d.id}">${hourAppts.map(renderApptCard).join('')}</div>`);
      });
    }

    grid.innerHTML = cells.join('');
    bindApptActionButtons(grid, (id) => findApptInDayView(id));
  }

  function isDentistAvailable(dentistId, dayOfWeek, hour) {
    const slots = state.scheduleByDentist[dentistId] || [];
    const hourMinutes = hour * 60;
    return slots.some((s) => {
      if (Number(s.day_of_week) !== dayOfWeek || s.is_active === false) return false;
      const startMinutes = timeStringToMinutes(s.start_time);
      const endMinutes = timeStringToMinutes(s.end_time);
      return hourMinutes >= startMinutes && hourMinutes < endMinutes;
    });
  }

  function timeStringToMinutes(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function findApptInDayView(id) {
    for (const dentistId of Object.keys(state.appointmentsByDentist)) {
      const found = state.appointmentsByDentist[dentistId].find((a) => String(a.id) === String(id));
      if (found) return found;
    }
    return null;
  }

  /* ---- week view: single dentist, 7 day columns ---- */
  function renderWeekView() {
    const el = document.getElementById('weekGrid');
    const { start } = weekBounds(state.currentDate);
    const today = new Date();

    document.getElementById('apptCount').textContent =
      `${state.weekAppointments.length} appointment${state.weekAppointments.length === 1 ? '' : 's'}`;

    const cols = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const dayAppts = state.weekAppointments.filter((a) => sameDay(new Date(a.scheduled_start), day));
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

  /* ---- month view: calendar grid, all shown dentists merged ---- */
  function renderMonthGrid() {
    const dentists = currentlyShownDentists();
    const allAppts = mergeShownAppointments(state.monthAppointmentsByDentist, dentists);

    document.getElementById('apptCount').textContent =
      `${allAppts.length} appointment${allAppts.length === 1 ? '' : 's'}`;

    const days = monthGridDays(state.currentDate);
    const currentMonth = state.currentDate.getMonth();
    const today = new Date();

    const weekdayHeader = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      .map((label) => `<div class="month-weekday">${label}</div>`).join('');

    const dayCells = days.map((day) => {
      const dayAppts = allAppts
        .filter((a) => sameDay(new Date(a.scheduled_start), day))
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      const isOtherMonth = day.getMonth() !== currentMonth;
      const isToday = sameDay(day, today);
      const visible = dayAppts.slice(0, 3);
      const overflow = dayAppts.length - visible.length;

      return `
        <button type="button" class="month-day-cell${isOtherMonth ? ' is-other-month' : ''}${isToday ? ' is-today' : ''}" data-date="${toDateInputValue(day)}">
          <span class="month-day-num">${day.getDate()}</span>
          <div class="month-day-appts">
            ${visible.map((a) => `
              <span class="month-appt-chip ${statusMeta(a.status).className}">${escapeHtml(formatTime(a.scheduled_start))} · ${escapeHtml(patientName(a.patient_id))}</span>
            `).join('')}
            ${overflow > 0 ? `<span class="month-appt-more">+${overflow} more</span>` : ''}
          </div>
        </button>
      `;
    }).join('');

    const grid = document.getElementById('monthGrid');
    grid.innerHTML = weekdayHeader + dayCells;
    grid.querySelectorAll('.month-day-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        const [y, m, d] = cell.getAttribute('data-date').split('-').map(Number);
        drillToDay(new Date(y, m - 1, d));
      });
    });
  }

  /* ---- year view: 12 mini-months, all shown dentists merged ---- */
  function renderYearGrid() {
    const dentists = currentlyShownDentists();
    const year = state.currentDate.getFullYear();
    const today = new Date();
    const allAppts = mergeShownAppointments(state.yearAppointmentsByDentist, dentists);

    document.getElementById('apptCount').textContent =
      `${allAppts.length} appointment${allAppts.length === 1 ? '' : 's'}`;

    // Pre-count once so each mini-month just does key lookups.
    const countByDateKey = {};
    allAppts.forEach((a) => {
      const key = toDateInputValue(new Date(a.scheduled_start));
      countByDateKey[key] = (countByDateKey[key] || 0) + 1;
    });

    const months = [];
    for (let m = 0; m < 12; m += 1) {
      const monthDate = new Date(year, m, 1);
      const days = monthGridDays(monthDate);
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long' });
      const monthTotal = days
        .filter((d) => d.getMonth() === m)
        .reduce((sum, d) => sum + (countByDateKey[toDateInputValue(d)] || 0), 0);

      const dayCells = days.map((d) => {
        const isOtherMonth = d.getMonth() !== m;
        const isToday = sameDay(d, today);
        const hasAppts = !!countByDateKey[toDateInputValue(d)];
        return `<span class="year-day-cell${isOtherMonth ? ' is-other-month' : ''}${isToday ? ' is-today' : ''}${hasAppts ? ' has-appts' : ''}">${d.getDate()}</span>`;
      }).join('');

      months.push(`
        <button type="button" class="year-month-card" data-month="${m}">
          <div class="year-month-head">
            <span class="year-month-name">${monthLabel}</span>
            <span class="year-month-count">${monthTotal}</span>
          </div>
          <div class="year-month-grid">${dayCells}</div>
        </button>
      `);
    }

    const grid = document.getElementById('yearGrid');
    grid.innerHTML = months.join('');
    grid.querySelectorAll('.year-month-card').forEach((card) => {
      card.addEventListener('click', () => drillToMonth(new Date(year, Number(card.getAttribute('data-month')), 1)));
    });
  }

  /* ---- appointment card (shared markup for day + used by binder) ---- */
  function renderApptCard(a) {
    const meta = statusMeta(a.status);
    const isTerminal = TERMINAL_STATUSES.includes(a.status);
    return `
      <div class="appt-card ${meta.className}" data-appt-id="${a.id}">
        <div class="appt-card-top">
          <div>
            <div class="appt-patient-name">${escapeHtml(patientName(a.patient_id))}</div>
            <div class="appt-time">${escapeHtml(formatTime(a.scheduled_start))} – ${escapeHtml(formatTime(a.scheduled_end))}${a.room ? ` · ${escapeHtml(a.room)}` : ''}</div>
          </div>
          <span class="appt-status-badge">${escapeHtml(meta.label)}</span>
        </div>
        ${a.reason ? `<span class="appt-reason-chip">${escapeHtml(a.reason)}</span>` : ''}
        ${isTerminal ? '' : `
          <div class="appt-actions">
            ${a.status !== 'checked_in' ? `<button class="appt-action-btn checkin" data-action="checkin" data-appt-id="${a.id}" type="button">Check in</button>` : ''}
            <button class="appt-action-btn" data-action="reschedule" data-appt-id="${a.id}" type="button">Reschedule</button>
            ${a.status !== 'no_show' ? `<button class="appt-action-btn" data-action="no_show" data-appt-id="${a.id}" type="button">No-show</button>` : ''}
            <button class="appt-action-btn cancel" data-action="cancel" data-appt-id="${a.id}" type="button">Cancel</button>
          </div>
        `}
      </div>
    `;
  }

  function bindApptActionButtons(scope, resolveAppt) {
    scope.querySelectorAll('[data-action]').forEach((btn) => {
      const apptId = btn.getAttribute('data-appt-id');
      const appt = resolveAppt(apptId);
      if (!appt) return;
      const action = btn.getAttribute('data-action');
      if (action === 'checkin') btn.addEventListener('click', () => setApptStatus(appt, 'checked_in'));
      if (action === 'no_show') btn.addEventListener('click', () => setApptStatus(appt, 'no_show'));
      if (action === 'reschedule') btn.addEventListener('click', () => openRescheduleModal(appt));
      if (action === 'cancel') btn.addEventListener('click', () => cancelApptAction(appt));
    });
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  async function setApptStatus(appt, status) {
    try {
      const updated = await fetchMethod(`/appointments/${appt.id}/status`, 'PUT', { status }, true);
      Object.assign(appt, updated);
      render();
      showToast(status === 'checked_in' ? 'Patient checked in.' : 'Marked as no-show.');
    } catch (err) {
      showToast(err.message || 'Could not update this appointment.');
    }
  }

  async function cancelApptAction(appt) {
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
      await fetchMethod(`/appointments/${appt.id}/reschedule`, 'PUT', { scheduled_start, scheduled_end }, true);
      // The new time may fall on a different day/hour bucket (or, in day
      // view, we're already scoped to one dentist's data) — simplest
      // correct thing is to reload the active range from the server.
      closeRescheduleModal();
      await loadRange();
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

  function monthRangeIso(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  function yearRangeIso(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    const end = new Date(date.getFullYear() + 1, 0, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  // Full weeks (Monday–Sunday) covering the given month, including the
  // leading/trailing days of adjacent months needed to fill the grid —
  // the standard "calendar" layout, so cells always line up 7-wide.
  function monthGridDays(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const gridStart = weekBounds(firstOfMonth).start;       // Monday on/before the 1st
    const lastWeekStart = weekBounds(lastOfMonth).start;    // Monday of the week containing the last day
    const totalDays = Math.round((lastWeekStart.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)) + 7;
    const days = [];
    for (let i = 0; i < totalDays; i += 1) {
      days.push(new Date(gridStart.getTime() + i * 24 * 60 * 60 * 1000));
    }
    return days;
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
    document.getElementById('avatarInitials').textContent = Avatar.initialsOf(name);
  }
})();