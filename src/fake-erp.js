/**
 * A small in-memory stand-in for the ERPNext REST API, used by the unit tests and by
 * `npm run dev:erp` (local ERP-mode preview without touching ERP UAT).
 * It mimics the Frappe responses ProRack Move uses; it is not a complete Frappe server.
 */
const TR_META = {
  name: 'Travel Request', is_submittable: 1, fields: [
    { fieldname: 'travel_type', fieldtype: 'Select', options: '\nDomestic\nInternational', label: 'Travel Type' },
    { fieldname: 'travel_funding', fieldtype: 'Select', options: '\nRequire Full Funding\nFully Sponsored\nPartially Sponsored, Require Partial Funding', label: 'Travel Funding' },
    { fieldname: 'purpose_of_travel', fieldtype: 'Link', options: 'Purpose of Travel', label: 'Purpose of Travel' },
    { fieldname: 'employee', fieldtype: 'Link', options: 'Employee', reqd: 1, label: 'Employee' },
    { fieldname: 'employee_name', fieldtype: 'Data', label: 'Employee Name' },
    { fieldname: 'company', fieldtype: 'Link', options: 'Company', label: 'Company' },
    { fieldname: 'cell_number', fieldtype: 'Data', label: 'Contact Number' },
    { fieldname: 'prefered_email', fieldtype: 'Data', label: 'Contact Email' },
    { fieldname: 'description', fieldtype: 'Small Text', label: 'Any other details' },
    { fieldname: 'itinerary', fieldtype: 'Table', options: 'Travel Itinerary', label: 'Itinerary' },
    { fieldname: 'workflow_state', fieldtype: 'Link', options: 'Workflow State', label: 'Workflow State' }
  ]
};
const LEG_META = {
  name: 'Travel Itinerary', fields: [
    { fieldname: 'travel_from', fieldtype: 'Data', label: 'Travel From' },
    { fieldname: 'travel_to', fieldtype: 'Data', label: 'Travel To' },
    { fieldname: 'mode_of_travel', fieldtype: 'Select', options: 'Flight\nTrain\nTaxi\nRented Car', label: 'Mode of Travel' },
    { fieldname: 'departure_date', fieldtype: 'Datetime', label: 'Departure Datetime' },
    { fieldname: 'arrival_date', fieldtype: 'Datetime', label: 'Arrival Datetime' }
  ]
};

