(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as dashboard.js / billing.js — api.js must load first.
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
    plans: [],
    dentists: [],
    appointments: [],
    // planId -> { items, diagnosis, loaded, open }
    detail: {},
  };

  const ACTIVE_STATUSES = ['approved', 'in_progress'];
  const STATUS_LABEL = {
    draft: 'Draft', proposed: 'Proposed', approved: 'Approved',
    in_progress: 'In Progress', completed: 'Completed', rejected: 'Rejected',
  };
  const ITEM_STATUS_LABEL = { planned: 'Planned', completed: 'Completed', skipped: 'Skipped' };

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    loadTreatmentPlans();
  });

  async function loadTreatmentPlans() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;

      document.getElementById('avatarInitials').textContent =
        initialsOf(`${patient.first_name} ${patient.last_name}`);

      const [plans, dentists, appointments] = await Promise.all([
        fetchMethod(`/treatment-plans/patient/${patient.id}`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true).catch(() => []),
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true).catch(() => []),
      ]);

      state.plans = plans.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.dentists = dentists;
      state.appointments = appointments;

      // Items are needed up front for accurate stats (completed count, active-plan cost),
      // so load them for every plan once rather than only on expand.
      await Promise.all(state.plans.map((p) => loadPlanDetail(p.id, { silent: true })));

      renderStats();
      renderPlanList();
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
    showToast(err.message || 'Could not load your treatment plans. Please refresh.');
  }

  /* ============================================================
     DATA LOADING (per plan: items + linked diagnosis)
     ============================================================ */
  async function loadPlanDetail(planId, opts) {
    const silent = !!(opts && opts.silent);
    if (!state.detail[planId]) state.detail[planId] = { open: false, loaded: false };
    const d = state.detail[planId];

    try {
      const items = await fetchMethod(`/treatment-plan-items/plan/${planId}`, 'GET', null, true);
      d.items = items;

      const plan = state.plans.find((p) => String(p.id) === String(planId));
      if (plan && plan.diagnosis_id) {
        // Diagnosis lookup is best-effort — endpoint access can be role-restricted,
        // so a failure here just hides the diagnosis note rather than breaking the page.
        d.diagnosis = await fetchMethod(`/diagnoses/${plan.diagnosis_id}`, 'GET', null, true).catch(() => null);
      } else {
        d.diagnosis = null;
      }

      d.loaded = true;
    } catch (err) {
      d.items = d.items || [];
      d.loaded = true;
      if (!silent) showToast(err.message || 'Could not load this plan\'s procedures');
    }
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalPlans').textContent = state.plans.length;

    const activePlans = state.plans.filter((p) => ACTIVE_STATUSES.includes(p.status));
    document.getElementById('statActivePlans').textContent = activePlans.length;

    let doneItems = 0;
    let totalItems = 0;
    state.plans.forEach((p) => {
      const items = (state.detail[p.id] && state.detail[p.id].items) || [];
      totalItems += items.length;
      doneItems += items.filter((i) => i.status === 'completed').length;
    });
    document.getElementById('statItemsDone').textContent = `${doneItems} / ${totalItems}`;

    const estCost = activePlans.reduce((sum, p) => sum + Number(p.estimated_cost || 0), 0);
    document.getElementById('statEstCost').textContent = formatMoney(estCost);
  }

  /* ============================================================
     PLAN LIST
     ============================================================ */
  function renderPlanList() {
    const list = document.getElementById('planList');
    list.innerHTML = '';

    if (!state.plans.length) {
      list.innerHTML = '<div class="empty-state">No treatment plans on record yet.</div>';
      return;
    }

    state.plans.forEach((plan) => {
      const status = STATUS_LABEL[plan.status] ? plan.status : 'draft';
      const items = (state.detail[plan.id] && state.detail[plan.id].items) || [];
      const doneCount = items.filter((i) => i.status === 'completed').length;
      const isOpen = !!(state.detail[plan.id] && state.detail[plan.id].open);

      const card = document.createElement('div');
      card.className = 'plan-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-plan-id', plan.id);
      card.innerHTML = `
        <div class="plan-head" data-action="toggle" data-id="${plan.id}">
          <div class="plan-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </div>
          <div class="plan-mid">
            <p class="t">${escapeHtml(plan.description || `Treatment Plan #${shortId(plan.id)}`)}</p>
            <p class="s">${escapeHtml(dentistNameById(plan.dentist_id))} · ${escapeHtml(formatDate(plan.created_at))}</p>
          </div>
          <span class="badge badge-${status}">${STATUS_LABEL[status] || capitalize(status)}</span>
          <div class="plan-amounts">
            <p class="total">${formatMoney(plan.estimated_cost)}</p>
            <p class="sub">${doneCount}/${items.length} done</p>
          </div>
          <svg class="plan-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="plan-body" id="planBody-${plan.id}"></div>
      `;
      list.appendChild(card);

      // Data's already loaded up front, so render the body immediately —
      // it just stays hidden until the card is opened (CSS handles that).
      renderPlanBody(plan.id);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleplan(head.getAttribute('data-id')));
    });
  }

  function toggleplan(planId) {
    const card = document.querySelector(`.plan-card[data-plan-id="${planId}"]`);
    if (!card) return;
    if (!state.detail[planId]) state.detail[planId] = { open: false };
    state.detail[planId].open = !state.detail[planId].open;
    card.classList.toggle('is-open', state.detail[planId].open);
  }

  function renderPlanBody(planId) {
    const body = document.getElementById(`planBody-${planId}`);
    if (!body) return;
    const plan = state.plans.find((p) => String(p.id) === String(planId));
    const d = state.detail[planId] || {};
    const items = d.items || [];

    const doneCount = items.filter((i) => i.status === 'completed').length;
    const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

    const metaRow = `
      <div class="plan-meta-row">
        <span>Dentist <b>${escapeHtml(dentistNameById(plan.dentist_id))}</b></span>
        <span>Created <b>${escapeHtml(formatDate(plan.created_at))}</b></span>
        ${plan.approved_at ? `<span>Approved <b>${escapeHtml(formatDate(plan.approved_at))}</b></span>` : ''}
      </div>
    `;

    const diagnosisHtml = d.diagnosis
      ? `<div class="diagnosis-note"><span class="label">Based on diagnosis</span>${escapeHtml(d.diagnosis.diagnosis_text || '')}</div>`
      : '';

    const itemsHtml = items.length
      ? [...items].sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)).map((it) => {
          const itStatus = ITEM_STATUS_LABEL[it.status] ? it.status : 'planned';
          const completedAppt = state.appointments.find((a) => a.id === it.completed_appointment_id);
          return `
            <div class="tp-item-row ${itStatus === 'completed' ? 'is-completed' : ''}">
              <div class="tp-item-seq">${it.sequence_order != null ? it.sequence_order : '—'}</div>
              <div class="tp-item-mid">
                <p class="t">${escapeHtml(it.procedure_name)}</p>
                <p class="s">
                  ${it.tooth_number ? `<span class="tooth-tag">Tooth ${it.tooth_number}</span>` : ''}
                  ${completedAppt ? `Completed ${escapeHtml(formatDate(completedAppt.scheduled_start))}` : ITEM_STATUS_LABEL[itStatus]}
                </p>
              </div>
              <span class="badge badge-${itStatus}">${ITEM_STATUS_LABEL[itStatus]}</span>
              <span class="tp-item-amt">${formatMoney(it.estimated_cost)}</span>
            </div>
          `;
        }).join('')
      : '<p class="bill-body-empty">No procedures added to this plan yet.</p>';

    body.innerHTML = `
      <div class="plan-progress-wrap">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-label">${pct}% complete</span>
      </div>
      ${metaRow}
      ${diagnosisHtml}
      <div class="bill-section">
        <p class="bill-section-title">Procedures</p>
        ${itemsHtml}
      </div>
    `;
  }

  function dentistNameById(id) {
    const d = state.dentists.find((x) => x.id === id);
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Your dentist';
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
      if (hasRealHref) link.addEventListener('click', closeSidebar);
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
})();