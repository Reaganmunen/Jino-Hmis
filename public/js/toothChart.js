(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as dashboard.js. Assumes api.js (fetchMethod,
     getStoredUser, clearSession) is loaded before this file.
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
    dentists: [],
    appointments: [],
    toothChart: {},        // current condition per tooth, keyed by tooth_number
    toothHistoryCache: {}, // full ToothChart history per tooth, fetched lazily on select
    diagnoses: [],
    planItems: [],         // flattened TreatmentPlanItem rows, enriched with planDentistId
    activeCategory: 'medical',
    selectedTooth: null,
    legendFilter: null,    // condition string, or null for "show everything"
  };

  const DONE_STATUSES = ['completed', 'done'];
  const CLOSED_STATUSES = [...DONE_STATUSES, 'cancelled'];

  const CONDITION_LABEL = {
    healthy: 'Healthy', caries: 'Caries', filled: 'Filled', missing: 'Missing', crown: 'Crown',
  };
  const UPPER_ARCH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER_ARCH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

  // TreatmentPlanItem has no category column, so cosmetic vs medical is
  // inferred client-side from procedure_name. Anything that doesn't match
  // a cosmetic keyword falls through to "medical" -- the safer default for
  // fillings, extractions, root canals, crowns, cleanings, X-rays, etc.
  // If you'd rather this be authoritative, the real fix is a `category`
  // column on TreatmentPlanItem set by the dentist when they add the item.
  const COSMETIC_KEYWORDS = ['whiten', 'veneer', 'bonding', 'contour', 'cosmetic', 'bleach', 'smile design'];
  function categorize(procedureName) {
    const lower = (procedureName || '').toLowerCase();
    return COSMETIC_KEYWORDS.some((k) => lower.includes(k)) ? 'cosmetic' : 'medical';
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initCategoryToggle();
    loadPage();
  });

  async function loadPage() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;
      document.getElementById('avatarInitials').textContent =
        initialsOf(`${patient.first_name} ${patient.last_name}`);

      const [chart, dentistList, appts] = await Promise.all([
        fetchMethod(`/tooth-chart/patient/${patient.id}/current`, 'GET', null, true),
        fetchMethod('/users/dentists', 'GET', null, true),
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true),
      ]);

      state.dentists = dentistList;
      state.appointments = appts;
      state.toothChart = {};
      chart.forEach((entry) => { state.toothChart[entry.tooth_number] = entry; });

      // Diagnoses and treatment-plan items enrich the timeline (diagnosis
      // notes, and the medical/cosmetic split) but the odontogram itself
      // only needs the tooth chart above, so these degrade gracefully
      // instead of breaking the page if either request 404s.
      //
      // NOTE ON THESE TWO ENDPOINTS: I don't have diagnosisRoutes.js's
      // mount prefix (app.js/index.js wasn't in what you sent) or a
      // treatmentPlanItemRoutes.js file at all, so `/diagnoses` and
      // `/treatment-plans/:planId/items` below are inferred from the
      // naming convention your other confirmed endpoints use
      // (tooth-chart, treatment-plans, consent-forms, dentist-schedules).
      // If either 404s in your app, check the real mount path and fix
      // the two fetchMethod calls below.
      try {
        state.diagnoses = await fetchMethod(`/diagnoses/patient/${patient.id}`, 'GET', null, true);
      } catch (err) {
        state.diagnoses = [];
      }

      try {
        const plans = await fetchMethod(`/treatment-plans/patient/${patient.id}`, 'GET', null, true);
        const itemLists = await Promise.all(
          plans.map((plan) =>
            fetchMethod(`/treatment-plans/${plan.id}/items`, 'GET', null, true)
              .then((items) => items.map((it) => ({ ...it, planDentistId: plan.dentist_id })))
              .catch(() => [])
          )
        );
        state.planItems = itemLists.flat();
      } catch (err) {
        state.planItems = [];
      }

      renderStats();
      renderLegend();
      renderOdontogram();
      renderDetailPanel();
    } catch (err) {
      handleLoadError(err);
    }
  }

  /* ============================================================
     STATS
     ------------------------------------------------------------
     All computed from data already fetched above — no extra
     requests. "Needing attention" counts current caries; "Last
     recorded visit" takes the newest date across tooth-chart
     entries, diagnoses, and treatment-plan items.
     ============================================================ */
  function renderStats() {
    const attention = Object.values(state.toothChart).filter((e) => e.condition === 'caries').length;
    document.getElementById('statAttention').textContent = attention;

    const pending = state.planItems.filter((it) => !CLOSED_STATUSES.includes(it.status)).length;
    document.getElementById('statPending').textContent = pending;

    const cosmeticDone = state.planItems.filter(
      (it) => categorize(it.procedure_name) === 'cosmetic' && DONE_STATUSES.includes(it.status)
    ).length;
    document.getElementById('statCosmetic').textContent = cosmeticDone;

    const dates = [
      ...Object.values(state.toothChart).map((e) => e.recorded_at),
      ...state.diagnoses.map((d) => d.created_at),
      ...state.planItems.map((it) => it.created_at),
    ].filter(Boolean).map((d) => new Date(d));
    const last = dates.length ? new Date(Math.max(...dates)) : null;
    document.getElementById('statLastVisit').textContent =
      last ? last.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '—';
  }

  function handleLoadError(err) {
    const authFailures = ['No token provided', 'Invalid token', 'Token expired', 'Account not found or inactive'];
    if (authFailures.includes(err.message)) {
      clearSession();
      window.location.href = LOGIN_PATH;
      return;
    }
    showToast(err.message || 'Could not load your tooth chart. Please refresh.');
  }

  /* ============================================================
     ODONTOGRAM — identical anatomical SVG layout/markup to the
     dashboard's (same TOOTH_SHAPES, same QUADRANT_TRANSFORM, same
     tooth-svg/cond-* classes), just recolored by whichever category
     tab is active instead of always showing medical condition.
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

  function cosmeticToothSet() {
    return new Set(
      state.planItems
        .filter((it) => categorize(it.procedure_name) === 'cosmetic')
        .map((it) => Number(it.tooth_number))
    );
  }

  function renderOdontogram() {
    const svg = document.getElementById('odontogramSvg');
    svg.innerHTML = '';

    const ALL_TEETH = [...UPPER_ARCH, ...LOWER_ARCH];
    const cosmeticTeeth = state.activeCategory === 'cosmetic' ? cosmeticToothSet() : null;

    ALL_TEETH.forEach((num) => {
      const quadrant = Math.floor(num / 10);
      const position = num % 10;
      const shape = TOOTH_SHAPES[position];
      if (!shape) return;

      let condition = 'healthy';
      if (state.activeCategory === 'medical') {
        const entry = state.toothChart[num];
        const raw = entry ? entry.condition : 'healthy';
        condition = CONDITION_LABEL[raw] ? raw : 'healthy';
      } else if (cosmeticTeeth.has(num)) {
        condition = 'cosmetic';
      }

      // Same split as dashboard.js: the outer <g> only ever carries the
      // quadrant-mirroring transform attribute, kept separate from the
      // inner group's class-driven hover-scale CSS transform, since a CSS
      // transform on an element overrides that same element's SVG
      // transform attribute.
      const quadrantGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      quadrantGroup.setAttribute('transform', QUADRANT_TRANSFORM[quadrant] || '');

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `tooth-svg cond-${condition}` + (state.selectedTooth === num ? ' is-selected' : ''));
      g.setAttribute('data-tooth', num);
      g.setAttribute('data-condition', condition);
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Tooth ${num}, ${toothName(num)}`);

      // No <title> element here — the custom tooltip below replaces the
      // native browser one, which was slow to appear and hard to style.
      const highlightPaths = Array.isArray(shape.highlight) ? shape.highlight : [shape.highlight];
      g.innerHTML = `
        <path class="tooth-outline" d="${shape.outline}"></path>
        <path class="tooth-fill" d="${shape.fill}"></path>
        ${highlightPaths.map((d) => `<path class="tooth-highlight" d="${d}"></path>`).join('')}
      `;
      g.addEventListener('click', () => selectTooth(num));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTooth(num); }
      });
      g.addEventListener('mouseenter', (e) => showTooltip(e, num, condition));
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', hideTooltip);
      quadrantGroup.appendChild(g);
      svg.appendChild(quadrantGroup);
    });

    applyLegendFilter();
  }

  /* ============================================================
     HOVER TOOLTIP
     ============================================================ */
  function showTooltip(e, num, condition) {
    const tooltip = document.getElementById('toothTooltip');
    const label = state.activeCategory === 'medical'
      ? (CONDITION_LABEL[condition] || capitalize(condition))
      : (condition === 'cosmetic' ? 'Cosmetic work done' : 'No cosmetic work');
    tooltip.innerHTML = `<b>Tooth ${num}</b><span>${escapeHtml(toothName(num))} · ${escapeHtml(label)}</span>`;
    tooltip.classList.add('is-visible');
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const tooltip = document.getElementById('toothTooltip');
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
  }

  function hideTooltip() {
    document.getElementById('toothTooltip').classList.remove('is-visible');
  }

  // Click a legend item to highlight only teeth in that condition and dim
  // the rest; click it again (or switch category) to clear the filter.
  function renderLegend() {
    const legend = document.getElementById('legend');
    const items = state.activeCategory === 'medical'
      ? [
          { cond: 'healthy', label: 'Healthy' },
          { cond: 'caries', label: 'Caries' },
          { cond: 'filled', label: 'Filled' },
          { cond: 'missing', label: 'Missing' },
          { cond: 'crown', label: 'Crown' },
        ]
      : [
          { cond: 'healthy', label: 'No cosmetic work' },
          { cond: 'cosmetic', label: 'Cosmetic work done' },
        ];

    legend.innerHTML = items.map((it) => `
      <button type="button" class="legend-item${state.legendFilter === it.cond ? ' is-active' : ''}" data-condition="${it.cond}">
        <i class="dot dot-${it.cond}"></i>${it.label}
      </button>
    `).join('');

    legend.querySelectorAll('.legend-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cond = btn.getAttribute('data-condition');
        state.legendFilter = state.legendFilter === cond ? null : cond;
        renderLegend();
        applyLegendFilter();
      });
    });
  }

  function applyLegendFilter() {
    document.querySelectorAll('.tooth-svg').forEach((el) => {
      const cond = el.getAttribute('data-condition');
      el.classList.toggle('is-dimmed', !!state.legendFilter && cond !== state.legendFilter);
    });
  }

  function initCategoryToggle() {
    document.querySelectorAll('.segmented-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.getAttribute('data-category');
        if (category === state.activeCategory) return;
        state.activeCategory = category;
        state.legendFilter = null; // condition sets differ between tabs, so a stale filter wouldn't make sense
        document.querySelectorAll('.segmented-opt').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderLegend();
        renderOdontogram();
        renderDetailPanel();
      });
    });
  }

  /* ============================================================
     TOOTH DETAIL — merges ToothChart conditions, Diagnoses, and
     TreatmentPlanItems into one timeline, filtered by active category.
     ============================================================ */
  async function selectTooth(number) {
    state.selectedTooth = number;
    document.querySelectorAll('.tooth-svg').forEach((t) => t.classList.remove('is-selected'));
    const el = document.querySelector(`.tooth-svg[data-tooth="${number}"]`);
    if (el) el.classList.add('is-selected');

    const detail = document.getElementById('toothDetail');
    detail.innerHTML = '<p class="tooth-detail-empty">Loading history…</p>';

    if (!state.toothHistoryCache[number]) {
      try {
        state.toothHistoryCache[number] = await fetchMethod(
          `/tooth-chart/patient/${state.patientId}/tooth/${number}`, 'GET', null, true
        );
      } catch (err) {
        state.toothHistoryCache[number] = [];
      }
    }

    renderToothDetail(number);
  }

  // Called after data loads (shows recent activity) and after switching
  // category tabs — routes to whichever view is current.
  function renderDetailPanel() {
    if (state.selectedTooth) {
      renderToothDetail(state.selectedTooth);
    } else {
      renderRecentActivity();
    }
  }

  function buildToothTimeline(number, category) {
    const items = [];

    (state.toothHistoryCache[number] || []).forEach((h) => {
      items.push({
        type: 'Condition',
        category: 'medical',
        date: h.recorded_at,
        title: CONDITION_LABEL[h.condition] || capitalize(h.condition),
        dentist: dentistNameById(h.recorded_by),
        note: h.notes,
        appointmentId: h.appointment_id,
      });
    });

    state.diagnoses.forEach((dx) => {
      const refs = (dx.tooth_refs || []).map(Number);
      if (!refs.includes(Number(number))) return;
      items.push({
        type: 'Diagnosis',
        category: 'medical',
        date: dx.created_at,
        title: 'Diagnosis recorded',
        dentist: dentistNameById(dx.dentist_id),
        note: dx.diagnosis_text,
        appointmentId: dx.appointment_id,
      });
    });

    state.planItems.forEach((it) => {
      if (Number(it.tooth_number) !== Number(number)) return;
      items.push({
        type: 'Treatment',
        category: categorize(it.procedure_name),
        date: it.created_at,
        title: it.procedure_name,
        dentist: dentistNameById(it.planDentistId),
        status: it.status,
        cost: it.estimated_cost,
        appointmentId: it.completed_appointment_id,
      });
    });

    return items
      .filter((i) => i.category === category)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  // Same three sources as buildToothTimeline, but across every tooth and
  // capped to a handful of entries — this is what the detail panel shows
  // by default, before any tooth is clicked.
  function buildRecentActivity(category, limit) {
    const items = [];

    Object.values(state.toothChart).forEach((entry) => {
      items.push({
        type: 'Condition',
        category: 'medical',
        date: entry.recorded_at,
        title: CONDITION_LABEL[entry.condition] || capitalize(entry.condition),
        dentist: dentistNameById(entry.recorded_by),
        note: entry.notes,
        toothNumber: entry.tooth_number,
        appointmentId: entry.appointment_id,
      });
    });

    state.diagnoses.forEach((dx) => {
      const refs = (dx.tooth_refs || []).map(Number);
      items.push({
        type: 'Diagnosis',
        category: 'medical',
        date: dx.created_at,
        title: 'Diagnosis recorded',
        dentist: dentistNameById(dx.dentist_id),
        note: dx.diagnosis_text,
        toothNumber: refs.length ? refs.join(', ') : null,
        appointmentId: dx.appointment_id,
      });
    });

    state.planItems.forEach((it) => {
      items.push({
        type: 'Treatment',
        category: categorize(it.procedure_name),
        date: it.created_at,
        title: it.procedure_name,
        dentist: dentistNameById(it.planDentistId),
        status: it.status,
        cost: it.estimated_cost,
        toothNumber: it.tooth_number,
        appointmentId: it.completed_appointment_id,
      });
    });

    return items
      .filter((i) => i.category === category)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, limit);
  }

  // Shared row markup for both the recent-activity view and the
  // single-tooth timeline, so cost/status/appointment-link formatting
  // stays consistent between them.
  function renderTimelineRow(item, opts) {
    opts = opts || {};
    const d = item.date ? new Date(item.date) : null;
    const month = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '—';
    const day = d ? d.getDate() : '';
    const statusBadge = item.status
      ? `<span class="badge ${statusBadgeClass(item.status)}">${statusLabel(item.status)}</span>`
      : '';
    const costLine = item.cost != null && item.cost !== ''
      ? `<span class="timeline-cost">KSh ${Number(item.cost).toLocaleString('en-KE')}</span>`
      : '';
    const toothPill = opts.showTooth && item.toothNumber
      ? `<span class="timeline-tooth">Tooth ${item.toothNumber}</span>`
      : '';
    // Appointments live on a different page — this links there rather than
    // duplicating appointment detail here. If appointments.html doesn't
    // read an ?id= param yet, the link still just takes them to My
    // Appointments; wire up auto-scroll/highlight there when convenient.
    const appt = item.appointmentId ? state.appointments.find((a) => a.id === item.appointmentId) : null;

    return `
      <div class="timeline-item">
        <div class="timeline-row">
          <span class="timeline-date">${month} ${day}</span>
          ${toothPill}
          <span><b>${escapeHtml(item.title)}</b>${item.type}</span>
          <span><b>${escapeHtml(item.dentist || '—')}</b>Dentist</span>
          ${statusBadge}
          ${costLine}
        </div>
        ${item.note ? `<div class="timeline-note">${escapeHtml(item.note)}</div>` : ''}
        ${appt ? `<a class="timeline-appt-link" href="appointments.html?id=${appt.id}">View appointment · ${escapeHtml(appt.reason || 'Appointment')}</a>` : ''}
      </div>
    `;
  }

  function renderRecentActivity() {
    const detail = document.getElementById('toothDetail');
    const items = buildRecentActivity(state.activeCategory, 6);

    if (!items.length) {
      detail.innerHTML = `
        <p class="tooth-detail-title">Recent activity</p>
        <p class="tooth-detail-sub">Across all teeth</p>
        <p class="tooth-detail-empty">No ${state.activeCategory} activity on record yet.</p>
      `;
      return;
    }

    const rows = items.map((item) => renderTimelineRow(item, { showTooth: true })).join('');
    detail.innerHTML = `
      <p class="tooth-detail-title">Recent activity</p>
      <p class="tooth-detail-sub">Across all teeth · tap any tooth for its full history</p>
      <div class="timeline">${rows}</div>
    `;
  }

  function renderToothDetail(number) {
    const detail = document.getElementById('toothDetail');
    const items = buildToothTimeline(number, state.activeCategory);
    const backLink = '<button type="button" class="tooth-detail-back" id="backToRecent">&larr; All recent activity</button>';

    if (!items.length) {
      detail.innerHTML = `
        ${backLink}
        <p class="tooth-detail-title">Tooth ${number}</p>
        <p class="tooth-detail-sub">${toothName(number)}</p>
        <p class="tooth-detail-empty">No ${state.activeCategory} history on record for this tooth.</p>
      `;
    } else {
      const rows = items.map((item) => renderTimelineRow(item, { showTooth: false })).join('');
      detail.innerHTML = `
        ${backLink}
        <p class="tooth-detail-title">Tooth ${number}</p>
        <p class="tooth-detail-sub">${toothName(number)}</p>
        <div class="timeline">${rows}</div>
      `;
    }

    document.getElementById('backToRecent').addEventListener('click', () => {
      state.selectedTooth = null;
      document.querySelectorAll('.tooth-svg').forEach((t) => t.classList.remove('is-selected'));
      renderDetailPanel();
    });
  }

  function statusBadgeClass(status) {
    if (status === 'completed' || status === 'done') return 'badge-confirmed';
    if (status === 'cancelled') return 'badge-cancelled';
    return 'badge-pending';
  }

  function statusLabel(status) {
    if (status === 'completed' || status === 'done') return '✓ Done';
    if (status === 'cancelled') return 'Cancelled';
    return '⏳ Pending';
  }

  function dentistNameById(id) {
    const d = state.dentists.find((x) => x.id === id);
    return d ? `Dr. ${d.first_name} ${d.last_name}` : 'Dentist';
  }

  /* ============================================================
     SIDEBAR + NAV — same behavior as dashboard.js, duplicated here
     rather than shared, matching how each portal page owns its own
     controller file in this codebase.
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

    // Every nav link here has a real href (this page ships alongside
    // the others), so just close the sidebar on tap/click for mobile.
    document.querySelectorAll('[data-page]').forEach((link) => {
      link.addEventListener('click', closeSidebar);
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

  function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : str; }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();