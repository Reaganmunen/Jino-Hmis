(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Assumes api.js (fetchMethod, getStoredUser, clearSession) is
     loaded before this file.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'patient') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     CONSTANTS
     ============================================================ */
  const SLOT_MINUTES = 30;
  const ROW_HEIGHT = 70;      // px per hour row in the day timeline
  const GRID_START_HOUR = 7;  // 7am
  const GRID_END_HOUR = 19;   // 7pm (exclusive)

  const STATUS_META = {
    scheduled: { label: 'Scheduled', dot: '●' },
    confirmed: { label: 'Confirmed', dot: '✓' },
    completed: { label: 'Finished', dot: '●' },
    cancelled: { label: 'Cancelled', dot: '✕' },
    no_show: { label: 'No-show', dot: '●' },
    overdue: { label: 'Needs follow-up', dot: '⚑' },
  };
  const ACTIONABLE_STATUSES = ['scheduled', 'confirmed'];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    patientId: null,
    appointments: [],
    dentists: [],
    tab: 'calendar',            // 'calendar' | 'history'
    view: 'day',                // 'day' | 'week'
    selectedDate: startOfDay(new Date()),
    booking: { step: 1, dentistId: null, date: null, slot: null, reason: '', availableSlots: [] },
    reschedule: { appointmentId: null, dentistId: null, date: null, slot: null, availableSlots: [] },
  };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initTabs();
    initViewToggle();
    initDateNav();
    initBookingModal();
    initRescheduleModal();
    loadData();
  });

  async function loadData() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      const [appts, dentistList, files] = await Promise.all([
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true),
        fetchMethod(`/patient-files/patient/${patient.id}`, 'GET', null, true).catch(() => []),
      ]);

      // file_type is a Postgres enum without a 'profile_picture' value, so
      // the profile photo is stored as file_type: 'photo' + description:
      // 'Profile Picture' (see profile.js) and found the same way here.
      const profilePhoto = files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
      renderTopbarAvatar(`${patient.first_name} ${patient.last_name}`, profilePhoto ? profilePhoto.file_url : null);

      state.appointments = appts;
      state.dentists = dentistList;

      renderDentistOptions();
      renderAll();
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
    showToast(err.message || 'Could not load your appointments. Please refresh.');
  }

  function renderAll() {
    renderDateLabel();
    renderCalendarPanel();
    renderHistory();
  }

  /* ============================================================
     TABS (Calendar / Log History)
     ============================================================ */
  function initTabs() {
    document.querySelectorAll('.cal-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.cal-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        document.getElementById('calendarPanel').style.display = state.tab === 'calendar' ? '' : 'none';
        document.getElementById('historyPanel').style.display = state.tab === 'history' ? '' : 'none';
      });
    });
  }

  /* ============================================================
     DAY / WEEK VIEW TOGGLE
     ============================================================ */
  function initViewToggle() {
    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.getAttribute('data-view');
        document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderCalendarPanel();
      });
    });
  }

  /* ============================================================
     DATE NAVIGATION
     ============================================================ */
  function initDateNav() {
    document.getElementById('todayBtn').addEventListener('click', () => {
      state.selectedDate = startOfDay(new Date());
      renderDateLabel();
      renderCalendarPanel();
    });
    document.getElementById('prevDate').addEventListener('click', () => {
      shiftSelectedDate(state.view === 'week' ? -7 : -1);
    });
    document.getElementById('nextDate').addEventListener('click', () => {
      shiftSelectedDate(state.view === 'week' ? 7 : 1);
    });
  }

  function shiftSelectedDate(days) {
    const d = new Date(state.selectedDate);
    d.setDate(d.getDate() + days);
    state.selectedDate = d;
    renderDateLabel();
    renderCalendarPanel();
  }

  function renderDateLabel() {
    const label = document.getElementById('calDateLabel');
    label.textContent = state.selectedDate.toLocaleDateString('en-US', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
    document.getElementById('todayBtn').classList.toggle(
      'is-current', sameLocalDate(state.selectedDate, new Date())
    );
  }

  /* ============================================================
     CALENDAR PANEL (day timeline / week agenda) + total count
     ============================================================ */
  function renderCalendarPanel() {
    const dayEl = document.getElementById('dayTimeline');
    const weekEl = document.getElementById('weekAgenda');

    if (state.view === 'day') {
      dayEl.style.display = '';
      weekEl.style.display = 'none';
      renderDayTimeline();
    } else {
      dayEl.style.display = 'none';
      weekEl.style.display = '';
      renderWeekAgenda();
    }
  }

  function apptsOnDate(date) {
    return state.appointments.filter((a) => sameLocalDate(new Date(a.scheduled_start), date));
  }

  function apptsInWeek(weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return state.appointments.filter((a) => {
      const d = new Date(a.scheduled_start);
      return d >= weekStart && d < weekEnd;
    });
  }

  function renderDayTimeline() {
    const container = document.getElementById('dayTimeline');
    container.innerHTML = '';

    const totalHours = GRID_END_HOUR - GRID_START_HOUR;
    const gridHeight = totalHours * ROW_HEIGHT;

    const dayAppts = apptsOnDate(state.selectedDate)
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
    document.getElementById('totalCount').textContent = dayAppts.length;
    container.classList.toggle('is-today', sameLocalDate(state.selectedDate, new Date()));

    // hours column
    const hoursCol = document.createElement('div');
    hoursCol.className = 'dt-hours';
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
      const label = document.createElement('div');
      label.className = 'dt-hour-label';
      label.textContent = formatHourLabel(h);
      hoursCol.appendChild(label);
    }
    container.appendChild(hoursCol);

    // grid column
    const grid = document.createElement('div');
    grid.className = 'dt-grid';
    grid.style.height = gridHeight + 'px';

    for (let i = 1; i < totalHours; i++) {
      const line = document.createElement('div');
      line.className = 'dt-row-line';
      line.style.top = i * ROW_HEIGHT + 'px';
      grid.appendChild(line);
    }

    if (!dayAppts.length) {
      const empty = document.createElement('div');
      empty.className = 'dt-empty-day';
      empty.textContent = 'No appointments on this day.';
      grid.appendChild(empty);
    }

    dayAppts.forEach((appt) => {
      grid.appendChild(buildDayApptCard(appt, gridHeight));
    });

    // "now" line — only when viewing today
    if (sameLocalDate(state.selectedDate, new Date())) {
      const now = new Date();
      const nowHourFloat = now.getHours() + now.getMinutes() / 60;
      if (nowHourFloat >= GRID_START_HOUR && nowHourFloat <= GRID_END_HOUR) {
        const top = (nowHourFloat - GRID_START_HOUR) * ROW_HEIGHT;
        const line = document.createElement('div');
        line.className = 'dt-now-line';
        line.style.top = top + 'px';
        line.innerHTML = `
          <span class="dt-now-dot"></span>
          <span class="dt-now-label">${escapeHtml(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</span>
        `;
        grid.appendChild(line);
      }
    }

    container.appendChild(grid);
  }

  function buildDayApptCard(appt, gridHeight) {
    const start = new Date(appt.scheduled_start);
    const end = new Date(appt.scheduled_end);
    const startHourFloat = start.getHours() + start.getMinutes() / 60;
    const durationMin = Math.max(15, (end - start) / 60000);

    let top = Math.max(0, (startHourFloat - GRID_START_HOUR) * ROW_HEIGHT);
    let height = Math.max(46, (durationMin / 60) * ROW_HEIGHT - 4);
    if (top + height > gridHeight) height = Math.max(46, gridHeight - top);

    const status = effectiveStatus(appt);
    const meta = statusMeta(status);
    const timeRange = `${formatTime(start)} – ${formatTime(end)}`;
    const dentistName = dentistNameById(appt.dentist_id);

    const card = document.createElement('div');
    card.className = `dt-appt st-${status}`;
    card.style.top = top + 'px';
    card.style.height = height + 'px';
    card.setAttribute('data-id', appt.id);
    card.innerHTML = `
      <span class="dt-pill">${meta.dot} ${escapeHtml(meta.label)}</span>
      <p class="t">${escapeHtml(appt.reason || 'Appointment')}</p>
      <p class="s">${escapeHtml(dentistName)} · ${escapeHtml(timeRange)}</p>
      ${appt.room ? `<span class="r">Room ${escapeHtml(appt.room)}</span>` : ''}
    `;
    card.addEventListener('click', () => openApptActions(appt));
    return card;
  }

  function renderWeekAgenda() {
    const container = document.getElementById('weekAgenda');
    container.innerHTML = '';

    const weekStart = startOfWeek(state.selectedDate);
    const weekAppts = apptsInWeek(weekStart);
    document.getElementById('totalCount').textContent = weekAppts.length;

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + i);
      const isToday = sameLocalDate(dayDate, new Date());

      const col = document.createElement('div');
      col.className = 'week-day' + (isToday ? ' is-today' : '');
      col.innerHTML = `
        <div class="week-day-head">
          <div class="week-day-name">${dayDate.toLocaleDateString('en-US', { weekday: 'short' })}</div>
          <div class="week-day-num">${dayDate.getDate()}</div>
        </div>
      `;

      const dayItems = apptsOnDate(dayDate).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      if (!dayItems.length) {
        const empty = document.createElement('div');
        empty.className = 'week-day-empty';
        empty.textContent = '—';
        col.appendChild(empty);
      } else {
        dayItems.forEach((appt) => {
          const status = effectiveStatus(appt);
          const meta = statusMeta(status);
          const chip = document.createElement('div');
          chip.className = `week-chip st-${status}`;
          chip.innerHTML = `
            <span class="wt">${escapeHtml(formatTime(new Date(appt.scheduled_start)))} · ${escapeHtml(appt.reason || 'Appointment')}</span>
            <span class="ws">${meta.dot} ${escapeHtml(meta.label)}</span>
          `;
          chip.addEventListener('click', () => {
            state.selectedDate = startOfDay(dayDate);
            state.view = 'day';
            document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-view') === 'day'));
            renderDateLabel();
            renderCalendarPanel();
          });
          col.appendChild(chip);
        });
      }

      container.appendChild(col);
    }
  }

  /* ============================================================
     APPOINTMENT ACTIONS (reschedule / cancel) — from a day card
     ============================================================ */
  function openApptActions(appt) {
    const status = appt.status || 'scheduled';
    if (!ACTIONABLE_STATUSES.includes(status)) {
      showToast(`This appointment is ${statusMeta(effectiveStatus(appt)).label.toLowerCase()} and can't be changed.`);
      return;
    }
    const wantsReschedule = confirm(
      `${appt.reason || 'Appointment'} with ${dentistNameById(appt.dentist_id)}\n` +
      `${formatDateTime(new Date(appt.scheduled_start))}\n\n` +
      `Click OK to reschedule, or Cancel to close this without changes.`
    );
    if (wantsReschedule) openRescheduleModal(appt);
  }

  /* ============================================================
     LOG HISTORY TAB
     ============================================================ */
  function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';

    const now = new Date();
    const history = state.appointments
      .filter((a) => {
        const isPast = new Date(a.scheduled_start) < now;
        const isClosed = ['cancelled', 'completed', 'no_show'].includes(a.status);
        return isPast || isClosed;
      })
      .sort((a, b) => new Date(b.scheduled_start) - new Date(a.scheduled_start));

    if (!history.length) {
      list.innerHTML = '<div class="empty-state">No past appointments yet.</div>';
      return;
    }

    history.forEach((appt) => {
      const start = new Date(appt.scheduled_start);
      const status = effectiveStatus(appt);
      const meta = statusMeta(status);

      const row = document.createElement('div');
      row.className = 'appt-item';
      row.innerHTML = `
        <div class="appt-date"><div class="d">${start.getDate()}</div><div class="m">${start.toLocaleString('en-US', { month: 'short' })}</div></div>
        <div class="appt-mid">
          <p class="t">${escapeHtml(appt.reason || 'Appointment')}</p>
          <p class="s">${escapeHtml(dentistNameById(appt.dentist_id))} · ${escapeHtml(formatTime(start))}</p>
        </div>
        <span class="badge badge-${status}">${escapeHtml(meta.label)}</span>
      `;
      list.appendChild(row);
    });
  }

  function dentistNameById(id) {
    const d = state.dentists.find((x) => x.id === id);
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Dentist';
  }

  // A scheduled/confirmed appointment whose time has already passed and
  // nobody (staff) marked it completed/no_show/cancelled — flag it rather
  // than silently showing a stale "Scheduled" badge for something that's
  // already in the past.
  function effectiveStatus(appt) {
    const raw = appt.status || 'scheduled';
    if (['scheduled', 'confirmed'].includes(raw) && new Date(appt.scheduled_end) < new Date()) {
      return 'overdue';
    }
    return raw;
  }

  function statusMeta(statusKey) {
    return STATUS_META[statusKey] || { label: capitalize(statusKey), dot: '●' };
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
     BOOKING MODAL — 3-step wizard (dentist -> date/time -> confirm)
     ------------------------------------------------------------
     Slot generation reads the dentist's recurring weekly schedule
     (GET /dentist-schedules/:dentistId), filters to the chosen
     date's weekday, generates 30-min slots across each active
     window, then removes any slot whose start matches an
     already-booked appointment for that dentist that day
     (GET /appointments/dentist/:dentistId?from=&to=).
     ============================================================ */
  function initBookingModal() {
    const scrim = document.getElementById('modalScrim');
    const b = state.booking;

    document.getElementById('openBooking').addEventListener('click', openModal);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeModal(); });

    document.getElementById('apptDate').addEventListener('change', async (e) => {
      b.date = e.target.value;
      b.slot = null;
      await loadSlotsForSelection(b, 'slotGrid');
    });

    document.getElementById('apptReason').addEventListener('input', (e) => { b.reason = e.target.value; });

    document.getElementById('wizardBack').addEventListener('click', () => goToStep(b.step - 1));
    document.getElementById('wizardNext').addEventListener('click', () => {
      if (b.step === 1 && !b.dentistId) return showToast('Choose a dentist to continue');
      if (b.step === 2 && (!b.date || !b.slot)) return showToast('Pick a date and time slot');
      if (b.step === 3) return submitBooking();
      goToStep(b.step + 1);
    });

    function openModal() {
      b.step = 1; b.dentistId = null; b.date = null; b.slot = null; b.reason = ''; b.availableSlots = [];
      document.getElementById('apptDate').value = '';
      document.getElementById('apptReason').value = '';
      document.getElementById('slotGrid').innerHTML = '<p class="tooth-detail-empty">Pick a date to see open slots.</p>';
      renderDentistOptions();
      goToStep(1);
      scrim.classList.add('is-open');
    }

    function closeModal() { scrim.classList.remove('is-open'); }

    function goToStep(step) {
      if (step < 1 || step > 3) return;
      b.step = step;
      document.querySelectorAll('#modalScrim .wizard-step').forEach((s) => {
        s.classList.toggle('is-active', Number(s.getAttribute('data-step')) === step);
      });
      document.querySelectorAll('#modalScrim .prog-step').forEach((s) => {
        const n = Number(s.getAttribute('data-step'));
        s.classList.toggle('is-active', n === step);
        s.classList.toggle('is-done', n < step);
      });
      const titles = { 1: 'Choose a dentist', 2: 'Pick date & time', 3: 'Confirm booking' };
      document.getElementById('modalTitle').textContent = titles[step];
      document.getElementById('modalStepLabel').textContent = `Step ${step} of 3`;
      document.getElementById('wizardBack').style.visibility = step === 1 ? 'hidden' : 'visible';
      document.getElementById('wizardNext').textContent = step === 3 ? 'Confirm appointment' : 'Continue';
      if (step === 3) renderConfirmSummary();
    }

    function renderConfirmSummary() {
      const dentist = state.dentists.find((d) => d.id === b.dentistId);
      document.getElementById('confirmSummary').innerHTML = `
        <div class="confirm-row"><span>Dentist</span><b>${escapeHtml(dentist ? `Dr. ${dentist.first_name} ${dentist.last_name}` : '—')}</b></div>
        <div class="confirm-row"><span>Date</span><b>${b.date ? formatDate(b.date) : '—'}</b></div>
        <div class="confirm-row"><span>Time</span><b>${b.slot ? formatTime(new Date(b.slot)) : '—'}</b></div>
      `;
    }

    async function submitBooking() {
      const nextBtn = document.getElementById('wizardNext');
      nextBtn.disabled = true;
      nextBtn.textContent = 'Booking…';
      try {
        const start = new Date(b.slot);
        const end = new Date(start.getTime() + SLOT_MINUTES * 60000);

        const appointment = await fetchMethod('/appointments', 'POST', {
          patient_id: state.patientId,
          dentist_id: b.dentistId,
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          reason: b.reason || 'General appointment',
        }, true);

        state.appointments.push(appointment);
        state.selectedDate = startOfDay(start);
        renderDateLabel();
        renderAll();
        closeModal();
        showToast('Appointment booked');
      } catch (err) {
        showToast(err.message || 'Could not book that appointment');
      } finally {
        nextBtn.disabled = false;
        nextBtn.textContent = 'Confirm appointment';
      }
    }
  }

  function renderDentistOptions() {
    const grid = document.getElementById('dentistGrid');
    if (!grid) return;
    grid.innerHTML = '';
    state.dentists.forEach((d) => {
      const name = `Dr. ${d.first_name} ${d.last_name}`;
      const opt = document.createElement('div');
      opt.className = 'dentist-opt' + (state.booking.dentistId === d.id ? ' is-selected' : '');
      opt.innerHTML = `
        <div class="dentist-avatar">${initialsOf(name)}</div>
        <div><p class="t">${escapeHtml(name)}</p><p class="s">${escapeHtml(d.email || '')}</p></div>
      `;
      opt.addEventListener('click', () => {
        state.booking.dentistId = d.id;
        state.booking.date = null;
        state.booking.slot = null;
        document.getElementById('apptDate').value = '';
        document.getElementById('slotGrid').innerHTML = '<p class="tooth-detail-empty">Pick a date to see open slots.</p>';
        renderDentistOptions();
      });
      grid.appendChild(opt);
    });
  }

  /* ============================================================
     RESCHEDULE MODAL — single-step, pick a new date/time for an
     existing appointment. PUT /appointments/:id/reschedule
     ============================================================ */
  function initRescheduleModal() {
    const scrim = document.getElementById('rescheduleScrim');
    const r = state.reschedule;

    document.getElementById('rescheduleClose').addEventListener('click', closeReschedule);
    document.getElementById('rescheduleCancel').addEventListener('click', closeReschedule);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeReschedule(); });

    document.getElementById('rescheduleDate').addEventListener('change', async (e) => {
      r.date = e.target.value;
      r.slot = null;
      await loadSlotsForSelection(r, 'rescheduleSlotGrid');
    });

    document.getElementById('rescheduleConfirm').addEventListener('click', submitReschedule);

    function closeReschedule() { scrim.classList.remove('is-open'); }

    async function submitReschedule() {
      if (!r.date || !r.slot) return showToast('Pick a date and time slot');
      const btn = document.getElementById('rescheduleConfirm');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const start = new Date(r.slot);
        const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
        const updated = await fetchMethod(`/appointments/${r.appointmentId}/reschedule`, 'PUT', {
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
        }, true);

        const idx = state.appointments.findIndex((a) => a.id === r.appointmentId);
        if (idx > -1) state.appointments[idx] = updated;
        state.selectedDate = startOfDay(start);
        renderDateLabel();
        renderAll();
        closeReschedule();
        showToast('Appointment rescheduled');
      } catch (err) {
        showToast(err.message || 'Could not reschedule that appointment');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm new time';
      }
    }
  }

  function openRescheduleModal(appt) {
    const r = state.reschedule;
    r.appointmentId = appt.id;
    r.dentistId = appt.dentist_id;
    r.date = null;
    r.slot = null;
    r.availableSlots = [];
    document.getElementById('rescheduleDate').value = '';
    document.getElementById('rescheduleDate').min = todayISODate();
    document.getElementById('rescheduleSlotGrid').innerHTML =
      '<p class="tooth-detail-empty">Pick a date to see open slots.</p>';
    document.getElementById('rescheduleScrim').classList.add('is-open');
  }

  /* ============================================================
     SHARED SLOT-LOADING (booking + reschedule)
     ============================================================ */
  async function loadSlotsForSelection(target, gridId) {
    const grid = document.getElementById(gridId);
    const dentistId = target.dentistId;
    if (!dentistId || !target.date) return;
    grid.innerHTML = '<p class="tooth-detail-empty">Checking availability…</p>';

    try {
      const dayOfWeek = new Date(target.date + 'T00:00:00').getDay();
      const [schedule, dayAppointments] = await Promise.all([
        fetchMethod(`/dentist-schedules/${dentistId}`, 'GET', null, true),
        fetchMethod(
          `/appointments/dentist/${dentistId}?from=${target.date}T00:00:00&to=${target.date}T23:59:59`,
          'GET', null, true
        ),
      ]);

      const windows = schedule.filter((s) => s.day_of_week === dayOfWeek);
      const bookedStarts = new Set(
        dayAppointments
          .filter((a) => a.status !== 'cancelled' && a.id !== target.appointmentId)
          .map((a) => a.scheduled_start)
      );

      target.availableSlots = [];
      windows.forEach((w) => {
        let cursor = toMinutes(w.start_time);
        const end = toMinutes(w.end_time);
        while (cursor + SLOT_MINUTES <= end) {
          const iso = `${target.date}T${minutesToTimeStr(cursor)}:00`;
          if (!bookedStarts.has(iso)) target.availableSlots.push(iso);
          cursor += SLOT_MINUTES;
        }
      });

      renderSlots(target, gridId);
    } catch (err) {
      grid.innerHTML = '<p class="tooth-detail-empty">Could not load availability for that date.</p>';
      showToast(err.message || 'Could not load availability');
    }
  }

  function renderSlots(target, gridId) {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';
    if (!target.availableSlots.length) {
      grid.innerHTML = '<p class="tooth-detail-empty">No open slots that day — try another date.</p>';
      return;
    }
    target.availableSlots.forEach((iso) => {
      const opt = document.createElement('div');
      opt.className = 'slot-opt' + (target.slot === iso ? ' is-selected' : '');
      opt.textContent = formatTime(new Date(iso));
      opt.addEventListener('click', () => { target.slot = iso; renderSlots(target, gridId); });
      grid.appendChild(opt);
    });
  }

  /* ============================================================
     DATE / TIME UTILITIES
     ============================================================ */
  function startOfDay(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  function startOfWeek(d) {
    const c = startOfDay(d);
    c.setDate(c.getDate() - c.getDay()); // back up to Sunday
    return c;
  }

  function sameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function todayISODate() {
    return dateToISODateStr(new Date());
  }

  function dateToISODateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatHourLabel(h) {
    const period = h < 12 || h === 24 ? 'am' : 'pm';
    let displayHour = h % 12;
    if (displayHour === 0) displayHour = 12;
    return `${displayHour}${period}`;
  }

  function formatTime(d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function formatDate(iso) {
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(d) {
    return `${d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(d)}`;
  }

  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToTimeStr(mins) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  /* ============================================================
     GENERAL UTILITIES
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

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }



  
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
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