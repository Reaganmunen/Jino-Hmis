const { wrapper, formatMoney, formatDate, formatDateTime } = require('./pdfLayout');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

// Treatment quote. When the patient has accepted, their signature and the date are printed on it,
// using the snapshot taken at acceptance (so later price edits do not change what they agreed to).
const quoteHtml = ({ plan, items, patient, dentist, acceptance }, clinicName, logoUrl) => {
  const accepted = acceptance && acceptance.decision === 'accepted';
  const shownItems = accepted ? acceptance.accepted_items : items;
  const total = accepted
    ? Number(acceptance.accepted_total)
    : shownItems.reduce((s, i) => s + Number(i.estimated_cost || 0), 0);

  const rows = shownItems.length
    ? shownItems.map((it, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(it.procedure_name)}</td>
          <td>${it.tooth_number ? esc(it.tooth_number) : '—'}</td>
          <td style="text-align:right;">${formatMoney(it.estimated_cost)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="color:#64748b;">No procedures on this plan.</td></tr>';

  const signature = accepted ? `
    <div class="section-title">Patient acceptance</div>
    <p>I have read this treatment plan and estimate, and I agree to go ahead with the treatment listed above.</p>
    ${acceptance.signature_png && PNG_URL.test(acceptance.signature_png)
      ? `<img src="${acceptance.signature_png}" style="height:70px;border-bottom:1px solid #1a1a1a;padding:0 24px;" />` : ''}
    <div class="meta-row"><span class="label">Signed by</span><b>${esc(acceptance.signer_name)}${acceptance.signer_relationship !== 'self' ? ` (${esc(acceptance.signer_relationship)} of the patient)` : ''}</b></div>
    <div class="meta-row"><span class="label">Date and time</span><b>${formatDateTime(acceptance.created_at)}</b></div>
    <div class="meta-row"><span class="label">Recorded</span><b>${acceptance.recorded_via === 'in_clinic' ? 'In the clinic' : 'Patient portal'}</b></div>`
    : `
    <div class="section-title">Patient acceptance</div>
    <p style="color:#64748b;">Not yet accepted.</p>
    <div style="margin-top:36px;display:flex;gap:40px;">
      <div style="flex:1;border-top:1px solid #1a1a1a;padding-top:4px;font-size:11px;color:#64748b;">Patient signature</div>
      <div style="width:160px;border-top:1px solid #1a1a1a;padding-top:4px;font-size:11px;color:#64748b;">Date</div>
    </div>`;

  const bodyHtml = `
    <div class="meta-row"><span class="label">Patient</span><b>${esc(patient.first_name)} ${esc(patient.last_name)}</b></div>
    ${dentist ? `<div class="meta-row"><span class="label">Dentist</span><b>Dr ${esc(dentist.first_name)} ${esc(dentist.last_name)}</b></div>` : ''}
    <div class="meta-row"><span class="label">Date issued</span><b>${formatDate(plan.created_at)}</b></div>
    ${plan.description ? `<div class="meta-row"><span class="label">Plan</span><b>${esc(plan.description)}</b></div>` : ''}

    <div class="section-title">Proposed treatment</div>
    <table>
      <thead><tr><th>#</th><th>Procedure</th><th>Tooth</th><th style="text-align:right;">Estimate</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="meta-row" style="margin-top:12px;font-size:14px;"><span class="label">Estimated total</span><b>${formatMoney(total)}</b></div>
    <p style="margin-top:14px;font-size:11.5px;color:#64748b;">
      This is an estimate. The final cost can change if your dentist finds something different once treatment starts,
      and they will talk to you before doing anything that changes the price.
    </p>
    ${signature}`;

  return wrapper({
    clinicName, logoUrl, docLabel: 'Treatment quote', docId: String(plan.id).slice(0, 8).toUpperCase(), bodyHtml,
  });
};

module.exports = { quoteHtml };
