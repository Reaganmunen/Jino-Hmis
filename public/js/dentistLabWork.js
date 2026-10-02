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
     CONSTANTS — mirror the backend (labOrderController.js)
     ============================================================ */
  const WORK_TYPES = {
    crown: 'Crown',
    bridge: 'Bridge',
    veneer: 'Veneer',
    inlay_onlay: 'Inlay / Onlay',
    denture_full: 'Full denture',
    denture_partial: 'Partial denture',
    implant_restoration: 'Implant restoration',
    night_guard: 'Night guard',
    retainer: 'Retainer',
    orthodontic_appliance: 'Orthodontic appliance',
    surgical_guide: 'Surgical guide',
    other: 'Other',
  };

  const STATUS_LABELS = {
    draft: 'Draft',
    sent: 'At lab',
    received: 'Received',
    try_in: 'Try-in',
    adjustment: 'Back at lab',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  const TRANSITIONS = {
    draft: ['sent', 'cancelled'],
    sent: ['received', 'cancelled'],
    received: ['try_in', 'adjustment', 'completed'],
    try_in: ['completed', 'adjustment'],
    adjustment: ['received', 'cancelled'],
    completed: [],
    cancelled: [],
  };

  const ACTION_LABELS = {
    sent: 'Mark sent to lab',
    received: 'Mark received from lab',
    try_in: 'Start try-in',
    adjustment: 'Send back for adjustment',
    completed: 'Complete — fitted',
    cancelled: 'Cancel order',
  };

  const NOTE_PROMPTS = {
    adjustment: 'What needs adjusting? (the lab will see this)',
    cancelled: 'Why is this order being cancelled?',
  };

  // Which statuses belong to each tab
  const TABS = [
    { key: 'active', label: 'Active', statuses: ['draft', 'sent', 'received', 'try_in', 'adjustment'] },
    { key: 'atlab', label: 'At lab', statuses: ['sent', 'adjustment'] },
    { key: 'back', label: 'Back in clinic', statuses: ['received', 'try_in'] },
    { key: 'closed', label: 'Closed', statuses: ['completed', 'cancelled'] },
  ];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    dentistId: sessionUser.id,
    orders: [],
    labs: [],
    patients: [],
    tab: 'active',
    search: '',
    activeOrderId: null,   // order open in the details modal
    editingOrderId: null,  // order being edited in the form modal (null = creating)
    pendingStatus: null,   // status waiting on a note in the details modal
    saving: false,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    renderTopbarAvatar(`Dr. ${sessionUser.first_name} ${sessionUser.last_name}`);
    populateWorkTypeSelect();

    document.getElementById('labSearchInput').addEventListener('input', (e) => {
      state.search = e.target.value.trim().toLowerCase();
      renderList();
    });
    document.getElementById('newOrderBtn').addEventListener('click', () => openFormModal(null));
    document.getElementById('addLabBtn').addEventListener('click', openLabModal);

    // details modal
    document.getElementById('detailCloseBtn').addEventListener('click', closeDetailModal);
    document.getElementById('noteCancelBtn').addEventListener('click', cancelPendingStatus);
    document.getElementById('noteConfirmBtn').addEventListener('click', confirmPendingStatus);

    // form modal
    document.getElementById('formCancelBtn').addEventListener('click', closeFormModal);
    document.getElementById('formSaveBtn').addEventListener('click', saveOrder);
    document.getElementById('formPatientSearch').addEventListener('input', populatePatientSelect);

    // add-lab modal
    document.getElementById('labCancelBtn').addEventListener('click', closeLabModal);
    document.getElementById('labSaveBtn').addEventListener('click', saveLab);

    loadInitialData();
  });

  /* ============================================================
     LOAD — everything once, then filter/search on the client
     ============================================================ */
  async function loadInitialData() {
    try {
      const [orders, labs, patients] = await Promise.all([
        fetchMethod(`/lab-orders/dentist/${state.dentistId}`, 'GET', null, true),
        fetchMethod('/lab-partners', 'GET', null, true),
        fetchMethod('/patients', 'GET', null, true),
      ]);
      state.orders = orders;
      state.labs = labs;
      state.patients = patients.sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
      populateLabSelect();
      render();
    } catch (err) {
      handleLoadError(err);
      document.getElementById('labList').innerHTML =
        '<div class="empty-state">Could not load lab orders. Please refresh.</div>';
    }
  }

  async function reloadOrders() {
    try {
      state.orders = await fetchMethod(`/lab-orders/dentist/${state.dentistId}`, 'GET', null, true);
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
    showToast(err.message || 'Something went wrong. Please refresh.');
  }

  // Swap one order in the cache with the server's fresh copy — no refetch needed.
  function upsertOrder(order) {
    const i = state.orders.findIndex((o) => o.id === order.id);
    if (i === -1) state.orders.unshift(order);
    else state.orders[i] = order;
  }

  /* ============================================================
     LIST
     ============================================================ */
  function render() {
    renderTabs();
    renderList();
  }

  function tabOrders(tabKey) {
    const tab = TABS.find((t) => t.key === tabKey);
    return state.orders.filter((o) => tab.statuses.includes(o.status));
  }

  function renderTabs() {
    const wrap = document.getElementById('labTabs');
    wrap.innerHTML = '';
    TABS.forEach((tab) => {
      const orders = tabOrders(tab.key);
      const overdue = tab.key !== 'closed' && tab.key !== 'back'
        ? orders.filter((o) => o.is_overdue).length : 0;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `lab-tab${state.tab === tab.key ? ' is-active' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.innerHTML = `${escapeHtml(tab.label)} <span class="count">${orders.length}</span>`
        + (overdue ? ` <span class="count is-alert">${overdue} overdue</span>` : '');
      btn.addEventListener('click', () => { state.tab = tab.key; render(); });
      wrap.appendChild(btn);
    });
  }

  function sortOrders(list) {
    return list.slice().sort((a, b) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      const closed = state.tab === 'closed';
      if (closed) return new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at);
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  function renderList() {
    const list = document.getElementById('labList');
    let orders = tabOrders(state.tab);

    if (state.search) {
      orders = orders.filter((o) => {
        const hay = `${o.patient_name} ${WORK_TYPES[o.work_type] || ''} ${o.lab_name || ''}`.toLowerCase();
        return hay.includes(state.search);
      });
    }
    orders = sortOrders(orders);

    if (!orders.length) {
      list.innerHTML = `<div class="empty-state">${
        state.search ? 'No lab orders match your search.'
          : state.orders.length ? 'Nothing here right now.'
            : 'No lab orders yet. Create one with “New lab order”.'
      }</div>`;
      return;
    }

    list.innerHTML = '';
    orders.forEach((order) => {
      const title = `${WORK_TYPES[order.work_type] || order.work_type}${teethText(order) ? ` · ${teethText(order)}` : ''}`;
      const row = document.createElement('div');
      row.className = `sched-item is-selectable lab-row${order.is_overdue ? ' is-overdue' : ''}`;
      row.innerHTML = `
        <div class="sched-avatar">${escapeHtml(initialsOf(order.patient_name))}</div>
        <div class="sched-mid">
          <p class="t">${escapeHtml(title)}</p>
          <p class="s">${escapeHtml(order.patient_name)} · ${escapeHtml(order.lab_name || 'No lab chosen yet')}</p>
        </div>
        <div class="lab-right">
          <div class="lab-badges">${badgesHtml(order)}</div>
          ${dueHtml(order)}
        </div>
      `;
      row.addEventListener('click', () => openDetailModal(order.id));
      list.appendChild(row);
    });
  }

  function badgesHtml(order) {
    let html = `<span class="badge badge-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status])}</span>`;
    if (order.is_overdue) html += '<span class="badge badge-overdue">Overdue</span>';
    return html;
  }

  function dueHtml(order) {
    if (!order.due_date || order.status === 'completed' || order.status === 'cancelled') return '';
    return `<span class="lab-due${order.is_overdue ? ' is-overdue' : ''}">Due ${escapeHtml(formatDate(order.due_date))}</span>`;
  }

  function teethText(order) {
    return Array.isArray(order.tooth_numbers) && order.tooth_numbers.length ? order.tooth_numbers.join(', ') : '';
  }

  /* ============================================================
     DETAILS MODAL
     ============================================================ */
  function openDetailModal(orderId) {
    state.activeOrderId = orderId;
    state.pendingStatus = null;
    renderDetailModal(true);
    document.getElementById('detailScrim').classList.add('is-open');
    loadHistory(orderId);
  }

  function closeDetailModal() {
    document.getElementById('detailScrim').classList.remove('is-open');
    state.activeOrderId = null;
    state.pendingStatus = null;
  }

  function activeOrder() {
    return state.orders.find((o) => o.id === state.activeOrderId) || null;
  }

  function renderDetailModal(resetHistory) {
    const order = activeOrder();
    if (!order) return;

    document.getElementById('detailKicker').textContent = order.patient_name;
    document.getElementById('detailTitle').textContent =
      `${WORK_TYPES[order.work_type] || order.work_type}${teethText(order) ? ` · ${teethText(order)}` : ''}`;
    document.getElementById('detailBadges').innerHTML = badgesHtml(order);

    const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;
    const field = (label, value, muted) =>
      `<div><dt>${escapeHtml(label)}</dt><dd${muted ? ' class="is-muted"' : ''}>${escapeHtml(value)}</dd></div>`;

    document.getElementById('detailGrid').innerHTML = [
      field('Lab', order.lab_name ? `${order.lab_name}${order.lab_phone ? ` · ${order.lab_phone}` : ''}` : 'Not chosen yet', !order.lab_name),
      field('Due', order.due_date ? formatDate(order.due_date) : 'Not set', !order.due_date),
      field('Shade', order.shade || '—', !order.shade),
      field('Material', order.material || '—', !order.material),
      field('Lab cost', `${money(order.lab_cost)} · ${order.lab_paid ? 'paid' : 'unpaid'}`),
      field('Patient charge', money(order.patient_charge)),
      field('Sent', order.sent_at ? formatDate(order.sent_at) : '—', !order.sent_at),
      field('Received', order.received_at ? formatDate(order.received_at) : '—', !order.received_at),
    ].join('');

    const instrWrap = document.getElementById('detailInstructionsWrap');
    instrWrap.style.display = order.instructions || order.notes ? 'block' : 'none';
    document.getElementById('detailInstructions').textContent =
      [order.instructions, order.notes ? `Internal: ${order.notes}` : ''].filter(Boolean).join('\n');
    document.getElementById('detailInstructions').style.whiteSpace = 'pre-wrap';

    if (resetHistory) {
      document.getElementById('detailHistory').innerHTML = '<div class="empty-state">Loading history…</div>';
    }

    renderDetailActions(order);
  }

  function renderDetailActions(order) {
    const wrap = document.getElementById('detailActions');
    wrap.innerHTML = '';
    document.getElementById('noteWrap').style.display = state.pendingStatus ? 'block' : 'none';
    if (state.pendingStatus) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';

    TRANSITIONS[order.status].forEach((next, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const danger = next === 'cancelled';
      btn.className = `btn btn-sm ${i === 0 ? 'btn-primary' : danger ? 'btn-outline btn-danger-outline' : 'btn-outline'}`;
      btn.textContent = ACTION_LABELS[next];
      btn.addEventListener('click', () => startStatusChange(next));
      wrap.appendChild(btn);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-outline btn-sm';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => { const id = order.id; closeDetailModal(); openFormModal(id); });
    wrap.appendChild(edit);

    if (order.status !== 'draft' && order.status !== 'cancelled') {
      const paid = document.createElement('button');
      paid.type = 'button';
      paid.className = 'btn btn-outline btn-sm';
      paid.textContent = order.lab_paid ? 'Mark lab as unpaid' : 'Mark lab as paid';
      paid.addEventListener('click', () => toggleLabPaid(order));
      wrap.appendChild(paid);
    }
  }

  async function loadHistory(orderId) {
    try {
      const full = await fetchMethod(`/lab-orders/${orderId}`, 'GET', null, true);
      if (state.activeOrderId !== orderId) return; // modal was closed/changed meanwhile
      renderHistory(full.history || []);
    } catch (err) {
      document.getElementById('detailHistory').innerHTML = '<div class="empty-state">Could not load history.</div>';
    }
  }

  function renderHistory(history) {
    const wrap = document.getElementById('detailHistory');
    if (!history.length) { wrap.innerHTML = '<div class="empty-state">No history yet.</div>'; return; }
    wrap.innerHTML = history.map((h) => `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${escapeHtml(formatDate(h.changed_at))}</span>
          <b>${escapeHtml(STATUS_LABELS[h.status] || h.status)}${h.changed_by_name ? ` <span class="tl-by">· ${escapeHtml(h.changed_by_name)}</span>` : ''}</b>
        </div>
        ${h.notes ? `<div class="timeline-note">${escapeHtml(h.notes)}</div>` : ''}
      </div>
    `).join('');
  }

  /* ---- status changes ---- */
  function startStatusChange(status) {
    if (NOTE_PROMPTS[status]) {
      state.pendingStatus = status;
      document.getElementById('statusNoteLabel').textContent = NOTE_PROMPTS[status];
      document.getElementById('statusNote').value = '';
      renderDetailActions(activeOrder());
      document.getElementById('statusNote').focus();
      return;
    }
    applyStatus(status, null);
  }

  function cancelPendingStatus() {
    state.pendingStatus = null;
    renderDetailActions(activeOrder());
  }

  function confirmPendingStatus() {
    const note = document.getElementById('statusNote').value.trim();
    if (!note) { showToast('Please add a note first.'); return; }
    applyStatus(state.pendingStatus, note);
  }

  async function applyStatus(status, notes) {
    const order = activeOrder();
    if (!order || state.saving) return;
    state.saving = true;
    try {
      const updated = await fetchMethod(`/lab-orders/${order.id}/status`, 'PUT', { status, notes }, true);
      upsertOrder(updated);
      state.pendingStatus = null;
      render();
      renderDetailModal(false);
      loadHistory(order.id);
      showToast(`Marked as ${STATUS_LABELS[status].toLowerCase()}.`);
    } catch (err) {
      showToast(err.message || 'Could not update the order.');
      state.pendingStatus = null;
      await reloadOrders();          // someone else may have changed it — show the truth
      if (activeOrder()) { renderDetailModal(false); loadHistory(order.id); }
    } finally {
      state.saving = false;
    }
  }

  async function toggleLabPaid(order) {
    if (state.saving) return;
    state.saving = true;
    try {
      const updated = await fetchMethod(`/lab-orders/${order.id}`, 'PUT', { lab_paid: !order.lab_paid }, true);
      upsertOrder(updated);
      render();
      renderDetailModal(false);
    } catch (err) {
      showToast(err.message || 'Could not update the order.');
    } finally {
      state.saving = false;
    }
  }

  /* ============================================================
     NEW / EDIT FORM
     ============================================================ */
  function populateWorkTypeSelect() {
    document.getElementById('formWorkType').innerHTML =
      Object.entries(WORK_TYPES).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  }

  function populateLabSelect(selectedId) {
    const sel = document.getElementById('formLab');
    sel.innerHTML = '<option value="">No lab chosen yet</option>'
      + state.labs.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('');
    if (selectedId) sel.value = selectedId;
  }

  function populatePatientSelect() {
    const q = document.getElementById('formPatientSearch').value.trim().toLowerCase();
    const sel = document.getElementById('formPatient');
    const keep = sel.value;
    const matches = state.patients
      .filter((p) => !q || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q))
      .slice(0, 50);
    sel.innerHTML = matches.map((p) =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}${p.phone ? ` — ${escapeHtml(p.phone)}` : ''}</option>`).join('');
    if (keep && matches.some((p) => p.id === keep)) sel.value = keep;
  }

  function openFormModal(orderId) {
    const order = orderId ? state.orders.find((o) => o.id === orderId) : null;
    state.editingOrderId = order ? order.id : null;
    const closed = !!order && (order.status === 'completed' || order.status === 'cancelled');

    document.getElementById('formKicker').textContent = order ? 'Edit lab order' : 'New lab order';
    document.getElementById('formTitle').textContent = order ? order.patient_name : 'Lab order';
    document.getElementById('patientFieldWrap').style.display = order ? 'none' : 'block';
    document.getElementById('formLockedHint').style.display = closed ? 'block' : 'none';

    document.getElementById('formPatientSearch').value = '';
    populatePatientSelect();
    populateLabSelect(order && order.lab_partner_id);

    document.getElementById('formWorkType').value = order ? order.work_type : 'crown';
    document.getElementById('formTeeth').value = order ? teethText(order) : '';
    document.getElementById('formShade').value = (order && order.shade) || '';
    document.getElementById('formMaterial').value = (order && order.material) || '';
    document.getElementById('formDue').value = (order && order.due_date) || '';
    document.getElementById('formLabCost').value = order && Number(order.lab_cost) ? order.lab_cost : '';
    document.getElementById('formCharge').value = order && Number(order.patient_charge) ? order.patient_charge : '';
    document.getElementById('formInstructions').value = (order && order.instructions) || '';
    document.getElementById('formNotes').value = (order && order.notes) || '';

    // Closed orders: clinical fields are locked server-side; mirror that here.
    ['formWorkType', 'formTeeth', 'formShade', 'formMaterial', 'formLab', 'formDue', 'formCharge', 'formInstructions']
      .forEach((id) => { document.getElementById(id).disabled = closed; });

    document.getElementById('formScrim').classList.add('is-open');
  }

  function closeFormModal() {
    document.getElementById('formScrim').classList.remove('is-open');
    state.editingOrderId = null;
  }

  async function saveOrder() {
    if (state.saving) return;
    const value = (id) => document.getElementById(id).value.trim();
    const editing = state.editingOrderId;

    const body = {
      work_type: value('formWorkType'),
      tooth_numbers: value('formTeeth'),
      shade: value('formShade'),
      material: value('formMaterial'),
      lab_partner_id: document.getElementById('formLab').value || null,
      due_date: value('formDue') || null,
      lab_cost: value('formLabCost'),
      patient_charge: value('formCharge'),
      instructions: value('formInstructions'),
      notes: value('formNotes'),
    };

    if (!editing) {
      body.patient_id = document.getElementById('formPatient').value;
      if (!body.patient_id) { showToast('Please select a patient.'); return; }
    }

    const saveBtn = document.getElementById('formSaveBtn');
    state.saving = true;
    saveBtn.disabled = true;
    try {
      const saved = editing
        ? await fetchMethod(`/lab-orders/${editing}`, 'PUT', body, true)
        : await fetchMethod('/lab-orders', 'POST', body, true);
      upsertOrder(saved);
      closeFormModal();
      if (!editing) state.tab = 'active';
      render();
      showToast(editing ? 'Lab order updated.' : 'Lab order saved as a draft.');
      if (!editing) openDetailModal(saved.id); // straight to the order so it can be sent
    } catch (err) {
      showToast(err.message || 'Could not save the lab order.');
    } finally {
      state.saving = false;
      saveBtn.disabled = false;
    }
  }

  /* ============================================================
     ADD LAB
     ============================================================ */
  function openLabModal() {
    ['labName', 'labContact', 'labPhone', 'labEmail'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('labTurnaround').value = '7';
    document.getElementById('labScrim').classList.add('is-open');
    document.getElementById('labName').focus();
  }

  function closeLabModal() {
    document.getElementById('labScrim').classList.remove('is-open');
  }

  async function saveLab() {
    if (state.saving) return;
    const value = (id) => document.getElementById(id).value.trim();
    if (!value('labName')) { showToast('Please enter the lab name.'); return; }

    state.saving = true;
    try {
      const lab = await fetchMethod('/lab-partners', 'POST', {
        name: value('labName'),
        contact_person: value('labContact') || null,
        phone: value('labPhone') || null,
        email: value('labEmail') || null,
        turnaround_days: value('labTurnaround') === '' ? null : Number(value('labTurnaround')),
      }, true);
      state.labs.push(lab);
      state.labs.sort((a, b) => a.name.localeCompare(b.name));

      const formOpen = document.getElementById('formScrim').classList.contains('is-open');
      const current = document.getElementById('formLab').value;
      populateLabSelect(formOpen ? lab.id : current);   // pre-select the new lab if the order form is open
      closeLabModal();
      showToast(`${lab.name} added.`);
    } catch (err) {
      showToast(err.message || 'Could not save the lab.');
    } finally {
      state.saving = false;
    }
  }

  /* ============================================================
     UTILITIES
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

  // Accepts a full ISO timestamp or a plain 'YYYY-MM-DD' date (parsed as a local date, so no day shift).
  function formatDate(iso) {
    if (!iso) return '—';
    const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function initialsOf(name) {
    return String(name || '').replace('Dr. ', '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
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
