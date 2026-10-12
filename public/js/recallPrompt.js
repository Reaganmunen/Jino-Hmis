/* ============================================================
   RECALL / FOLLOW-UP PROMPT (dentist side)
   ------------------------------------------------------------
   RecallPrompt.open({ patientId, patientName, notify })

   A small modal, shown right after a visit is marked completed, that
   lets the dentist set a follow-up date in one click. It saves through
   the existing POST /recall-reminders endpoint. "Skip" does nothing.

   Needs api.js (fetchMethod) and dashboard.css (modal classes);
   styles are in dentist-extras.css.

   NOTE: a saved reminder is only a record until something sends it.
   Your backend exposes GET /recall-reminders/due for a scheduled job;
   make sure that job is running if you expect patients to be messaged.
   ============================================================ */
(function () {
  'use strict';

  // If your RecallReminder table restricts these columns to specific values,
  // change them here (one place) to match.
  const CONFIG = {
    reminderType: 'follow_up',
    channel: 'sms',
  };

  const PRESETS = [
    { label: '1 week', days: 7 },
    { label: '2 weeks', days: 14 },
    { label: '1 month', months: 1 },
    { label: '3 months', months: 3 },
    { label: '6 months', months: 6 },
    { label: '1 year', months: 12 },
  ];

  const els = {};
  let built = false;
  let current = null;   // { patientId, patientName, notify }
  let saving = false;

  function open({ patientId, patientName, notify } = {}) {
    if (!patientId) return;
    build();
    current = { patientId, patientName: patientName || 'this patient', notify: notify || null };
    saving = false;

    els.intro.textContent = `Set a follow-up reminder for ${current.patientName}, or skip if none is needed.`;
    els.date.value = '';
    els.date.min = toInputDate(addDays(new Date(), 1));
    els.notes.value = '';
    els.error.textContent = '';
    els.save.disabled = false;
    els.save.textContent = 'Save reminder';
    els.presets.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('is-active'));

    els.scrim.classList.add('is-open');
    els.presets.querySelector('.filter-tab').focus();
  }

  function close() {
    if (!built) return;
    els.scrim.classList.remove('is-open');
    current = null;
  }

  window.RecallPrompt = { open, close };

  /* ---- DOM ---- */
  function build() {
    if (built) return;
    built = true;

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim rc-scrim';
    scrim.innerHTML = `
      <div class="modal rc-modal" role="dialog" aria-modal="true" aria-labelledby="rcTitle">
        <div class="modal-head">
          <div>
            <p class="modal-kicker">Visit completed</p>
            <h2 id="rcTitle">Follow-up reminder</h2>
          </div>
        </div>
        <p class="rc-intro" id="rcIntro"></p>

        <div class="rc-presets" id="rcPresets" role="group" aria-label="Remind in">
          ${PRESETS.map((p, i) => `<button class="filter-tab" type="button" data-preset="${i}">${p.label}</button>`).join('')}
        </div>

        <div class="rc-field">
          <label class="field-label" for="rcDate">Reminder date</label>
          <input class="field-input" type="date" id="rcDate">
        </div>
        <div class="rc-field">
          <label class="field-label" for="rcNotes">Note (optional)</label>
          <input class="field-input" type="text" id="rcNotes" maxlength="200" placeholder="e.g. Review extraction site">
        </div>

        <p class="rc-error" id="rcError" role="alert"></p>

        <div class="modal-foot" style="justify-content:flex-end;">
          <button class="btn btn-outline" id="rcSkip" type="button">Skip</button>
          <button class="btn btn-primary" id="rcSave" type="button">Save reminder</button>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);

    els.scrim = scrim;
    els.intro = scrim.querySelector('#rcIntro');
    els.presets = scrim.querySelector('#rcPresets');
    els.date = scrim.querySelector('#rcDate');
    els.notes = scrim.querySelector('#rcNotes');
    els.error = scrim.querySelector('#rcError');
    els.save = scrim.querySelector('#rcSave');
    els.skip = scrim.querySelector('#rcSkip');

    els.presets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      const preset = PRESETS[Number(btn.dataset.preset)];
      els.presets.querySelectorAll('.filter-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      els.date.value = toInputDate(dateFromPreset(preset));
      els.error.textContent = '';
    });
    // Picking a date by hand un-highlights the presets.
    els.date.addEventListener('input', () => {
      els.presets.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('is-active'));
      els.error.textContent = '';
    });
    els.skip.addEventListener('click', close);
    els.save.addEventListener('click', save);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.scrim.classList.contains('is-open')) close();
    });
  }

  async function save() {
    if (saving || !current) return;
    const due = els.date.value;
    if (!due) { els.error.textContent = 'Pick a reminder date, or press Skip.'; return; }
    if (due < els.date.min) { els.error.textContent = 'The reminder date must be in the future.'; return; }

    saving = true;
    els.save.disabled = true;
    els.save.textContent = 'Saving…';
    els.error.textContent = '';

    try {
      await fetchMethod('/recall-reminders', 'POST', {
        patient_id: current.patientId,
        due_date: due,
        reminder_type: CONFIG.reminderType,
        channel: CONFIG.channel,
        notes: els.notes.value.trim() || null,
      }, true);
      const notify = current.notify;
      const name = current.patientName;
      close();
      if (typeof notify === 'function') notify(`Follow-up reminder set for ${name} on ${prettyDate(due)}.`);
    } catch (err) {
      // Stay open so the dentist can retry or press Skip; show the server's reason.
      els.error.textContent = err.message || 'Could not save the reminder.';
      els.save.disabled = false;
      els.save.textContent = 'Save reminder';
    } finally {
      saving = false;
    }
  }

  /* ---- date helpers (local time, YYYY-MM-DD for <input type="date">) ---- */
  function addDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  // Adds calendar months, clamping to the month's last day (31 Aug + 1 month = 30 Sep, not 1 Oct).
  function addMonths(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth(), 1);
    d.setMonth(d.getMonth() + months);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(date.getDate(), lastDay));
    return d;
  }

  function dateFromPreset(preset) {
    const today = new Date();
    return preset.days ? addDays(today, preset.days) : addMonths(today, preset.months);
  }

  function toInputDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function prettyDate(inputDate) {
    const [y, m, d] = inputDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
})();
