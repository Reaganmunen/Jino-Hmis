/* ============================================================
   JinoSlots — shared appointment-slot helpers
   ------------------------------------------------------------
   One place that decides which start times are offered, so the
   patient booking wizard, patient reschedule, and the receptionist
   booking / edit / reschedule modals all behave the same way.

   Rules applied by buildSlots():
   1. Slots come from the dentist's weekly schedule windows for the
      chosen date's weekday.
   2. A slot is hidden if it starts before "now" (so at 2:10 pm the
      first offered slot is 2:30 pm). Only affects today.
   3. A slot is hidden if it would overlap any non-cancelled
      appointment for that dentist. This is a real interval check, so
      a 60-minute appointment blocks both of the 30-minute slots it
      covers. (Times are compared as instants, so the UTC strings the
      API returns line up with the local slot times.)
   4. For a longer appointment, every slot must fit entirely inside
      one schedule window.

   Slot values are local, timezone-less strings: 'YYYY-MM-DDTHH:MM:00'.
   `new Date(value)` reads them as local time, which is what the
   existing pages already do.
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULT_STEP = 30;

  function pad(n) { return String(n).padStart(2, '0'); }

  function toMinutes(timeStr) {
    const [h, m] = String(timeStr).split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToTimeStr(mins) {
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }

  function dateToISODateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayISODate() {
    return dateToISODateStr(new Date());
  }

  // "Now" rounded down to the minute, so a slot starting at exactly the
  // current minute is still offered.
  function nowFloor() {
    const n = new Date();
    n.setSeconds(0, 0);
    return n;
  }

  /**
   * @param {object}   opts
   * @param {string}   opts.dateStr        'YYYY-MM-DD' (local date picked by the user)
   * @param {Array}    opts.schedule       rows from GET /dentist-schedules/:id
   *                                       ({ day_of_week, start_time, end_time })
   * @param {Array}    opts.appointments   that dentist's appointments for the day
   * @param {number}   [opts.step=30]      gap between offered start times (minutes)
   * @param {number}   [opts.duration=step] appointment length (minutes)
   * @param {*}        [opts.ignoreId]     appointment id to ignore (editing/rescheduling it)
   * @param {Date}     [opts.now]          override for tests
   * @returns {string[]} local slot start strings, in time order
   */
  function buildSlots(opts) {
    const {
      dateStr, schedule = [], appointments = [],
      step = DEFAULT_STEP, ignoreId = null,
    } = opts;
    const duration = opts.duration || step;
    const now = opts.now || nowFloor();

    if (!dateStr) return [];

    const dayOfWeek = new Date(`${dateStr}T00:00:00`).getDay();
    const windows = schedule.filter((s) => Number(s.day_of_week) === dayOfWeek);

    const busy = appointments
      .filter((a) => a.status !== 'cancelled' && !a.deleted_at
        && (ignoreId == null || String(a.id) !== String(ignoreId)))
      .map((a) => ({ start: new Date(a.scheduled_start).getTime(), end: new Date(a.scheduled_end).getTime() }));

    const seen = new Set();
    const slots = [];

    windows.forEach((w) => {
      const winEnd = toMinutes(w.end_time);
      for (let cursor = toMinutes(w.start_time); cursor + duration <= winEnd; cursor += step) {
        const iso = `${dateStr}T${minutesToTimeStr(cursor)}:00`;
        if (seen.has(iso)) continue; // overlapping windows shouldn't duplicate a slot

        const start = new Date(iso);
        if (start.getTime() < now.getTime()) continue; // already passed

        const s = start.getTime();
        const e = s + duration * 60000;
        if (busy.some((b) => s < b.end && e > b.start)) continue; // clashes with a booking

        seen.add(iso);
        slots.push(iso);
      }
    });

    return slots.sort();
  }

  function isInPast(isoOrDate) {
    return new Date(isoOrDate).getTime() < nowFloor().getTime();
  }

  function formatSlotLabel(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /* ------------------------------------------------------------
     createSlotPicker — a ready-made date + duration + slot grid for
     the receptionist modals (needs api.js's fetchMethod).

     opts:
       dateInput, grid        DOM elements (required)
       durationSelect         <select> of minutes (optional; default 30)
       getDentistId()         current dentist id, or falsy if none picked yet
       getIgnoreId()          appointment id being edited/rescheduled (optional)

     Returns { reload, reset, getSlot, getDuration, setDuration, setSlot }.
     setSlot(iso, { pin: true }) keeps that time visible & selected even
     though it has passed — used when editing an existing appointment
     so notes/room can be changed without forcing a new time.
     ------------------------------------------------------------ */
  function createSlotPicker(opts) {
    const { dateInput, grid, durationSelect } = opts;
    const getDentistId = opts.getDentistId || (() => null);
    const getIgnoreId = opts.getIgnoreId || (() => null);
    const scheduleCache = new Map(); // dentistId -> weekly schedule rows

    let slots = [];
    let selected = null;
    let pinned = null;
    let requestSeq = 0;

    const hint = (text) => { grid.innerHTML = `<p class="tooth-detail-empty">${text}</p>`; };

    function getDuration() {
      return durationSelect ? Number(durationSelect.value) || DEFAULT_STEP : DEFAULT_STEP;
    }

    function setDuration(mins) {
      if (!durationSelect) return;
      const rounded = Math.max(DEFAULT_STEP, Math.round(mins) || DEFAULT_STEP);
      if (![...durationSelect.options].some((o) => Number(o.value) === rounded)) {
        const opt = document.createElement('option');
        opt.value = String(rounded);
        opt.textContent = `${rounded} min`;
        durationSelect.appendChild(opt);
      }
      durationSelect.value = String(rounded);
    }

    function render() {
      const list = slots.slice();
      if (pinned && pinned.startsWith(dateInput.value) && !list.includes(pinned)) {
        list.push(pinned);
        list.sort();
      }
      if (!list.length) {
        hint(dateInput.value === todayISODate()
          ? 'No more open slots today — try another date.'
          : 'No open slots that day — try another date.');
        return;
      }
      grid.innerHTML = '';
      list.forEach((iso) => {
        const opt = document.createElement('div');
        opt.className = 'slot-opt' + (selected === iso ? ' is-selected' : '');
        opt.setAttribute('role', 'button');
        opt.textContent = formatSlotLabel(iso) + (iso === pinned && !slots.includes(iso) ? ' (current)' : '');
        opt.addEventListener('click', () => { selected = iso; render(); });
        grid.appendChild(opt);
      });
    }

    async function reload() {
      const dentistId = getDentistId();
      const dateStr = dateInput.value;
      if (!dentistId) { slots = []; selected = null; return hint('Choose a dentist first.'); }
      if (!dateStr) { slots = []; selected = null; return hint('Pick a date to see open slots.'); }

      const seq = ++requestSeq;
      hint('Checking availability…');
      try {
        if (!scheduleCache.has(String(dentistId))) {
          scheduleCache.set(String(dentistId), await fetchMethod(`/dentist-schedules/${dentistId}`, 'GET', null, true));
        }
        const appointments = await fetchMethod(
          `/appointments/dentist/${dentistId}?from=${dateStr}T00:00:00&to=${dateStr}T23:59:59`,
          'GET', null, true
        );
        if (seq !== requestSeq) return; // a newer request superseded this one

        slots = buildSlots({
          dateStr,
          schedule: scheduleCache.get(String(dentistId)),
          appointments,
          step: DEFAULT_STEP,
          duration: getDuration(),
          ignoreId: getIgnoreId(),
        });
        if (selected && !slots.includes(selected) && selected !== pinned) selected = null;
        render();
      } catch (err) {
        if (seq !== requestSeq) return;
        slots = [];
        selected = null;
        hint('Could not load availability for that date.');
      }
    }

    dateInput.min = todayISODate();
    dateInput.addEventListener('change', () => { selected = null; reload(); });
    if (durationSelect) durationSelect.addEventListener('change', () => { selected = null; reload(); });

    return {
      reload,
      getSlot: () => selected,
      getDuration,
      setDuration,
      setSlot(iso, { pin = false } = {}) { selected = iso; pinned = pin ? iso : null; },
      reset() {
        slots = []; selected = null; pinned = null; requestSeq++;
        dateInput.value = '';
        dateInput.min = todayISODate();
        if (durationSelect) durationSelect.value = String(DEFAULT_STEP);
        hint('Pick a date to see open slots.');
      },
    };
  }

  global.JinoSlots = {
    buildSlots, isInPast, todayISODate, dateToISODateStr, toMinutes, minutesToTimeStr,
    formatSlotLabel, createSlotPicker,
  };
})(window);
