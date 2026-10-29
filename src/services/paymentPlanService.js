// Pure schedule maths for payment plans. No database access, so it is easy to test.
//
// Money is handled in whole cents internally to avoid floating point drift, and dates are
// plain 'YYYY-MM-DD' strings (Nairobi has no daylight saving, so a date is just a date).

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
const MAX_INSTALMENTS = 24;
const MAX_HORIZON_DAYS = 730; // last instalment no later than ~2 years out

const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => Math.round(c) / 100;

const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Adds whole months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb).
const addMonths = (dateStr, months) => {
  const [y, m, day] = dateStr.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(day, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
};

const daysBetween = (fromStr, toStr) => Math.round(
  (new Date(`${toStr}T00:00:00Z`) - new Date(`${fromStr}T00:00:00Z`)) / 86400000,
);

// Nairobi's calendar date right now (Render runs in UTC; Nairobi is UTC+3 all year).
const todayNairobi = (now = new Date()) => new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Splits `balance` into a deposit (due today) plus `count` instalments.
 * Instalments are rounded down to whole shillings; the last one absorbs the remainder
 * so the schedule always adds up to the balance exactly.
 * Returns { error } or { instalments: [{ seq, due_date, amount }] }.
 */
const buildSchedule = ({
  balance, deposit = 0, count, frequency, firstDueDate, today = todayNairobi(),
}) => {
  const balanceC = toCents(balance);
  const depositC = toCents(deposit || 0);

  if (!(balanceC > 0)) return { error: 'This bill has no balance to spread over a plan' };
  if (!(depositC >= 0)) return { error: 'Deposit cannot be negative' };
  if (depositC >= balanceC) return { error: 'Deposit must be less than the balance. Take full payment instead.' };
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) {
    return { error: `Number of instalments must be between 1 and ${MAX_INSTALMENTS}` };
  }
  if (!FREQUENCIES.includes(frequency)) return { error: 'Frequency must be weekly, biweekly or monthly' };
  if (!isDateStr(firstDueDate)) return { error: 'First instalment date is invalid' };
  if (firstDueDate < today) return { error: 'First instalment date cannot be in the past' };

  const remaining = balanceC - depositC;
  const base = Math.floor(remaining / count / 100) * 100;     // whole shillings
  if (base <= 0) return { error: 'Instalments would be less than KSh 1. Use fewer instalments.' };

  const instalments = [];
  if (depositC > 0) instalments.push({ seq: 0, due_date: today, amount: fromCents(depositC) });

  for (let i = 0; i < count; i += 1) {
    const due = frequency === 'monthly'
      ? addMonths(firstDueDate, i)                       // anchored to the first date: no drift
      : addDays(firstDueDate, i * (frequency === 'weekly' ? 7 : 14));
    const amountC = i === count - 1 ? remaining - base * (count - 1) : base;
    instalments.push({ seq: i + 1, due_date: due, amount: fromCents(amountC) });
  }

  const last = instalments[instalments.length - 1].due_date;
  if (daysBetween(today, last) > MAX_HORIZON_DAYS) {
    return { error: 'The plan would run longer than 2 years. Use fewer instalments or a shorter gap.' };
  }
  return { instalments };
};

/**
 * Works out each instalment's state from what has been paid on the bill.
 * Payments fill instalments in order (deposit first, then the earliest due date).
 * `paidTowardPlan` = Bill.amount_paid - PaymentPlan.paid_before (never negative).
 */
const allocate = (instalments, paidTowardPlan, today = todayNairobi()) => {
  let pool = toCents(Math.max(0, paidTowardPlan || 0));
  return [...instalments]
    .sort((a, b) => a.seq - b.seq)
    .map((inst) => {
      const amountC = toCents(inst.amount);
      const allocC = Math.min(pool, amountC);
      pool -= allocC;
      const outstandingC = amountC - allocC;
      const dueDate = String(inst.due_date).slice(0, 10);
      let status;
      if (outstandingC === 0) status = 'paid';
      else if (dueDate < today) status = 'overdue';
      else if (allocC > 0) status = 'partial';
      else status = 'upcoming';
      return {
        id: inst.id,
        seq: inst.seq,
        due_date: dueDate,
        amount: fromCents(amountC),
        allocated: fromCents(allocC),
        outstanding: fromCents(outstandingC),
        status,
        days_overdue: status === 'overdue' ? daysBetween(dueDate, today) : 0,
      };
    });
};

/** Roll-up for a plan: overall state, next instalment, totals. */
const summarise = ({ plan, instalments, bill, today = todayNairobi() }) => {
  const paidToward = Math.max(0, Number(bill.amount_paid || 0) - Number(plan.paid_before || 0));
  const rows = allocate(instalments, paidToward, today);
  const scheduled = rows.reduce((s, r) => s + toCents(r.amount), 0);
  const outstanding = rows.reduce((s, r) => s + toCents(r.outstanding), 0);
  const overdueC = rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + toCents(r.outstanding), 0);
  const next = rows.find((r) => r.status !== 'paid') || null;

  let state = 'active';
  if (plan.status === 'cancelled') state = 'cancelled';
  else if (bill.status === 'void') state = 'bill_void';
  else if (outstanding === 0) state = 'completed';
  else if (overdueC > 0) state = 'overdue';

  // If the bill grew after the plan was made, say how much the plan does not cover.
  const billBalanceC = toCents(bill.total_amount) - toCents(bill.amount_paid || 0);
  const uncovered = Math.max(0, billBalanceC - outstanding);

  return {
    state,
    instalments: rows,
    total_scheduled: fromCents(scheduled),
    outstanding: fromCents(outstanding),
    overdue_amount: fromCents(overdueC),
    next_due: next && { seq: next.seq, due_date: next.due_date, outstanding: next.outstanding, status: next.status },
    uncovered_balance: fromCents(uncovered),
  };
};

const AGEING_BUCKETS = [
  { key: '1-30', min: 1, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '90+', min: 91, max: Infinity },
];
const bucketFor = (days) => (AGEING_BUCKETS.find((b) => days >= b.min && days <= b.max) || {}).key || null;

module.exports = {
  FREQUENCIES, MAX_INSTALMENTS, AGEING_BUCKETS,
  buildSchedule, allocate, summarise, bucketFor,
  addDays, addMonths, daysBetween, isDateStr, todayNairobi, toCents, fromCents,
};
