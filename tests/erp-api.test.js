import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../convex/lib/api.js';
import { createErpClient, toErpTravelRequest, fromErpTravelRequest, statusFromErp, summariseMeta, matchOption, frappeMessage } from '../convex/lib/erp.js';
import { checkClaims, decodeJwtPayload, parseCookies, safeEqual, pkceChallenge } from '../convex/lib/auth.js';
import { createFakeErp, memoryStore } from '../src/fake-erp.js';

const BASE = 'https://happy-otter-123.convex.site';
const ENV = {
  ERP_BASE_URL: 'https://erpuat.prorackglobal.com/', ERP_API_KEY: 'k', ERP_API_SECRET: 's', CONVEX_SITE_URL: BASE,
  UAT_LOGIN_PASSCODE: 'uat-pass-2026', TRAVEL_ADMIN_EMAILS: 'aarav.reddy@prorackglobal.com',
  MS_TENANT_ID: 'tenant-1', MS_CLIENT_ID: 'client-1', MS_CLIENT_SECRET: 'secret-1'
};

function setup({ env = ENV, failWorkflow = false, msFetch } = {}) {
  const fake = createFakeErp({ failWorkflow });
  const store = memoryStore();
  const deps = { env, erp: createErpClient(env, fake.fetch), store, fetch: msFetch || fake.fetch, now: () => Date.now() };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = new Headers({ ...headers });
    if (cookie) h.set('cookie', cookie);
    if (method === 'POST' && !('x-prorack-move' in headers)) h.set('x-prorack-move', '1');
    if (body !== undefined) h.set('content-type', 'application/json');
    const res = await handleApi(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const login = email => call('POST', '/api/auth/passcode', { email, passcode: 'uat-pass-2026' });
  return { fake, store, call, login, clearCookie: () => { cookie = ''; } };
}

const REQ = { tripType: 'domestic', purpose: 'Customer Visit', origin: 'Hyderabad', destination: 'Bengaluru', departDate: '2026-11-20', departTime: '06:00',
  returnDate: '2026-11-22', returnTime: '19:00', preferredMode: 'flight', people: '1', notes: 'Quarterly review', roundTripKm: '1140', normalFare: '5000', quotedFare: '5750' };
const POLICY = { basis: 'Proposed Travel Policy v1.0, not in force', grade: 'ERP: Manager to DGM · Policy: provisional',
  checks: [{ level: 'approval', rule: 'TP 18.10', message: 'Quoted fare is 15% above the normal fare.' }],
  approvals: [{ role: 'HOD', reason: 'Tour sanction' }, { role: 'ED / Dy. ED / HOD', reason: 'Fare 15%+ above normal' }] };

test('config is public and reports what is configured, without secrets', async () => {
  const { call } = setup();
  const r = await call('GET', '/api/auth/config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { mode: 'erp', microsoft: true, uatPasscode: true, erpConfigured: true, erpDeskUrl: 'https://erpuat.prorackglobal.com', environment: 'UAT' });
  assert.ok(!JSON.stringify(r.body).includes('secret-1'));
});

test('signed-out calls are refused and POSTs need the custom header', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/travel-requests')).status, 401);
  assert.equal((await call('POST', '/api/auth/passcode', { email: 'x', passcode: 'y' }, { 'x-prorack-move': '0' })).status, 403);
});

test('UAT passcode sign-in: wrong passcode, unknown email, inactive employee, then success with a secure cookie', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/auth/passcode', { email: 'priya.sharma@prorackglobal.com', passcode: 'nope' })).status, 401);
  assert.equal((await s.login('nobody@prorackglobal.com')).status, 404);
  assert.equal((await s.login('left@prorackglobal.com')).status, 404, 'only Active employees');
  const ok = await s.login('Priya.Sharma@prorackglobal.com');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /pm_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200/);
  const [stored] = [...s.store.sessions.values()];
  assert.equal(stored.employeeId, 'HR-EMP-00001');
  assert.ok(!JSON.stringify(stored).includes(ok.headers.get('set-cookie').split('=')[1].split(';')[0]), 'only the token hash is stored');
});

test('passcode sign-in is off unless a passcode of 8+ characters is set', async () => {
  const s = setup({ env: { ...ENV, UAT_LOGIN_PASSCODE: 'short' } });
  assert.equal((await s.login('priya.sharma@prorackglobal.com')).status, 404);
});

test('/api/me returns the ERP employee with the ERP grade; admin flag comes from TRAVEL_ADMIN_EMAILS', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const me = (await s.call('GET', '/api/me')).body.employee;
  assert.equal(me.erpGrade, 'Manager to DGM');
  assert.equal(me.designation, 'Sales Project Manager');
  assert.equal(me.isAdmin, false);
  s.clearCookie();
  await s.login('aarav.reddy@prorackglobal.com');
  assert.equal((await s.call('GET', '/api/me')).body.employee.isAdmin, true);
});

