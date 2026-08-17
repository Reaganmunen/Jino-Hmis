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
    signingType: null,
    signingDecision: null, // true | false
  };

  // form_type is a Postgres enum: general_treatment, extraction, surgery,
  // xray, minor_treatment, other. It's procedure-based, not policy-based —
  // there's no value for a financial or privacy policy, so those aren't
  // offered here. (Add them to the enum via migration if you want patients
  // to formally consent to policy documents this same way.)
  //
  // The wording below is a starting template covering the standard elements
  // a dental consent form should have (purpose, risks, alternatives, right
  // to withdraw). It is NOT legal advice and has not been reviewed by a
  // lawyer — have it checked against Kenyan health and data protection
  // requirements before relying on it with real patients. Replace
  // "[Clinic Name]" throughout.
  const FORM_CATALOG = [
    {
      type: 'general_treatment',
      label: 'General Treatment Consent',
      body: `I, the undersigned patient (or parent/guardian if the patient is a minor), consent to dental examination, diagnosis, and the routine dental treatment recommended by the dentists and staff of [Clinic Name], including but not limited to cleanings, fillings, and other procedures customarily performed in general dental practice.

I understand that dentistry is not an exact science and that no guarantee can be made as to the outcome of any treatment. I have had the opportunity to ask questions about my diagnosis and the treatment options available to me, including the option of no treatment and the risks of declining treatment.

I understand I may withdraw this consent at any time before a procedure begins by informing my dentist. I confirm that I have disclosed my full medical history, current medications, and any known allergies to the best of my knowledge, and I agree to inform the clinic promptly of any changes.`,
    },
    {
      type: 'extraction',
      label: 'Tooth Extraction Consent',
      body: `I authorize the dentists of [Clinic Name] to remove the tooth or teeth identified as necessary for extraction, along with any local anesthesia required to perform the procedure.

I understand the risks associated with extraction, which may include bleeding, swelling, bruising, infection, dry socket, damage to adjacent teeth or restorations, and, rarely, injury to nearby nerves resulting in temporary or permanent numbness.

I understand alternatives to extraction (such as root canal treatment, where applicable) have been explained to me, along with the risks of leaving the tooth untreated. I agree to follow the post-extraction care instructions provided by the clinic.`,
    },
    {
      type: 'surgery',
      label: 'Oral Surgery Consent',
      body: `I authorize the dentists and oral surgery staff of [Clinic Name] to perform the oral surgical procedure recommended to me, including the administration of local anesthesia as required.

I understand that oral surgery carries risks including but not limited to infection, prolonged bleeding, swelling, bruising, injury to nearby teeth, nerves, sinuses, or jaw structures, and a longer-than-expected recovery. I understand rare but serious complications are possible.

I have had the opportunity to discuss alternatives to surgery, including no treatment, and their associated risks. I agree to follow all pre- and post-operative instructions provided by the clinic and to disclose any change in my health status before the procedure.`,
    },
    {
      type: 'xray',
      label: 'Dental X-Ray Consent',
      body: `I authorize [Clinic Name] to take dental radiographs (x-rays) as clinically necessary for the diagnosis, treatment planning, and monitoring of my dental and oral health.

I understand that dental x-rays involve exposure to a small, regulated dose of ionizing radiation, and that the clinic follows the ALARA principle (As Low As Reasonably Achievable) to minimize this exposure, including the use of protective shielding such as a lead apron or thyroid collar where appropriate.

I confirm that I have informed the clinic if I am or may be pregnant, or if I have had significant recent radiation exposure. I understand I may decline any specific x-ray, and that doing so may limit the dentist's ability to diagnose or safely treat certain conditions.`,
    },
    {
      type: 'minor_treatment',
      label: 'Consent for Treatment of a Minor',
      body: `I confirm that I am the parent or legal guardian of the minor patient named on this record, and I have the legal authority to consent to dental treatment on their behalf.

I authorize the dentists and staff of [Clinic Name] to examine, diagnose, and provide the dental treatment they judge necessary for this minor, including routine procedures and, where specifically discussed with me in advance, any additional treatment such as extractions, x-rays, or the use of local anesthesia.

I understand I may be present during treatment where clinically appropriate, that I will be informed of any significant findings or recommended treatment before it proceeds, and that I may withdraw this consent at any time by informing the clinic.`,
      signerHint: 'This form must be signed by a parent or legal guardian, not the minor patient.',
    },
    {
      type: 'other',
      label: 'Other Treatment Consent',
      body: `I authorize the dentists and staff of [Clinic Name] to proceed with the treatment or procedure discussed with me that is not otherwise covered by a specific consent form.

I confirm that the nature of the procedure, its expected benefits, reasonably foreseeable risks, and available alternatives (including no treatment) have been explained to me, and that I have had the opportunity to ask questions.

I understand I may withdraw this consent at any time before the procedure begins by informing my dentist.`,
    },
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
    wrap.innerHTML = FORM_CATALOG.map((item) => {
      const latest = latestFormOfType(item.type);
      const statusText = !latest
        ? 'Not yet submitted'
        : latest.consented === false
          ? `Declined on ${formatDate(latest.signed_at || latest.created_at)}`
          : `Signed on ${formatDate(latest.signed_at || latest.created_at)}`;

      return `
        <div class="pending-cf-row">
          <div class="pending-ic">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </div>
          <div class="pending-mid">
            <p>${escapeHtml(item.label)}</p>
            <span>${escapeHtml(statusText)}</span>
          </div>
          <button class="btn btn-outline btn-sm" data-action="review" data-type="${escapeAttr(item.type)}">
            ${latest ? 'Review again' : 'Review & sign'}
          </button>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-action="review"]').forEach((btn) => {
      btn.addEventListener('click', () => openSignModal(btn.getAttribute('data-type')));
    });
  }

  function latestFormOfType(type) {
    return state.forms.find((f) => f.form_type === type) || null; // state.forms is already sorted newest-first
  }

  /* ============================================================
     REVIEW & SIGN MODAL
     ============================================================ */
  function initSignModal() {
    const scrim = document.getElementById('signModalScrim');
    document.getElementById('signModalClose').addEventListener('click', closeSignModal);
    document.getElementById('signCancel').addEventListener('click', closeSignModal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeSignModal(); });

    document.getElementById('signAgreeBtn').addEventListener('click', () => setDecision(true));
    document.getElementById('signDeclineBtn').addEventListener('click', () => setDecision(false));
    document.getElementById('signName').addEventListener('input', updateSubmitEnabled);
    document.getElementById('signSubmit').addEventListener('click', submitConsentForm);
  }

  function openSignModal(type) {
    const item = FORM_CATALOG.find((f) => f.type === type);
    if (!item) return;

    state.signingType = type;
    state.signingDecision = null;

    document.getElementById('signModalTitle').textContent = item.label;
    document.getElementById('signContentBox').textContent = item.body;
    document.getElementById('signName').value = state.patientName || '';

    const hintEl = document.getElementById('signSignerHint');
    if (item.signerHint) {
      hintEl.textContent = item.signerHint;
      hintEl.style.display = '';
    } else {
      hintEl.style.display = 'none';
    }

    document.getElementById('signAgreeBtn').classList.remove('is-active');
    document.getElementById('signDeclineBtn').classList.remove('is-active');
    updateSubmitEnabled();

    document.getElementById('signModalScrim').classList.add('is-open');
  }

  function closeSignModal() {
    document.getElementById('signModalScrim').classList.remove('is-open');
    state.signingType = null;
    state.signingDecision = null;
  }

  function setDecision(decision) {
    state.signingDecision = decision;
    document.getElementById('signAgreeBtn').classList.toggle('is-active', decision === true);
    document.getElementById('signDeclineBtn').classList.toggle('is-active', decision === false);
    updateSubmitEnabled();
  }

  function updateSubmitEnabled() {
    const name = document.getElementById('signName').value.trim();
    const ready = state.signingDecision !== null && !!name;
    document.getElementById('signSubmit').disabled = !ready;
  }

  async function submitConsentForm() {
    const item = FORM_CATALOG.find((f) => f.type === state.signingType);
    const signedByName = document.getElementById('signName').value.trim();
    if (!item || state.signingDecision === null || !signedByName) return;

    const submitBtn = document.getElementById('signSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      await fetchMethod('/consent-forms', 'POST', {
        form_type: item.type,
        content_snapshot: item.body,
        consented: state.signingDecision,
        signed_by_name: signedByName,
        signature_data: signedByName, // typed signature — no signature-pad capture wired up yet
      }, true);

      showToast(state.signingDecision ? 'Consent recorded — thank you.' : 'Your decision has been recorded.');
      closeSignModal();

      const forms = await fetchMethod(`/consent-forms/patient/${state.patientId}`, 'GET', null, true);
      state.forms = forms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      renderStats();
      renderPendingList();
      renderList();
    } catch (err) {
      showToast(err.message || 'Could not submit this form. Please try again.');
    } finally {
      submitBtn.textContent = 'Submit';
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
            <p class="t">${escapeHtml(prettyType(form.form_type))}</p>
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

  function prettyType(type) {
    if (!type) return 'Consent Form';
    return type.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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