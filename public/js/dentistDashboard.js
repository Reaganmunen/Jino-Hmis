(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors dashboard.js's guard, but for the 'dentist' role.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'dentist') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id, // dentist_id references User.id directly — no separate Dentist table
    appointments: [],          // today's appointments for this dentist
    diagnoses: [],             // today's diagnoses logged by this dentist (drives the stat card)
    recentDiagnoses: [],       // last 7 days, for the "Recent diagnoses" panel
    prescriptions: [],         // today's prescriptions written by this dentist
    activePlans: [],           // this dentist's treatment plans still in flight
    patients: [],               // full roster, for name lookups + local search
    patientsById: {},
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPatientSearch();
    loadDashboard();
  });

  /* ============================================================
     INIT
     ============================================================ */
  async function loadDashboard() {
    try {
      document.getElementById('dentistName').textContent = `Dr. ${sessionUser.last_name}`;
      renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);

      const { from, to } = todayRangeIso();
      const recentFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [appts, diagnoses, recentDiagnoses, prescriptions, activePlans, patients] = await Promise.all([
        fetchMethod(`/appointments/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod(`/diagnoses/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod(`/diagnoses/dentist/${state.dentistId}?from=${recentFrom}&to=${to}`, 'GET', null, true),
        fetchMethod(`/prescriptions/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod(`/treatment-plans/dentist/${state.dentistId}/active`, 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
      ]);

      state.appointments = appts;
      state.diagnoses = diagnoses;
      state.recentDiagnoses = recentDiagnoses;
      state.prescriptions = prescriptions;
      state.activePlans = activePlans;
      state.patients = patients;
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });

      renderStats();
      renderSchedule();
      renderActivePlans();
      renderRecentDiagnoses();
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
     - Today's appointments: all non-cancelled appointments for
       this dentist today.
     - Patients seen today: distinct patients across appointments
       whose status is 'completed'.
     - Pending diagnoses/notes: completed appointments today that
       have no matching Diagnosis row (by appointment_id) yet.
     - Prescriptions written today: count of Prescription rows this
       dentist created today.
     ============================================================ */
  function renderStats() {
    const active = state.appointments.filter((a) => a.status !== 'cancelled');
    document.getElementById('statTodayAppts').textContent = active.length;

    const completed = state.appointments.filter((a) => a.status === 'completed');
    const seenPatientIds = new Set(completed.map((a) => a.patient_id));
    document.getElementById('statPatientsSeen').textContent = seenPatientIds.size;

    const notedAppointmentIds = new Set(state.diagnoses.map((d) => d.appointment_id));
    const pendingNotes = completed.filter((a) => !notedAppointmentIds.has(a.id));
    document.getElementById('statPendingNotes').textContent = pendingNotes.length;

    document.getElementById('statPrescriptions').textContent = state.prescriptions.length;
  }

  /* ============================================================
     TODAY'S SCHEDULE
     ============================================================ */
  function renderSchedule() {
    const list = document.getElementById('schedList');
    list.innerHTML = '';

    const active = state.appointments
      .filter((a) => a.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

    if (!active.length) {
      list.innerHTML = '<div class="empty-state">No appointments on today\'s schedule.</div>';
      return;
    }

    const notedAppointmentIds = new Set(state.diagnoses.map((d) => d.appointment_id));

    active.forEach((appt) => {
      const patient = state.patientsById[appt.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const time = new Date(appt.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const needsNotes = appt.status === 'completed' && !notedAppointmentIds.has(appt.id);

      const row = document.createElement('div');
      row.className = 'sched-item';
      row.innerHTML = `
        <div class="sched-time">${escapeHtml(time)}</div>
        <div class="sched-avatar">${initialsOf(patientName)}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(patientName)}</p>
          <p class="s">${escapeHtml(appt.reason || 'Appointment')}${appt.room ? ' · ' + escapeHtml(appt.room) : ''}</p>
        </div>
        <div class="sched-flags">
          ${needsNotes ? '<span class="badge badge-needs-notes">Needs notes</span>' : ''}
          <span class="badge badge-${appt.status}">${capitalize(appt.status)}</span>
        </div>
      `;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openPatientChart(appt.patient_id, appt.id));
      list.appendChild(row);
    });
  }

  /* ============================================================
     ACTIVE TREATMENT PLANS
     ------------------------------------------------------------
     This dentist's plans still in flight (approved / in_progress),
     across all their patients — the clearest "what do I still owe
     these patients" view.
     ============================================================ */
  function renderActivePlans() {
    const list = document.getElementById('planList');
    list.innerHTML = '';

    if (!state.activePlans.length) {
      list.innerHTML = '<div class="empty-state">No active treatment plans right now.</div>';
      return;
    }

    state.activePlans.forEach((plan) => {
      const patient = state.patientsById[plan.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const cost = plan.estimated_cost != null
        ? 'KSh ' + Number(plan.estimated_cost).toLocaleString('en-KE')
        : '';

      const item = document.createElement('div');
      item.className = 'plan-item';
      item.innerHTML = `
        <div class="plan-item-head">
          <p class="t">${escapeHtml(patientName)}</p>
          <span class="badge badge-${plan.status}">${capitalize(plan.status.replace('_', ' '))}</span>
        </div>
        <p class="s">${escapeHtml(plan.description || 'No description')}</p>
        ${cost ? `<p class="s cost">${escapeHtml(cost)}</p>` : ''}
      `;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => openPatientChart(plan.patient_id));
      list.appendChild(item);
    });
  }

  /* ============================================================
     RECENT DIAGNOSES
     ------------------------------------------------------------
     Last 7 days of this dentist's clinical notes — a quick log to
     scan back through, separate from the "today only" stat card.
     ============================================================ */
  function renderRecentDiagnoses() {
    const list = document.getElementById('diagnosisList');
    list.innerHTML = '';

    if (!state.recentDiagnoses.length) {
      list.innerHTML = '<div class="empty-state">No diagnoses logged in the last 7 days.</div>';
      return;
    }

    state.recentDiagnoses.slice(0, 8).forEach((d) => {
      const patient = state.patientsById[d.patient_id];
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient';
      const when = new Date(d.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      const teeth = Array.isArray(d.tooth_refs) ? d.tooth_refs : [];

      const item = document.createElement('div');
      item.className = 'diagnosis-item';
      item.innerHTML = `
        <div class="diagnosis-item-head">
          <p class="t">${escapeHtml(patientName)}</p>
          <span class="when">${escapeHtml(when)}</span>
        </div>
        <p class="s">${escapeHtml(d.diagnosis_text || '')}</p>
        ${teeth.map((t) => `<span class="diagnosis-tooth-pill">FDI ${escapeHtml(String(t))}</span>`).join('')}
      `;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => openPatientChart(d.patient_id));
      list.appendChild(item);
    });
  }

  /* ============================================================
     PATIENT SEARCH
     ------------------------------------------------------------
     Filters the already-fetched roster client-side. If the patient
     list grows large, swap this for the server-side GET
     /patients/search?q= endpoint instead.
     ============================================================ */
  function initPatientSearch() {
    const input = document.getElementById('patientSearchInput');
    input.addEventListener('input', () => renderPatientResults(input.value.trim()));
  }

  function renderPatientResults(query) {
    const container = document.getElementById('patientResults');
    container.innerHTML = '';

    if (!query) return;

    const q = query.toLowerCase();
    const matches = state.patients.filter((p) => {
      return (
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        (p.phone || '').includes(q) ||
        (p.national_id || '').toLowerCase().includes(q)
      );
    }).slice(0, 8);

    if (!matches.length) {
      container.innerHTML = '<div class="empty-state">No patients match that search.</div>';
      return;
    }

    matches.forEach((p) => {
      const name = `${p.first_name} ${p.last_name}`;
      const row = document.createElement('div');
      row.className = 'patient-row';
      row.innerHTML = `
        <div class="sched-avatar">${initialsOf(name)}</div>
        <div>
          <p class="t">${escapeHtml(name)}</p>
          <p class="s">${escapeHtml(p.phone || p.email || '')}</p>
        </div>
        <a class="panel-link" href="#">View chart</a>
      `;
      row.querySelector('.panel-link').addEventListener('click', (e) => {
        e.preventDefault();
        openPatientChart(p.id);
      });
      container.appendChild(row);
    });
  }

  // Patient chart page isn't built yet — this is the deliberate hook for it.
  // Swap the URL once dentist-patient-chart.html exists.
  function openPatientChart(patientId, appointmentId) {
    const params = new URLSearchParams({ patientId });
    if (appointmentId) params.set('appointmentId', appointmentId);
    window.location.href = `dentist-patient-chart.html?${params.toString()}`;
  }

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as dashboard.js
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
  function todayRangeIso() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
  }

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

  function renderTopbarAvatar(name) {
    document.getElementById('avatarInitials').textContent = initialsOf(name);
  }
})();