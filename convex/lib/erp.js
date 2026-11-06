/**
 * ERPNext (Frappe REST) client and field mapping for ProRack Move.
 *
 * ERP is the source of truth: employees, grades, approvers and Travel Requests are read from
 * and written to ERP. Nothing here stores ERP data; Convex only keeps sign-in sessions.
 *
 * Pure module (no Convex imports) so it can be unit tested with a mocked fetch.
 * Env: ERP_BASE_URL (e.g. https://erpuat.prorackglobal.com), ERP_API_KEY, ERP_API_SECRET.
 */

import { EXPENSE_CLAIM, EXPENSE_DETAIL } from './expenses.js';

export const TRAVEL_REQUEST = 'Travel Request';
export const ITINERARY = 'Travel Itinerary';
export const SUBMIT_ACTION = 'Submit for Approval';
export const APPROVE_ACTION = 'Approve';
export const REJECT_ACTION = 'Reject';

const EMPLOYEE_FIELDS = ['name', 'employee_name', 'first_name', 'designation', 'department', 'grade', 'company',
  'user_id', 'company_email', 'cell_number', 'branch', 'expense_approver', 'reports_to', 'status'];
const REQUEST_FIELDS = ['name', 'employee', 'employee_name', 'travel_type', 'purpose_of_travel', 'travel_funding',
  'workflow_state', 'docstatus', 'description', 'creation', 'modified'];
const CLAIM_FIELDS = ['name', 'employee', 'employee_name', 'posting_date', 'approval_status', 'expense_approver', 'total_claimed_amount', 'docstatus', 'remark', 'creation', 'modified'];
const LEG_FIELDS = ['parent', 'idx', 'travel_from', 'travel_to', 'mode_of_travel', 'departure_date', 'arrival_date'];

export class ErpError extends Error {
  constructor(message, status = 502, detail = '') { super(message); this.status = status; this.detail = detail; }
}

export function erpConfig(env) {
  const base = String(env.ERP_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.ERP_API_KEY || '').trim();
  const secret = String(env.ERP_API_SECRET || '').trim();
  return { base, key, secret, configured: Boolean(base && key && secret) };
}

/** Pull a readable message out of a Frappe error response. */
export function frappeMessage(body) {
  if (!body || typeof body !== 'object') return '';
  if (body._server_messages) {
    try {
      return JSON.parse(body._server_messages).map(m => { try { return JSON.parse(m).message; } catch { return m; } })
        .join(' ').replace(/<[^>]+>/g, '').trim();
    } catch { /* fall through */ }
  }
  return String(body.exception || body.message || body.exc_type || '').replace(/<[^>]+>/g, '').trim();
}

