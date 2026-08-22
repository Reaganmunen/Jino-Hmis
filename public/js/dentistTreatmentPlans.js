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
     REFERENCE DATA
     ============================================================ */
  const ALL_TEETH = [];
  [1, 2, 3, 4].forEach((quadrant) => {
    for (let position = 1; position <= 8; position += 1) ALL_TEETH.push(quadrant * 10 + position);
  });

  const currencyFormatter = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 });
  function formatCost(value) {
    const num = Number(value);
    return Number.isFinite(num) ? currencyFormatter.format(num) : '—';
  }

  // Neither TreatmentPlan.status nor TreatmentPlanItem.status has a visible
  // enum in the schema — only 'approved' / 'in_progress' / 'completed' /
  // 'cancelled' are confirmed, from findActiveTreatmentPlansByDentist and
  // updateTreatmentPlanStatus. The pre-approval default is a guess
  // ('proposed'); anything unrecognized falls back to a generic badge
  // showing the raw value, so this won't silently mislabel real data.
  const PLAN_STATUS_META = {
    proposed: { label: 'Proposed', className: 'status-proposed' },
    pending: { label: 'Pending', className: 'status-pending' },
    approved: { label: 'Approved', className: 'status-approved' },
    in_progress: { label: 'In Progress', className: 'status-inprogress' },
    completed: { label: 'Completed', className: 'status-completed' },
    cancelled: { label: 'Cancelled', className: 'status-cancelled' },
  };
  function planStatusMeta(status) {
    return PLAN_STATUS_META[status] || { label: capitalize((status || 'unknown').replace(/_/g, ' ')), className: 'status-default' };
  }

  const ITEM_STATUS_META = {
    pending: { label: 'Pending', className: 'status-pending' },
    completed: { label: 'Completed', className: 'status-completed' },
    cancelled: { label: 'Cancelled', className: 'status-cancelled' },
  };
  function itemStatusMeta(status) {
    return ITEM_STATUS_META[status] || { label: capitalize((status || 'pending').replace(/_/g, ' ')), className: 'status-default' };
  }

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id,
    patientsById: {},
    services: [],
    appointments: [],       // today's appointments, for the picker
    activeAppointment: null,
    activePatient: null,
    activePlans: [],        // dentist-wide, approved/in_progress only
    patientPlans: [],       // full history for the selected patient
    planItemsByPlanId: {},  // lazily loaded per plan
    expandedPlanId: null,
    newItemPlanId: null,    // which plan the item modal is adding to
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    initPlanModal();
    initItemModal();
    populateToothSelect();
    document.getElementById('newPlanBtn').addEventListener('click', () => openPlanModal());
    loadInitialData();
  });

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadInitialData() {
    try {
      const { from, to } = todayRangeIso();
      const [appointments, patients, services, activePlans] = await Promise.all([
        fetchMethod(`/appointments/dentist/${state.dentistId}?from=${from}&to=${to}`, 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
        fetchMethod('/services', 'GET', null, true),
        fetchMethod(`/treatment-plans/dentist/${state.dentistId}/active`, 'GET', null, true),
      ]);

      state.appointments = appointments
        .filter((a) => a.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
      state.patientsById = {};
      patients.forEach((p) => { state.patientsById[p.id] = p; });
      state.services = services;
      state.activePlans = activePlans;

      renderAppointmentPicker();
      renderActivePlans();
      populateProcedureSelect();
    } catch (err) {
      handleLoadError(err);
    }
  }

  async function reloadActivePlans() {
    try {
      state.activePlans = await fetchMethod(`/treatment-plans/dentist/${state.dentistId}/active`, 'GET', null, true);
      renderActivePlans();
    } catch (err) {
      // Non-critical — the patient-specific list is already up to date.
    }
  }

  function handleLoadError(err) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    showToast(err.message || 'Could not load treatment plans. Please refresh.');
  }

  function patientName(patientId) {
    const p = state.patientsById[patientId];
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown patient';
  }

  /* ============================================================
     ACTIVE PLANS (dentist-wide overview)
     ============================================================ */
  function renderActivePlans() {
    const list = document.getElementById('activePlansList');
    document.getElementById('activePlansCount').textContent =
      `${state.activePlans.length} in progress`;

    if (!state.activePlans.length) {
      list.innerHTML = '';
      list.classList.add('is-empty');
      return;
    }
    list.classList.remove('is-empty');
    list.innerHTML = state.activePlans.map((plan) => {
      const meta = planStatusMeta(plan.status);
      return `
        <div class="plan-card ${meta.className}">
          <div class="plan-card-top">
            <div>
              <div class="plan-patient-name">${escapeHtml(patientName(plan.patient_id))}</div>
              <div class="plan-description">${escapeHtml(plan.description || 'Treatment plan')}</div>
            </div>
            <span class="status-badge">${escapeHtml(meta.label)}</span>
          </div>
          <div class="plan-meta-row">
            <span class="plan-cost">${formatCost(plan.estimated_cost)}</span>
            <span class="plan-date">Started ${formatDate(plan.created_at)}</span>
          </div>
          <div class="plan-actions">
            <button class="plan-action-btn expand" type="button" data-open-patient="${plan.patient_id}">View patient's plans</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-open-patient]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const patient = state.patientsById[btn.getAttribute('data-open-patient')];
        if (patient) selectPatient(patient, null);
      });
    });
  }

  /* ============================================================
     APPOINTMENT PICKER (today's patients)
     ============================================================ */
  function renderAppointmentPicker() {
    const list = document.getElementById('apptPickerList');
    document.getElementById('apptPickerCount').textContent =
      `${state.appointments.length} appointment${state.appointments.length === 1 ? '' : 's'} today`;

    if (!state.appointments.length) {
      list.innerHTML = '<div class="empty-state">No appointments today.</div>';
      return;
    }

    list.innerHTML = state.appointments.map((a) => `
      <button class="sched-item" type="button" data-appt-id="${a.id}">
        <span class="sched-time">${formatTime(a.scheduled_start)}</span>
        <span class="sched-patient">${escapeHtml(patientName(a.patient_id))}</span>
        ${a.reason ? `<span class="sched-reason">${escapeHtml(a.reason)}</span>` : ''}
      </button>
    `).join('');

    list.querySelectorAll('[data-appt-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const appt = state.appointments.find((a) => String(a.id) === btn.getAttribute('data-appt-id'));
        const patient = appt ? state.patientsById[appt.patient_id] : null;
        if (patient) selectPatient(patient, appt);
      });
    });
  }

  /* ============================================================
     SELECTED PATIENT — full plan history
     ============================================================ */
  async function selectPatient(patient, appointment) {
    state.activePatient = patient;
    state.activeAppointment = appointment;
    state.expandedPlanId = null;
    state.planItemsByPlanId = {};

    const panel = document.getElementById('patientPlansPanel');
    panel.style.display = 'block';
    document.getElementById('plansPatientName').textContent = `— ${patient.first_name} ${patient.last_name}`;
    document.getElementById('patientPlansList').innerHTML = '<div class="empty-state">Loading treatment plans…</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      state.patientPlans = await fetchMethod(`/treatment-plans/patient/${patient.id}`, 'GET', null, true);
      renderPatientPlans();
    } catch (err) {
      handleLoadError(err);
    }
  }

  function renderPatientPlans() {
    const list = document.getElementById('patientPlansList');
    if (!state.patientPlans.length) {
      list.innerHTML = '<div class="empty-state">No treatment plans logged for this patient yet.</div>';
      return;
    }
    list.innerHTML = state.patientPlans.map(renderPlanCard).join('');
    bindPlanCardActions(list);
  }

  function renderPlanCard(plan) {
    const meta = planStatusMeta(plan.status);
    const isExpanded = state.expandedPlanId === plan.id;
    const items = state.planItemsByPlanId[plan.id];

    return `
      <div class="plan-card ${meta.className}" data-plan-id="${plan.id}">
        <div class="plan-card-top">
          <div>
            <div class="plan-description">${escapeHtml(plan.description || 'Treatment plan')}</div>
          </div>
          <span class="status-badge">${escapeHtml(meta.label)}</span>
        </div>
        <div class="plan-meta-row">
          <span class="plan-cost">${formatCost(plan.estimated_cost)}</span>
          <span class="plan-date">Created ${formatDate(plan.created_at)}</span>
          ${plan.diagnosis_id ? `<span class="plan-date">Diagnosis #${escapeHtml(String(plan.diagnosis_id))}</span>` : ''}
        </div>
        <div class="plan-actions">
          ${!['approved', 'in_progress', 'completed', 'cancelled'].includes(plan.status) ? `<button class="plan-action-btn approve" data-plan-action="approved" data-plan-id="${plan.id}" type="button">Approve for patient</button>` : ''}
          ${plan.status === 'approved' ? `<button class="plan-action-btn start" data-plan-action="in_progress" data-plan-id="${plan.id}" type="button">Start treatment</button>` : ''}
          ${plan.status === 'in_progress' ? `<button class="plan-action-btn complete" data-plan-action="completed" data-plan-id="${plan.id}" type="button">Mark completed</button>` : ''}
          ${!['completed', 'cancelled'].includes(plan.status) ? `<button class="plan-action-btn cancel" data-plan-action="cancelled" data-plan-id="${plan.id}" type="button">Cancel plan</button>` : ''}
          <button class="plan-action-btn expand" data-toggle-plan="${plan.id}" type="button">${isExpanded ? 'Hide items' : 'Show items'}</button>
        </div>
        ${isExpanded ? `
          <div class="plan-items">
            ${renderPlanItems(plan, items)}
            <button class="add-item-btn" data-add-item="${plan.id}" type="button">+ Add procedure</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderPlanItems(plan, items) {
    if (!items) return '<div class="plan-items-empty">Loading…</div>';
    if (!items.length) return '<div class="plan-items-empty">No procedures added yet.</div>';
    return items.map((item) => {
      const meta = itemStatusMeta(item.status);
      const isTerminal = ['completed', 'cancelled'].includes(item.status);
      return `
        <div class="plan-item-row">
          <div class="plan-item-main">
            <span class="plan-item-name">${escapeHtml(item.procedure_name || 'Procedure')}</span>
            ${item.tooth_number ? `<span class="plan-item-tooth">FDI ${escapeHtml(String(item.tooth_number))}</span>` : ''}
            <span class="plan-item-cost">${formatCost(item.estimated_cost)}</span>
            <span class="status-badge ${meta.className}">${escapeHtml(meta.label)}</span>
          </div>
          ${isTerminal ? '' : `
            <div class="plan-item-actions">
              <button class="plan-item-action-btn complete" data-item-action="completed" data-item-id="${item.id}" data-plan-id="${plan.id}" type="button">Complete</button>
              <button class="plan-item-action-btn cancel" data-item-action="cancelled" data-item-id="${item.id}" data-plan-id="${plan.id}" type="button">Cancel</button>
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  function bindPlanCardActions(scope) {
    scope.querySelectorAll('[data-toggle-plan]').forEach((btn) => {
      btn.addEventListener('click', () => toggleExpandPlan(btn.getAttribute('data-toggle-plan')));
    });
    scope.querySelectorAll('[data-plan-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const planId = btn.getAttribute('data-plan-id');
        const status = btn.getAttribute('data-plan-action');
        // Approval is normally the patient's own action (setStatus restricts
        // that role to approved/cancelled only). Dentists/admins aren't
        // restricted server-side, so this button exists for cases where the
        // patient genuinely can't log in — gate it with an explicit confirm
        // so it's not one accidental click away, and so there's a moment
        // that nudges toward confirming with the patient directly first.
        if (status === 'approved') {
          const ok = window.confirm('Approve this plan on the patient\'s behalf? Only do this if you\'ve confirmed with them directly (e.g. by phone), since they normally approve it themselves.');
          if (!ok) return;
        }
        setPlanStatus(planId, status);
      });
    });
    scope.querySelectorAll('[data-add-item]').forEach((btn) => {
      btn.addEventListener('click', () => openItemModal(btn.getAttribute('data-add-item')));
    });
    scope.querySelectorAll('[data-item-action]').forEach((btn) => {
      btn.addEventListener('click', () => setItemStatus(
        btn.getAttribute('data-item-id'), btn.getAttribute('data-plan-id'), btn.getAttribute('data-item-action'),
      ));
    });
  }

  async function toggleExpandPlan(planId) {
    const id = Number(planId);
    if (state.expandedPlanId === id) {
      state.expandedPlanId = null;
      renderPatientPlans();
      return;
    }
    state.expandedPlanId = id;
    renderPatientPlans();

    if (!state.planItemsByPlanId[id]) {
      try {
        state.planItemsByPlanId[id] = await fetchMethod(`/treatment-plan-items/plan/${id}`, 'GET', null, true);
        renderPatientPlans();
      } catch (err) {
        showToast(err.message || 'Could not load procedures for this plan.');
      }
    }
  }

  async function setPlanStatus(planId, status) {
    try {
      const updated = await fetchMethod(`/treatment-plans/${planId}/status`, 'PUT', { status }, true);
      const plan = state.patientPlans.find((p) => String(p.id) === String(planId));
      if (plan) Object.assign(plan, updated);
      renderPatientPlans();
      reloadActivePlans();
      showToast('Treatment plan updated.');
    } catch (err) {
      showToast(err.message || 'Could not update this treatment plan.');
    }
  }

  async function setItemStatus(itemId, planId, status) {
    const completed_appointment_id = status === 'completed' && state.activeAppointment ? state.activeAppointment.id : null;
    try {
      const updated = await fetchMethod(`/treatment-plan-items/${itemId}/status`, 'PUT', { status, completed_appointment_id }, true);
      const items = state.planItemsByPlanId[planId];
      if (items) {
        const idx = items.findIndex((i) => String(i.id) === String(itemId));
        if (idx !== -1) items[idx] = updated;
      }
      renderPatientPlans();
      showToast('Procedure updated.');
    } catch (err) {
      showToast(err.message || 'Could not update this procedure.');
    }
  }

  /* ============================================================
     NEW PLAN MODAL
     ============================================================ */
  function initPlanModal() {
    document.getElementById('planModalCancel').addEventListener('click', closePlanModal);
    document.getElementById('planModalScrim').addEventListener('click', (e) => {
      if (e.target.id === 'planModalScrim') closePlanModal();
    });
    document.getElementById('planModalSave').addEventListener('click', savePlan);
  }

  function openPlanModal() {
    if (!state.activePatient) {
      showToast('Pick a patient from today\'s appointments (or an active plan) first.');
      return;
    }
    document.getElementById('planModalPatientName').textContent =
      `${state.activePatient.first_name} ${state.activePatient.last_name}`;
    document.getElementById('planDescription').value = '';
    document.getElementById('planCost').value = '';
    document.getElementById('planDiagnosisId').value = '';
    document.getElementById('planModalScrim').classList.add('is-open');
  }

  function closePlanModal() {
    document.getElementById('planModalScrim').classList.remove('is-open');
  }

  async function savePlan() {
    if (!state.activePatient) return;

    const description = document.getElementById('planDescription').value.trim();
    const estimated_cost = document.getElementById('planCost').value;
    const diagnosisIdRaw = document.getElementById('planDiagnosisId').value;

    if (!description) {
      showToast('Add a description for this plan.');
      return;
    }

    const saveBtn = document.getElementById('planModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const created = await fetchMethod('/treatment-plans', 'POST', {
        patient_id: state.activePatient.id,
        diagnosis_id: diagnosisIdRaw ? Number(diagnosisIdRaw) : null,
        description,
        estimated_cost: estimated_cost ? Number(estimated_cost) : null,
      }, true);

      state.patientPlans.unshift(created);
      renderPatientPlans();
      reloadActivePlans();
      closePlanModal();
      showToast('Treatment plan created.');
    } catch (err) {
      showToast(err.message || 'Could not create this treatment plan.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save plan';
    }
  }

  /* ============================================================
     NEW ITEM MODAL
     ============================================================ */
  function populateToothSelect() {
    const select = document.getElementById('itemTooth');
    ALL_TEETH.forEach((num) => {
      const opt = document.createElement('option');
      opt.value = num;
      opt.textContent = `FDI ${num}`;
      select.appendChild(opt);
    });
  }

  function populateProcedureSelect() {
    const select = document.getElementById('itemProcedure');
    select.innerHTML = '<option value="">Select a procedure…</option>';
    state.services.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  }

  function initItemModal() {
    document.getElementById('itemModalCancel').addEventListener('click', closeItemModal);
    document.getElementById('itemModalScrim').addEventListener('click', (e) => {
      if (e.target.id === 'itemModalScrim') closeItemModal();
    });
    document.getElementById('itemModalSave').addEventListener('click', saveItem);
  }

  function openItemModal(planId) {
    state.newItemPlanId = Number(planId);
    const items = state.planItemsByPlanId[planId] || [];
    document.getElementById('itemProcedure').value = '';
    document.getElementById('itemTooth').value = '';
    document.getElementById('itemCost').value = '';
    document.getElementById('itemSequence').value = items.length + 1;
    document.getElementById('itemModalScrim').classList.add('is-open');
  }

  function closeItemModal() {
    state.newItemPlanId = null;
    document.getElementById('itemModalScrim').classList.remove('is-open');
  }

  async function saveItem() {
    const planId = state.newItemPlanId;
    if (!planId) return;

    const procedure_name = document.getElementById('itemProcedure').value;
    const toothVal = document.getElementById('itemTooth').value;
    const estimated_cost = document.getElementById('itemCost').value;
    const sequence_order = document.getElementById('itemSequence').value;

    if (!procedure_name) {
      showToast('Pick a procedure.');
      return;
    }

    const saveBtn = document.getElementById('itemModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const created = await fetchMethod('/treatment-plan-items', 'POST', {
        treatment_plan_id: planId,
        procedure_name,
        tooth_number: toothVal ? Number(toothVal) : null,
        estimated_cost: estimated_cost ? Number(estimated_cost) : null,
        sequence_order: sequence_order ? Number(sequence_order) : null,
      }, true);

      if (!state.planItemsByPlanId[planId]) state.planItemsByPlanId[planId] = [];
      state.planItemsByPlanId[planId].push(created);
      renderPatientPlans();
      closeItemModal();
      showToast('Procedure added.');
    } catch (err) {
      showToast(err.message || 'Could not add this procedure.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add item';
    }
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
  function todayRangeIso() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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