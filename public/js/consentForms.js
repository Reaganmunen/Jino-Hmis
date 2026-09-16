(function () {
  'use strict';

  /* ============================================================
     AUTH GUARD
     Same pattern as billing.js / treatmentPlan.js / prescriptions.js / documents.js.
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
    patientName: '',
    forms: [],
    appointments: [],
    detail: {}, // formId -> { open }
    selectedServices: new Set(),
  };

  // A single consolidated consent form: one shared consent text, plus a
  // checklist of dental services the patient ticks off before agreeing.
  // form_type stays 'general_treatment' (existing Postgres enum value) so no
  // schema migration is needed — content_snapshot below carries both the
  // consent text and the list of services the patient actually selected.
  const CONSENT_FORM = {
    type: 'general_treatment',
    label: 'Consent to Dental Treatment',
    body: `I, the undersigned patient (or parent/guardian if the patient is a minor), consent to the dental services ticked below, to be carried out by the dentists and staff providing my care at this clinic.

I understand that dentistry is not an exact science and that no guarantee can be made as to the outcome of any treatment. I have had the opportunity to ask questions about my diagnosis and the treatment options available to me, including the option of no treatment and the risks of declining treatment.

For procedures involving extraction, surgery, anesthesia, or radiographs, I understand the associated risks, which may include bleeding, swelling, infection, and rare but serious complications, and I confirm that reasonable alternatives have been explained to me.

I confirm that I have disclosed my full medical history, current medications, and any known allergies to the best of my knowledge, and I agree to inform the clinic promptly of any changes. I understand I may withdraw this consent at any time before a procedure begins by informing my dentist.`,
  };

  const SERVICES = [
    'General Checkup & Cleaning',
    'Dental X-Rays',
    'Fillings & Restorations',
    'Root Canal Treatment',
    'Tooth Extraction',
    'Oral Surgery',
    'Orthodontics (Braces & Aligners)',
    'Teeth Whitening',
    'Dental Implants',
    'Crowns & Bridges',
    'Dentures',
    'Periodontal (Gum) Treatment',
    'Pediatric Dentistry',
    'Emergency Dental Care',
  ];

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initSignModal();
    loadConsentForms();
  });

  async function loadConsentForms() {
    try {
      const patient = await fetchMethod('/patients/me', 'GET', null, true);
      state.patientId = patient.id;
      state.patientName = `${patient.first_name} ${patient.last_name}`.trim();

      renderTopbarAvatar(state.patientName, await fetchProfilePhotoUrl(patient.id));

      const [forms, appointments] = await Promise.all([
        fetchMethod(`/consent-forms/patient/${patient.id}`, 'GET', null, true),
        fetchMethod(`/appointments/patient/${patient.id}`, 'GET', null, true).catch(() => []),
      ]);

      state.forms = forms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      state.appointments = appointments;

      try { renderStats(); } catch (e) { console.error('renderStats failed', e); }
      try { renderPendingList(); } catch (e) { console.error('renderPendingList failed', e); }
      try { renderList(); } catch (e) { console.error('renderList failed', e); }
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
    showToast(err.message || 'Could not load your consent forms. Please refresh.');
  }

  /* ============================================================
     FORMS TO REVIEW (fixed catalog)
     ============================================================ */
  function renderPendingList() {
    const wrap = document.getElementById('pendingCfList');
    const latest = latestForm();
    const statusText = !latest
      ? 'Not yet submitted'
      : `Signed on ${formatDate(latest.signed_at || latest.created_at)}`;

    wrap.innerHTML = `
      <div class="pending-cf-row">
        <div class="pending-ic">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </div>
        <div class="pending-mid">
          <p>${escapeHtml(CONSENT_FORM.label)}</p>
          <span>${escapeHtml(statusText)}</span>
        </div>
        <button class="btn btn-outline btn-sm" data-action="review">
          ${latest ? 'Review again' : 'Review & sign'}
        </button>
      </div>
    `;

    wrap.querySelector('[data-action="review"]').addEventListener('click', () => openSignModal());
  }

  function latestForm() {
    return state.forms[0] || null; // state.forms is already sorted newest-first
  }

  /* ============================================================
     REVIEW & SIGN MODAL
     ============================================================ */
  function initSignModal() {
    const scrim = document.getElementById('signModalScrim');
    document.getElementById('signModalClose').addEventListener('click', closeSignModal);
    document.getElementById('signCancel').addEventListener('click', closeSignModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeSignModal(); });

    document.getElementById('signName').addEventListener('input', updateSubmitEnabled);
    document.getElementById('signSubmit').addEventListener('click', submitConsentForm);
  }

  function openSignModal() {
    state.selectedServices = new Set();

    document.getElementById('signModalTitle').textContent = CONSENT_FORM.label;
    document.getElementById('signContentBox').textContent = CONSENT_FORM.body;
    document.getElementById('signName').value = state.patientName || '';

    const listEl = document.getElementById('signServicesList');
    listEl.innerHTML = SERVICES.map((service, i) => `
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;">
        <input type="checkbox" class="sign-service-check" value="${escapeAttr(service)}" id="signService${i}">
        ${escapeHtml(service)}
      </label>
    `).join('');
    listEl.querySelectorAll('.sign-service-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.selectedServices.add(cb.value);
        else state.selectedServices.delete(cb.value);
        updateSubmitEnabled();
      });
    });

    document.getElementById('signSubmit').textContent = 'I Agree to Receive Treatment';
    updateSubmitEnabled();

    document.getElementById('signModalScrim').classList.add('is-open');
  }

  function closeSignModal() {
    document.getElementById('signModalScrim').classList.remove('is-open');
    state.selectedServices = new Set();
  }

  function updateSubmitEnabled() {
    const name = document.getElementById('signName').value.trim();
    const ready = state.selectedServices.size > 0 && !!name;
    document.getElementById('signSubmit').disabled = !ready;
  }

  async function submitConsentForm() {
    const signedByName = document.getElementById('signName').value.trim();
    if (!signedByName || state.selectedServices.size === 0) return;

    const submitBtn = document.getElementById('signSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const chosenServices = SERVICES.filter((s) => state.selectedServices.has(s));
    const snapshot = `${CONSENT_FORM.body}\n\nServices consented to:\n${chosenServices.map((s) => `- ${s}`).join('\n')}`;

    try {
      await fetchMethod('/consent-forms', 'POST', {
        form_type: CONSENT_FORM.type,
        content_snapshot: snapshot,
        consented: true,
        signed_by_name: signedByName,
        signature_data: signedByName, // typed signature — no signature-pad capture wired up yet
      }, true);

      showToast('Consent recorded — thank you.');
      closeSignModal();

      const forms = await fetchMethod(`/consent-forms/patient/${state.patientId}`, 'GET', null, true);
      state.forms = forms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      renderStats();
      renderPendingList();
      renderList();
    } catch (err) {
      showToast(err.message || 'Could not submit this form. Please try again.');
    } finally {
      submitBtn.textContent = 'I Agree to Receive Treatment';
      updateSubmitEnabled();
    }
  }

  /* ============================================================
     STATS
     ============================================================ */
  function renderStats() {
    document.getElementById('statTotalForms').textContent = state.forms.length;

    const signed = state.forms.filter((f) => f.consented === true).length;
    document.getElementById('statSigned').textContent = signed;

    const declined = state.forms.filter((f) => f.consented === false).length;
    document.getElementById('statDeclined').textContent = declined;

    document.getElementById('statLastSigned').textContent = state.forms.length
      ? formatDate(state.forms[0].signed_at || state.forms[0].created_at)
      : '—';
  }

  /* ============================================================
     LIST
     ============================================================ */
  function renderList() {
    const list = document.getElementById('cfList');
    list.innerHTML = '';

    if (!state.forms.length) {
      list.innerHTML = '<div class="empty-state">No consent forms on record yet.</div>';
      return;
    }

    state.forms.forEach((form) => {
      const isOpen = !!(state.detail[form.id] && state.detail[form.id].open);
      const consented = form.consented === true;
      const statusKey = form.consented === false ? 'declined' : 'signed';
      const statusLabel = form.consented === false ? 'Declined' : 'Signed';

      const card = document.createElement('div');
      card.className = 'cf-card' + (isOpen ? ' is-open' : '');
      card.setAttribute('data-form-id', form.id);
      card.innerHTML = `
        <div class="cf-head" data-action="toggle" data-id="${form.id}">
          <div class="cf-ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 14.5l2.2 2.2L16 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="cf-mid">
            <p class="t">${escapeHtml(CONSENT_FORM.label)}</p>
            <p class="s">Signed by ${escapeHtml(form.signed_by_name || 'you')}</p>
          </div>
          <span class="badge badge-${statusKey}">${statusLabel}</span>
          <div class="cf-date">${escapeHtml(formatDate(form.signed_at || form.created_at))}</div>
          <svg class="cf-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="cf-body" id="cfBody-${form.id}"></div>
      `;
      list.appendChild(card);
      renderFormBody(form.id);
    });

    list.querySelectorAll('[data-action="toggle"]').forEach((head) => {
      head.addEventListener('click', () => toggleForm(head.getAttribute('data-id')));
    });
  }

  function toggleForm(formId) {
    const card = document.querySelector(`.cf-card[data-form-id="${formId}"]`);
    if (!card) return;
    if (!state.detail[formId]) state.detail[formId] = { open: false };
    state.detail[formId].open = !state.detail[formId].open;
    card.classList.toggle('is-open', state.detail[formId].open);
  }

  function renderFormBody(formId) {
    const body = document.getElementById(`cfBody-${formId}`);
    if (!body) return;
    const form = state.forms.find((f) => String(f.id) === String(formId));
    if (!form) return;

    const appt = state.appointments.find((a) => a.id === form.appointment_id);

    const signatureHtml = form.signature_data
      ? (String(form.signature_data).startsWith('data:image')
          ? `<img src="${escapeAttr(form.signature_data)}" alt="Signature of ${escapeAttr(form.signed_by_name || '')}">`
          : `<span class="cf-signature-typed">${escapeHtml(form.signature_data)}</span>`)
      : '<span style="color:var(--slate-400);font-size:12.5px;">No signature on file</span>';

    body.innerHTML = `
      <div class="plan-meta-row">
        <span>Signed by <b>${escapeHtml(form.signed_by_name || '—')}</b></span>
        <span>Date <b>${escapeHtml(formatDate(form.signed_at || form.created_at))}</b></span>
        ${appt ? `<span>Visit <b>${escapeHtml(formatDate(appt.scheduled_start))}</b></span>` : ''}
      </div>

      <div class="bill-section">
        <p class="bill-section-title">Signature</p>
        <div class="cf-signature-box">${signatureHtml}</div>
      </div>

      ${form.content_snapshot ? `
        <div class="bill-section">
          <p class="bill-section-title">Form text</p>
          <div class="cf-content-box">${escapeHtml(form.content_snapshot)}</div>
        </div>
      ` : ''}
    `;
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

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—'; // toLocaleDateString throws on an invalid date rather than returning text
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // file_type is a Postgres enum without a 'profile_picture' value, so the
  // profile photo is stored as file_type: 'photo' + description: 'Profile
  // Picture' (see profile.js) and found the same way here.
  async function fetchProfilePhotoUrl(patientId) {
    try {
      const files = await fetchMethod(`/patient-files/patient/${patientId}`, 'GET', null, true);
      const photo = files
        .filter((f) => f.file_type === 'photo' && f.description === 'Profile Picture')
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
      return photo ? photo.file_url : null;
    } catch {
      return null;
    }
  }

  function renderTopbarAvatar(name, photoUrl) {
    const el = document.getElementById('avatarInitials');
    if (photoUrl) {
      el.innerHTML = `<img src="${escapeAttr(photoUrl)}" alt="Profile photo">`;
    } else {
      el.textContent = initialsOf(name);
    }
  }
})();