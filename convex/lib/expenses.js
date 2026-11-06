/**
 * Expense rules shared by the /api handler, the browser UI and the tests. No I/O here.
 *
 * ERP is the system of record: each app expense is one ERP Expense Claim. App-only details
 * (category, conveyance legs, bill name, report number, approval notes) travel in the claim's
 * `remark` field, on a marked last line, so the text above it stays readable in ERP.
 */
import { ERP_CURRENT_RULES } from '../../src/policy.js';

export const EXPENSE_CLAIM = 'Expense Claim';
export const EXPENSE_DETAIL = 'Expense Claim Detail';
const META_MARK = 'ProRack Move data: ';

export const EXPENSE_TYPES = {
  conveyance: { label: 'Local conveyance', category: 'local', erp: ['Local Conveyance', 'Conveyance', 'Mileage', 'Travel'], billRequired: false },
  local_food: { label: 'Local food', category: 'local', erp: ['Local Food', 'Food', 'Meal', 'Meals', 'Per Diem'], billRequired: true },
  hotel: { label: 'Hotel', category: 'inland', erp: ['Hotel', 'Lodging', 'Accommodation', 'Stay'], billRequired: true },
  food: { label: 'Food', category: 'inland', erp: ['Food', 'Meal', 'Meals', 'Per Diem'], billRequired: true },
  fare: { label: 'Air / train / bus', category: 'inland', erp: ['Travel', 'Air', 'Train', 'Fare', 'Ticket'], billRequired: true },
  own_vehicle: { label: 'Own vehicle', category: 'inland', erp: ['Mileage', 'Own Vehicle', 'Conveyance', 'Travel'], billRequired: false },
  taxi: { label: 'Taxi / 3W / bike', category: 'inland', erp: ['Taxi', 'Cab', 'Conveyance', 'Travel'], billRequired: true },
  incidental: { label: 'Incidental', category: 'inland', erp: ['Incidental', 'Incidentals', 'Miscellaneous', 'Others', 'Other'], billRequired: false },
  exceptional: { label: 'Exceptional', category: 'inland', erp: ['Exceptional', 'Miscellaneous', 'Others', 'Other'], billRequired: true }
};

export const LEG_CATEGORIES = {
  four_wheeler: { label: 'Own 4-wheeler', perKm: true },
  two_wheeler: { label: 'Own 2-wheeler', perKm: true },
  taxi: { label: 'Taxi / auto', perKm: false, bill: true },
  toll: { label: 'Toll', perKm: false, bill: true },
  parking: { label: 'Parking', perKm: false, bill: true }
};

const round2 = n => Math.round(Number(n) * 100) / 100;
const clean = s => String(s ?? '').trim();
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));

/** Per-km legs use the mileage rates currently in force in ERP, so the server always recalculates them. */
export function legAmount(leg) {
  const cat = LEG_CATEGORIES[leg.category];
  if (!cat) return 0;
  if (cat.perKm) {
    const km = Number(leg.km);
    return Number.isFinite(km) && km > 0 ? round2(km * ERP_CURRENT_RULES.mileage[leg.category]) : 0;
  }
  const amount = Number(leg.amount);
  return Number.isFinite(amount) && amount > 0 ? round2(amount) : 0;
}
export const legsKm = legs => round2((legs || []).reduce((sum, l) => sum + (LEG_CATEGORIES[l.category]?.perKm ? Number(l.km) || 0 : 0), 0));
export const legsTotal = legs => round2((legs || []).reduce((sum, l) => sum + legAmount(l), 0));

/** Does this expense need a bill before it can be sent for approval? */
export function billRequired(expense) {
  if (expense.estimate) return false;
  if (EXPENSE_TYPES[expense.type]?.billRequired) return true;
  return (expense.legs || []).some(l => LEG_CATEGORIES[l.category]?.bill);
}

/** Validate and normalise what the browser sent. Throws an Error with a user-facing message. */
export function normaliseExpense(input, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const def = EXPENSE_TYPES[input?.type];
  if (!def) throw Error('Choose a valid expense type.');
  const date = clean(input.date);
  if (!validDate(date)) throw Error('Enter a valid expense date.');
  if (!input.estimate && date > today) throw Error('Expense date cannot be in the future.');
  const out = { type: input.type, category: def.category, date, description: clean(input.description).slice(0, 300), purpose: clean(input.purpose).slice(0, 140), request: clean(input.request).slice(0, 140) };
  if (input.type === 'conveyance') {
    const legs = (Array.isArray(input.legs) ? input.legs : []).slice(0, 25).map(l => ({ from: clean(l.from).slice(0, 80), to: clean(l.to).slice(0, 80), category: l.category, km: Number(l.km) || 0, amount: Number(l.amount) || 0 }));
    if (!legs.length) throw Error('Add at least one journey leg.');
    for (const l of legs) {
      if (!LEG_CATEGORIES[l.category]) throw Error('Choose a category for every leg.');
      if (!l.from || !l.to) throw Error('Enter where every leg starts and ends.');
      if (legAmount(l) <= 0) throw Error(LEG_CATEGORIES[l.category].perKm ? 'Enter the distance for every own-vehicle leg.' : 'Enter the amount for every toll, parking or taxi leg.');
    }
    out.legs = legs.map(l => ({ ...l, amount: legAmount(l) }));
    out.amount = legsTotal(legs);
  } else if (Array.isArray(input.rows) && input.estimate) {
    out.rows = input.rows.filter(r => EXPENSE_TYPES[r.type] && Number(r.amount) > 0).map(r => ({ type: r.type, amount: round2(r.amount), description: clean(r.description).slice(0, 140) }));
    if (!out.rows.length) throw Error('This estimate has no amounts to record.');
    out.amount = round2(out.rows.reduce((sum, r) => sum + r.amount, 0));
  } else {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw Error('Enter an amount greater than zero.');
    out.amount = round2(amount);
  }
  if (input.estimate) out.estimate = true;
  return out;
}

