/* ============================================================
   PAYMENT PLANS — deposit + instalments on a bill
   ------------------------------------------------------------
     PaymentPlans.openSetup({ bill, onDone })
         Reception window: pick deposit, number of instalments,
         how often and the first date. The schedule is previewed
         live from the server before anything is saved.

     PaymentPlans.fetchForBill(billId)          -> { plan | null }
     PaymentPlans.renderSection(host, { bill, plan, canManage, onChange })
         The schedule on a bill (patient and staff), with the
         set-up / cancel / download buttons for staff.

     PaymentPlans.renderCollections(host, { onOpenBill })
         Overdue instalments grouped by age, with WhatsApp and
         call buttons.

   Payments are never recorded here. They go on the bill as usual
   (cash, M-Pesa, card…) and are applied to the earliest instalment
   first, so the schedule always matches the real payments.

   Needs api.js, dashboard.css, plan-finance.css.
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
  function fmtDay(ymd) {
    const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
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

  const FREQ_LABEL = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month' };
  const STATUS_LABEL = { paid: 'Paid', overdue: 'Overdue', partial: 'Part paid', upcoming: 'Upcoming' };
  const STATE_LABEL = {
    active: ['On track', 'ok'], overdue: ['Overdue', 'bad'], completed: ['Completed', 'ok'],
    cancelled: ['Cancelled', 'plain'], bill_void: ['Bill voided', 'plain'],
  };

  const fetchForBill = (billId) => call(`/payment-plans/bill/${billId}`);

  async function downloadPdf(planId) {
    try {
      const token = localStorage.getItem('jino_token');
      const res = await fetch(`/api/payment-plans/${planId}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not make the PDF. Please try again.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `payment-plan-${String(planId).slice(0, 8)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { notify(e.message); }
  }

  /* ============================================================
     SETUP WINDOW
     ============================================================ */
  function openSetup({ bill, onDone }) {
    const total = Number(bill.total_amount || 0);
    const paid = Number(bill.amount_paid || 0);
    const balance = total - paid;

    const scrim = el(`<div class="pa-scrim is-open">
      <div class="pa-modal pp-modal" role="dialog" aria-modal="true" aria-label="Set up payment plan">
        <div class="pa-head">
          <div><p class="pa-kicker">Payment plan</p><h2>Spread the balance</h2></div>
          <button type="button" class="pa-x" data-close aria-label="Close">&times;</button>
        </div>
        <div class="pa-body">
          <div class="pp-sum">
            <div><span>Bill total</span><b>${money(total)}</b></div>
            <div><span>Already paid</span><b>${money(paid)}</b></div>
            <div class="is-key"><span>To spread</span><b>${money(balance)}</b></div>
          </div>
          <div class="pp-grid">
            <div>
              <label class="field-label" for="ppDeposit">Deposit today (KSh)</label>
              <input class="field-input" type="number" id="ppDeposit" min="0" step="1" value="0" inputmode="numeric">
              <div class="pp-chips">
                <button type="button" data-pct="0">None</button><button type="button" data-pct="20">20%</button>
                <button type="button" data-pct="30">30%</button><button type="button" data-pct="50">50%</button>
              </div>
            </div>
            <div>
              <label class="field-label" for="ppCount">Number of instalments</label>
              <input class="field-input" type="number" id="ppCount" min="1" max="24" step="1" value="3" inputmode="numeric">
            </div>
            <div>
              <label class="field-label" for="ppFreq">How often</label>
              <select class="field-input" id="ppFreq">
                <option value="monthly">Every month</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="weekly">Every week</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="ppFirst">First instalment due</label>
              <input class="field-input" type="date" id="ppFirst" min="${ymd(new Date())}" value="${plusDays(30)}">
            </div>
          </div>
          <label class="field-label" for="ppNotes" style="margin-top:14px;">Notes (optional)</label>
          <input class="field-input" id="ppNotes" maxlength="500" placeholder="e.g. Patient paid deposit by M-Pesa; salary comes on the 28th.">
          <div class="pp-preview" id="ppPreview"></div>
          <p class="pa-error" id="ppError" style="display:none;"></p>
          <div class="pa-foot">
            <span></span>
            <div class="pa-foot-r">
              <button type="button" class="btn btn-outline" data-close>Cancel</button>
              <button type="button" class="btn btn-primary" id="ppCreate" disabled>Create plan</button>
            </div>
          </div>
        </div>
      </div>
    </div>`);
    document.body.appendChild(scrim);

    let busy = false;
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    function close() { if (busy) return; document.removeEventListener('keydown', onEsc, true); scrim.remove(); }
    document.addEventListener('keydown', onEsc, true);
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });

    const q = (id) => scrim.querySelector(id);
    const preview = q('#ppPreview'); const errEl = q('#ppError'); const createBtn = q('#ppCreate');
    let firstTouched = false; let timer = null; let seq = 0;

    const payload = (extra) => ({
      bill_id: bill.id,
      deposit: Number(q('#ppDeposit').value || 0),
      instalments: Number(q('#ppCount').value),
      frequency: q('#ppFreq').value,
      first_due_date: q('#ppFirst').value,
      notes: q('#ppNotes').value,
      ...extra,
    });

    function refresh() {
      clearTimeout(timer);
      createBtn.disabled = true;
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const r = await call('/payment-plans', 'POST', payload({ preview: true }));
          if (mine !== seq) return;
          errEl.style.display = 'none';
          preview.innerHTML = `<table class="pp-table"><thead><tr><th>Payment</th><th>Due</th><th>Amount</th></tr></thead><tbody>
            ${r.instalments.map((i) => `<tr><td>${i.seq === 0 ? 'Deposit' : `Instalment ${i.seq}`}</td><td>${esc(i.seq === 0 ? 'Today' : fmtDay(i.due_date))}</td><td>${money(i.amount)}</td></tr>`).join('')}
            </tbody><tfoot><tr><td colspan="2">Total</td><td>${money(r.total_scheduled)}</td></tr></tfoot></table>`;
          createBtn.disabled = false;
        } catch (e) {
          if (mine !== seq) return;
          preview.innerHTML = '';
          errEl.textContent = e.message; errEl.style.display = 'block';
        }
      }, 300);
    }

    scrim.querySelectorAll('.pp-chips button').forEach((b) => b.addEventListener('click', () => {
      q('#ppDeposit').value = Math.round((balance * Number(b.dataset.pct)) / 100);
      refresh();
    }));
    ['#ppDeposit', '#ppCount', '#ppNotes'].forEach((id) => q(id).addEventListener('input', () => (id === '#ppNotes' ? null : refresh())));
    q('#ppFirst').addEventListener('change', () => { firstTouched = true; refresh(); });
    q('#ppFreq').addEventListener('change', () => {
      if (!firstTouched) q('#ppFirst').value = plusDays({ monthly: 30, biweekly: 14, weekly: 7 }[q('#ppFreq').value]);
      refresh();
    });

    createBtn.addEventListener('click', async () => {
      busy = true; createBtn.disabled = true; createBtn.textContent = 'Creating…';
      try {
        await call('/payment-plans', 'POST', payload({}));
        busy = false;
        document.removeEventListener('keydown', onEsc, true);
        scrim.remove();
        notify('Payment plan created');
        if (onDone) onDone();
      } catch (e) {
        busy = false; createBtn.disabled = false; createBtn.textContent = 'Create plan';
        errEl.textContent = e.message; errEl.style.display = 'block';
      }
    });
    refresh();
  }

  /* ============================================================
     SCHEDULE ON A BILL
     ============================================================ */
  function renderSection(host, { bill, plan, canManage, onChange }) {
    host.innerHTML = '';
    const open = bill && (bill.status === 'unpaid' || bill.status === 'partially_paid');

    if (!plan) {
      if (canManage && open) {
        host.innerHTML = `<div class="pp-empty"><span>No payment plan. The patient has to pay the full balance.</span>
          <button type="button" class="btn btn-outline btn-sm" data-pp="setup">Set up payment plan</button></div>`;
        host.querySelector('[data-pp="setup"]').addEventListener('click', () => openSetup({ bill, onDone: onChange }));
      }
      return;
    }

    const [label, tone] = STATE_LABEL[plan.state] || [plan.state, 'plain'];
    const rows = plan.instalments.map((i) => `
      <tr class="is-${i.status}">
        <td>${i.seq === 0 ? 'Deposit' : `Instalment ${i.seq}`}</td>
        <td>${esc(fmtDay(i.due_date))}${i.status === 'overdue' ? `<span class="pp-late">${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'} late</span>` : ''}</td>
        <td>${money(i.amount)}</td>
        <td><span class="pp-badge is-${i.status}">${STATUS_LABEL[i.status] || esc(i.status)}</span>${i.status === 'partial' || (i.status === 'overdue' && i.allocated > 0) ? `<span class="pp-sub">${money(i.outstanding)} to go</span>` : ''}</td>
      </tr>`).join('');

    const next = plan.next_due && plan.state !== 'cancelled' && plan.state !== 'bill_void'
      ? `<p class="pp-next">Next: <b>${money(plan.next_due.outstanding)}</b> ${plan.next_due.status === 'overdue' ? 'was due' : 'due'} ${esc(plan.next_due.seq === 0 && plan.next_due.status !== 'overdue' ? 'today' : fmtDay(plan.next_due.due_date))}</p>` : '';

    host.innerHTML = `<div class="pp-card">
      <div class="pp-head">
        <div><p class="pp-title">Payment plan <span class="pp-state is-${tone}">${esc(label)}</span></p>
        <p class="pp-meta">${plan.instalments.filter((i) => i.seq > 0).length} instalment${plan.instalments.filter((i) => i.seq > 0).length === 1 ? '' : 's'}, ${esc(FREQ_LABEL[plan.frequency] || plan.frequency)}${plan.overdue_amount > 0 ? ` · <b class="pp-bad">${money(plan.overdue_amount)} overdue</b>` : ''}</p></div>
        ${next}
      </div>
      <div class="pp-scroll"><table class="pp-table"><thead><tr><th>Payment</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${plan.uncovered_balance > 0 ? `<p class="pp-warn">The bill has ${money(plan.uncovered_balance)} more than this plan covers (items were added after the plan was made).</p>` : ''}
      ${plan.notes ? `<p class="pp-notes">${esc(plan.notes)}</p>` : ''}
      <p class="pp-foot">Payments on the bill are applied to the earliest instalment first.</p>
      <div class="pp-actions">
        <button type="button" class="btn btn-outline btn-sm" data-pp="pdf">Download plan (PDF)</button>
        ${canManage && plan.state !== 'cancelled' && plan.state !== 'completed' ? '<button type="button" class="btn btn-outline btn-sm pp-danger" data-pp="cancel">Cancel plan</button>' : ''}
      </div>
    </div>`;

    host.querySelector('[data-pp="pdf"]').addEventListener('click', () => downloadPdf(plan.id));
    const cancel = host.querySelector('[data-pp="cancel"]');
    if (cancel) cancel.addEventListener('click', async () => {
      if (!window.confirm('Cancel this payment plan? The bill balance stays the same, but the schedule is removed.')) return;
      try { await call(`/payment-plans/${plan.id}/cancel`, 'PUT'); notify('Payment plan cancelled'); if (onChange) onChange(); } catch (e) { notify(e.message); }
    });
  }

  /* ============================================================
     OVERDUE / COLLECTIONS
     ============================================================ */
  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('254')) return d;
    if (d.startsWith('0')) return `254${d.slice(1)}`;
    if (d.length === 9) return `254${d}`;
    return d;
  }

  async function renderCollections(host, { onOpenBill } = {}) {
    host.innerHTML = '<div class="records-loading"><div class="mpesa-spinner"></div>Checking payment plans…</div>';
    let data;
    try { data = await call('/payment-plans/collections'); } catch (e) {
      host.innerHTML = `<div class="empty-state">Could not load overdue instalments. ${esc(e.message)}</div>`;
      return false;
    }
    const keys = ['1-30', '31-60', '61-90', '90+'];
    const buckets = keys.map((k) => `<div class="pp-bucket${data.buckets[k].count ? ' has' : ''}"><span>${k} days</span><b>${money(data.buckets[k].amount)}</b><em>${data.buckets[k].count} patient${data.buckets[k].count === 1 ? '' : 's'}</em></div>`).join('');

    const rows = data.accounts.map((a) => {
      const first = esc(String(a.patient_name).split(' ')[0]);
      const wa = waNumber(a.patient_phone);
      const text = `Hello ${String(a.patient_name).split(' ')[0]}, a friendly reminder that ${money(a.overdue_amount)} on your dental payment plan is overdue. Please pay when you can, or call us if you would like to talk about the schedule. Thank you.`;
      return `<tr>
        <td><b>${esc(a.patient_name)}</b><span class="pp-sub">${esc(a.patient_phone || 'No phone on file')}</span></td>
        <td>${money(a.overdue_amount)}<span class="pp-sub">${a.overdue_instalments} instalment${a.overdue_instalments === 1 ? '' : 's'}</span></td>
        <td><span class="pp-age age-${esc(a.bucket.replace('+', 'plus'))}">${a.oldest_days_overdue} days</span></td>
        <td class="pp-row-actions">
          ${wa ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}" aria-label="WhatsApp ${first}">WhatsApp</a>` : ''}
          ${a.patient_phone ? `<a class="btn btn-outline btn-sm" href="tel:${esc(a.patient_phone)}">Call</a>` : ''}
          ${onOpenBill ? `<button type="button" class="btn btn-primary btn-sm" data-bill="${esc(a.bill_id)}">Open bill</button>` : ''}
        </td></tr>`;
    }).join('');

    host.innerHTML = `
      <div class="pp-coll-head">
        <div><p class="pp-coll-title">Overdue instalments</p>
        <p class="pp-meta">${data.accounts.length ? `${money(data.total_overdue)} overdue across ${data.accounts.length} patient${data.accounts.length === 1 ? '' : 's'}` : 'Nothing is overdue.'}${data.due_within_7_days > 0 ? ` · ${money(data.due_within_7_days)} due in the next 7 days` : ''}</p></div>
      </div>
      ${data.accounts.length ? `<div class="pp-buckets">${buckets}</div>` : ''}
      ${data.accounts.length ? `<div class="pp-scroll"><table class="pp-table pp-coll"><thead><tr><th>Patient</th><th>Overdue</th><th>Oldest</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;

    host.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => onOpenBill(b.dataset.bill)));
    return true;
  }

  window.PaymentPlans = { openSetup, fetchForBill, renderSection, renderCollections };
})();