test('lookups come from ERP meta and the Purpose of Travel list', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const l = (await s.call('GET', '/api/lookups')).body;
  assert.deepEqual(l.purposes, ['Customer Visit', 'Site Visit', 'Vendor Visit', 'Training / Conference']);
  assert.deepEqual(l.travelTypes, ['Domestic', 'International']);
  assert.deepEqual(l.modes, ['Flight', 'Train', 'Taxi', 'Rented Car']);
});

test('creating a request writes it to ERP, submits it for HOD approval and records the policy check', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const r = await s.call('POST', '/api/travel-requests', { request: REQ, policy: POLICY, submit: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.submitted, true);
  assert.equal(r.body.request.status, 'submitted');
  assert.equal(r.body.request.workflowState, 'Pending HOD Approval');
  const doc = s.fake.state.requests[0];
  assert.equal(doc.employee, 'HR-EMP-00001');
  assert.equal(doc.travel_type, 'Domestic');
  assert.equal(doc.purpose_of_travel, 'Customer Visit');
  assert.equal(doc.travel_funding, 'Require Full Funding');
  assert.equal(doc.company, 'Prorack Storage Solutions India Private Limited');
  assert.deepEqual(doc.itinerary, [
    { travel_from: 'Hyderabad', travel_to: 'Bengaluru', mode_of_travel: 'Flight', departure_date: '2026-11-20 06:00:00' },
    { travel_from: 'Bengaluru', travel_to: 'Hyderabad', mode_of_travel: 'Flight', departure_date: '2026-11-22 19:00:00' }
  ]);
  assert.match(doc.description, /Policy check \(Proposed Travel Policy v1\.0, not in force\)/);
  assert.match(doc.description, /\[approval\] Quoted fare is 15% above/);
  assert.match(doc.description, /Round-trip distance: 1140 km/);
  assert.ok(s.fake.state.calls.includes('POST /api/method/frappe.model.workflow.apply_workflow'));
});

test('a draft is saved without the workflow call; a failed workflow keeps the ERP draft and warns', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const draft = await s.call('POST', '/api/travel-requests', { request: REQ, submit: false });
  assert.equal(draft.body.request.status, 'draft');
  assert.ok(!s.fake.state.calls.includes('POST /api/method/frappe.model.workflow.apply_workflow'));
  const f = setup({ failWorkflow: true });
  await f.login('priya.sharma@prorackglobal.com');
  const r = await f.call('POST', '/api/travel-requests', { request: REQ, submit: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.submitted, false);
  assert.match(r.body.warning, /Saved in ERP as HR-TRQ-2026-\d+ \(Draft\), but "Submit for Approval" failed: Not a valid Workflow Action/);
});

test('incomplete requests are refused before reaching ERP', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const r = await s.call('POST', '/api/travel-requests', { request: { ...REQ, destination: ' ' }, submit: true });
  assert.equal(r.status, 400);
  assert.equal(s.fake.state.requests.length, 0);
});

test('employees see only their own requests; admins can list all; detail is permission-checked', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  const mine = (await s.call('POST', '/api/travel-requests', { request: REQ, submit: true })).body.request;
  const list = (await s.call('GET', '/api/travel-requests')).body.requests;
  assert.equal(list.length, 1);
  assert.equal(list[0].origin, 'Hyderabad');
  assert.equal(list[0].returnDate, '2026-11-22');
  assert.equal((await s.call('GET', '/api/travel-requests?scope=all')).status, 403);
  s.clearCookie();
  await s.login('aarav.reddy@prorackglobal.com');
  assert.equal((await s.call('GET', '/api/travel-requests')).body.requests.length, 0);
  assert.equal((await s.call('GET', '/api/travel-requests?scope=all')).body.requests.length, 1);
  assert.equal((await s.call('GET', `/api/travel-requests/${encodeURIComponent(mine.id)}`)).status, 200, 'admin may open it');
  const other = setup();
  other.fake.state.requests.push(...s.fake.state.requests);
  await other.login('priya.sharma@prorackglobal.com');
  assert.equal((await other.call('GET', `/api/travel-requests/${encodeURIComponent(mine.id)}`)).status, 200);
});

test('logout deletes the session', async () => {
  const s = setup();
  await s.login('priya.sharma@prorackglobal.com');
  assert.equal(s.store.sessions.size, 1);
  await s.call('POST', '/api/auth/logout', {});
  assert.equal(s.store.sessions.size, 0);
  assert.equal((await s.call('GET', '/api/me')).status, 401);
});

test('ERP not configured gives a clear 503, not a crash', async () => {
  const s = setup({ env: { ...ENV, ERP_API_SECRET: '' } });
  assert.equal((await s.login('priya.sharma@prorackglobal.com')).status, 503);
  assert.equal((await s.call('GET', '/api/health')).body.erpConfigured, false);
});

