(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Assumes api.js (fetchMethod, getStoredUser, clearSession) is
     loaded before this file. Adjust the login path below to match
     your actual public/ folder layout.
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
    appointments: [],
    dentists: [],
    toothChart: {},     // keyed by tooth_number
    bills: [],
    treatmentPlans: [],
    consentForms: [],
    booking: { step: 1, dentistId: null, date: null, slot: null, reason: '', availableSlots: [] },
  };

  const CONDITION_LABEL = {
    healthy: 'Healthy', caries: 'Caries', filled: 'Filled', missing: 'Missing', crown: 'Crown',
  };
  const UPPER_ARCH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER_ARCH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const SLOT_MINUTES = 30;

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initBookingModal();
    loadDashboard();
  });

  async function loadDashboard() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      document.getElementById('patientFirstName').textContent = patient.first_name;

      const [appts, chart, dentistList, bills, plans, consentForms, files] = await Promise.all([
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/tooth-chart/patient/${patient.id}/current`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true),
        fetchMethod(`/bills/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/treatment-plans/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/consent-forms/patient/${patient.id}`, 'GET', null, true),
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
      state.bills = bills;
      state.treatmentPlans = plans;
      state.consentForms = consentForms;
      state.toothChart = {};
      chart.forEach((entry) => { state.toothChart[entry.tooth_number] = entry; });

      renderStats();
      renderAppointments();
      renderOdontogram();
      renderDentistOptions();
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
    showToast(err.message || 'Could not load your dashboard. Please refresh.');
  }

  /* ============================================================
     STATS
     ------------------------------------------------------------
     - Upcoming appointments: future, not cancelled.
     - Outstanding balance: sum of (total_amount - amount_paid) across
       bills whose status isn't 'paid' or 'void'.
     - Active treatment plans: status in ('approved','in_progress').
     - Consent forms pending: forms issued (via POST /consent-forms)
       but not yet signed — signed_at is null until PUT /:id/sign.
     ============================================================ */
  function renderStats() {
    const now = new Date();

    const upcoming = state.appointments.filter(
      (a) => a.status !== 'cancelled' && new Date(a.scheduled_start) >= now
    );
    document.getElementById('statUpcoming').textContent = upcoming.length;

    const balance = state.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'void')
      .reduce((sum, b) => sum + (Number(b.total_amount) - Number(b.amount_paid || 0)), 0);
    document.getElementById('statBalance').textContent = 'KSh ' + balance.toLocaleString('en-KE');

    const activePlans = state.treatmentPlans.filter(
      (p) => p.status === 'approved' || p.status === 'in_progress'
    );
    document.getElementById('statPlans').textContent = activePlans.length;

    const pendingConsent = state.consentForms.filter((f) => !f.signed_at);
    document.getElementById('statConsent').textContent = pendingConsent.length;
  }

  /* ============================================================
     APPOINTMENTS
     ============================================================ */
  function renderAppointments() {
    const list = document.getElementById('apptList');
    list.innerHTML = '';

    const now = new Date();
    const upcoming = state.appointments
      .filter((a) => a.status !== 'cancelled' && new Date(a.scheduled_start) >= now)
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

    if (!upcoming.length) {
      list.innerHTML = '<div class="empty-state">No upcoming appointments. Book one to get started.</div>';
      return;
    }

    upcoming.forEach((appt) => {
      const start = new Date(appt.scheduled_start);
      const day = start.getDate();
      const month = start.toLocaleString('en-US', { month: 'short' });
      const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const dentistName = dentistNameById(appt.dentist_id);

      const row = document.createElement('div');
      row.className = 'appt-item';
      row.innerHTML = `
        <div class="appt-date"><div class="d">${day}</div><div class="m">${month}</div></div>
        <div class="appt-mid">
          <p class="t">${escapeHtml(appt.reason || 'Appointment')}</p>
          <p class="s">${escapeHtml(dentistName)} · ${escapeHtml(time)}</p>
        </div>
        <span class="badge badge-${appt.status}">${capitalize(appt.status)}</span>
        <div class="appt-actions">
          <button class="icon-link-btn" title="Reschedule" data-action="reschedule" data-id="${appt.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 1 3 6.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3 21v-5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-link-btn" title="Cancel" data-action="cancel" data-id="${appt.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
      btn.addEventListener('click', () => cancelAppointment(btn.getAttribute('data-id')));
    });
    list.querySelectorAll('[data-action="reschedule"]').forEach((btn) => {
      btn.addEventListener('click', () => showToast('Open the reschedule flow from My Appointments'));
    });
  }

  async function cancelAppointment(id) {
    try {
      await fetchMethod(`/appointments/${id}`, 'DELETE', null, true);
      const idx = state.appointments.findIndex((a) => a.id === id);
      if (idx > -1) state.appointments[idx].status = 'cancelled';
      renderAppointments();
      renderStats();
      showToast('Appointment cancelled');
    } catch (err) {
      showToast(err.message || 'Could not cancel that appointment');
    }
  }

  function dentistNameById(id) {
    const d = state.dentists.find((x) => x.id === id);
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Dentist';
  }

  /* ============================================================
     ODONTOGRAM — oval anatomical layout, SVG-based
     ============================================================ */
  const FDI_QUADRANT = { 1: 'Maxillary Right', 2: 'Maxillary Left', 3: 'Mandibular Left', 4: 'Mandibular Right' };
  const FDI_POSITION = {
    1: 'Central Incisor', 2: 'Lateral Incisor', 3: 'Canine', 4: 'First Premolar',
    5: 'Second Premolar', 6: 'First Molar', 7: 'Second Molar', 8: 'Third Molar',
  };
  function toothName(number) {
    const quadrant = Math.floor(number / 10);
    const position = number % 10;
    return `${FDI_QUADRANT[quadrant]} ${FDI_POSITION[position]}`;
  }

  function renderOdontogram() {
    const svg = document.getElementById('odontogramSvg');
    svg.innerHTML = '';

    // Every real tooth number: quadrant digit (1-4) + position digit (1-8).
    const ALL_TEETH = [...UPPER_ARCH, ...LOWER_ARCH];

    ALL_TEETH.forEach((num) => {
      const quadrant = Math.floor(num / 10);
      const position = num % 10;
      const shape = TOOTH_SHAPES[position];
      if (!shape) return;

      const entry = state.toothChart[num];
      const rawCondition = entry ? entry.condition : 'healthy';
      const condition = CONDITION_LABEL[rawCondition] ? rawCondition : 'healthy';

      // Outer <g> only ever carries the quadrant-mirroring transform
      // attribute and nothing else -- no class, no CSS rules -- so the
      // hover-scale CSS transform on the inner group below can never
      // clobber it (a CSS transform on an element overrides that same
      // element's SVG transform attribute, which was silently wiping
      // out the mirroring and stacking all four quadrants on top of
      // each other).
      const quadrantGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      quadrantGroup.setAttribute('transform', QUADRANT_TRANSFORM[quadrant] || '');

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `tooth-svg cond-${condition}`);
      g.setAttribute('data-tooth', num);
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Tooth ${num}, ${entry ? entry.condition : 'Healthy'}`);

      const highlightPaths = Array.isArray(shape.highlight) ? shape.highlight : [shape.highlight];
      g.innerHTML = `
        <title>Tooth ${num} — ${shape.type}</title>
        <path class="tooth-outline" d="${shape.outline}"></path>
        <path class="tooth-fill" d="${shape.fill}"></path>
        ${highlightPaths.map((d) => `<path class="tooth-highlight" d="${d}"></path>`).join('')}
      `;
      g.addEventListener('click', () => selectTooth(num));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTooth(num); }
      });
      quadrantGroup.appendChild(g);
      svg.appendChild(quadrantGroup);
    });
  }

  async function selectTooth(number) {
    document.querySelectorAll('.tooth-svg').forEach((t) => t.classList.remove('is-selected'));
    const el = document.querySelector(`.tooth-svg[data-tooth="${number}"]`);
    if (el) el.classList.add('is-selected');

    const detail = document.getElementById('toothDetail');
    detail.innerHTML = '<p class="tooth-detail-empty">Loading history…</p>';

    try {
      const history = await fetchMethod(
        `/tooth-chart/patient/${state.patientId}/tooth/${number}`, 'GET', null, true
      );

      if (!history.length) {
        detail.innerHTML = `
          <p class="tooth-detail-title">Tooth ${number}</p>
          <p class="tooth-detail-sub">${toothName(number)}</p>
          <p class="tooth-detail-empty">No conditions on record for this tooth.</p>
        `;
        return;
      }

      const rows = history.map((h) => {
        const d = new Date(h.recorded_at);
        const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const day = d.getDate();
        const dentist = dentistNameById(h.recorded_by);
        const appt = state.appointments.find((a) => a.id === h.appointment_id);

        return `
          <div class="timeline-item">
            <div class="timeline-row">
              <span class="timeline-date">${month} ${day}</span>
              <span><b>${escapeHtml(CONDITION_LABEL[h.condition] || capitalize(h.condition))}</b>Condition</span>
              <span><b>${escapeHtml(dentist)}</b>Dentist</span>
            </div>
            ${appt ? `<div class="timeline-row"><span>Reason: ${escapeHtml(appt.reason || '—')}</span></div>` : ''}
            ${h.notes ? `<div class="timeline-note">${escapeHtml(h.notes)}</div>` : ''}
          </div>
        `;
      }).join('');

      detail.innerHTML = `
        <p class="tooth-detail-title">Tooth ${number}</p>
        <p class="tooth-detail-sub">${toothName(number)}</p>
        <div class="timeline">${rows}</div>
      `;
    } catch (err) {
      detail.innerHTML = '<p class="tooth-detail-empty">Could not load this tooth\'s history.</p>';
    }
  }

  /* ============================================================
     SIDEBAR + NAV
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
      link.addEventListener('click', (e) => {
        const page = link.getAttribute('data-page');
        if (hasRealHref) {
          // Built page — let the browser navigate there normally.
          closeSidebar();
          return;
        }
        e.preventDefault();
        document.querySelectorAll('.side-link[data-page]').forEach((l) => l.classList.remove('is-active'));
        const target = document.querySelector(`.side-link[data-page="${page}"]`);
        if (target) target.classList.add('is-active');
        closeSidebar();
        if (page !== 'overview') showToast(pageLabel(page) + ' — build next in the portal.');
      });
    });
  }

  function pageLabel(page) {
    const map = {
      appointments: 'My Appointments', toothchart: 'Tooth Chart', billing: 'Billing & Payments',
      treatments: 'Treatment Plans', prescriptions: 'Prescriptions', documents: 'Documents',
      consent: 'Consent Forms', referrals: 'Referrals', profile: 'Profile & Settings',
    };
    return map[page] || page;
  }

  /* ============================================================
     BOOKING MODAL — 3-step wizard, wired to real endpoints
     ------------------------------------------------------------
     Slot generation is an approximation: there is no dedicated
     availability endpoint yet. This reads the dentist's recurring
     weekly schedule (GET /dentist-schedules/:dentistId), filters
     to the chosen date's weekday, generates 30-min slots across
     each active window, then removes any slot whose start matches
     an already-booked appointment for that dentist that day
     (GET /appointments/dentist/:dentistId?from=&to=). It does not
     catch partial overlaps (e.g. a 45-min appointment blocking two
     slots) — worth a real availability endpoint later.
     ============================================================ */
  function initBookingModal() {
    const scrim = document.getElementById('modalScrim');
    const b = state.booking;

    document.getElementById('openBooking').addEventListener('click', openModal);
    document.getElementById('quickBook').addEventListener('click', openModal);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeModal(); });

    document.getElementById('apptDate').addEventListener('change', async (e) => {
      b.date = e.target.value;
      b.slot = null;
      await loadSlotsForSelection();
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

    async function loadSlotsForSelection() {
      const grid = document.getElementById('slotGrid');
      if (!b.dentistId || !b.date) return;
      grid.innerHTML = '<p class="tooth-detail-empty">Checking availability…</p>';

      try {
        const dayOfWeek = new Date(b.date + 'T00:00:00').getDay();
        const [schedule, dayAppointments] = await Promise.all([
          fetchMethod(`/dentist-schedules/${b.dentistId}`, 'GET', null, true),
          fetchMethod(
            `/appointments/dentist/${b.dentistId}?from=${b.date}T00:00:00&to=${b.date}T23:59:59`,
            'GET', null, true
          ),
        ]);

        const windows = schedule.filter((s) => s.day_of_week === dayOfWeek);
        const bookedStarts = new Set(
          dayAppointments.filter((a) => a.status !== 'cancelled').map((a) => a.scheduled_start)
        );

        b.availableSlots = [];
        windows.forEach((w) => {
          let cursor = toMinutes(w.start_time);
          const end = toMinutes(w.end_time);
          while (cursor + SLOT_MINUTES <= end) {
            const iso = `${b.date}T${minutesToTimeStr(cursor)}:00`;
            if (!bookedStarts.has(iso)) b.availableSlots.push(iso);
            cursor += SLOT_MINUTES;
          }
        });

        renderSlots();
      } catch (err) {
        grid.innerHTML = '<p class="tooth-detail-empty">Could not load availability for that date.</p>';
        showToast(err.message || 'Could not load availability');
      }
    }

    function renderSlots() {
      const grid = document.getElementById('slotGrid');
      grid.innerHTML = '';
      if (!b.availableSlots.length) {
        grid.innerHTML = '<p class="tooth-detail-empty">No open slots that day — try another date.</p>';
        return;
      }
      b.availableSlots.forEach((iso) => {
        const label = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const opt = document.createElement('div');
        opt.className = 'slot-opt' + (b.slot === iso ? ' is-selected' : '');
        opt.textContent = label;
        opt.addEventListener('click', () => { b.slot = iso; renderSlots(); });
        grid.appendChild(opt);
      });
    }

    function goToStep(step) {
      if (step < 1 || step > 3) return;
      b.step = step;

      document.querySelectorAll('.wizard-step').forEach((s) => {
        s.classList.toggle('is-active', Number(s.getAttribute('data-step')) === step);
      });
      document.querySelectorAll('.prog-step').forEach((s) => {
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
      const summaryEl = document.getElementById('confirmSummary');
      summaryEl.innerHTML = `
        <div class="confirm-row"><span>Dentist</span><b>${escapeHtml(dentist ? `Dr. ${dentist.first_name} ${dentist.last_name}` : '—')}</b></div>
        <div class="confirm-row"><span>Date</span><b>${b.date ? formatDate(b.date) : '—'}</b></div>
        <div class="confirm-row"><span>Time</span><b>${b.slot ? new Date(b.slot).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}</b></div>
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
        renderAppointments();
        renderStats();
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

  function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function formatDate(iso) {
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
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