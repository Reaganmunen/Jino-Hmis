(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Mirrors dentistDashboard.js's guard, but for the 'admin' role.
     ============================================================ */
  const LOGIN_PATH = '../login.html';

  const sessionUser = getStoredUser();
  if (!sessionUser || sessionUser.role !== 'admin') {
    window.location.href = LOGIN_PATH;
    return;
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    summary: null,
    revenueTrend: [],
    topServices: [],
    workload: [],
    schedule: [],
    lowStock: [],
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    loadDashboard();
  });

  /* ============================================================
     INIT
     ============================================================ */
  async function loadDashboard() {
    try {
      document.getElementById('adminName').textContent = sessionUser.first_name;
      document.getElementById('greetingText').textContent = getGreeting();
      renderTopbarAvatar(`${sessionUser.first_name} ${sessionUser.last_name}`);

      const { from, to } = todayRangeIso();

      const [summary, revenueTrend, topServices, workload, schedule, lowStock] = await Promise.all([
        fetchMethod(`/admin/stats/summary?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod('/admin/stats/revenue-trend?days=14', 'GET', null, true),
        fetchMethod('/admin/stats/top-services?limit=5', 'GET', null, true),
        fetchMethod(`/admin/stats/workload?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod(`/admin/schedule?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod('/inventory-items/low-stock', 'GET', null, true),
      ]);

      state.summary = summary;
      state.revenueTrend = revenueTrend;
      state.topServices = topServices;
      state.workload = workload;
      state.schedule = schedule;
      state.lowStock = lowStock;

      renderStats();
      renderSchedule();
      renderRevenueChart();
      renderAlerts();
      renderTopServices();
      renderWorkload();
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
     STAT CARDS
     ============================================================ */
  function renderStats() {
    const s = state.summary;

    document.getElementById('statTotalPatients').textContent = s.patients.total_patients;
    document.getElementById('statNewPatients').textContent = s.patients.new_this_month;

    document.getElementById('statRevenueToday').textContent = formatKsh(s.revenueToday);
    document.getElementById('statRevenueMonth').textContent = formatKsh(s.revenueThisMonth);

    const counts = {};
    s.appointmentStatusCounts.forEach((row) => { counts[row.status] = Number(row.count); });
    const totalAppts = Object.values(counts).reduce((sum, n) => sum + n, 0);
    document.getElementById('statApptsToday').textContent = totalAppts;
    document.getElementById('statApptsCompleted').textContent = counts.completed || 0;
    document.getElementById('statApptsNoShow').textContent = counts.no_show || 0;

    const staffTotal = s.staff.reduce((sum, row) => sum + Number(row.count), 0);
    document.getElementById('statActiveStaff').textContent = staffTotal;

    const alertDot = document.getElementById('alertDot');
    alertDot.style.display = state.lowStock.length || s.outstandingBalance > 0 ? 'block' : 'none';
  }

  /* ============================================================
     TODAY'S CLINIC-WIDE SCHEDULE
     ============================================================ */
  function renderSchedule() {
    const list = document.getElementById('schedList');
    list.innerHTML = '';

    const active = state.schedule
      .filter((a) => a.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

    if (!active.length) {
      list.innerHTML = '<div class="empty-state">No appointments booked across the clinic today.</div>';
      return;
    }

    active.forEach((appt) => {
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
      list.appendChild(row);
    });
  }

  /* ============================================================
     REVENUE TREND — lightweight CSS bar chart, no library needed
     ============================================================ */
  function renderRevenueChart() {
    const container = document.getElementById('revChart');
    container.innerHTML = '';

    if (!state.revenueTrend.length) {
      container.innerHTML = '<div class="empty-state">No payments recorded in this period yet.</div>';
      return;
    }

    const max = Math.max(...state.revenueTrend.map((d) => Number(d.revenue)), 1);

    state.revenueTrend.forEach((d) => {
      const value = Number(d.revenue);
      const heightPct = Math.max((value / max) * 100, value > 0 ? 4 : 0);
      const dayLabel = new Date(d.day).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

      const col = document.createElement('div');
      col.className = 'rev-bar-col';
      col.title = `${dayLabel}: ${formatKsh(value)}`;
      col.innerHTML = `
        <div class="rev-bar" style="height:${heightPct}%"></div>
        <div class="rev-bar-label">${escapeHtml(dayLabel.split(' ')[0])}</div>
      `;
      container.appendChild(col);
    });
  }

  /* ============================================================
     ALERTS — low stock + outstanding balance
     ============================================================ */
  function renderAlerts() {
    const container = document.getElementById('alertList');
    container.innerHTML = '';

    const rows = [];

    if (state.summary.outstandingBalance > 0) {
      rows.push({
        type: 'red',
        title: `${formatKsh(state.summary.outstandingBalance)} outstanding`,
        subtitle: 'Across all unpaid and partially paid bills',
      });
    }

    state.lowStock.forEach((item) => {
      rows.push({
        type: 'amber',
        title: `${item.name} is low on stock`,
        subtitle: `${item.quantity} ${item.unit || 'units'} left (reorder at ${item.reorder_level})`,
      });
    });

    if (!rows.length) {
      container.innerHTML = '<div class="empty-state">Nothing needs attention right now.</div>';
      return;
    }

    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'alert-row';
      row.innerHTML = `
        <div class="alert-ic alert-ic-${r.type}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.3 3.9 2.5 18a1.8 1.8 0 0 0 1.5 2.7h16a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </div>
        <div class="alert-mid">
          <p class="t">${escapeHtml(r.title)}</p>
          <p class="s">${escapeHtml(r.subtitle)}</p>
        </div>
      `;
      container.appendChild(row);
    });
  }

  /* ============================================================
     TOP SERVICES
     ============================================================ */
  function renderTopServices() {
    const list = document.getElementById('svcList');
    list.innerHTML = '';

    if (!state.topServices.length) {
      list.innerHTML = '<div class="empty-state">No billed services yet.</div>';
      return;
    }

    state.topServices.forEach((svc) => {
      const item = document.createElement('div');
      item.className = 'svc-item';
      item.innerHTML = `
        <div>
          <p class="name">${escapeHtml(svc.name || 'Unnamed service')}</p>
          <p class="vol">${escapeHtml(String(svc.volume))} billed</p>
        </div>
        <div class="rev">${formatKsh(svc.revenue)}</div>
      `;
      list.appendChild(item);
    });
  }

  /* ============================================================
     STAFF WORKLOAD
     ============================================================ */
  function renderWorkload() {
    const list = document.getElementById('workloadList');
    list.innerHTML = '';

    if (!state.workload.length) {
      list.innerHTML = '<div class="empty-state">No dentists on staff yet.</div>';
      return;
    }

    const max = Math.max(...state.workload.map((d) => Number(d.appointment_count)), 1);

    state.workload.forEach((d) => {
      const count = Number(d.appointment_count);
      const pct = (count / max) * 100;

      const item = document.createElement('div');
      item.className = 'workload-item';
      item.innerHTML = `
        <p class="name">Dr. ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name)}</p>
        <div class="workload-bar-track"><div class="workload-bar-fill" style="width:${pct}%"></div></div>
        <div class="workload-count">${count}</div>
      `;
      list.appendChild(item);
    });
  }

  /* ============================================================
     SIDEBAR (mobile open/close) — same behavior as dentistDashboard.js
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

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function formatKsh(value) {
    return 'KSh ' + Number(value || 0).toLocaleString('en-KE');
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
})();