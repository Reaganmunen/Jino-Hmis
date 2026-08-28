const { wrapper, formatDate } = require('./pdfLayout');

const CONDITION_LABEL = {
  healthy: 'Healthy', caries: 'Caries', filled: 'Filled', missing: 'Missing', crown: 'Crown',
};

// entries: full ToothChart history rows for the patient (every recorded
// observation, every tooth), newest first per tooth — same data the
// "history" view uses, not just the current-condition snapshot.
const toothChartHtml = ({ patient, entries }, clinicName, logoUrl) => {
  const rows = entries.length
    ? entries.map((e) => `
        <tr>
          <td>${e.tooth_number}</td>
          <td>${CONDITION_LABEL[e.condition] || e.condition}</td>
          <td>${e.notes || '—'}</td>
          <td>${formatDate(e.recorded_at)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="color:#64748b;">No tooth chart entries recorded.</td></tr>`;

  const bodyHtml = `
    <div class="meta-row"><span class="label">Patient</span><b>${patient.first_name} ${patient.last_name}</b></div>
    <div class="meta-row"><span class="label">Total entries</span><b>${entries.length}</b></div>

    <div class="section-title">Full tooth chart history (FDI numbering)</div>
    <table>
      <thead><tr><th>Tooth</th><th>Condition</th><th>Notes</th><th>Recorded</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  return wrapper({ clinicName, logoUrl, docLabel: 'Tooth Chart History', docId: null, bodyHtml });
};

module.exports = { toothChartHtml };