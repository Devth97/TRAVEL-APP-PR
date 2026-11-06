/**
 * The /api surface of ProRack Move, as one pure request handler.
 * Convex (convex/http.ts), the unit tests and the local mock server all call handleApi with their
 * own `deps`, so the routing and checks are identical everywhere.
 *
 * deps = {
 *   env,                                    // environment variables
 *   erp,                                    // createErpClient(env, fetch)
 *   store: { saveState, takeState, createSession, getSession, deleteSession },
 *   fetch,                                  // for the Microsoft token call
 *   now                                     // () => ms
 * }
 */
import { APPROVE_ACTION, ErpError, REJECT_ACTION, TRAVEL_REQUEST, fromErpTravelRequest, matchOption, publicEmployee, selectOptions, toErpTravelRequest, SUBMIT_ACTION, erpConfig } from './erp.js';
import { BILL_EXTENSIONS, BILL_MAX_BYTES, buildRemark, canDecide, expenseStatus, fromErpExpenseClaim, normaliseExpense, parseRemark, toErpExpenseClaim } from './expenses.js';
import {
  SESSION_COOKIE, SESSION_HOURS, STATE_MINUTES, adminEmails, authorizeUrl, clearSessionCookie, emailFromClaims, exchangeCode,
  microsoftConfig, parseCookies, randomToken, safeEqual, sessionCookie, sha256Hex, appBaseUrl
} from './auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
const fail = (status, error, extra = {}) => json(status, { error, ...extra });
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', ...headers } });
const CSRF_HEADER = 'x-prorack-move';

export const ROUTES = [
  ['GET', '/api/auth/config'], ['GET', '/api/auth/microsoft'], ['GET', '/api/auth/callback'],
  ['POST', '/api/auth/passcode'], ['POST', '/api/auth/logout'], ['GET', '/api/me'], ['GET', '/api/lookups'],
  ['GET', '/api/travel-requests'], ['POST', '/api/travel-requests'], ['GET', '/api/health'],
  ['GET', '/api/expenses'], ['POST', '/api/expenses'], ['POST', '/api/expenses/send'], ['POST', '/api/expenses/delete'], ['POST', '/api/expenses/bill'],
  ['POST', '/api/expenses/decide'], ['GET', '/api/approvals'], ['POST', '/api/approvals/travel']
];
export const PREFIX_ROUTES = [['GET', '/api/travel-requests/']];

async function currentSession(request, deps) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  return deps.store.getSession(await sha256Hex(token));
}

async function startSession(deps, { email, employeeId, method }) {
  const token = randomToken();
  await deps.store.createSession({ tokenHash: await sha256Hex(token), email, employeeId, method, expiresAt: deps.now() + SESSION_HOURS * 3600 * 1000 });
  return sessionCookie(token);
}

/** Today's date in India, so an expense dated "today" is never refused as future around midnight UTC. */
const istToday = now => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const ownClaim = async (erp, name, session) => {
  const doc = await erp.expenseClaim(String(name || ''));
  if (!doc) throw new ErpError('Expense not found.', 404);
  if (doc.employee !== session.employeeId) throw new ErpError('That expense belongs to someone else.', 403);
  return doc;
};
/** Write app data back onto a claim's remark without losing what is already there. */
const withMeta = (doc, changes) => {
  const { summary, meta } = parseRemark(doc.remark);
  return buildRemark(summary, { ...meta, ...changes });
};

function errorResponse(e) {
  if (e instanceof ErpError) return fail(e.status, e.message);
  return fail(500, 'Something went wrong in ProRack Move.', { detail: String(e?.message || e).slice(0, 300) });
}

