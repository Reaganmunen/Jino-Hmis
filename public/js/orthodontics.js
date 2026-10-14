/* ============================================================
   ORTHODONTICS — dentist side
   ------------------------------------------------------------
     Orthodontics.render(container, { patientId, patientName, onLoaded })

   One "case" per course of treatment: a baseline diagnosis & plan
   (draft -> finalised, then locked), a progress status
   (planning -> active -> retention -> completed), and a timeline of
   adjustment visits. Visit records can be corrected for 24 hours.

   Needs api.js (fetchMethod, getStoredUser). Styles: ortho.css.
   ============================================================ */
(function () {
  'use strict';

  const call = (path, method, body) => fetchMethod(path, method || 'GET', body || null, true);

  /* ---------- helpers ---------- */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const fmtDate = (s) => {
    if (!s) return '—';
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const addMonths = (dateStr, months) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  };
  const addWeeks = (dateStr, weeks) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + weeks * 7)).toISOString().slice(0, 10);
  };
  const money = (v) => (v == null || v === '' ? '—' : `KES ${Number(v).toLocaleString('en-KE')}`);
  const mm = (v) => (v == null ? '—' : `${Number(v)} mm`);
  const isDentist = () => { const u = getStoredUser(); return !!u && u.role === 'dentist'; };
  const myId = () => { const u = getStoredUser(); return u ? String(u.id) : ''; };
  const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

  const TREATMENT = {
    fixed_metal: 'Fixed braces (metal)', fixed_ceramic: 'Fixed braces (ceramic)', clear_aligners: 'Clear aligners',
    lingual: 'Lingual braces', removable: 'Removable appliance', retainers_only: 'Retainers only',
  };
  const ANGLE = { I: 'Class I', II_div1: 'Class II div 1', II_div2: 'Class II div 2', III: 'Class III' };
  const SKELETAL = { I: 'Class I', II: 'Class II', III: 'Class III' };
  const STATUS = { planning: 'Planning', active: 'Active treatment', retention: 'Retention', completed: 'Completed', discontinued: 'Discontinued' };
  const VISIT_TYPE = {
    records: 'Records & photos', bonding: 'Bonding / fitting', adjustment: 'Adjustment', aligner_change: 'Aligner change',
    emergency: 'Emergency', debond: 'Debond', retainer_fit: 'Retainer fitted', retention_review: 'Retention review',
  };
  const LEVEL = { good: 'Good', fair: 'Fair', poor: 'Poor' };
  const PROGRESS = { ahead: 'Ahead of plan', on_track: 'On track', slow: 'Slower than planned', concern: 'Concern' };
  const NEXT = {
    planning: [['active', 'Start treatment']],
    active: [['retention', 'Debond → retention'], ['discontinued', 'Discontinue']],
    retention: [['completed', 'Complete case'], ['active', 'Back to active (refinement)'], ['discontinued', 'Discontinue']],
  };
  const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

  const select = (id, map, current, blank) =>
    `<select class="field-input" id="${id}">${blank ? opt('', blank, !current) : ''}${Object.keys(map).map((k) => opt(k, map[k], current === k)).join('')}</select>`;
  const field = (label, control, hint) =>
    `<div class="oc-field"><label class="field-label">${esc(label)}</label>${control}${hint ? `<span class="oc-hint">${esc(hint)}</span>` : ''}</div>`;
  const numInput = (id, val, step, min, max) =>
    `<input class="field-input" type="number" id="${id}" step="${step}" min="${min}" max="${max}" value="${esc(val == null ? '' : val)}">`;
  const textInput = (id, val, max) =>
    `<input class="field-input" type="text" id="${id}" maxlength="${max}" value="${esc(val || '')}">`;
  const textArea = (id, val, max, rows) =>
    `<textarea class="field-input" id="${id}" rows="${rows || 3}" maxlength="${max}">${esc(val || '')}</textarea>`;

  /* ---------- overlay form ---------- */
  function openOverlay({ title, body, actions, onMount }) {
    const wrap = document.createElement('div');
    wrap.className = 'oc-overlay';
    wrap.innerHTML = `
      <div class="oc-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="oc-dialog-head"><h3>${esc(title)}</h3><button type="button" class="oc-x" data-oc-close aria-label="Close">×</button></div>
        <div class="oc-dialog-body">${body}</div>
        <p class="oc-error" id="ocError" style="display:none;"></p>
        <div class="oc-dialog-foot">${actions.map((a) => `<button type="button" class="btn ${a.cls || 'btn-secondary'} btn-sm" data-oc-act="${esc(a.key)}">${esc(a.label)}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-oc-close]').addEventListener('click', close);
    const errBox = wrap.querySelector('#ocError');
    const ctl = {
      el: wrap,
      close,
      q: (sel) => wrap.querySelector(sel),
      val: (id) => { const el = wrap.querySelector(`#${id}`); return el ? el.value : ''; },
      checked: (id) => { const el = wrap.querySelector(`#${id}`); return !!(el && el.checked); },
      error: (msg) => { errBox.textContent = msg; errBox.style.display = msg ? '' : 'none'; },
      busy: (on) => wrap.querySelectorAll('[data-oc-act]').forEach((b) => { b.disabled = on; }),
    };
    actions.forEach((a) => {
      wrap.querySelector(`[data-oc-act="${a.key}"]`).addEventListener('click', () => a.run(ctl));
    });
    if (onMount) onMount(ctl);
    return ctl;
  }

  /* ---------- baseline form ---------- */
  function baselineBody(c) {
    c = c || {};
    return `
      <div class="oc-grid">
        ${field('Treatment type *', select('ocType', TREATMENT, c.treatment_type, 'Choose…'))}
        ${field('Planned duration (months) *', numInput('ocMonths', c.planned_months, 1, 1, 60))}
        ${field('Angle class — right', select('ocAngleR', ANGLE, c.angle_class_right, '—'))}
        ${field('Angle class — left', select('ocAngleL', ANGLE, c.angle_class_left, '—'))}
        ${field('Skeletal pattern', select('ocSkeletal', SKELETAL, c.skeletal_pattern, '—'))}
        ${field('Total fee (KES)', numInput('ocFee', c.total_fee, 0.01, 0, 99999999))}
        ${field('Overjet (mm)', numInput('ocOJ', c.overjet_mm, 0.1, -10, 25))}
        ${field('Overbite (mm)', numInput('ocOB', c.overbite_mm, 0.1, -10, 20))}
        ${field('Upper crowding (mm)', numInput('ocCrU', c.crowding_upper_mm, 0.1, -20, 20), 'Negative = spacing')}
        ${field('Lower crowding (mm)', numInput('ocCrL', c.crowding_lower_mm, 0.1, -20, 20), 'Negative = spacing')}
        ${field('Midline deviation (mm)', numInput('ocMid', c.midline_deviation_mm, 0.1, -15, 15))}
        <div class="oc-field oc-checks">
          <label><input type="checkbox" id="ocXbite"${c.crossbite ? ' checked' : ''}> Crossbite</label>
          <label><input type="checkbox" id="ocOpen"${c.open_bite ? ' checked' : ''}> Open bite</label>
        </div>
      </div>
      ${field('Problem list *', textArea('ocProblems', c.problem_list, 2000, 3))}
      ${field('Treatment objectives *', textArea('ocObjectives', c.treatment_objectives, 2000, 3))}
      ${field('Extractions', textInput('ocExtractions', c.extractions, 500), 'e.g. 14, 24 — or "none"')}
      ${field('Appliance notes', textInput('ocAppliance', c.appliance_notes, 1000))}
      <p class="oc-note">Finalising locks the diagnosis and plan. Status, dates and retention details stay editable.</p>`;
  }

  function readBaseline(ctl) {
    return {
      treatment_type: ctl.val('ocType'), planned_months: ctl.val('ocMonths'),
      angle_class_right: ctl.val('ocAngleR'), angle_class_left: ctl.val('ocAngleL'), skeletal_pattern: ctl.val('ocSkeletal'),
      total_fee: ctl.val('ocFee'), overjet_mm: ctl.val('ocOJ'), overbite_mm: ctl.val('ocOB'),
      crowding_upper_mm: ctl.val('ocCrU'), crowding_lower_mm: ctl.val('ocCrL'), midline_deviation_mm: ctl.val('ocMid'),
      crossbite: ctl.checked('ocXbite'), open_bite: ctl.checked('ocOpen'),
      problem_list: ctl.val('ocProblems'), treatment_objectives: ctl.val('ocObjectives'),
      extractions: ctl.val('ocExtractions'), appliance_notes: ctl.val('ocAppliance'),
    };
  }

  function openBaselineForm(c, onSaved) {
    const save = (finalise) => async (ctl) => {
      ctl.error(''); ctl.busy(true);
      try {
        const body = { ...readBaseline(ctl), finalise };
        if (c) await call(`/ortho/cases/${c.id}`, 'PUT', body);
        else await call(`/ortho/patient/${onSaved.patientId}`, 'POST', body);
        ctl.close(); onSaved();
      } catch (err) { ctl.error(err.message); ctl.busy(false); }
    };
    openOverlay({
      title: c ? 'Edit baseline (draft)' : 'New orthodontic case',
      body: baselineBody(c),
      actions: [
        { key: 'cancel', label: 'Cancel', run: (ctl) => ctl.close() },
        { key: 'draft', label: 'Save draft', run: save(false) },
        { key: 'final', label: 'Save & finalise', cls: 'btn-primary', run: (ctl) => {
          if (window.confirm('Finalise the baseline? The diagnosis and plan will be locked.')) save(true)(ctl);
        } },
      ],
    });
  }

  /* ---------- visit form ---------- */
  function visitBody(v, c) {
    v = v || {};
    return `
      <div class="oc-grid">
        ${field('Visit date', `<input class="field-input" type="date" id="ovDate" max="${today()}" value="${esc(v.visit_date || today())}">`)}
        ${field('Visit type *', select('ovType', VISIT_TYPE, v.visit_type || (c && c.status === 'planning' ? 'records' : 'adjustment'), 'Choose…'))}
        ${field('Upper wire', textInput('ovUpper', v.upper_wire, 100), 'e.g. 0.016 NiTi')}
        ${field('Lower wire', textInput('ovLower', v.lower_wire, 100), 'e.g. 0.018 SS')}
        ${field('Elastics', textInput('ovElastics', v.elastics, 200), 'e.g. Class II 3/16" 6oz')}
        ${field('Aligner tray #', numInput('ovTray', v.aligner_tray, 1, 0, 200))}
        ${field('Oral hygiene', select('ovHygiene', LEVEL, v.oral_hygiene, '—'))}
        ${field('Compliance', select('ovCompliance', LEVEL, v.compliance, '—'))}
        ${field('Progress', select('ovProgress', PROGRESS, v.progress, '—'))}
        ${field('Next visit in (weeks)', numInput('ovNext', v.next_visit_weeks, 1, 1, 52))}
        <div class="oc-field oc-checks"><label><input type="checkbox" id="ovIpr"${v.ipr_done ? ' checked' : ''}> IPR done</label></div>
      </div>
      ${field('Procedures done', textArea('ovProcedures', v.procedures, 1500, 3))}
      ${field('Notes', textArea('ovNotes', v.notes, 2000, 3))}`;
  }

  function openVisitForm(c, v, onSaved, patientId) {
    openOverlay({
      title: v ? 'Edit visit' : 'Record visit',
      body: visitBody(v, c),
      actions: [
        { key: 'cancel', label: 'Cancel', run: (ctl) => ctl.close() },
        { key: 'save', label: 'Save visit', cls: 'btn-primary', run: async (ctl) => {
          ctl.error(''); ctl.busy(true);
          const body = {
            visit_date: ctl.val('ovDate'), visit_type: ctl.val('ovType'),
            upper_wire: ctl.val('ovUpper'), lower_wire: ctl.val('ovLower'), elastics: ctl.val('ovElastics'),
            aligner_tray: ctl.val('ovTray'), ipr_done: ctl.checked('ovIpr'),
            oral_hygiene: ctl.val('ovHygiene'), compliance: ctl.val('ovCompliance'), progress: ctl.val('ovProgress'),
            next_visit_weeks: ctl.val('ovNext'), procedures: ctl.val('ovProcedures'), notes: ctl.val('ovNotes'),
            appointment_id: v ? v.appointment_id : null,
          };
          try {
            const saved = v
              ? await call(`/ortho/visits/${v.id}`, 'PUT', body)
              : await call(`/ortho/cases/${c.id}/visits`, 'POST', body);
            ctl.close();
            if (!v && saved.next_visit_weeks && window.confirm(`Create a recall reminder for ${saved.next_visit_weeks} week(s) from this visit?`)) {
              try {
                await call('/recall-reminders', 'POST', {
                  patient_id: patientId,
                  due_date: addWeeks(saved.visit_date, saved.next_visit_weeks),
                  reminder_type: 'follow_up',
                  channel: 'sms',
                  notes: 'Orthodontic adjustment visit',
                });
              } catch (e) { window.alert('The visit was saved, but the recall reminder could not be created.'); }
            }
            onSaved();
          } catch (err) { ctl.error(err.message); ctl.busy(false); }
        } },
      ],
    });
  }

  /* ---------- status change ---------- */
  function openStatusForm(c, target, onSaved) {
    let extra = '';
    if (target === 'active') extra = field('Start date', `<input class="field-input" type="date" id="osStart" value="${esc(c.start_date || today())}">`);
    if (target === 'retention') {
      extra = field('Debond date', `<input class="field-input" type="date" id="osDebond" value="${esc(c.debond_date || today())}">`)
        + field('Retainer type', textInput('osRetainer', c.retainer_type, 200), 'e.g. Fixed lower 3-3 + Essix upper')
        + field('Retention notes', textArea('osRetNotes', c.retention_notes, 1000, 3));
    }
    if (target === 'discontinued') extra = field('Reason *', textArea('osReason', '', 500, 3));
    if (target === 'completed') extra = '<p class="oc-note">The case will be closed and can no longer be changed.</p>';

    openOverlay({
      title: STATUS[target] ? `Move to: ${STATUS[target]}` : 'Change status',
      body: extra || '<p class="oc-note">Confirm this change.</p>',
      actions: [
        { key: 'cancel', label: 'Cancel', run: (ctl) => ctl.close() },
        { key: 'go', label: 'Confirm', cls: 'btn-primary', run: async (ctl) => {
          ctl.error(''); ctl.busy(true);
          const body = { status: target };
          if (target === 'active') body.start_date = ctl.val('osStart');
          if (target === 'retention') {
            body.debond_date = ctl.val('osDebond'); body.retainer_type = ctl.val('osRetainer'); body.retention_notes = ctl.val('osRetNotes');
          }
          if (target === 'discontinued') body.discontinue_reason = ctl.val('osReason');
          try { await call(`/ortho/cases/${c.id}/progress`, 'PATCH', body); ctl.close(); onSaved(); }
          catch (err) { ctl.error(err.message); ctl.busy(false); }
        } },
      ],
    });
  }

  /* ---------- rendering ---------- */
  const stat = (label, value) => `<span class="oc-stat">${esc(label)} <b>${esc(value)}</b></span>`;

  function visitHtml(v) {
    const mine = String(v.dentist_id) === myId();
    const editable = mine && isDentist() && (Date.now() - new Date(v.created_at).getTime() < EDIT_WINDOW_MS);
    const bits = [];
    if (v.upper_wire) bits.push(`Upper: ${esc(v.upper_wire)}`);
    if (v.lower_wire) bits.push(`Lower: ${esc(v.lower_wire)}`);
    if (v.elastics) bits.push(`Elastics: ${esc(v.elastics)}`);
    if (v.aligner_tray != null) bits.push(`Tray ${esc(v.aligner_tray)}`);
    if (v.ipr_done) bits.push('IPR');
    const flags = [];
    if (v.oral_hygiene) flags.push(`Hygiene: ${LEVEL[v.oral_hygiene]}`);
    if (v.compliance) flags.push(`Compliance: ${LEVEL[v.compliance]}`);
    return `
      <li class="oc-visit${v.progress === 'concern' || v.progress === 'slow' ? ' is-flagged' : ''}">
        <div class="oc-visit-head">
          <b>${esc(fmtDate(v.visit_date))}</b> · ${esc(VISIT_TYPE[v.visit_type] || v.visit_type)}
          ${v.progress ? `<span class="oc-chip oc-chip-${esc(v.progress)}">${esc(PROGRESS[v.progress])}</span>` : ''}
          <span class="oc-by">Dr ${esc(v.dentist_first_name)} ${esc(v.dentist_last_name)}</span>
          ${editable ? `<button type="button" class="oc-link" data-oc-edit-visit="${esc(v.id)}">Edit</button><button type="button" class="oc-link oc-danger" data-oc-del-visit="${esc(v.id)}">Delete</button>` : ''}
        </div>
        ${bits.length ? `<div class="oc-visit-line">${bits.join(' · ')}</div>` : ''}
        ${flags.length ? `<div class="oc-visit-line">${esc(flags.join(' · '))}</div>` : ''}
        ${v.procedures ? `<div class="oc-visit-text">${esc(v.procedures)}</div>` : ''}
        ${v.notes ? `<div class="oc-visit-text oc-muted">${esc(v.notes)}</div>` : ''}
        ${v.next_visit_weeks ? `<div class="oc-visit-line oc-muted">Next visit in ${esc(v.next_visit_weeks)} week${v.next_visit_weeks === 1 ? '' : 's'}</div>` : ''}
      </li>`;
  }

  function cardHtml(c, visits) {
    const final = c.baseline_status === 'final';
    const mine = String(c.dentist_id) === myId();
    const open = ['planning', 'active', 'retention'].includes(c.status);
    const dentist = isDentist();
    const est = c.start_date && c.planned_months ? fmtDate(addMonths(c.start_date, c.planned_months)) : null;

    const stats = [
      stat('Angle R / L', `${ANGLE[c.angle_class_right] || '—'} / ${ANGLE[c.angle_class_left] || '—'}`),
      c.skeletal_pattern ? stat('Skeletal', SKELETAL[c.skeletal_pattern]) : '',
      stat('Overjet', mm(c.overjet_mm)), stat('Overbite', mm(c.overbite_mm)),
      stat('Crowding U / L', `${mm(c.crowding_upper_mm)} / ${mm(c.crowding_lower_mm)}`),
      c.midline_deviation_mm != null ? stat('Midline', mm(c.midline_deviation_mm)) : '',
      c.crossbite ? stat('Crossbite', 'yes') : '', c.open_bite ? stat('Open bite', 'yes') : '',
      stat('Planned', c.planned_months ? `${c.planned_months} mo` : '—'),
      stat('Fee', money(c.total_fee)),
    ].join('');

    const meta = [c.start_date ? `Started ${fmtDate(c.start_date)}` : 'Not started'];
    if (est && c.status === 'active') meta.push(`estimated finish ${est}`);
    if (c.debond_date) meta.push(`debonded ${fmtDate(c.debond_date)}`);
    if (c.retainer_type) meta.push(`retainer: ${c.retainer_type}`);
    if (c.discontinue_reason) meta.push(`discontinued: ${c.discontinue_reason}`);

    const actions = [];
    if (dentist && !final && mine) {
      actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-oc-edit-base="${esc(c.id)}">Edit baseline</button>`);
      actions.push(`<button type="button" class="btn btn-primary btn-sm" data-oc-final="${esc(c.id)}">Finalise baseline</button>`);
      if (!visits.length) actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-oc-del-case="${esc(c.id)}">Delete draft</button>`);
    }
    if (dentist && open) {
      actions.push(`<button type="button" class="btn btn-primary btn-sm" data-oc-add-visit="${esc(c.id)}">+ Record visit</button>`);
      (NEXT[c.status] || []).forEach(([t, label]) => {
        if (c.baseline_status !== 'final' && t !== 'discontinued') return;
        actions.push(`<button type="button" class="btn btn-secondary btn-sm" data-oc-status="${esc(c.id)}|${t}">${esc(label)}</button>`);
      });
    }

    return `
      <article class="oc-card">
        <div class="oc-card-head">
          <div>
            <h4>${esc(TREATMENT[c.treatment_type] || c.treatment_type)}</h4>
            <p class="oc-sub">Dr ${esc(c.dentist_first_name)} ${esc(c.dentist_last_name)} · opened ${esc(fmtDate(String(c.created_at).slice(0, 10)))}</p>
          </div>
          <div class="oc-badges">
            <span class="oc-badge oc-st-${esc(c.status)}">${esc(STATUS[c.status])}</span>
            <span class="oc-badge ${final ? 'oc-b-final' : 'oc-b-draft'}">${final ? 'Baseline locked' : 'Baseline draft'}</span>
          </div>
        </div>
        <div class="oc-stats">${stats}</div>
        ${c.problem_list ? `<div class="oc-text"><b>Problems:</b> ${esc(c.problem_list)}</div>` : ''}
        ${c.treatment_objectives ? `<div class="oc-text"><b>Objectives:</b> ${esc(c.treatment_objectives)}</div>` : ''}
        ${c.extractions ? `<div class="oc-text"><b>Extractions:</b> ${esc(c.extractions)}</div>` : ''}
        ${c.appliance_notes ? `<div class="oc-text"><b>Appliance:</b> ${esc(c.appliance_notes)}</div>` : ''}
        <div class="oc-meta">${esc(meta.join(' · '))}</div>
        ${actions.length ? `<div class="oc-actions">${actions.join('')}</div>` : ''}
        <div class="oc-visits-title">Visits (${visits.length})</div>
        ${visits.length ? `<ul class="oc-visits">${visits.map(visitHtml).join('')}</ul>` : '<div class="empty-state">No visits recorded yet.</div>'}
      </article>`;
  }

  function render(container, opts) {
    const { patientId, onLoaded } = opts;

    const reload = () => {
      container.innerHTML = '<div class="empty-state">Loading orthodontics…</div>';
      return call(`/ortho/patient/${patientId}`).then((cases) =>
        Promise.all(cases.map((c) => call(`/ortho/cases/${c.id}/visits`).catch(() => []))).then((visitLists) => {
          if (typeof onLoaded === 'function') { try { onLoaded(cases); } catch (e) { /* never block the render */ } }
          const byId = {}; cases.forEach((c, i) => { byId[c.id] = { c, visits: visitLists[i] }; });
          const hasOpen = cases.some((c) => ['planning', 'active', 'retention'].includes(c.status));

          container.innerHTML = `
            <div class="oc-toolbar">
              <p class="oc-count">${cases.length} case${cases.length === 1 ? '' : 's'}</p>
              ${isDentist() && !hasOpen ? '<button type="button" class="btn btn-primary btn-sm" data-oc-new>+ New orthodontic case</button>' : ''}
            </div>
            <div class="oc-list">
              ${cases.length ? cases.map((c, i) => cardHtml(c, visitLists[i])).join('') : '<div class="empty-state">No orthodontic cases for this patient yet.</div>'}
            </div>`;

          const saved = Object.assign(() => reload(), { patientId });
          const on = (sel, fn) => container.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => fn(el)));

          on('[data-oc-new]', () => openBaselineForm(null, saved));
          on('[data-oc-edit-base]', (el) => openBaselineForm(byId[el.dataset.ocEditBase].c, saved));
          on('[data-oc-final]', async (el) => {
            if (!window.confirm('Finalise the baseline? The diagnosis and plan will be locked.')) return;
            el.disabled = true;
            try { await call(`/ortho/cases/${el.dataset.ocFinal}/finalise`, 'POST'); reload(); }
            catch (err) { window.alert(err.message); el.disabled = false; }
          });
          on('[data-oc-del-case]', async (el) => {
            if (!window.confirm('Delete this draft case?')) return;
            try { await call(`/ortho/cases/${el.dataset.ocDelCase}`, 'DELETE'); reload(); }
            catch (err) { window.alert(err.message); }
          });
          on('[data-oc-add-visit]', (el) => openVisitForm(byId[el.dataset.ocAddVisit].c, null, reload, patientId));
          on('[data-oc-status]', (el) => {
            const [id, target] = el.dataset.ocStatus.split('|');
            openStatusForm(byId[id].c, target, reload);
          });
          on('[data-oc-edit-visit]', (el) => {
            const vid = el.dataset.ocEditVisit;
            const found = Object.values(byId).map((x) => ({ c: x.c, v: x.visits.find((v) => v.id === vid) })).find((x) => x.v);
            if (found) openVisitForm(found.c, found.v, reload, patientId);
          });
          on('[data-oc-del-visit]', async (el) => {
            if (!window.confirm('Delete this visit record?')) return;
            try { await call(`/ortho/visits/${el.dataset.ocDelVisit}`, 'DELETE'); reload(); }
            catch (err) { window.alert(err.message); }
          });
        }),
      ).catch((err) => {
        container.innerHTML = `<div class="empty-state">Could not load orthodontics: ${esc(err.message)}</div>`;
      });
    };

    return reload();
  }

  window.Orthodontics = { render };
})();