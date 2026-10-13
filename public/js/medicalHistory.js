/* ============================================================
   MEDICAL HISTORY (shared, dentist side)
   ------------------------------------------------------------
     MedicalHistory.open({ patientId, patientName, onSaved })
         Editor modal: tick conditions, list medicines, pregnancy,
         lifestyle, anaesthetic reaction. Every save creates a new
         dated version on the server.

     MedicalHistory.renderSummary(container, { patientId, patientName,
                                               data, alerts, onChange })
         Read-only summary (for the Medical history tab) with
         "Update" and "Confirm no changes" buttons.

     MedicalHistory.fetchCurrent(patientId)
     MedicalHistory.fetchAlerts(patientId, { drug, procedure })
     MedicalHistory.alertsHtml(alertsArray)

   Needs api.js (fetchMethod) and dashboard.css (modal, btn, field-*).
   Styles live in medical-history.css.
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
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function personName(first, last) {
    return [first, last].filter(Boolean).join(' ');
  }
  // Only dentists/admins can mark a history as reviewed ("Confirm no changes").
  function isClinician() {
    const u = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    return !u || u.role === 'dentist' || u.role === 'admin';
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ---------- API ---------- */
  let cataloguePromise = null;
  function loadCatalogue() {
    if (!cataloguePromise) {
      cataloguePromise = call('/medical-history/catalogue').catch((e) => { cataloguePromise = null; throw e; });
    }
    return cataloguePromise;
  }
  const fetchCurrent = (patientId) => call(`/medical-history/patient/${patientId}`);
  const confirmHistory = (patientId) => call(`/medical-history/patient/${patientId}/confirm`, 'POST', {});
  function fetchAlerts(patientId, { drug = '', procedure = '' } = {}) {
    const qs = [];
    if (drug) qs.push(`drug=${encodeURIComponent(drug)}`);
    if (procedure) qs.push(`procedure=${encodeURIComponent(procedure)}`);
    return call(`/medical-history/patient/${patientId}/alerts${qs.length ? '?' + qs.join('&') : ''}`);
  }

  /* ---------- alert strips ---------- */
  const ALERT_LABEL = { high: 'Warning', caution: 'Check', info: 'Note' };
  function alertsHtml(list) {
    return (list || []).map((a) => `
      <div class="mh-alert mh-alert-${esc(a.level)}" role="alert">
        <b>${ALERT_LABEL[a.level] || 'Note'}:</b><span>${esc(a.message)}</span>
      </div>`).join('');
  }

  /* ---------- review status line (used by editor + summary) ---------- */
  function statusInfo(data) {
    const cur = data && data.current;
    if (!cur) return { text: 'No medical history has been recorded for this patient yet.', warn: true };
    if (!cur.reviewed_at) {
      const who = personName(cur.recorded_by_first_name, cur.recorded_by_last_name);
      const by = cur.source === 'patient' ? 'the patient'
        : cur.source === 'reception' ? `reception${who ? ' (' + who + ')' : ''}`
          : (who || 'staff');
      return {
        text: `Entered by ${by} on ${fmtDate(cur.created_at)} — not yet reviewed by a clinician.`,
        warn: true,
      };
    }
    const who = personName(cur.reviewed_by_first_name, cur.reviewed_by_last_name);
    let text = `Last reviewed ${fmtDate(cur.reviewed_at)}${who ? ' by ' + who : ''}.`;
    if (data.stale) text += ' This is more than 6 months old — please re-confirm with the patient.';
    return { text, warn: !!data.stale };
  }

  /* ============================================================
     EDITOR MODAL
     ============================================================ */
  const state = {
    built: false, token: 0, patientId: null, patientName: '', onSaved: null, hasCurrent: false,
    required: false, onCancel: null, // required = gate mode: can't be dismissed, only saved or backed out of
  };
  const els = {};

  function buildShell() {
    if (state.built) return;
    state.built = true;

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim mh-scrim';
    scrim.innerHTML = `
      <div class="modal modal-lg mh-modal" role="dialog" aria-modal="true" aria-labelledby="mhTitle">
        <div class="modal-head">
          <div>
            <p class="modal-kicker">Medical history</p>
            <h2 id="mhTitle">—</h2>
          </div>
          <button class="icon-link-btn" id="mhClose" type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="mhBody"></div>
      </div>`;
    document.body.appendChild(scrim);

    els.scrim = scrim;
    els.title = scrim.querySelector('#mhTitle');
    els.body = scrim.querySelector('#mhBody');
    els.close = scrim.querySelector('#mhClose');

    els.close.addEventListener('click', close);
    scrim.addEventListener('click', (e) => { if (e.target === scrim && !state.required) close(); });

    // Capture phase so Escape closes only this editor, not the patient modal behind it.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.scrim.classList.contains('is-open')) {
        e.stopPropagation();
        e.preventDefault();
        if (!state.required) close();
      }
    }, true);

    els.body.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-cond]');
      if (cb) cb.closest('.mh-check').classList.toggle('is-on', cb.checked);
    });

    els.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-mh-add-med]')) {
        const list = els.body.querySelector('#mhMeds');
        list.insertAdjacentHTML('beforeend', medRow({}));
        const rows = list.querySelectorAll('.mh-med');
        const last = rows[rows.length - 1];
        if (last) last.querySelector('input').focus();
        return;
      }
      const rm = e.target.closest('.mh-med-remove');
      if (rm) { rm.closest('.mh-med').remove(); return; }
      if (e.target.closest('[data-mh-cancel]')) { cancel(); return; }
      if (e.target.closest('[data-mh-save]')) { save(); return; }
      if (e.target.closest('[data-mh-confirm]')) { confirmNoChange(); }
    });
  }

  // required: true makes this a gate. There is no X, Escape and a click outside
  // do nothing, and "Skip" becomes "Back to patients" (calls onCancel). The only
  // way forward is Save (or "Confirm no changes" for a clinician), which calls onSaved.
  async function open({ patientId, patientName = '', onSaved = null, required = false, onCancel = null } = {}) {
    if (!patientId) return;
    buildShell();
    state.patientId = patientId;
    state.patientName = patientName;
    state.onSaved = onSaved;
    state.required = !!required;
    state.onCancel = onCancel;
    els.close.style.display = state.required ? 'none' : '';
    const myToken = ++state.token;

    els.title.textContent = patientName || 'Patient';
    els.body.innerHTML = '<p class="mh-empty">Loading…</p>';
    els.scrim.classList.add('is-open');

    try {
      const [cat, data] = await Promise.all([loadCatalogue(), fetchCurrent(patientId)]);
      if (myToken !== state.token) return;
      state.hasCurrent = !!(data && data.current);
      els.body.innerHTML = formHtml(cat, data);
    } catch (err) {
      if (myToken !== state.token) return;
      els.body.innerHTML = `<p class="mh-error">${esc(err.message || 'Could not load medical history.')}</p>
        <div class="mh-foot"><div class="mh-foot-right"><button type="button" class="btn btn-outline" data-mh-cancel>Close</button></div></div>`;
    }
  }

  function close() {
    if (!state.built) return;
    state.token++;
    state.required = false;
    els.scrim.classList.remove('is-open');
  }

  function cancel() {
    const cb = state.required ? state.onCancel : null;
    close();
    if (typeof cb === 'function') cb();
  }

  function medRow(m) {
    return `
      <div class="mh-med">
        <input class="field-input" data-med="name" placeholder="Medicine" maxlength="120" value="${esc(m.name)}">
        <input class="field-input" data-med="dose" placeholder="Dose" maxlength="80" value="${esc(m.dose)}">
        <input class="field-input" data-med="frequency" placeholder="How often" maxlength="80" value="${esc(m.frequency)}">
        <input class="field-input" data-med="reason" placeholder="What for" maxlength="120" value="${esc(m.reason)}">
        <button type="button" class="mh-med-remove" aria-label="Remove medicine">&times;</button>
      </div>`;
  }

  function selectHtml(id, options, current) {
    return `<select class="field-input" id="${id}">
      <option value="">Not recorded</option>
      ${options.map((o) => `<option value="${esc(o)}"${current === o ? ' selected' : ''}>${esc(cap(o))}</option>`).join('')}
    </select>`;
  }

  function formHtml(cat, data) {
    const cur = (data && data.current) || {};
    const selected = new Set(Array.isArray(cur.conditions) ? cur.conditions : []);
    const notes = cur.condition_notes || {};
    const meds = Array.isArray(cur.medications) && cur.medications.length ? cur.medications : [];
    const st = statusInfo(data);
    const allergiesText = data && data.allergies ? String(data.allergies) : '';

    const groups = cat.groups.map((g) => {
      const items = cat.conditions.filter((c) => c.group === g.id);
      if (!items.length) return '';
      return `
        <section class="mh-section">
          <h3>${esc(g.label)}</h3>
          <div class="mh-checks">
            ${items.map((c) => `
              <div class="mh-check${selected.has(c.key) ? ' is-on' : ''}">
                <label>
                  <input type="checkbox" data-cond="${esc(c.key)}"${selected.has(c.key) ? ' checked' : ''}>
                  <span>${esc(c.label)}</span>
                </label>
                <input class="field-input mh-note" data-note="${esc(c.key)}" maxlength="300"
                       placeholder="Details (optional) — e.g. type, since when, controlled?" value="${esc(notes[c.key] || '')}">
              </div>`).join('')}
          </div>
        </section>`;
    }).join('');

    return `
      ${state.required ? '<p class="mh-required">Please complete and save this form to open the patient\'s chart.</p>' : ''}
      <p class="mh-status${st.warn ? ' is-warn' : ''}">${esc(st.text)}</p>
      <div class="mh-form">
        <section class="mh-section">
          <h3>Allergies</h3>
          <label class="field-label" for="mhAllergies">Drug, latex, food or other allergies</label>
          <textarea class="field-input" id="mhAllergies" maxlength="1000" rows="2"
            data-initial="${esc(allergiesText)}"
            placeholder="e.g. Penicillin, latex, ibuprofen — leave blank if none">${esc(allergiesText)}</textarea>
        </section>

        ${groups}

        <section class="mh-section">
          <h3>Current medicines</h3>
          <div id="mhMeds">${meds.map(medRow).join('')}</div>
          <button type="button" class="btn btn-outline btn-sm" data-mh-add-med>+ Add medicine</button>
        </section>

        <section class="mh-section">
          <h3>Pregnancy &amp; breastfeeding</h3>
          <label class="mh-inline-check">
            <input type="checkbox" id="mhPregnant"${cur.is_pregnant ? ' checked' : ''}> Currently pregnant
          </label>
          <div class="mh-row2">
            <div>
              <label class="field-label" for="mhWeeks">Weeks pregnant</label>
              <input class="field-input" id="mhWeeks" type="number" min="1" max="45" value="${cur.pregnancy_weeks != null ? esc(cur.pregnancy_weeks) : ''}">
            </div>
          </div>
          <label class="mh-inline-check" style="margin-top:12px;">
            <input type="checkbox" id="mhBreastfeeding"${cur.is_breastfeeding ? ' checked' : ''}> Currently breastfeeding
          </label>
        </section>

        <section class="mh-section">
          <h3>Anaesthetic</h3>
          <label class="mh-inline-check">
            <input type="checkbox" id="mhAnaes"${cur.anaesthetic_reaction ? ' checked' : ''}> Has had a bad reaction to a local or general anaesthetic
          </label>
          <input class="field-input" id="mhAnaesNotes" maxlength="1000" placeholder="What happened? Which anaesthetic?" value="${esc(cur.anaesthetic_reaction_notes || '')}">
        </section>

        <section class="mh-section">
          <h3>Lifestyle</h3>
          <div class="mh-row2">
            <div>
              <label class="field-label" for="mhSmoking">Smoking / tobacco</label>
              ${selectHtml('mhSmoking', cat.smoking, cur.smoking_status)}
            </div>
            <div>
              <label class="field-label" for="mhAlcohol">Alcohol</label>
              ${selectHtml('mhAlcohol', cat.alcohol, cur.alcohol_use)}
            </div>
          </div>
        </section>

        <section class="mh-section">
          <h3>Anything else</h3>
          <label class="field-label" for="mhOther">Other conditions not listed above</label>
          <textarea class="field-input" id="mhOther" maxlength="1000">${esc(cur.other_conditions || '')}</textarea>
          <label class="field-label" for="mhSurgeries" style="margin-top:12px;">Past operations / hospital stays</label>
          <textarea class="field-input" id="mhSurgeries" maxlength="1000">${esc(cur.past_surgeries || '')}</textarea>
          <label class="field-label" for="mhNotes" style="margin-top:12px;">Clinician notes</label>
          <textarea class="field-input" id="mhNotes" maxlength="2000">${esc(cur.notes || '')}</textarea>
        </section>

        <p class="mh-error" id="mhError" style="display:none;"></p>
        <div class="mh-foot">
          ${state.hasCurrent && isClinician() ? '<button type="button" class="btn btn-outline" data-mh-confirm>Confirm no changes</button>' : '<span></span>'}
          <div class="mh-foot-right">
            <button type="button" class="btn btn-outline" data-mh-cancel>${state.required ? 'Back to patients' : (state.hasCurrent ? 'Cancel' : 'Skip for now')}</button>
            <button type="button" class="btn btn-primary" data-mh-save>Save medical history</button>
          </div>
        </div>
      </div>`;
  }

  function collect() {
    const q = (sel) => els.body.querySelector(sel);
    const conditions = Array.from(els.body.querySelectorAll('[data-cond]:checked')).map((i) => i.dataset.cond);
    const condition_notes = {};
    conditions.forEach((k) => {
      const input = q(`[data-note="${k}"]`);
      if (input && input.value.trim()) condition_notes[k] = input.value.trim();
    });
    const medications = Array.from(els.body.querySelectorAll('.mh-med')).map((row) => {
      const get = (f) => row.querySelector(`[data-med="${f}"]`).value.trim();
      return { name: get('name'), dose: get('dose'), frequency: get('frequency'), reason: get('reason') };
    }).filter((m) => m.name);

    return {
      conditions,
      condition_notes,
      medications,
      is_pregnant: q('#mhPregnant').checked,
      pregnancy_weeks: q('#mhWeeks').value,
      is_breastfeeding: q('#mhBreastfeeding').checked,
      anaesthetic_reaction: q('#mhAnaes').checked,
      anaesthetic_reaction_notes: q('#mhAnaesNotes').value,
      smoking_status: q('#mhSmoking').value,
      alcohol_use: q('#mhAlcohol').value,
      allergies: q('#mhAllergies').value,
      other_conditions: q('#mhOther').value,
      past_surgeries: q('#mhSurgeries').value,
      notes: q('#mhNotes').value,
    };
  }

  function setBusy(busy, label) {
    els.body.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    const saveBtn = els.body.querySelector('[data-mh-save]');
    if (saveBtn && label) saveBtn.textContent = label;
  }
  function showError(msg) {
    const el = els.body.querySelector('#mhError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  async function save() {
    showError('');
    const payload = collect();
    setBusy(true, 'Saving…');
    try {
      const result = await call(`/medical-history/patient/${state.patientId}`, 'POST', payload);
      const cb = state.onSaved;
      close();
      if (typeof cb === 'function') cb(result);
    } catch (err) {
      setBusy(false, 'Save medical history');
      showError(err.message || 'Could not save medical history.');
    }
  }

  async function confirmNoChange() {
    showError('');
    // "Confirm no changes" copies the old record forward and ignores the form,
    // so edited allergies would be silently lost. Make the user save instead.
    const box = els.body.querySelector('#mhAllergies');
    if (box && box.value.trim() !== (box.dataset.initial || '').trim()) {
      showError('You changed the allergies, so click “Save medical history” instead.');
      return;
    }
    setBusy(true);
    try {
      const result = await confirmHistory(state.patientId);
      const cb = state.onSaved;
      close();
      if (typeof cb === 'function') cb(result);
    } catch (err) {
      setBusy(false);
      showError(err.message || 'Could not confirm medical history.');
    }
  }

  /* ============================================================
     SUMMARY (Medical history tab)
     ============================================================ */
  async function renderSummary(container, { patientId, patientName = '', data, alerts, onChange } = {}) {
    if (!container) return;
    if (!data) {
      container.innerHTML = '<p class="pd-muted">Could not load medical history for this patient. You may not have permission to view it.</p>';
      return;
    }

    let cat;
    try { cat = await loadCatalogue(); } catch (e) { cat = { conditions: [], groups: [] }; }

    const cur = data.current;
    const st = statusInfo(data);
    const labelOf = (key) => (cat.conditions.find((c) => c.key === key) || {}).label || key;
    const shortLabel = (key) => labelOf(key).replace(/\s*\(.*\)\s*$/, '');

    let html = `
      <div class="mh-summary-actions">
        <button type="button" class="btn btn-primary btn-sm" data-mh-action="edit">${cur ? 'Update history' : 'Record history'}</button>
        ${cur ? '<button type="button" class="btn btn-outline btn-sm" data-mh-action="confirm">Confirm no changes</button>' : ''}
      </div>
      <p class="mh-review${st.warn ? ' is-warn' : ''}">${esc(st.text)}</p>`;

    if (!cur) {
      html += '<p class="mh-empty">Record the patient\'s medical history before prescribing or starting invasive treatment — drug and procedure warnings depend on it.</p>';
      container.innerHTML = html;
    } else {
      const conds = Array.isArray(cur.conditions) ? cur.conditions : [];
      const notes = cur.condition_notes || {};
      const meds = Array.isArray(cur.medications) ? cur.medications : [];

      html += `<div class="mh-block"><h4>Conditions</h4>${
        conds.length
          ? `<div class="mh-chips">${conds.map((k) => `<span class="mh-chip">${esc(shortLabel(k))}${notes[k] ? ` <small>— ${esc(notes[k])}</small>` : ''}</span>`).join('')}</div>`
          : '<p class="mh-empty">None reported.</p>'
      }</div>`;

      if (cur.other_conditions) html += `<div class="mh-block"><h4>Other conditions</h4><p>${esc(cur.other_conditions)}</p></div>`;

      html += `<div class="mh-block"><h4>Current medicines</h4>${
        meds.length
          ? `<table class="mh-table"><thead><tr><th>Medicine</th><th>Dose</th><th>How often</th><th>For</th></tr></thead><tbody>${
            meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.reason || '—')}</td></tr>`).join('')
          }</tbody></table>`
          : '<p class="mh-empty">None reported.</p>'
      }</div>`;

      const status = [];
      if (cur.is_pregnant) status.push(`Pregnant${cur.pregnancy_weeks ? ` (${esc(cur.pregnancy_weeks)} weeks)` : ''}`);
      if (cur.is_breastfeeding) status.push('Breastfeeding');
      if (cur.smoking_status) status.push(`Smoking: ${esc(cur.smoking_status)}`);
      if (cur.alcohol_use) status.push(`Alcohol: ${esc(cur.alcohol_use)}`);
      if (status.length) html += `<div class="mh-block"><h4>Status &amp; lifestyle</h4><div class="mh-chips">${status.map((s) => `<span class="mh-chip">${s}</span>`).join('')}</div></div>`;

      if (cur.anaesthetic_reaction) {
        html += `<div class="mh-block"><h4>Anaesthetic reaction</h4><p>${esc(cur.anaesthetic_reaction_notes || 'Reported — no details recorded.')}</p></div>`;
      }
      if (cur.past_surgeries) html += `<div class="mh-block"><h4>Past operations</h4><p>${esc(cur.past_surgeries)}</p></div>`;
      if (cur.notes) html += `<div class="mh-block"><h4>Clinician notes</h4><p>${esc(cur.notes)}</p></div>`;

      container.innerHTML = html;
    }

    container.onclick = async (e) => {
      const btn = e.target.closest('[data-mh-action]');
      if (!btn) return;
      if (btn.dataset.mhAction === 'edit') {
        open({ patientId, patientName, onSaved: onChange });
      } else if (btn.dataset.mhAction === 'confirm') {
        btn.disabled = true;
        try {
          await confirmHistory(patientId);
          if (typeof onChange === 'function') onChange();
        } catch (err) {
          btn.disabled = false;
          window.alert(err.message || 'Could not confirm medical history.');
        }
      }
    };
  }

  window.MedicalHistory = {
    open, close, fetchCurrent, fetchAlerts, alertsHtml, renderSummary, esc,
  };
})();
