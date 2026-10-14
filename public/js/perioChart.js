/* ============================================================
   PERIODONTAL CHARTING — dentist side
   ------------------------------------------------------------
     PerioChart.render(container, { patientId, patientName, onChange })
         The "Perio chart" tab: risk-factor strip, trend table across
         finalised charts, and one card per chart (open / continue /
         finalise / delete).

   Chart editor: six sites per tooth (DB, B, MB / DL, L, ML) with probing
   depth, recession, bleeding and plaque; mobility and furcation per tooth;
   click a tooth number to mark it missing. CAL (= PD + recession) and all
   totals are calculated automatically.

   Finalised charts are locked. To correct one, start a new chart from it.

   Needs api.js (fetchMethod, getStoredUser), perioSummary.js (totals) and
   dashboard.css (modal, btn, field-*). Styles live in perio-chart.css.
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
  // exam_date arrives as a plain YYYY-MM-DD string (no timezone shifts)
  function fmtDay(ymd) {
    if (!ymd) return '';
    const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtShort(ymd) {
    if (!ymd) return '';
    const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function ymd(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
  }
  const todayStr = () => ymd(new Date());
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  function me() { return (typeof getStoredUser === 'function') ? getStoredUser() : null; }
  function isMine(chart) { const u = me(); return !!u && String(u.id) === String(chart.dentist_id); }
  function isDentist() { const u = me(); return !!u && u.role === 'dentist'; }
  const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

  /* ---------- chart layout ---------- */
  const UPPER = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
  const LOWER = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
  // Teeth where furcation involvement can occur (multi-rooted).
  const FURC = new Set(['14', '24', '16', '17', '18', '26', '27', '28', '36', '37', '38', '46', '47', '48']);

  const DIAGNOSES = {
    periodontal_health: 'Periodontal health',
    gingivitis: 'Gingivitis',
    periodontitis: 'Periodontitis',
  };
  const EXTENTS = { localized: 'Localized', generalized: 'Generalized', molar_incisor: 'Molar-incisor pattern' };

  function diagnosisText(c) {
    if (!c.diagnosis) return 'No diagnosis recorded';
    let t = DIAGNOSES[c.diagnosis] || c.diagnosis;
    if (c.diagnosis === 'periodontitis') {
      const bits = [];
      if (c.stage) bits.push(`Stage ${c.stage}`);
      if (c.grade) bits.push(`Grade ${c.grade}`);
      if (c.extent) bits.push(EXTENTS[c.extent] || c.extent);
      if (bits.length) t += ` · ${bits.join(' · ')}`;
    }
    return t;
  }

  // Quadrants 1 and 4 are the patient's right side, drawn on the left of the chart,
  // so their sites read distal → mesial from left to right; quadrants 2 and 3 are mirrored.
  function siteOrder(fdi, surface) {
    const right = fdi[0] === '1' || fdi[0] === '4';
    if (surface === 'facial') return right ? ['DB', 'B', 'MB'] : ['MB', 'B', 'DB'];
    return right ? ['DL', 'L', 'ML'] : ['ML', 'L', 'DL'];
  }

  const pdClass = (v) => (v >= 6 ? 'pc-pd-6' : (v >= 4 ? 'pc-pd-4' : ''));
  const num = (v) => (typeof v === 'number' ? v : null);
  const siteVal = (t, kind, site) => (t && t[kind] ? num(t[kind][site]) : null);
  const calVal = (t, site) => {
    const pd = siteVal(t, 'pd', site);
    if (pd === null) return null;
    const rec = siteVal(t, 'rec', site);
    return Math.max(0, pd + (rec === null ? 0 : rec));
  };

  /* ---------- grid html ---------- */
  function archHtml(arch, teeth, prevTeeth, ro) {
    const list = arch === 'upper' ? UPPER : LOWER;
    const surfaces = [
      { key: 'facial', label: 'Facial' },
      { key: 'lingual', label: arch === 'upper' ? 'Palatal' : 'Lingual' },
    ];

    const headCells = list.map((fdi) => {
      const missing = !!(teeth[fdi] && teeth[fdi].missing);
      const inner = ro
        ? `<th colspan="3" class="pc-tooth${missing ? ' is-missing' : ''}">${fdi}</th>`
        : `<th colspan="3" class="pc-tooth-cell"><button type="button" class="pc-tooth${missing ? ' is-missing' : ''}" data-pc-missing="${fdi}" title="Click to mark ${missing ? 'present' : 'missing'}">${fdi}</button></th>`;
      return inner;
    }).join('');

    const toothRow = (label, kind) => {
      const cells = list.map((fdi) => {
        const t = teeth[fdi];
        const missing = !!(t && t.missing);
        if (kind === 'furc' && !FURC.has(fdi)) return '<td colspan="3" class="pc-c pc-start"></td>';
        const v = t && typeof t[kind] === 'number' ? t[kind] : '';
        return `<td colspan="3" class="pc-c pc-start${missing ? ' pc-miss' : ''}">
          <input class="pc-in pc-in-wide" data-k="${kind}" data-t="${fdi}" maxlength="1" inputmode="numeric" autocomplete="off" value="${v}" ${missing || ro ? 'disabled' : ''}></td>`;
      }).join('');
      return `<tr><td class="pc-label">${label}</td>${cells}</tr>`;
    };

    const siteRow = (label, surface, kind) => {
      const rowKey = `${arch}-${surface}`;
      const cells = list.map((fdi) => {
        const t = teeth[fdi];
        const missing = !!(t && t.missing);
        return siteOrder(fdi, surface).map((site, idx) => {
          const start = idx === 0 ? ' pc-start' : '';
          const miss = missing ? ' pc-miss' : '';
          const dis = missing || ro ? 'disabled' : '';
          if (kind === 'pd') {
            const v = siteVal(t, 'pd', site);
            return `<td class="pc-c${start}${miss} ${v !== null ? pdClass(v) : ''}" data-cell="pd-${fdi}-${site}">
              <input class="pc-in" data-k="pd" data-t="${fdi}" data-s="${site}" data-row="${rowKey}-pd" maxlength="2" inputmode="numeric" autocomplete="off" value="${v === null ? '' : v}" ${dis}></td>`;
          }
          if (kind === 'rec') {
            const v = siteVal(t, 'rec', site);
            return `<td class="pc-c${start}${miss}">
              <input class="pc-in" data-k="rec" data-t="${fdi}" data-s="${site}" data-row="${rowKey}-rec" maxlength="3" inputmode="numeric" autocomplete="off" value="${v === null ? '' : v}" ${dis}></td>`;
          }
          if (kind === 'cal') {
            const v = calVal(t, site);
            return `<td class="pc-c pc-cal${start}${miss}${v !== null && v >= 3 ? ' is-high' : ''}" data-cal="${fdi}-${site}">${v === null ? '' : v}</td>`;
          }
          if (kind === 'delta') {
            const cur = siteVal(t, 'pd', site);
            const prev = siteVal(prevTeeth && prevTeeth[fdi], 'pd', site);
            let text = ''; let cls = '';
            if (cur !== null && prev !== null && cur !== prev) {
              const d = cur - prev;
              text = d > 0 ? `+${d}` : String(d);
              cls = d < 0 ? ' is-better' : ' is-worse';
            }
            return `<td class="pc-c pc-delta${start}${miss}${cls}">${text}</td>`;
          }
          // bop / plq toggles
          const on = !!(t && t[kind] && t[kind][site]);
          return `<td class="pc-c${start}${miss}"><button type="button" class="pc-dot pc-${kind}${on ? ' is-on' : ''}" data-k="${kind}" data-t="${fdi}" data-s="${site}" ${dis} aria-label="${kind === 'bop' ? 'Bleeding' : 'Plaque'} ${fdi} ${site}"></button></td>`;
        }).join('');
      }).join('');
      return `<tr><td class="pc-label">${label}</td>${cells}</tr>`;
    };

    let rows = `<tr><td class="pc-label">Tooth</td>${headCells}</tr>`;
    rows += toothRow('Mobility 0–3', 'mob');
    rows += toothRow('Furcation 0–3', 'furc');
    surfaces.forEach((s) => {
      rows += '<tr class="pc-gap"><td colspan="49"></td></tr>';
      rows += siteRow(`${s.label} PD`, s.key, 'pd');
      rows += siteRow(`${s.label} rec.`, s.key, 'rec');
      rows += siteRow(`${s.label} CAL`, s.key, 'cal');
      rows += siteRow('Bleeding', s.key, 'bop');
      rows += siteRow('Plaque', s.key, 'plq');
      if (prevTeeth) rows += siteRow(`Δ PD ${s.label}`, s.key, 'delta');
    });

    return `<table class="pc-table">${rows}</table>`;
  }

  /* ---------- API / small actions ---------- */
  async function createRecall(patientId, examDate, months) {
    // Counted from the exam date, or from today if the exam was backdated.
    const base = new Date(Math.max(new Date(`${examDate}T12:00:00`).getTime(), Date.now()));
    base.setMonth(base.getMonth() + months);
    await call('/recall-reminders', 'POST', {
      patient_id: patientId,
      due_date: ymd(base),
      reminder_type: 'follow_up',
      channel: 'sms',
      notes: 'Periodontal maintenance review',
    });
  }

  /* ---------- tab render ---------- */
  const better = (cur, prev, unit) => {
    if (cur == null || prev == null) return '';
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return '';
    return ` <span class="${d < 0 ? 'pc-better' : 'pc-worse'}">(${d > 0 ? '+' : ''}${d}${unit})</span>`;
  };

  function cardHtml(c) {
    const draft = c.status === 'draft';
    const s = c.summary || {};
    const author = [c.dentist_first_name, c.dentist_last_name].filter(Boolean).join(' ');
    const meta = [`Dr. ${esc(author)}`];
    if (!draft && c.finalised_at) meta.push(`Finalised ${esc(fmtDateTime(c.finalised_at))}`);

    const stats = [];
    if (s.sites_measured) {
      stats.push(`<span class="pc-stat">Mean PD <b>${esc(s.mean_pd)} mm</b></span>`);
      stats.push(`<span class="pc-stat${s.pct_pd_4_plus >= 30 ? ' is-alert' : ''}">Sites ≥ 4 mm <b>${esc(s.pd_4_5 + s.pd_6_plus)}</b> (${esc(s.pct_pd_4_plus)}%)</span>`);
      stats.push(`<span class="pc-stat${s.bop_pct >= 30 ? ' is-alert' : ''}">Bleeding <b>${esc(s.bop_pct)}%</b></span>`);
      stats.push(`<span class="pc-stat">Plaque <b>${esc(s.plaque_pct)}%</b></span>`);
      if (s.max_cal != null) stats.push(`<span class="pc-stat">Max CAL <b>${esc(s.max_cal)} mm</b> (tooth ${esc(s.max_cal_tooth)})</span>`);
    }
    if (s.teeth_missing) stats.push(`<span class="pc-stat">Missing <b>${esc(s.teeth_missing)}</b></span>`);
    if (s.mobile_teeth) stats.push(`<span class="pc-stat">Mobile teeth <b>${esc(s.mobile_teeth)}</b></span>`);
    if (s.furcation_teeth) stats.push(`<span class="pc-stat">Furcation <b>${esc(s.furcation_teeth)}</b></span>`);
    if (c.recall_interval_months) stats.push(`<span class="pc-stat">Recall <b>${esc(c.recall_interval_months)} mo</b></span>`);

    let actions = `<button type="button" class="btn btn-outline btn-sm" data-pc-open="${esc(c.id)}">${draft && isMine(c) ? 'Continue editing' : 'Open chart'}</button>`;
    if (draft && isMine(c)) {
      actions += `
        <button type="button" class="btn btn-primary btn-sm" data-pc-final="${esc(c.id)}">Finalise</button>
        <button type="button" class="pc-btn-danger" data-pc-delete="${esc(c.id)}">Delete draft</button>`;
    }

    return `
      <article class="pc-card${draft ? ' is-draft' : ''}">
        <div class="pc-head">
          <div>
            <p class="pc-date">${esc(fmtDay(c.exam_date))}</p>
            <p class="pc-meta">${meta.join(' · ')}</p>
          </div>
          <span class="pc-badge${draft ? ' is-draft' : ''}">${draft ? 'Draft' : 'Finalised'}</span>
        </div>
        <p class="pc-dx">${esc(diagnosisText(c))}</p>
        ${stats.length ? `<div class="pc-stats">${stats.join('')}</div>` : ''}
        ${c.treatment_notes ? `<p class="pc-notes">${esc(c.treatment_notes)}</p>` : ''}
        <div class="pc-actions">${actions}</div>
      </article>`;
  }

  function trendHtml(charts) {
    const finals = charts.filter((c) => c.status === 'final' && c.summary && c.summary.sites_measured);
    if (finals.length < 2) return '';
    const rows = finals.map((c, i) => {
      const s = c.summary;
      const p = finals[i + 1] ? finals[i + 1].summary : null; // next-older final chart
      return `<tr>
        <td>${esc(fmtShort(c.exam_date))}</td>
        <td>${esc(s.mean_pd)} mm${p ? better(s.mean_pd, p.mean_pd, '') : ''}</td>
        <td>${esc(s.pct_pd_4_plus)}%${p ? better(s.pct_pd_4_plus, p.pct_pd_4_plus, '%') : ''}</td>
        <td>${esc(s.bop_pct)}%${p ? better(s.bop_pct, p.bop_pct, '%') : ''}</td>
        <td>${esc(s.plaque_pct)}%${p ? better(s.plaque_pct, p.plaque_pct, '%') : ''}</td>
        <td>${s.max_cal == null ? '—' : `${esc(s.max_cal)} mm`}</td>
      </tr>`;
    }).join('');
    return `
      <div class="pc-trend">
        <table>
          <thead><tr><th>Exam</th><th>Mean PD</th><th>Sites ≥ 4 mm</th><th>Bleeding</th><th>Plaque</th><th>Max CAL</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function render(container, opts) {
    const { patientId, patientName, onChange, inline, onLoaded } = opts;
    const reload = () => (typeof onChange === 'function' ? onChange() : render(container, opts));

    // Inline mode: the editor takes over the container instead of opening a modal.
    const open = (args) => {
      if (!inline) { openChart(args); return; }
      container.innerHTML = '';
      const host = document.createElement('div');
      container.appendChild(host);
      openChart({ ...args, host, onExit: () => render(container, opts) });
    };

    container.innerHTML = '<div class="records-loading"><div class="mpesa-spinner"></div>Loading periodontal charts…</div>';

    return Promise.all([
      call(`/perio-charts/patient/${patientId}`),
      call(`/medical-history/patient/${patientId}`).catch(() => null),
    ]).then(([charts, mh]) => {
      // Risk factors that matter for gum disease, from the medical history on file.
      const risks = [];
      const cur = mh && mh.current;
      if (cur) {
        if (Array.isArray(cur.conditions) && cur.conditions.includes('diabetes')) risks.push('Diabetes');
        if (cur.smoking_status === 'current') risks.push('Current smoker');
      }

      if (typeof onLoaded === 'function') { try { onLoaded(charts); } catch (e) { /* never block the render */ } }
      const drafts = charts.filter((c) => c.status === 'draft').length;
      container.innerHTML = `
        ${risks.length ? `<div class="pc-risk"><b>Periodontal risk factors on file:</b> ${risks.map((r) => `<span class="pc-risk-chip">${esc(r)}</span>`).join('')}</div>` : ''}
        <div class="pc-toolbar">
          <p class="pc-count">${charts.length} chart${charts.length === 1 ? '' : 's'}${drafts ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}</p>
          ${isDentist() ? '<button type="button" class="btn btn-primary btn-sm" data-pc-new>+ New perio chart</button>' : ''}
        </div>
        ${trendHtml(charts)}
        <div class="pc-list">
          ${charts.length ? charts.map(cardHtml).join('') : '<div class="empty-state">No periodontal charts yet for this patient.</div>'}
        </div>`;

      const base = { patientId, patientName, charts, onSaved: reload };

      const newBtn = container.querySelector('[data-pc-new]');
      if (newBtn) {
        newBtn.addEventListener('click', async () => {
          newBtn.disabled = true;
          try {
            // The latest chart (any status) lets us carry over missing teeth.
            const baseline = charts.length ? await call(`/perio-charts/${charts[0].id}`) : null;
            open({ ...base, chart: null, baseline });
          } catch (err) {
            window.alert(err.message || 'Could not start a new chart');
          } finally {
            newBtn.disabled = false;
          }
        });
      }

      container.querySelectorAll('[data-pc-open]').forEach((b) => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const full = await call(`/perio-charts/${b.dataset.pcOpen}`);
            open({ ...base, chart: full, baseline: null });
          } catch (err) {
            window.alert(err.message || 'Could not open the chart');
          } finally {
            b.disabled = false;
          }
        });
      });

      container.querySelectorAll('[data-pc-final]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!window.confirm('Finalise this chart? Once finalised it cannot be edited or deleted.')) return;
          b.disabled = true;
          try {
            const done = await call(`/perio-charts/${b.dataset.pcFinal}/finalise`, 'POST', {});
            if (done.recall_interval_months && window.confirm(`Create a recall reminder in ${done.recall_interval_months} month(s)?`)) {
              try { await createRecall(patientId, done.exam_date, done.recall_interval_months); } catch (e) {
                window.alert('The chart was finalised, but the recall reminder could not be created.');
              }
            }
            reload();
          } catch (err) {
            b.disabled = false;
            window.alert(err.message || 'Could not finalise the chart');
          }
        });
      });

      container.querySelectorAll('[data-pc-delete]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!window.confirm('Delete this draft chart? This cannot be undone.')) return;
          b.disabled = true;
          try {
            await call(`/perio-charts/${b.dataset.pcDelete}`, 'DELETE');
            reload();
          } catch (err) {
            b.disabled = false;
            window.alert(err.message || 'Could not delete the draft');
          }
        });
      });
    }).catch(() => {
      container.innerHTML = '<div class="empty-state">Could not load periodontal charts. Please try again.</div>';
    });
  }

  /* ---------- editor / viewer modal ---------- */
  const ed = { built: false, els: {}, dirty: false, readOnly: false };

  function buildShell() {
    if (ed.built) return;
    ed.built = true;

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim pc-scrim';
    scrim.innerHTML = `
      <div class="modal modal-lg pc-modal" role="dialog" aria-modal="true" aria-labelledby="pcTitle">
        <div class="modal-head">
          <div>
            <p class="modal-kicker" id="pcKicker">Periodontal chart</p>
            <h2 id="pcTitle">—</h2>
          </div>
          <button class="icon-link-btn" id="pcClose" type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="pcBody"></div>
      </div>`;
    document.body.appendChild(scrim);

    ed.els = {
      scrim,
      kicker: scrim.querySelector('#pcKicker'),
      title: scrim.querySelector('#pcTitle'),
      body: scrim.querySelector('#pcBody'),
      close: scrim.querySelector('#pcClose'),
    };

    ed.els.close.addEventListener('click', requestClose);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) requestClose(); });
    // Capture phase so Escape closes only this chart, not the patient modal behind it.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ed.els.scrim.classList.contains('is-open')) {
        e.stopPropagation();
        requestClose();
      }
    }, true);
  }

  function closeEditor() {
    ed.dirty = false;
    // Inline (embedded in the Diagnosis flow): "closing" means going back to the chart list.
    if (ed.inline) { if (typeof ed.onExit === 'function') ed.onExit(); return; }
    if (ed.els.scrim) ed.els.scrim.classList.remove('is-open');
  }
  function requestClose() {
    if (ed.dirty && !ed.readOnly && !window.confirm('Close without saving? Your changes to this chart will be lost.')) return;
    closeEditor();
  }

  function missingOnly(source) {
    const out = {};
    if (source && source.teeth) {
      Object.keys(source.teeth).forEach((f) => { if (source.teeth[f] && source.teeth[f].missing) out[f] = { missing: true }; });
    }
    return out;
  }

  function openChart({ patientId, patientName, chart, baseline, copyFrom, charts, onSaved, host, onExit }) {
    // With a `host` element the editor is drawn inline (no modal). Used by the Diagnosis flow.
    const inline = !!host;
    ed.inline = inline;
    ed.onExit = onExit || null;
    let els;
    if (inline) {
      const noop = { textContent: '', classList: { add() {}, remove() {}, contains() { return false; } } };
      els = { body: host, kicker: noop, title: noop, scrim: noop };
    } else {
      buildShell();
      els = ed.els;
    }
    const readOnly = !!chart && (chart.status === 'final' || !isMine(chart) || !isDentist());
    ed.readOnly = readOnly;
    ed.dirty = false;

    if (!window.PerioSummary) {
      window.alert('The perio summary module could not be loaded. Please refresh the page.');
      return;
    }

    // ---- state ----
    let teeth = chart ? clone(chart.teeth) : (copyFrom ? clone(copyFrom.teeth) : missingOnly(baseline));
    let prevTeeth = null;
    let prevLabel = '';

    els.kicker.textContent = readOnly ? 'Periodontal chart' : (chart ? 'Edit draft chart' : 'New periodontal chart');
    els.title.textContent = patientName || 'Patient';

    const examDate = chart ? String(chart.exam_date).slice(0, 10) : todayStr();
    const otherCharts = (charts || []).filter((c) => !chart || c.id !== chart.id).filter((c) => c.summary && c.summary.sites_measured);

    const months = [1, 2, 3, 4, 6, 12];
    const dx = chart || {};

    const root = document.createElement('div');
    root.innerHTML = `
      ${inline ? `<div class="pc-inline-head">
        <button type="button" class="pc-back" id="pcBack">&larr; All perio charts</button>
        <span class="pc-inline-title">${esc(readOnly ? 'Periodontal chart' : (chart ? 'Edit draft chart' : 'New periodontal chart'))}</span>
      </div>` : ''}
      <div class="pc-top">
        <div class="pc-field">
          <label class="field-label" for="pcDate">Exam date</label>
          <input class="field-input" id="pcDate" type="date" max="${esc(todayStr())}" value="${esc(examDate)}" ${readOnly ? 'disabled' : ''}>
        </div>
        ${!readOnly && baseline ? `<button type="button" class="btn btn-outline btn-sm" id="pcCopy">Copy all measurements from ${esc(fmtShort(baseline.exam_date))}</button>` : ''}
        ${readOnly && otherCharts.length ? `
          <div class="pc-compare">
            <label class="field-label" for="pcCompare" style="margin:0;">Compare PD with</label>
            <select class="field-input" id="pcCompare">
              <option value="">— No comparison —</option>
              ${otherCharts.map((c) => opt(c.id, `${fmtShort(c.exam_date)} · mean PD ${c.summary.mean_pd} mm${c.status === 'draft' ? ' (draft)' : ''}`)).join('')}
            </select>
          </div>` : ''}
      </div>

      <p class="pc-help">
        <b>PD</b> = probing depth (mm). <b>Rec.</b> = recession: positive when the gum has moved away from the CEJ, negative if the margin sits above it.
        <b>CAL</b> = PD + recession, calculated for you.
        ${readOnly ? 'This chart is read-only.' : `Type a depth and the cursor jumps to the next site (for <b>1</b> press Space, for 10–15 type both digits).
        The order follows the usual route: upper facial, upper palatal, lower facial, lower lingual.
        Press <b>B</b> for bleeding or <b>P</b> for plaque on the current site. Click a tooth number to mark it missing.`}
      </p>

      <div class="pc-summary" id="pcSummary"></div>

      <p class="pc-arch-title">Upper arch</p>
      <div class="pc-scroll" id="pcUpper"></div>
      <p class="pc-arch-title">Lower arch</p>
      <div class="pc-scroll" id="pcLower"></div>

      ${readOnly ? `
        <div class="pc-final-dx">
          <b>${esc(diagnosisText(dx))}</b>
          ${dx.recall_interval_months ? `<br>Maintenance recall: every ${esc(dx.recall_interval_months)} month${dx.recall_interval_months === 1 ? '' : 's'}` : ''}
          ${dx.treatment_notes ? `<br><span style="white-space:pre-wrap;">${esc(dx.treatment_notes)}</span>` : ''}
        </div>` : `
        <div class="pc-dx-block">
          <div class="pc-dx-grid">
            <div class="pc-field">
              <label class="field-label" for="pcDx">Periodontal diagnosis</label>
              <select class="field-input" id="pcDx">
                ${opt('', '— Select —', !dx.diagnosis)}
                ${Object.keys(DIAGNOSES).map((k) => opt(k, DIAGNOSES[k], dx.diagnosis === k)).join('')}
              </select>
            </div>
            <div class="pc-field" data-pc-perio style="display:none;">
              <label class="field-label" for="pcStage">Stage</label>
              <select class="field-input" id="pcStage">${opt('', '—', !dx.stage)}${['I', 'II', 'III', 'IV'].map((v) => opt(v, v, dx.stage === v)).join('')}</select>
            </div>
            <div class="pc-field" data-pc-perio style="display:none;">
              <label class="field-label" for="pcGrade">Grade</label>
              <select class="field-input" id="pcGrade">${opt('', '—', !dx.grade)}${['A', 'B', 'C'].map((v) => opt(v, v, dx.grade === v)).join('')}</select>
            </div>
            <div class="pc-field" data-pc-perio style="display:none;">
              <label class="field-label" for="pcExtent">Extent</label>
              <select class="field-input" id="pcExtent">${opt('', '—', !dx.extent)}${Object.keys(EXTENTS).map((k) => opt(k, EXTENTS[k], dx.extent === k)).join('')}</select>
            </div>
            <div class="pc-field">
              <label class="field-label" for="pcRecall">Maintenance recall</label>
              <select class="field-input" id="pcRecall">
                ${opt('', 'None', !dx.recall_interval_months)}
                ${months.map((m) => opt(String(m), `Every ${m} month${m === 1 ? '' : 's'}`, dx.recall_interval_months === m)).join('')}
              </select>
            </div>
          </div>
          <p class="pc-hint" id="pcStageHint" style="display:none;"></p>
          <label class="pc-inline-check" id="pcRecallCheckWrap" style="display:none;"><input type="checkbox" id="pcRecallCheck" checked> Also create a recall reminder when I finalise this chart</label>
          <div class="pc-field" style="margin-top:12px;">
            <label class="field-label" for="pcNotes">Treatment plan / notes</label>
            <textarea class="field-input" id="pcNotes" maxlength="2000" placeholder="e.g. Oral hygiene instruction, scaling and root planing 2 quadrants, re-evaluate in 6 weeks">${esc(dx.treatment_notes || '')}</textarea>
          </div>
        </div>`}

      <div class="pc-error" id="pcError" style="display:none;"></div>
      <div class="pc-foot">
        <p class="pc-hint" style="margin:0;">${readOnly ? '' : 'Finalising locks the chart. To correct a finalised chart you start a new one from it.'}</p>
        <div class="pc-foot-right">
          ${readOnly ? `
            ${isDentist() && chart && chart.status === 'final' ? '<button type="button" class="btn btn-outline" id="pcStartFrom">Start a new chart from this one</button>' : ''}
            <button type="button" class="btn btn-primary" id="pcDone">Close</button>` : `
            <button type="button" class="btn btn-outline" id="pcCancel">Cancel</button>
            <button type="button" class="btn btn-outline" id="pcSaveDraft">Save draft</button>
            <button type="button" class="btn btn-primary" id="pcFinalise">Finalise chart</button>`}
        </div>
      </div>`;

    els.body.innerHTML = '';
    els.body.appendChild(root); // fresh element per open, so listeners never stack up
    els.scrim.classList.add('is-open');

    const $ = (sel) => root.querySelector(sel);
    const backBtn = $('#pcBack');
    if (backBtn) backBtn.addEventListener('click', requestClose);
    const upperHost = $('#pcUpper');
    const lowerHost = $('#pcLower');
    const errEl = $('#pcError');
    const showError = (msg) => { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; };

    const renderGrids = () => {
      upperHost.innerHTML = archHtml('upper', teeth, prevTeeth, readOnly);
      lowerHost.innerHTML = archHtml('lower', teeth, prevTeeth, readOnly);
    };

    const renderSummary = () => {
      const s = window.PerioSummary.compute(teeth);
      const pill = (label, value, alert) => `<div class="pc-sum${alert ? ' is-alert' : ''}">${esc(label)}<b>${esc(value)}</b></div>`;
      $('#pcSummary').innerHTML = [
        pill('Sites measured', s.sites_measured),
        pill('Mean PD', s.mean_pd == null ? '—' : `${s.mean_pd} mm`),
        pill('Sites ≥ 4 mm', s.sites_measured ? `${s.pd_4_5 + s.pd_6_plus} (${s.pct_pd_4_plus}%)` : '—', s.pct_pd_4_plus >= 30),
        pill('Sites ≥ 6 mm', s.pd_6_plus, s.pd_6_plus > 0),
        pill('Bleeding', s.bop_pct == null ? '—' : `${s.bop_pct}%`, s.bop_pct >= 30),
        pill('Plaque', s.plaque_pct == null ? '—' : `${s.plaque_pct}%`),
        pill('Max CAL', s.max_cal == null ? '—' : `${s.max_cal} mm`),
        pill('Missing teeth', s.teeth_missing),
        pill('Mobile teeth', s.mobile_teeth),
      ].join('');

      const hint = $('#pcStageHint');
      if (hint) {
        const dxSel = $('#pcDx');
        if (dxSel && dxSel.value === 'periodontitis' && s.stage_hint) {
          hint.style.display = 'block';
          hint.textContent = `Guide only: the largest attachment loss recorded is ${s.max_cal} mm (tooth ${s.max_cal_tooth}), which fits Stage ${s.stage_hint}. Final staging also depends on bone loss, tooth loss and complexity. That is your clinical call.`;
        } else {
          hint.style.display = 'none';
        }
      }
    };

    renderGrids();
    renderSummary();

    if (readOnly) {
      const cmp = $('#pcCompare');
      if (cmp) {
        cmp.addEventListener('change', async () => {
          if (!cmp.value) { prevTeeth = null; renderGrids(); return; }
          cmp.disabled = true;
          try {
            const other = await call(`/perio-charts/${cmp.value}`);
            prevTeeth = other.teeth || {};
            prevLabel = fmtShort(other.exam_date);
            renderGrids();
          } catch (err) {
            showError(err.message || 'Could not load that chart for comparison');
          } finally {
            cmp.disabled = false;
          }
        });
      }
      $('#pcDone').addEventListener('click', closeEditor);
      const startFrom = $('#pcStartFrom');
      if (startFrom) {
        startFrom.addEventListener('click', () => {
          if (!ed.inline) closeEditor();
          openChart({ patientId, patientName, chart: null, baseline: chart, copyFrom: chart, charts, onSaved, host, onExit });
        });
      }
      return;
    }

    /* ---------- edit mode ---------- */
    const markDirty = () => { ed.dirty = true; };

    const setSite = (fdi, kind, site, val) => {
      const t = teeth[fdi] = teeth[fdi] || {};
      if (val === null) { if (t[kind]) delete t[kind][site]; return; }
      (t[kind] = t[kind] || {})[site] = val;
    };

    const updateSiteDisplay = (fdi, site) => {
      const t = teeth[fdi];
      const pdCell = root.querySelector(`[data-cell="pd-${fdi}-${site}"]`);
      if (pdCell) {
        pdCell.classList.remove('pc-pd-4', 'pc-pd-6');
        const pd = siteVal(t, 'pd', site);
        if (pd !== null && pdClass(pd)) pdCell.classList.add(pdClass(pd));
      }
      const calCell = root.querySelector(`[data-cal="${fdi}-${site}"]`);
      if (calCell) {
        const cal = calVal(t, site);
        calCell.textContent = cal === null ? '' : cal;
        calCell.classList.toggle('is-high', cal !== null && cal >= 3);
      }
    };

    // Order the cursor follows when entering depths: upper facial, upper palatal (back),
    // lower facial, lower lingual (back) — a continuous route around the mouth.
    const sequence = (kind) => {
      const q = (key) => Array.from(root.querySelectorAll(`input[data-row="${key}-${kind}"]:not(:disabled)`));
      return [...q('upper-facial'), ...q('upper-lingual').reverse(), ...q('lower-facial'), ...q('lower-lingual').reverse()];
    };
    const move = (el, step) => {
      const kind = el.dataset.k;
      if (kind !== 'pd' && kind !== 'rec') return;
      const seq = sequence(kind);
      const i = seq.indexOf(el);
      const target = seq[i + step];
      if (target) { target.focus(); }
    };

    const toggleFlag = (fdi, kind, site, btn) => {
      const t = teeth[fdi] = teeth[fdi] || {};
      t[kind] = t[kind] || {};
      if (t[kind][site]) delete t[kind][site]; else t[kind][site] = true;
      if (btn) btn.classList.toggle('is-on', !!t[kind][site]);
      markDirty();
      renderSummary();
    };

    root.addEventListener('focusin', (e) => {
      if (e.target.classList && e.target.classList.contains('pc-in')) e.target.select();
    });

    root.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('pc-in')) return;
      const kind = el.dataset.k;
      const fdi = el.dataset.t;
      const site = el.dataset.s;
      markDirty();

      if (kind === 'pd') {
        const raw = el.value.replace(/[^0-9]/g, '').slice(0, 2);
        const n = raw === '' ? null : Math.min(15, parseInt(raw, 10));
        el.value = n === null ? '' : String(n);
        setSite(fdi, 'pd', site, n);
        updateSiteDisplay(fdi, site);
        renderSummary();
        // A lone "1" could be the start of 10–15, so wait for Space/Enter in that case.
        if (n !== null && (raw.length === 2 || raw !== '1')) move(el, 1);
      } else if (kind === 'rec') {
        const raw = el.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '').slice(0, 3);
        if (raw === '' || raw === '-') {
          el.value = raw;
          setSite(fdi, 'rec', site, null);
        } else {
          const n = Math.max(-9, Math.min(15, parseInt(raw, 10)));
          el.value = String(n);
          setSite(fdi, 'rec', site, n);
        }
        updateSiteDisplay(fdi, site);
        renderSummary();
      } else if (kind === 'mob' || kind === 'furc') {
        const raw = el.value.replace(/[^0-3]/g, '').slice(0, 1);
        el.value = raw;
        const t = teeth[fdi] = teeth[fdi] || {};
        if (raw === '') delete t[kind]; else t[kind] = parseInt(raw, 10);
        renderSummary();
      }
    });

    root.addEventListener('keydown', (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('pc-in')) return;
      const kind = el.dataset.k;
      if (kind !== 'pd' && kind !== 'rec') return;

      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); move(el, 1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(el, -1); return; }
      if (e.key === 'Backspace' && el.value === '') { e.preventDefault(); move(el, -1); return; }
      if (kind === 'pd' && (e.key === 'b' || e.key === 'B' || e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const flag = (e.key === 'b' || e.key === 'B') ? 'bop' : 'plq';
        const btn = root.querySelector(`.pc-dot[data-k="${flag}"][data-t="${el.dataset.t}"][data-s="${el.dataset.s}"]`);
        toggleFlag(el.dataset.t, flag, el.dataset.s, btn);
      }
    });

    root.addEventListener('click', (e) => {
      const dot = e.target.closest ? e.target.closest('.pc-dot') : null;
      if (dot && !dot.disabled) { toggleFlag(dot.dataset.t, dot.dataset.k, dot.dataset.s, dot); return; }

      const missBtn = e.target.closest ? e.target.closest('[data-pc-missing]') : null;
      if (missBtn) {
        const fdi = missBtn.dataset.pcMissing;
        const t = teeth[fdi];
        if (t && t.missing) {
          teeth[fdi] = {};
        } else {
          const hasData = t && (t.pd || t.rec || t.bop || t.plq || typeof t.mob === 'number' || typeof t.furc === 'number');
          if (hasData && !window.confirm(`Mark tooth ${fdi} as missing? Its measurements will be cleared.`)) return;
          teeth[fdi] = { missing: true };
        }
        markDirty();
        renderGrids();
        renderSummary();
      }
    });

    const copyBtn = $('#pcCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const hasData = Object.keys(teeth).some((f) => teeth[f] && (teeth[f].pd || teeth[f].rec));
        if (hasData && !window.confirm('Replace what you have entered with the measurements from that chart?')) return;
        teeth = clone(baseline.teeth);
        markDirty();
        renderGrids();
        renderSummary();
      });
    }

    // Diagnosis block: stage / grade / extent only for periodontitis; recall checkbox only with an interval.
    const dxSel = $('#pcDx');
    const syncDx = () => {
      const perio = dxSel.value === 'periodontitis';
      root.querySelectorAll('[data-pc-perio]').forEach((n) => { n.style.display = perio ? '' : 'none'; });
      renderSummary();
    };
    const recallSel = $('#pcRecall');
    const syncRecall = () => { $('#pcRecallCheckWrap').style.display = recallSel.value ? 'flex' : 'none'; };
    dxSel.addEventListener('change', () => { markDirty(); syncDx(); });
    recallSel.addEventListener('change', () => { markDirty(); syncRecall(); });
    ['#pcStage', '#pcGrade', '#pcExtent', '#pcNotes', '#pcDate'].forEach((sel) => {
      const n = $(sel);
      if (n) { n.addEventListener('input', markDirty); n.addEventListener('change', markDirty); }
    });
    syncDx();
    syncRecall();

    const buttons = [$('#pcSaveDraft'), $('#pcFinalise'), $('#pcCancel')];
    const save = async (finalise) => {
      showError('');
      const s = window.PerioSummary.compute(teeth);
      const diagnosis = dxSel.value || null;
      const hasAnything = Object.keys(teeth).some((f) => teeth[f] && Object.keys(teeth[f]).length) || diagnosis;
      if (!hasAnything) { showError('Record at least one measurement or a missing tooth before saving'); return; }
      if (finalise) {
        if (!s.sites_measured) { showError('Record at least one probing depth before finalising'); return; }
        if (!diagnosis) { showError('Choose a periodontal diagnosis before finalising'); return; }
        if (!window.confirm('Finalise this chart? Once finalised it cannot be edited or deleted.')) return;
      }

      const recallMonths = recallSel.value ? parseInt(recallSel.value, 10) : null;
      const payload = {
        exam_date: $('#pcDate').value || todayStr(),
        teeth,
        diagnosis,
        stage: $('#pcStage').value || null,
        grade: $('#pcGrade').value || null,
        extent: $('#pcExtent').value || null,
        recall_interval_months: recallMonths,
        treatment_notes: $('#pcNotes').value,
        finalise,
      };

      buttons.forEach((b) => { b.disabled = true; });
      try {
        const saved = chart
          ? await call(`/perio-charts/${chart.id}`, 'PUT', payload)
          : await call(`/perio-charts/patient/${patientId}`, 'POST', payload);

        let recallFailed = false;
        if (finalise && recallMonths && $('#pcRecallCheck').checked) {
          try { await createRecall(patientId, saved.exam_date || payload.exam_date, recallMonths); } catch (e) { recallFailed = true; }
        }
        if (ed.inline) ed.dirty = false; else closeEditor();
        if (recallFailed) window.alert('The chart was finalised, but the recall reminder could not be created. You can set it from the schedule page.');
        if (typeof onSaved === 'function') onSaved();
      } catch (err) {
        buttons.forEach((b) => { b.disabled = false; });
        showError(err.message || 'Could not save the chart');
      }
    };

    $('#pcSaveDraft').addEventListener('click', () => save(false));
    $('#pcFinalise').addEventListener('click', () => save(true));
    $('#pcCancel').addEventListener('click', requestClose);

    // Start on the first probing depth when charting from scratch.
    const first = sequence('pd')[0];
    if (first && !Object.keys(teeth).some((f) => teeth[f] && teeth[f].pd)) first.focus();
  }

  window.PerioChart = { render, openChart, diagnosisText };
})();