const { wrapper, formatMoney, formatDate } = require('./pdfLayout');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FREQ = { weekly: 'every week', biweekly: 'every two weeks', monthly: 'every month' };
const STATUS = { paid: 'Paid', overdue: 'Overdue', partial: 'Part paid', upcoming: 'Upcoming' };

// view = the object the controller builds (plan fields + summary); patient = Patient row.
const paymentPlanHtml = ({ view, patient }, clinicName, logoUrl) => {
  const rows = view.instalments.map((i) => `
    <tr>
      <td>${i.seq === 0 ? 'Deposit' : `Instalment ${i.seq}`}</td>
      <td>${formatDate(`${i.due_date}T12:00:00+03:00`)}</td>
      <td>${formatMoney(i.amount)}</td>
      <td>${formatMoney(i.outstanding)}</td>
      <td>${STATUS[i.status] || esc(i.status)}</td>
    </tr>`).join('');

  const bodyHtml = `
    <div class="meta-row"><span class="label">Patient</span><b>${esc(patient.first_name)} ${esc(patient.last_name)}</b></div>
    <div class="meta-row"><span class="label">Invoice</span><b>#${esc(String(view.bill_id).slice(0, 8).toUpperCase())}</b></div>
    <div class="meta-row"><span class="label">Plan created</span><b>${formatDate(view.created_at)}</b></div>
    <div class="meta-row"><span class="label">Instalments</span><b>${esc(FREQ[view.frequency] || view.frequency)}</b></div>

    <div class="section-title">Payment schedule</div>
    <table>
      <thead><tr><th>Payment</th><th>Due date</th><th>Amount</th><th>Still to pay</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="section-title">Summary</div>
    <div class="meta-row"><span class="label">Total on this plan</span><b>${formatMoney(view.total_scheduled)}</b></div>
    <div class="meta-row"><span class="label">Still to pay on this plan</span><b>${formatMoney(view.outstanding)}</b></div>
    ${view.overdue_amount > 0 ? `<div class="meta-row"><span class="label">Overdue now</span><b style="color:#991b1b;">${formatMoney(view.overdue_amount)}</b></div>` : ''}
    ${view.notes ? `<div class="section-title">Notes</div><p>${esc(view.notes)}</p>` : ''}
    <p style="margin-top:22px;font-size:11.5px;color:#64748b;">
      Payments received on the invoice are applied to the earliest instalment first.
      Please pay each instalment on or before its due date.
    </p>`;

  return wrapper({
    clinicName, logoUrl, docLabel: 'Payment plan', docId: String(view.id).slice(0, 8).toUpperCase(), bodyHtml,
  });
};

module.exports = { paymentPlanHtml };
