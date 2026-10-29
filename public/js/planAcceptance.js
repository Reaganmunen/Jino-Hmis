/* ============================================================
   PLAN ACCEPTANCE — patient agrees to a treatment plan
   ------------------------------------------------------------
     PlanAcceptance.mountRow(host, { plan, patientName, role, onDone })
         Fills `host` with the plan's acceptance state and buttons.
         role: 'patient' (their own portal) or 'staff' (signing in the clinic).

     PlanAcceptance.open({ planId, patientName, role, onDone })
         The review-and-sign window on its own.

     PlanAcceptance.downloadQuote(planId)

   The server works out the procedures and total itself, so what
   the patient signs is always what is on record. Signatures are
   drawn on screen and stored with the date, who recorded it and
   whether it was signed online or in the clinic.

   Needs api.js, dashboard.css (.btn, .field-*), plan-finance.css.
   ============================================================ */
(function () {
  'use strict';

  const call = (path, method, body) => fetchMethod(path, method || 'GET', body || null, true);

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const money = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;
  function fmtDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function notify(msg) {
    const t = document.getElementById('toast');
    if (!t) { window.alert(msg); return; }
    t.textContent = msg;
    t.classList.add('is-visible');
    clearTimeout(notify._t);
    notify._t = setTimeout(() => t.classList.remove('is-visible'), 3000);
  }
  const el = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };
  const CLOSED = ['approved', 'in_progress', 'completed', 'cancelled', 'rejected'];

  async function downloadQuote(planId) {
    try {
      const token = localStorage.getItem('jino_token');
      const res = await fetch(`/api/plan-acceptance/${planId}/quote/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not make the quote PDF. Please try again.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `treatment-quote-${String(planId).slice(0, 8)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { notify(e.message); }
  }

  /* ---------- signature pad ---------- */
  function signaturePad() {
    const W = 600; const H = 180;
    const wrap = el(`<div class="pa-sigwrap">
      <canvas class="pa-sig" width="${W}" height="${H}" aria-label="Signature box. Draw your signature with your finger, stylus or mouse."></canvas>
      <span class="pa-sig-hint">Sign here</span>
      <button type="button" class="pa-sig-clear">Clear</button>
    </div>`);
    const canvas = wrap.querySelector('canvas');
    const hint = wrap.querySelector('.pa-sig-hint');
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0A1730';
    let drawing = false; let last = null; let ink = 0;

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true; last = pos(e);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.4, 0, Math.PI * 2); ctx.fillStyle = '#0A1730'; ctx.fill();
      hint.style.display = 'none';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ink += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    });
    const end = () => { drawing = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    wrap.querySelector('.pa-sig-clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, W, H); ink = 0; hint.style.display = '';
    });
    return {
      el: wrap,
      isSigned: () => ink > 60,                       // more than a dot or a tap
      toDataUrl: () => canvas.toDataURL('image/png'),
    };
  }

  /* ---------- review + sign window ---------- */
  async function open({ planId, patientName, role, onDone }) {
    const isStaff = role === 'staff';
    const scrim = el(`<div class="pa-scrim is-open">
      <div class="pa-modal" role="dialog" aria-modal="true" aria-label="Treatment plan acceptance">
        <div class="pa-head">
          <div><p class="pa-kicker">${isStaff ? 'Sign in the clinic' : 'Treatment plan'}</p><h2>${isStaff ? 'Record patient acceptance' : 'Review and accept'}</h2></div>
          <button type="button" class="pa-x" data-close aria-label="Close">&times;</button>
        </div>
        <div class="pa-body"><div class="records-loading"><div class="mpesa-spinner"></div>Loading plan…</div></div>
      </div>
    </div>`);
    document.body.appendChild(scrim);
    const body = scrim.querySelector('.pa-body');

    let busy = false;
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    function close() {
      if (busy) return;
      document.removeEventListener('keydown', onEsc, true);
      scrim.remove();
    }
    document.addEventListener('keydown', onEsc, true);
    scrim.querySelector('[data-close]').addEventListener('click', close);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });

    let data;
    try { data = await call(`/plan-acceptance/${planId}`); } catch (e) {
      body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      return;
    }
    if (!data.can_accept) {
      body.innerHTML = '<div class="empty-state">This plan can’t be accepted right now. It may already be approved, or have no procedures yet.</div>';
      return;
    }

    const rows = data.items.map((it, i) => `
      <div class="pa-item"><span class="pa-n">${i + 1}</span>
        <span class="pa-proc">${esc(it.procedure_name)}${it.tooth_number ? ` <em>tooth ${esc(it.tooth_number)}</em>` : ''}</span>
        <span class="pa-amt">${money(it.estimated_cost)}</span></div>`).join('');

    body.innerHTML = `
      <div class="pa-items">${rows}</div>
      <div class="pa-total"><span>Estimated total</span><b>${money(data.total)}</b></div>
      <p class="pa-note">This is an estimate. Your dentist will talk to you before doing anything that changes the price.</p>
      <div class="pa-signer">
        ${isStaff ? `<div><label class="field-label" for="paRel">Who is signing?</label>
          <select class="field-input" id="paRel">
            <option value="self">The patient</option>
            <option value="guardian">Parent or guardian</option>
            <option value="other">Someone else on their behalf</option>
          </select></div>` : ''}
        <div><label class="field-label" for="paName">Full name of the person signing</label>
          <input class="field-input" id="paName" maxlength="120" value="${isStaff ? '' : esc(patientName || '')}" autocomplete="name"></div>
      </div>
      <label class="field-label" style="margin-top:14px;">Signature</label>
      <div id="paSigHost"></div>
      <label class="pa-confirm"><input type="checkbox" id="paConfirm">
        I have read this treatment plan and estimate, and I agree to go ahead with the treatment listed above.</label>
      <p class="pa-error" id="paError" style="display:none;"></p>
      <div class="pa-foot">
        <button type="button" class="pa-decline-link" id="paDeclineLink">I don’t want to go ahead</button>
        <div class="pa-foot-r">
          <button type="button" class="btn btn-outline" data-close>Not now</button>
          <button type="button" class="btn btn-primary" id="paAccept">Accept and sign</button>
        </div>
      </div>
      <div class="pa-decline" id="paDecline" style="display:none;">
        <label class="field-label" for="paReason">What’s the main reason? (optional)</label>
        <textarea class="field-input" id="paReason" rows="2" maxlength="500" placeholder="e.g. Cost, want a second opinion, need time to decide."></textarea>
        <button type="button" class="btn btn-outline btn-sm" id="paDeclineGo" style="margin-top:10px;">Record that I’m declining</button>
      </div>`;

    const pad = signaturePad();
    body.querySelector('#paSigHost').appendChild(pad.el);
    body.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    const errEl = body.querySelector('#paError');
    const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; };

    async function send(payload, okMsg, btn, label) {
      busy = true; btn.disabled = true; btn.textContent = 'Saving…'; errEl.style.display = 'none';
      try {
        await call(`/plan-acceptance/${planId}`, 'POST', payload);
        busy = false;
        notify(okMsg);
        document.removeEventListener('keydown', onEsc, true);
        scrim.remove();
        if (onDone) onDone();
      } catch (e) {
        busy = false; btn.disabled = false; btn.textContent = label;
        showErr(e.message);
      }
    }

    body.querySelector('#paAccept').addEventListener('click', (ev) => {
      const name = body.querySelector('#paName').value.trim();
      if (name.length < 2) return showErr('Please type the full name of the person signing.');
      if (!pad.isSigned()) return showErr('Please sign in the box.');
      if (!body.querySelector('#paConfirm').checked) return showErr('Please tick the box to confirm you agree.');
      const rel = body.querySelector('#paRel');
      return send({
        decision: 'accepted', signer_name: name, signer_relationship: rel ? rel.value : 'self',
        signature: pad.toDataUrl(), confirm: true,
      }, 'Treatment plan accepted', ev.currentTarget, 'Accept and sign');
    });
    body.querySelector('#paDeclineLink').addEventListener('click', () => {
      const box = body.querySelector('#paDecline');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    body.querySelector('#paDeclineGo').addEventListener('click', (ev) => send({
      decision: 'declined', decline_reason: body.querySelector('#paReason').value,
      signer_name: body.querySelector('#paName').value.trim(),
    }, 'Your decision has been recorded', ev.currentTarget, 'Record that I’m declining'));
  }

  /* ---------- the status row shown on each plan ---------- */
  // Remembers the last answer per plan so a card that re-renders doesn't flash empty.
  const rowCache = new Map();

  async function mountRow(host, opts) {
    const planId = opts.plan.id;
    const cached = rowCache.get(planId);
    if (cached) paintRow(host, cached, opts); else host.innerHTML = '';
    let data;
    try { data = await call(`/plan-acceptance/${planId}`); } catch (e) { return; }
    rowCache.set(planId, data);
    if (!host.isConnected) return;               // card was re-rendered while we waited
    if (!cached || JSON.stringify(cached) !== JSON.stringify(data)) paintRow(host, data, opts);
  }

  function paintRow(host, data, { plan, patientName, role, onDone }) {
    const isStaff = role === 'staff';
    const a = data.acceptance;
    const closed = CLOSED.includes(plan.status);
    const accepted = a && a.decision === 'accepted';
    const declined = a && a.decision === 'declined';
    const parts = [];

    if (accepted) {
      parts.push(`<div class="pa-strip is-ok"><b>Accepted</b> by ${esc(a.signer_name)}${a.signer_relationship !== 'self' ? ` (${esc(a.signer_relationship)})` : ''}
        on ${esc(fmtDate(a.created_at))} · ${a.recorded_via === 'in_clinic' ? 'signed in the clinic' : 'signed online'} · ${money(a.accepted_total)}</div>`);
    } else if (!closed && declined) {
      parts.push(`<div class="pa-strip is-warn"><b>Declined</b> on ${esc(fmtDate(a.created_at))}${a.decline_reason ? `: ${esc(a.decline_reason)}` : ''}</div>`);
    } else if (!closed && data.can_accept) {
      parts.push(`<div class="pa-strip is-wait">${isStaff
        ? '<b>Waiting for the patient to accept.</b> They can do it in their portal, or sign here in the clinic.'
        : '<b>Please review this plan.</b> Accept it so your dentist can book your treatment.'}</div>`);
    } else if (!closed && isStaff && !data.items.length) {
      parts.push('<div class="pa-strip is-wait">Add procedures to this plan before the patient can accept it.</div>');
    } else if (closed && !accepted && isStaff && ['approved', 'in_progress', 'completed'].includes(plan.status)) {
      parts.push('<div class="pa-strip is-plain">Approved. No signed acceptance is on file for this plan.</div>');
    }

    const btns = [];
    if (!closed && data.can_accept) {
      btns.push(`<button type="button" class="btn btn-primary btn-sm" data-pa="sign">${isStaff ? 'Record acceptance in clinic' : 'Review and accept'}</button>`);
    }
    btns.push('<button type="button" class="btn btn-outline btn-sm" data-pa="quote">Download quote (PDF)</button>');
    parts.push(`<div class="pa-btns">${btns.join('')}</div>`);

    host.innerHTML = `<div class="pa-row">${parts.join('')}</div>`;
    const sign = host.querySelector('[data-pa="sign"]');
    if (sign) sign.addEventListener('click', (e) => { e.stopPropagation(); open({ planId: plan.id, patientName, role, onDone }); });
    host.querySelector('[data-pa="quote"]').addEventListener('click', (e) => { e.stopPropagation(); downloadQuote(plan.id); });
  }

  window.PlanAcceptance = { open, mountRow, downloadQuote };
})();
