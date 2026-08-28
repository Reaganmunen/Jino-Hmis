const { wrapper, formatMoney, formatDate, formatDateTime } = require('./pdfLayout');

const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', partially_paid: 'Partial', void: 'Void' };

// Single bill — full invoice with line items and payment history.
const billInvoiceHtml = ({ bill, items, payments }, clinicName, logoUrl) => {
  const balance = Number(bill.total_amount) - Number(bill.amount_paid || 0);
  const status = STATUS_LABEL[bill.status] || bill.status;

  const itemsRows = items.length
    ? items.map((it) => `
        <tr>
          <td>${it.description || 'Service'}</td>
          <td>${it.quantity}</td>
          <td>${formatMoney(it.unit_price)}</td>
          <td>${formatMoney(Number(it.quantity) * Number(it.unit_price))}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="color:#64748b;">No line items recorded.</td></tr>`;

  const paymentsRows = payments.length
    ? payments.map((p) => `
        <tr>
          <td>${formatDate(p.paid_at)}</td>
          <td>${p.method}${p.reference ? ` · ${p.reference}` : ''}</td>
          <td>${formatMoney(p.amount)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="color:#64748b;">No payments recorded yet.</td></tr>`;

  const bodyHtml = `
    <div class="meta-row"><span class="label">Patient</span><b>${bill.patient_first_name} ${bill.patient_last_name}</b></div>
    <div class="meta-row"><span class="label">Bill date</span><b>${formatDate(bill.created_at)}</b></div>
    <div class="meta-row"><span class="label">Status</span><span class="badge badge-${bill.status}">${status}</span></div>

    <div class="section-title">Line items</div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="section-title">Payment history</div>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th>Amount</th></tr></thead>
      <tbody>${paymentsRows}</tbody>
    </table>

    <div class="section-title">Summary</div>
    <div class="meta-row"><span class="label">Total</span><b>${formatMoney(bill.total_amount)}</b></div>
    <div class="meta-row"><span class="label">Paid</span><b>${formatMoney(bill.amount_paid)}</b></div>
    <div class="meta-row"><span class="label">Balance due</span><b>${bill.status === 'void' ? 'Voided' : formatMoney(balance)}</b></div>
  `;

  return wrapper({
    clinicName, logoUrl, docLabel: 'Invoice', docId: String(bill.id).slice(0, 8).toUpperCase(), bodyHtml,
  });
};

// Full statement — every bill for a patient, one summary row each, running total.
const billStatementHtml = ({ patient, bills }, clinicName, logoUrl) => {
  const totalBilled = bills.reduce((sum, b) => sum + Number(b.total_amount), 0);
  const totalPaid = bills.reduce((sum, b) => sum + Number(b.amount_paid || 0), 0);
  const totalDue = bills
    .filter((b) => b.status !== 'void')
    .reduce((sum, b) => sum + (Number(b.total_amount) - Number(b.amount_paid || 0)), 0);

  const rows = bills.length
    ? bills.map((b) => {
        const balance = Number(b.total_amount) - Number(b.amount_paid || 0);
        const status = STATUS_LABEL[b.status] || b.status;
        return `
          <tr>
            <td>${formatDate(b.created_at)}</td>
            <td>#${String(b.id).slice(0, 8).toUpperCase()}</td>
            <td>${formatMoney(b.total_amount)}</td>
            <td>${formatMoney(b.amount_paid)}</td>
            <td>${b.status === 'void' ? '—' : formatMoney(balance)}</td>
            <td><span class="badge badge-${b.status}">${status}</span></td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="6" style="color:#64748b;">No bills on record.</td></tr>`;

  const bodyHtml = `
    <div class="meta-row"><span class="label">Patient</span><b>${patient.first_name} ${patient.last_name}</b></div>
    <div class="meta-row"><span class="label">Statement generated</span><b>${formatDateTime(new Date())}</b></div>

    <div class="section-title">All bills</div>
    <table>
      <thead><tr><th>Date</th><th>Bill</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="section-title">Summary</div>
    <div class="meta-row"><span class="label">Total billed</span><b>${formatMoney(totalBilled)}</b></div>
    <div class="meta-row"><span class="label">Total paid</span><b>${formatMoney(totalPaid)}</b></div>
    <div class="meta-row"><span class="label">Total outstanding</span><b>${formatMoney(totalDue)}</b></div>
  `;

  return wrapper({ clinicName, logoUrl, docLabel: 'Account Statement', docId: null, bodyHtml });
};

module.exports = { billInvoiceHtml, billStatementHtml };