export function createFakeErp({ key = 'k', secret = 's', failWorkflow = false } = {}) {
  const state = {
    employees: [
      { name: 'HR-EMP-00001', employee_name: 'Priya Sharma', first_name: 'Priya', designation: 'Sales Project Manager', department: 'Sales - PSSIPL', grade: 'Manager to DGM', company: 'Prorack Storage Solutions India Private Limited', user_id: 'priya.sharma@prorackglobal.com', company_email: 'priya.sharma@prorackglobal.com', cell_number: '9000000001', branch: 'Hyderabad', expense_approver: 'hod.sales@prorackglobal.com', reports_to: 'HR-EMP-00003', status: 'Active' },
      { name: 'HR-EMP-00002', employee_name: 'Aarav Reddy', first_name: 'Aarav', designation: 'Engineer', department: 'Engineering - PSSIPL', grade: 'Jr Executive to Dy Manager', company: 'Prorack Storage Solutions India Private Limited', user_id: 'aarav.reddy@prorackglobal.com', company_email: '', cell_number: '', branch: 'Hyderabad', expense_approver: 'hod.eng@prorackglobal.com', reports_to: '', status: 'Active' },
      { name: 'HR-EMP-00009', employee_name: 'Left Employee', first_name: 'Left', designation: 'Engineer', grade: '', company: 'Prorack Storage Solutions India Private Limited', user_id: 'left@prorackglobal.com', status: 'Left' }
    ],
    purposes: ['Customer Visit', 'Site Visit', 'Vendor Visit', 'Training / Conference'],
    requests: [], seq: 41, calls: []
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pick = (row, fields) => fields ? Object.fromEntries(fields.filter(f => !f.includes('.')).map(f => [f, row[f] ?? null])) : row;
  const match = (row, filters = []) => filters.every(([f, op, v]) => op === '=' ? String(row[f] ?? '').toLowerCase() === String(v).toLowerCase() : op === 'in' ? v.includes(row[f]) : true);

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    state.calls.push(`${method} ${decodeURIComponent(url.pathname)}`);
    if (init.headers?.Authorization !== `token ${key}:${secret}`) return reply(401, { exc_type: 'AuthenticationError', message: 'Invalid API key' });
    const q = k => { const v = url.searchParams.get(k); try { return v ? JSON.parse(v) : undefined; } catch { return v; } };
    const p = decodeURIComponent(url.pathname);
    if (p === '/api/method/frappe.auth.get_logged_user') return reply(200, { message: 'api.travel@prorackglobal.com' });
    if (p === '/api/method/frappe.desk.form.load.getdoctype') return reply(200, { docs: [TR_META, LEG_META] });
    if (p === '/api/resource/Purpose of Travel') return reply(200, { data: state.purposes.map(name => ({ name })) });
    if (p === '/api/resource/Employee') return reply(200, { data: state.employees.filter(e => match(e, q('filters'))).map(e => pick(e, q('fields'))) });
    if (p.startsWith('/api/resource/Employee/')) {
      const e = state.employees.find(x => x.name === p.split('/').pop());
      return e ? reply(200, { data: e }) : reply(404, { exc_type: 'DoesNotExistError' });
    }
    if (p === '/api/resource/Travel Request' && method === 'GET') {
      const rows = state.requests.filter(r => match(r, q('filters'))).sort((a, b) => b.creation.localeCompare(a.creation));
      return reply(200, { data: rows.map(r => pick(r, q('fields'))) });
    }
    if (p === '/api/resource/Travel Itinerary') {
      if (url.searchParams.get('parent') !== 'Travel Request') return reply(403, { exc_type: 'PermissionError' });
      const names = (q('filters') || []).find(f => f[0] === 'parent')?.[2] || [];
      return reply(200, { data: state.requests.filter(r => names.includes(r.name)).flatMap(r => r.itinerary.map((l, i) => ({ ...l, parent: r.name, idx: i + 1 }))) });
    }
    if (p === '/api/resource/Travel Request' && method === 'POST') {
      const doc = JSON.parse(init.body);
      const emp = state.employees.find(e => e.name === doc.employee);
      if (!emp) return reply(417, { _server_messages: JSON.stringify([JSON.stringify({ message: 'Employee not found' })]) });
      const row = { ...doc, name: `HR-TRQ-2026-${String(++state.seq).padStart(5, '0')}`, employee_name: emp.employee_name, workflow_state: 'Draft', docstatus: 0, creation: new Date(Date.now() + state.seq).toISOString().replace('T', ' ').slice(0, 19), itinerary: doc.itinerary || [] };
      state.requests.push(row);
      return reply(200, { data: row });
    }
    if (p.startsWith('/api/resource/Travel Request/')) {
      const r = state.requests.find(x => x.name === p.split('/').pop());
      return r ? reply(200, { data: r }) : reply(404, { exc_type: 'DoesNotExistError', message: 'Not found' });
    }
    if (p === '/api/method/frappe.model.workflow.apply_workflow') {
      const form = new URLSearchParams(init.body);
      const doc = JSON.parse(form.get('doc'));
      if (failWorkflow) return reply(417, { _server_messages: JSON.stringify([JSON.stringify({ message: 'Not a valid Workflow Action' })]) });
      const r = state.requests.find(x => x.name === doc.name);
      if (form.get('action') === 'Submit for Approval') r.workflow_state = 'Pending HOD Approval';
      return reply(200, { message: r });
    }
    return reply(404, { exc_type: 'DoesNotExistError', message: `fake ERP has no route for ${method} ${p}` });
  }
  return { fetch: fetchImpl, state };
}

/** In-memory replacement for the Convex session tables. */
export function memoryStore() {
  const states = new Map(), sessions = new Map();
  return {
    saveState: async a => { states.set(a.state, a); },
    takeState: async ({ state }) => { const r = states.get(state); states.delete(state); return r && r.expiresAt > Date.now() ? r.verifier : null; },
    createSession: async a => { sessions.set(a.tokenHash, a); },
    getSession: async h => { const s = sessions.get(h); return s && s.expiresAt > Date.now() ? s : null; },
    deleteSession: async ({ tokenHash }) => { sessions.delete(tokenHash); },
    sessions
  };
}