export function createErpClient(env, fetchImpl = fetch) {
  const cfg = erpConfig(env);
  async function call(method, path, { query, json, form, multipart } = {}) {
    if (!cfg.configured) throw new ErpError('ERP is not configured: set ERP_BASE_URL, ERP_API_KEY and ERP_API_SECRET in Convex.', 503);
    const url = new URL(cfg.base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const headers = { Authorization: `token ${cfg.key}:${cfg.secret}`, Accept: 'application/json' };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (multipart !== undefined) body = multipart;
    let res;
    try { res = await fetchImpl(url.toString(), { method, headers, body }); }
    catch (e) { throw new ErpError(`ERP unreachable at ${cfg.base}`, 502, String(e?.message || e)); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = frappeMessage(data) || `ERP returned HTTP ${res.status}`;
      throw new ErpError(msg, res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400, text.slice(0, 500));
    }
    return data;
  }
  const list = (doctype, { filters, fields, order_by, limit = 100, parent } = {}) =>
    call('GET', `/api/resource/${encodeURIComponent(doctype)}`, { query: { filters, fields, order_by, limit_page_length: String(limit), parent } })
      .then(d => d?.data || []);
  const get = (doctype, name) => call('GET', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`).then(d => d?.data);

  return {
    config: cfg,
    call,
    async ping() { return call('GET', '/api/method/frappe.auth.get_logged_user').then(d => d?.message); },

    /** Active employee whose ERP user or company email matches the signed-in email. */
    async employeeByEmail(email) {
      const e = String(email || '').trim().toLowerCase();
      if (!e) return null;
      for (const field of ['user_id', 'company_email']) {
        const rows = await list('Employee', { filters: [[field, '=', e], ['status', '=', 'Active']], fields: EMPLOYEE_FIELDS, limit: 2 });
        if (rows.length) return rows[0];
      }
      return null;
    },
    employee: name => get('Employee', name),
    async employeeNames(ids) {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return {};
      const rows = await list('Employee', { filters: [['name', 'in', unique]], fields: ['name', 'employee_name'], limit: unique.length });
      return Object.fromEntries(rows.map(r => [r.name, r.employee_name]));
    },

    /** Travel Request meta (fields, options, mandatory) for the parent and the itinerary child. */
    async travelMeta() {
      const d = await call('GET', '/api/method/frappe.desk.form.load.getdoctype', { query: { doctype: TRAVEL_REQUEST } });
      return summariseMeta(d?.docs || []);
    },
    purposes: () => list('Purpose of Travel', { fields: ['name'], limit: 200 }).then(r => r.map(x => x.name)),

    async travelRequests({ employee, employees, limit = 50 } = {}) {
      const filters = employee ? [['employee', '=', employee]] : employees ? [['employee', 'in', employees]] : [];
      const rows = await list(TRAVEL_REQUEST, { filters, fields: REQUEST_FIELDS, order_by: 'creation desc', limit });
      if (!rows.length) return [];
      let legs = [];
      try {
        legs = await list(ITINERARY, { parent: TRAVEL_REQUEST, filters: [['parent', 'in', rows.map(r => r.name)]], fields: LEG_FIELDS, limit: rows.length * 4 });
      } catch {
        // Some builds refuse child-table listing; fall back to one read per request.
        const docs = await Promise.all(rows.map(r => get(TRAVEL_REQUEST, r.name).catch(() => null)));
        legs = docs.flatMap(d => (d?.itinerary || []).map(l => ({ ...l, parent: d.name })));
      }
      return rows.map(r => ({ ...r, itinerary: legs.filter(l => l.parent === r.name).sort((a, b) => (a.idx || 0) - (b.idx || 0)) }));
    },
    travelRequest: name => get(TRAVEL_REQUEST, name),
    /** Employees whose ERP expense approver is this email. */
    employeesByApprover: email => list('Employee', { filters: [['expense_approver', '=', String(email || '').toLowerCase()], ['status', '=', 'Active']], fields: ['name'], limit: 200 }).then(r => r.map(x => x.name)),

    expenseTypes: () => list('Expense Claim Type', { fields: ['name'], limit: 200 }).then(r => r.map(x => x.name)),
    async expenseClaims({ employee, employees, limit = 100 } = {}) {
      const filters = employee ? [['employee', '=', employee]] : employees ? [['employee', 'in', employees]] : [];
      const rows = await list(EXPENSE_CLAIM, { filters, fields: CLAIM_FIELDS, order_by: 'creation desc', limit });
      if (!rows.length) return [];
      let details = [];
      try {
        details = await list(EXPENSE_DETAIL, { parent: EXPENSE_CLAIM, filters: [['parent', 'in', rows.map(r => r.name)]], fields: ['parent', 'idx', 'expense_date', 'expense_type', 'description', 'amount'], limit: rows.length * 6 });
      } catch {
        const docs = await Promise.all(rows.map(r => get(EXPENSE_CLAIM, r.name).catch(() => null)));
        details = docs.flatMap(d => (d?.expenses || []).map(x => ({ ...x, parent: d.name })));
      }
      return rows.map(r => ({ ...r, expenses: details.filter(d => d.parent === r.name) }));
    },
    expenseClaim: name => get(EXPENSE_CLAIM, name),
    createExpenseClaim: doc => call('POST', `/api/resource/${encodeURIComponent(EXPENSE_CLAIM)}`, { json: doc }).then(d => d?.data),
    updateExpenseClaim: (name, patch) => call('PUT', `/api/resource/${encodeURIComponent(EXPENSE_CLAIM)}/${encodeURIComponent(name)}`, { json: patch }).then(d => d?.data),
    deleteExpenseClaim: name => call('DELETE', `/api/resource/${encodeURIComponent(EXPENSE_CLAIM)}/${encodeURIComponent(name)}`),
    submitDoc: doc => call('POST', '/api/method/frappe.client.submit', { json: { doc } }).then(d => d?.message),
    /** Attach a bill to a claim as a private file. */
    async uploadBill(name, fileName, base64) {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const body = new FormData();
      body.append('file', new Blob([bytes]), fileName);
      body.append('doctype', EXPENSE_CLAIM);
      body.append('docname', name);
      body.append('is_private', '1');
      return call('POST', '/api/method/upload_file', { multipart: body }).then(d => d?.message);
    },
    addComment: (doctype, name, text) => call('POST', '/api/resource/Comment', { json: { doctype: 'Comment', comment_type: 'Comment', reference_doctype: doctype, reference_name: name, content: text } }),
    createTravelRequest: doc => call('POST', `/api/resource/${encodeURIComponent(TRAVEL_REQUEST)}`, { json: doc }).then(d => d?.data),
    applyWorkflow: (doc, action) =>
      call('POST', '/api/method/frappe.model.workflow.apply_workflow', { form: { doc: JSON.stringify(doc), action } }).then(d => d?.message)
  };
}

/** Reduce getdoctype docs to what the mapping needs. */
export function summariseMeta(docs) {
  const shape = dt => {
    const d = docs.find(x => x.name === dt);
    if (!d) return null;
    const fields = {};
    for (const f of d.fields || []) {
      fields[f.fieldname] = { type: f.fieldtype, reqd: Boolean(f.reqd), options: f.options || '', label: f.label || f.fieldname, default: f.default ?? null };
    }
    return { fields, isSubmittable: Boolean(d.is_submittable) };
  };
  const parent = shape(TRAVEL_REQUEST);
  if (!parent) throw new ErpError('ERP did not return the Travel Request DocType. Is HRMS installed on this site?', 502);
  const tableField = Object.entries(parent.fields).find(([, f]) => f.type === 'Table' && f.options === ITINERARY)?.[0] || null;
  return { parent, itinerary: shape(ITINERARY), itineraryField: tableField };
}

export const selectOptions = field => (field && field.type === 'Select' ? String(field.options || '').split('\n').map(s => s.trim()).filter(Boolean) : []);

/** Pick the option that best matches one of the wanted labels, case-insensitively. */
export function matchOption(options, wanted) {
  const lower = options.map(o => o.toLowerCase());
  for (const w of [].concat(wanted)) {
    const i = lower.indexOf(String(w).toLowerCase());
    if (i >= 0) return options[i];
  }
  for (const w of [].concat(wanted)) {
    const i = lower.findIndex(o => o.includes(String(w).toLowerCase()));
    if (i >= 0) return options[i];
  }
  return null;
}

const MODE_TO_ERP = { flight: ['Flight', 'Air'], train: ['Train', 'Rail'], bus: ['Bus'], car: ['Taxi', 'Car', 'Rented Car'], van: ['Rented Car', 'Taxi'], sea: ['Ship', 'Sea'] };
const ERP_TO_MODE = [[/flight|air/i, 'flight'], [/train|rail/i, 'train'], [/bus/i, 'bus'], [/taxi|car|cab/i, 'car'], [/ship|sea|ferry/i, 'sea']];
export const modeFromErp = v => ERP_TO_MODE.find(([re]) => re.test(String(v || '')))?.[1] || '';

const dt = (date, time) => (date ? `${date} ${/^\d{2}:\d{2}$/.test(time || '') ? time : '00:00'}:00` : undefined);
const clean = s => String(s ?? '').trim();

/** Plain-text summary written to the ERP request so the HOD sees the app's policy check in ERP. */
export function policyNote(request, policy) {
  const lines = ['Raised from ProRack Move.'];
  if (request.priority === 'emergency') lines.push('Priority: EMERGENCY.');
  if (Number(request.people) > 1) lines.push(`Travellers: ${request.people}.${request.roster ? ' Roster: ' + clean(request.roster) : ''}`);
  if (request.site) lines.push(`Project / site: ${clean(request.site)}.`);
  if (request.roundTripKm) lines.push(`Round-trip distance: ${request.roundTripKm} km.`);
  if (request.normalFare || request.quotedFare) lines.push(`Fare: normal ₹${request.normalFare || '—'}, quoted ₹${request.quotedFare || '—'}.`);
  if (request.arrangements) lines.push(`Arrangements requested (Travel Admin to book): ${clean(request.arrangements)}`);
  if (request.estimateTotal) lines.push(`Estimated expenses: ₹${clean(request.estimateTotal)} (limits from the proposed policy, not bills).`);
  if (request.notes) lines.push(`Notes: ${clean(request.notes)}`);
  if (policy) {
    lines.push('', `Policy check (${clean(policy.basis) || 'proposed policy, not in force'}):`);
    if (policy.grade) lines.push(`- Grade: ${clean(policy.grade)}`);
    for (const c of policy.checks || []) lines.push(`- [${clean(c.level)}] ${clean(c.message)} (${clean(c.rule)})`);
    if ((policy.approvals || []).length) lines.push(`- Approval route: ${policy.approvals.map(a => `${clean(a.role)} (${clean(a.reason)})`).join(' → ')}`);
  }
  return lines.join('\n').slice(0, 4000);
}

/**
 * Map an app request (wizard values) onto an ERP Travel Request using the live meta, so only
 * fields that exist are sent. Returns { doc, missing } where `missing` lists mandatory parent
 * fields that could not be filled.
 */
export function toErpTravelRequest(request, employee, meta, { purposes = [], policy, defaults = {} } = {}) {
  const f = meta.parent.fields;
  const doc = { doctype: TRAVEL_REQUEST, employee: employee.name };
  const has = n => Object.prototype.hasOwnProperty.call(f, n);
  if (has('company') && employee.company) doc.company = employee.company;
  if (has('travel_type')) {
    doc.travel_type = matchOption(selectOptions(f.travel_type), request.tripType === 'international' ? ['International'] : ['Domestic']) || undefined;
  }
  if (has('purpose_of_travel')) {
    doc.purpose_of_travel = purposes.includes(request.purpose) ? request.purpose : (matchOption(purposes, [request.purpose]) || undefined);
  }
  if (has('travel_funding')) {
    const opts = selectOptions(f.travel_funding);
    doc.travel_funding = (defaults.travelFunding && matchOption(opts, [defaults.travelFunding])) || f.travel_funding.default || opts[0] || undefined;
  }
  if (has('cell_number') && employee.cell_number) doc.cell_number = employee.cell_number;
  if (has('prefered_email') && (employee.company_email || employee.user_id)) doc.prefered_email = employee.company_email || employee.user_id;
  const note = policyNote(request, policy);
  if (has('description')) doc.description = note; else if (has('details')) doc.details = note;

  if (meta.itineraryField && meta.itinerary) {
    const cf = meta.itinerary.fields;
    const legHas = n => Object.prototype.hasOwnProperty.call(cf, n);
    const modeOpts = selectOptions(cf.mode_of_travel);
    const mode = request.preferredMode ? matchOption(modeOpts, MODE_TO_ERP[request.preferredMode] || [request.preferredMode]) : null;
    const leg = (from, to, depart, arrive) => {
      const row = {};
      if (legHas('travel_from')) row.travel_from = clean(from);
      if (legHas('travel_to')) row.travel_to = clean(to);
      if (legHas('mode_of_travel') && mode) row.mode_of_travel = mode;
      if (legHas('departure_date') && depart) row.departure_date = depart;
      if (legHas('arrival_date') && arrive) row.arrival_date = arrive;
      return row;
    };
    const rows = [leg(request.origin, request.destination, dt(request.departDate, request.departTime),
      dt(request.requiredArrivalDate || (request.requiredArrival ? request.departDate : ''), request.requiredArrival))];
    if (request.returnDate) rows.push(leg(request.destination, request.origin, dt(request.returnDate, request.returnTime), undefined));
    doc[meta.itineraryField] = rows;
  }
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  const missing = Object.entries(f)
    .filter(([n, x]) => x.reqd && !['Section Break', 'Column Break', 'Tab Break', 'Table'].includes(x.type) && (doc[n] === undefined || doc[n] === '') && x.default == null
      && !['naming_series', 'workflow_state', 'status', 'employee_name', 'amended_from'].includes(n))
    .map(([n, x]) => x.label || n);
  return { doc, missing };
}

const STATUS = [[/^draft$/i, 'draft'], [/pending|submitted|review/i, 'submitted'], [/approved/i, 'approved'], [/rejected/i, 'rejected'], [/cancel/i, 'cancelled']];
export function statusFromErp(r) {
  if (Number(r.docstatus) === 2) return 'cancelled';
  const s = clean(r.workflow_state);
  if (!s) return Number(r.docstatus) === 1 ? 'approved' : 'draft';
  return STATUS.find(([re]) => re.test(s))?.[1] || 'submitted';
}

const splitDt = v => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(v || ''));
  return m ? [m[1], m[2] || ''] : ['', ''];
};

/** Map an ERP Travel Request (with itinerary rows) into the app's request shape. */
export function fromErpTravelRequest(r, legsField = 'itinerary') {
  const legs = r[legsField] || r.itinerary || [];
  const out = legs[0] || {}, back = legs.length > 1 ? legs[legs.length - 1] : null;
  const [departDate, departTime] = splitDt(out.departure_date);
  const [arrDate, arrTime] = splitDt(out.arrival_date);
  const [returnDate, returnTime] = back ? splitDt(back.departure_date) : ['', ''];
  return {
    id: r.name, erpName: r.name, source: 'erp',
    userId: r.employee, employeeName: r.employee_name || r.employee,
    origin: out.travel_from || '—', destination: out.travel_to || '—',
    departDate, departTime, requiredArrivalDate: arrDate, requiredArrival: arrTime, returnDate, returnTime,
    tripType: /international/i.test(r.travel_type || '') ? 'international' : 'domestic',
    purpose: r.purpose_of_travel || 'Not specified', preferredMode: modeFromErp(out.mode_of_travel),
    people: 1, priority: /EMERGENCY/.test(r.description || '') ? 'emergency' : 'planned',
    notes: r.description || '', department: '', site: '',
    status: statusFromErp(r), workflowState: r.workflow_state || '',
    createdAt: String(r.creation || '').replace(' ', 'T'), planId: null, roster: '', flexibility: ''
  };
}

/** Shape the signed-in employee for the frontend. */
export function publicEmployee(e, { isAdmin = false } = {}) {
  return {
    id: e.name, employeeId: e.name, name: e.employee_name || e.name,
    first: e.first_name || String(e.employee_name || e.name).split(' ')[0],
    email: e.company_email || e.user_id || '', designation: e.designation || '', department: e.department || '',
    erpGrade: e.grade || '', company: e.company || '', branch: e.branch || '', location: e.branch || '',
    expenseApprover: e.expense_approver || '', reportsTo: e.reports_to || '', isAdmin
  };
}