/** Build the remark text: a readable summary followed by the marked data line. */
export function buildRemark(summary, meta) {
  return `${clean(summary)}\n${META_MARK}${JSON.stringify(meta)}`.slice(0, 8000);
}
export function parseRemark(remark) {
  const text = String(remark || '');
  const at = text.lastIndexOf(META_MARK);
  if (at < 0) return { summary: text.trim(), meta: {} };
  let meta = {};
  try { meta = JSON.parse(text.slice(at + META_MARK.length).trim()); } catch { meta = {}; }
  return { summary: text.slice(0, at).trim(), meta };
}

/** Map an app expense onto an ERP Expense Claim. `erpTypes` is ERP's list of Expense Claim Types. */
export function toErpExpenseClaim(expense, employee, { erpTypes = [], match = () => null } = {}) {
  const lookup = type => match(erpTypes, EXPENSE_TYPES[type].erp);
  const rows = expense.rows || [{ type: expense.type, amount: expense.amount, description: expense.description }];
  const missing = [...new Set(rows.filter(r => !lookup(r.type)).map(r => EXPENSE_TYPES[r.type].label))];
  const summary = expense.estimate
    ? `Estimate raised from ProRack Move${expense.request ? ` for ${expense.request}` : ''}. Not a reimbursement claim.`
    : `Raised from ProRack Move.${expense.purpose ? ` Purpose: ${expense.purpose}.` : ''}`;
  const meta = { type: expense.type, category: expense.category, date: expense.date };
  for (const k of ['legs', 'rows', 'purpose', 'request', 'description', 'estimate']) if (expense[k]) meta[k] = expense[k];
  return {
    missing,
    doc: {
      doctype: EXPENSE_CLAIM, employee: employee.name, company: employee.company, posting_date: expense.date,
      expense_approver: employee.expense_approver || undefined, approval_status: 'Draft',
      remark: buildRemark(summary, meta),
      expenses: rows.map(r => ({ expense_date: expense.date, expense_type: lookup(r.type), description: clean(r.description) || EXPENSE_TYPES[r.type].label, amount: r.amount, sanctioned_amount: r.amount }))
    }
  };
}

export function expenseStatus(doc, meta = parseRemark(doc.remark).meta) {
  if (Number(doc.docstatus) === 2) return 'cancelled';
  if (/^approved$/i.test(doc.approval_status || '')) return 'approved';
  if (/^rejected$/i.test(doc.approval_status || '')) return 'rejected';
  if (meta.estimate) return 'estimate';
  if (meta.status === 'pending' || /pending/i.test(doc.workflow_state || '')) return 'pending';
  return 'ready';
}

/** Map an ERP Expense Claim into the app's expense shape. */
export function fromErpExpenseClaim(doc) {
  const { summary, meta } = parseRemark(doc.remark);
  const rows = doc.expenses || [];
  const claimed = Number(doc.total_claimed_amount) || rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const out = {
    id: doc.name, source: 'erp', userId: doc.employee, employeeName: doc.employee_name || doc.employee, status: expenseStatus(doc, meta),
    type: meta.type || 'exceptional', category: meta.category || 'inland', date: meta.date || String(doc.posting_date || rows[0]?.expense_date || '').slice(0, 10),
    amount: round2(claimed), summary, purpose: meta.purpose || '', description: meta.description || rows[0]?.description || '', request: meta.request || '',
    legs: meta.legs || [], rows: meta.rows || [], estimate: Boolean(meta.estimate), billName: meta.billName || '', report: meta.report || '',
    decidedBy: meta.decidedBy || '', decisionNote: meta.decisionNote || '', createdAt: String(doc.creation || '').replace(' ', 'T')
  };
  out.needsBill = billRequired(out) && !out.billName;
  return out;
}

/** Who may approve? Never yourself. The ERP expense approver may; a Travel Admin only if ADMIN_CAN_APPROVE=1. */
export function canDecide({ session, requester, isAdmin = false, env = {} }) {
  if (!requester || requester.name === session.employeeId) return false;
  if (clean(requester.expense_approver).toLowerCase() === clean(session.email).toLowerCase() && clean(session.email)) return true;
  return Boolean(isAdmin && String(env.ADMIN_CAN_APPROVE || '') === '1');
}

export const BILL_MAX_BYTES = 4 * 1024 * 1024;
export const BILL_EXTENSIONS = /\.(jpe?g|png|pdf)$/i;

/** Totals by status, used for the tab badges and the calendar. */
export function expenseSummary(expenses) {
  const out = { ready: [0, 0], estimate: [0, 0], pending: [0, 0], approved: [0, 0], rejected: [0, 0] };
  for (const e of expenses) if (out[e.status]) { out[e.status][0] += 1; out[e.status][1] = round2(out[e.status][1] + e.amount); }
  return out;
}

/** A month grid (weeks of day cells) with the expenses of each day. month is 'YYYY-MM'. */
export function monthGrid(month, expenses) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const items = expenses.filter(e => e.date === date && !e.estimate);
    cells.push({ day: d, date, items, total: round2(items.reduce((sum, e) => sum + e.amount, 0)) });
  }
  while (cells.length % 7) cells.push(null);
  const inMonth = expenses.filter(e => e.date.startsWith(month) && !e.estimate);
  return { cells, total: round2(inMonth.reduce((sum, e) => sum + e.amount, 0)), count: inMonth.length };
}
export function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