/* ---------- Microsoft sign-in ---------- */

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = claims => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

test('Microsoft sign-in: redirect with PKCE, callback exchanges the code and starts a session', async () => {
  const claims = { aud: 'client-1', tid: 'tenant-1', iss: 'https://login.microsoftonline.com/tenant-1/v2.0', exp: Math.floor(Date.now() / 1000) + 600, preferred_username: 'Priya.Sharma@prorackglobal.com' };
  let tokenBody = null;
  const fake = createFakeErp();
  const msFetch = async (url, init) => {
    if (String(url).includes('/oauth2/v2.0/token')) { tokenBody = new URLSearchParams(init.body); return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 }); }
    return fake.fetch(url, init);
  };
  const s = setup({ msFetch });
  const start = await s.call('GET', '/api/auth/microsoft');
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
  assert.equal(auth.searchParams.get('redirect_uri'), `${BASE}/api/auth/callback`);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const state = auth.searchParams.get('state');
  const cb = await s.call('GET', `/api/auth/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), `${BASE}/`);
  assert.equal(await pkceChallenge(tokenBody.get('code_verifier')), auth.searchParams.get('code_challenge'));
  assert.equal(tokenBody.get('client_secret'), 'secret-1');
  assert.equal((await s.call('GET', '/api/me')).body.employee.name, 'Priya Sharma');
  const replay = await s.call('GET', `/api/auth/callback?code=abc&state=${state}`);
  assert.match(replay.headers.get('location'), /error=Sign-in%20expired/, 'state is single-use');
});

test('ID token checks reject other apps, other tenants, odd issuers and expired tokens', () => {
  const ms = { clientId: 'client-1', tenant: 'tenant-1' };
  const ok = { aud: 'client-1', tid: 'tenant-1', iss: 'https://login.microsoftonline.com/tenant-1/v2.0', exp: Date.now() / 1000 + 60 };
  assert.equal(checkClaims(ok, ms), true);
  assert.throws(() => checkClaims({ ...ok, aud: 'x' }, ms), /different app/);
  assert.throws(() => checkClaims({ ...ok, tid: 'other' }, ms), /tenant/);
  assert.throws(() => checkClaims({ ...ok, iss: 'https://evil.example/v2.0' }, ms), /issuer/);
  assert.throws(() => checkClaims({ ...ok, exp: Date.now() / 1000 - 600 }, ms), /expired/);
  assert.equal(decodeJwtPayload(idToken({ name: 'Zoë' })).name, 'Zoë');
});

/* ---------- mapping ---------- */

test('ERP status, option matching and error messages', () => {
  assert.equal(statusFromErp({ workflow_state: 'Pending HOD Approval', docstatus: 0 }), 'submitted');
  assert.equal(statusFromErp({ workflow_state: 'Approved', docstatus: 1 }), 'approved');
  assert.equal(statusFromErp({ workflow_state: 'Rejected' }), 'rejected');
  assert.equal(statusFromErp({ workflow_state: 'Approved', docstatus: 2 }), 'cancelled');
  assert.equal(statusFromErp({ docstatus: 0 }), 'draft');
  assert.equal(matchOption(['Flight', 'Train'], ['air', 'flight']), 'Flight');
  assert.equal(frappeMessage({ _server_messages: JSON.stringify([JSON.stringify({ message: '<b>Purpose</b> is mandatory' })]) }), 'Purpose is mandatory');
  assert.equal(parseCookies('a=1; pm_session=x%3Dy').pm_session, 'x=y');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
});

test('mapping sends only fields ERP has and reports mandatory fields it cannot fill', () => {
  const meta = summariseMeta([
    { name: 'Travel Request', fields: [{ fieldname: 'employee', fieldtype: 'Link', reqd: 1 }, { fieldname: 'travel_type', fieldtype: 'Select', options: 'Domestic\nInternational' }, { fieldname: 'personal_id_number', fieldtype: 'Data', reqd: 1, label: 'Identification Document Number' }] }
  ]);
  const { doc, missing } = toErpTravelRequest({ ...REQ, tripType: 'international' }, { name: 'E1', company: 'C' }, meta);
  assert.deepEqual(doc, { doctype: 'Travel Request', employee: 'E1', travel_type: 'International' });
  assert.deepEqual(missing, ['Identification Document Number']);
  const back = fromErpTravelRequest({ name: 'T1', employee: 'E1', travel_type: 'International', workflow_state: 'Draft', itinerary: [{ travel_from: 'A', travel_to: 'B', mode_of_travel: 'Train', departure_date: '2026-12-01 08:30:00' }] });
  assert.equal(back.preferredMode, 'train');
  assert.equal(back.departTime, '08:30');
  assert.equal(back.tripType, 'international');
});