export async function handleApi(request, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const { env, erp } = deps;
  try {
    if (method === 'POST' && request.headers.get(CSRF_HEADER) !== '1') return fail(403, 'Missing request header.');

    // ---- public ----
    if (method === 'GET' && path === '/api/auth/config') {
      const ms = microsoftConfig(env);
      return json(200, {
        mode: 'erp', microsoft: ms.configured, uatPasscode: Boolean(env.UAT_LOGIN_PASSCODE),
        erpConfigured: erpConfig(env).configured, erpDeskUrl: erpConfig(env).base, environment: env.APP_ENVIRONMENT || 'UAT'
      });
    }
    if (method === 'GET' && path === '/api/health') {
      const out = { erpConfigured: erpConfig(env).configured, microsoftConfigured: microsoftConfig(env).configured, redirectUri: microsoftConfig(env).redirectUri };
      if (out.erpConfigured) {
        try { out.erpUser = await erp.ping(); out.erpReachable = true; } catch (e) { out.erpReachable = false; out.erpError = e.message; }
      }
      return json(200, out);
    }
    if (method === 'GET' && path === '/api/auth/microsoft') {
      if (!microsoftConfig(env).configured) return redirect('/?error=' + encodeURIComponent('Microsoft sign-in is not configured yet.'));
      const state = randomToken(18), verifier = randomToken(48);
      await deps.store.saveState({ state, verifier, expiresAt: deps.now() + STATE_MINUTES * 60 * 1000 });
      return redirect(await authorizeUrl(env, { state, verifier }));
    }
    if (method === 'GET' && path === '/api/auth/callback') {
      const back = msg => redirect('/?error=' + encodeURIComponent(msg));
      if (url.searchParams.get('error')) return back(url.searchParams.get('error_description') || 'Microsoft sign-in was cancelled.');
      const code = url.searchParams.get('code'), state = url.searchParams.get('state');
      if (!code || !state) return back('Sign-in response was incomplete.');
      const verifier = await deps.store.takeState({ state });
      if (!verifier) return back('Sign-in expired. Please try again.');
      let email;
      try { email = emailFromClaims(await exchangeCode(env, { code, verifier }, deps.fetch)); }
      catch (e) { return back(e.message); }
      let employee;
      try { employee = await erp.employeeByEmail(email); } catch (e) { return back(`ERP could not be reached: ${e.message}`); }
      if (!employee) return back(`No active ERP employee record is linked to ${email}. Ask HR to set it as the employee's User ID or company email.`);
      return redirect(appBaseUrl(env) + '/', { 'Set-Cookie': await startSession(deps, { email, employeeId: employee.name, method: 'microsoft' }) });
    }
    if (method === 'POST' && path === '/api/auth/passcode') {
      const expected = String(env.UAT_LOGIN_PASSCODE || '');
      if (expected.length < 8) return fail(404, 'Passcode sign-in is not enabled.');
      const body = await request.json().catch(() => ({}));
      const email = String(body.email || '').trim().toLowerCase();
      if (!safeEqual(String(body.passcode || ''), expected)) return fail(401, 'Incorrect passcode.');
      const employee = await erp.employeeByEmail(email);
      if (!employee) return fail(404, `No active ERP employee record is linked to ${email || 'that email'}.`);
      return json(200, { ok: true }, { 'Set-Cookie': await startSession(deps, { email, employeeId: employee.name, method: 'uat-passcode' }) });
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
      if (token) await deps.store.deleteSession({ tokenHash: await sha256Hex(token) });
      return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }

    // ---- signed in ----
    const session = await currentSession(request, deps);
    if (!session) return fail(401, 'Please sign in.');
    const isAdmin = adminEmails(env).includes(session.email.toLowerCase());

    if (method === 'GET' && path === '/api/me') {
      const e = await erp.employee(session.employeeId);
      if (!e || (e.status && e.status !== 'Active')) return fail(403, 'Your ERP employee record is not active.');
      return json(200, { employee: publicEmployee(e, { isAdmin }), signedInWith: session.method });
    }
    if (method === 'GET' && path === '/api/lookups') {
      const [meta, purposes] = await Promise.all([erp.travelMeta(), erp.purposes()]);
      const leg = meta.itinerary?.fields || {};
      return json(200, {
        purposes, travelTypes: selectOptions(meta.parent.fields.travel_type), travelFunding: selectOptions(meta.parent.fields.travel_funding),
        modes: selectOptions(leg.mode_of_travel), itinerary: Boolean(meta.itineraryField),
        mandatory: Object.entries(meta.parent.fields).filter(([, f]) => f.reqd).map(([n, f]) => ({ field: n, label: f.label }))
      });
    }
    if (method === 'GET' && path === '/api/travel-requests') {
      const all = url.searchParams.get('scope') === 'all';
      if (all && !isAdmin) return fail(403, 'Only Travel Admins can see all requests.');
      const rows = await erp.travelRequests({ employee: all ? undefined : session.employeeId, limit: all ? 100 : 50 });
      return json(200, { requests: rows.map(r => fromErpTravelRequest(r)) });
    }
    if (method === 'GET' && path.startsWith('/api/travel-requests/')) {
      const name = decodeURIComponent(path.slice('/api/travel-requests/'.length));
      const doc = await erp.travelRequest(name);
      if (!doc) return fail(404, 'Travel request not found.');
      if (doc.employee !== session.employeeId && !isAdmin) return fail(403, 'That travel request belongs to someone else.');
      return json(200, { request: fromErpTravelRequest(doc) });
    }
    if (method === 'POST' && path === '/api/travel-requests') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.request !== 'object') return fail(400, 'Missing travel request details.');
      const r = body.request;
      if (!String(r.origin || '').trim() || !String(r.destination || '').trim() || !r.departDate) return fail(400, 'Origin, destination and departure date are required.');
      const employee = await erp.employee(session.employeeId);
      const [meta, purposes] = await Promise.all([erp.travelMeta(), erp.purposes()]);
      const { doc, missing } = toErpTravelRequest(r, employee, meta, { purposes, policy: body.policy, defaults: { travelFunding: env.ERP_TRAVEL_FUNDING } });
      if (missing.length) return fail(400, `ERP needs these fields before it will accept the request: ${missing.join(', ')}.`, { missing });
      const created = await erp.createTravelRequest(doc);
      let submitted = false, warning = '';
      if (body.submit) {
        try {
          const after = await erp.applyWorkflow(created, SUBMIT_ACTION);
          if (after) Object.assign(created, { workflow_state: after.workflow_state, docstatus: after.docstatus });
          submitted = true;
        } catch (e) {
          warning = `Saved in ERP as ${created.name} (Draft), but "${SUBMIT_ACTION}" failed: ${e.message}`;
        }
      }
      return json(201, { request: fromErpTravelRequest(created), submitted, warning });
    }

    // ---- expenses (ERP Expense Claim) ----
    if (method === 'GET' && path === '/api/expenses') {
      const rows = await erp.expenseClaims({ employee: session.employeeId });
      return json(200, { expenses: rows.map(fromErpExpenseClaim).filter(e => e.status !== 'cancelled') });
    }
    if (method === 'POST' && path === '/api/expenses') {
      const body = await request.json().catch(() => null);
      let expense;
      try { expense = normaliseExpense(body?.expense, { today: istToday(deps.now()) }); } catch (e) { return fail(400, e.message); }
      const [employee, erpTypes] = await Promise.all([erp.employee(session.employeeId), erp.expenseTypes()]);
      const { doc, missing } = toErpExpenseClaim(expense, employee, { erpTypes, match: matchOption });
      if (missing.length) return fail(400, `ERP has no Expense Claim Type for: ${missing.join(', ')}. Ask HR to add it.`, { missing });
      const created = await erp.createExpenseClaim(doc);
      return json(201, { expense: fromErpExpenseClaim(created) });
    }
    if (method === 'POST' && path === '/api/expenses/bill') {
      const body = await request.json().catch(() => ({}));
      const fileName = String(body.fileName || '').replace(/[\\/]/g, '').slice(0, 120), data = String(body.data || '');
      if (!BILL_EXTENSIONS.test(fileName)) return fail(400, 'Bills must be JPG, PNG or PDF files.');
      if (!data || data.length * 0.75 > BILL_MAX_BYTES) return fail(400, 'Bills must be 4 MB or smaller.');
      const doc = await ownClaim(erp, body.name, session);
      if (!['ready', 'estimate'].includes(expenseStatus(doc))) return fail(409, 'Bills can only be added before an expense is sent for approval.');
      await erp.uploadBill(doc.name, fileName, data);
      const updated = await erp.updateExpenseClaim(doc.name, { remark: withMeta(doc, { billName: fileName }) });
      return json(200, { expense: fromErpExpenseClaim(updated) });
    }
    if (method === 'POST' && path === '/api/expenses/delete') {
      const body = await request.json().catch(() => ({}));
      const doc = await ownClaim(erp, body.name, session);
      if (!['ready', 'estimate'].includes(expenseStatus(doc))) return fail(409, 'Only expenses that have not been sent for approval can be deleted.');
      await erp.deleteExpenseClaim(doc.name);
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/expenses/send') {
      const body = await request.json().catch(() => ({}));
      const names = Array.isArray(body.names) ? [...new Set(body.names.map(String))].slice(0, 50) : [];
      if (!names.length) return fail(400, 'Select at least one expense.');
      const docs = await Promise.all(names.map(n => ownClaim(erp, n, session)));
      for (const doc of docs) {
        const e = fromErpExpenseClaim(doc);
        if (e.status === 'estimate') return fail(400, `${doc.name} is an estimate. Add your actual expenses with bills instead.`);
        if (e.status !== 'ready') return fail(409, `${doc.name} has already been sent for approval.`);
        if (e.needsBill) return fail(400, `${doc.name} needs a bill before it can be sent for approval.`);
      }
      const report = `RPT-${istToday(deps.now()).replaceAll('-', '')}-${randomToken(6).replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`;
      const sent = [];
      for (const doc of docs) sent.push(await erp.updateExpenseClaim(doc.name, { remark: withMeta(doc, { status: 'pending', report }) }));
      return json(200, { report, expenses: sent.map(fromErpExpenseClaim) });
    }

    // ---- approvals ----
    if (method === 'GET' && path === '/api/approvals') {
      const adminAll = isAdmin && String(env.ADMIN_CAN_APPROVE || '') === '1';
      const employees = adminAll ? undefined : await erp.employeesByApprover(session.email);
      if (employees && !employees.length) return json(200, { travel: [], expenses: [] });
      const [claims, trips] = await Promise.all([erp.expenseClaims({ employees }), erp.travelRequests({ employees, limit: 100 })]);
      const others = r => r.employee !== session.employeeId;
      return json(200, {
        expenses: claims.filter(others).map(fromErpExpenseClaim).filter(e => ['pending', 'approved', 'rejected'].includes(e.status)),
        travel: trips.filter(others).map(r => fromErpTravelRequest(r)).filter(r => ['submitted', 'approved', 'rejected'].includes(r.status))
      });
    }
    if (method === 'POST' && (path === '/api/expenses/decide' || path === '/api/approvals/travel')) {
      const body = await request.json().catch(() => ({}));
      const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : '';
      const note = String(body.note || '').trim().slice(0, 300);
      if (!decision) return fail(400, 'Choose approve or reject.');
      if (decision === 'reject' && note.length < 3) return fail(400, 'Give a reason for rejecting.');
      const isExpense = path === '/api/expenses/decide';
      const doc = await (isExpense ? erp.expenseClaim(String(body.name || '')) : erp.travelRequest(String(body.name || '')));
      if (!doc) return fail(404, 'Not found.');
      const requester = await erp.employee(doc.employee);
      if (!canDecide({ session, requester, isAdmin, env })) return fail(403, 'You are not the approver for this request.');
      const by = `${decision === 'approve' ? 'Approved' : 'Rejected'} in ProRack Move by ${session.email}${note ? `: ${note}` : ''}`;
      if (isExpense) {
        if (expenseStatus(doc) !== 'pending') return fail(409, 'This expense is not waiting for approval.');
        const updated = await erp.updateExpenseClaim(doc.name, {
          approval_status: decision === 'approve' ? 'Approved' : 'Rejected',
          remark: withMeta(doc, { status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: session.email, decisionNote: note })
        });
        await erp.submitDoc(updated);
        return json(200, { expense: fromErpExpenseClaim(await erp.expenseClaim(doc.name)) });
      }
      if (fromErpTravelRequest(doc).status !== 'submitted') return fail(409, 'This travel request is not waiting for approval.');
      await erp.applyWorkflow(doc, decision === 'approve' ? APPROVE_ACTION : REJECT_ACTION);
      let warning = '';
      try { await erp.addComment(TRAVEL_REQUEST, doc.name, by); } catch (err) { warning = `Decision saved, but the note could not be added in ERP: ${err.message}`; }
      return json(200, { request: fromErpTravelRequest(await erp.travelRequest(doc.name)), warning });
    }
    return fail(404, 'Not found.');
  } catch (e) {
    return errorResponse(e);
  }
}
