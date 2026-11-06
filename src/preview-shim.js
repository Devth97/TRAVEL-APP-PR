/**
 * PREVIEW MODE: loaded by default on *.netlify.app, and elsewhere only when the URL has ?preview=erp or #preview-erp.
 * Runs the real /api handler (convex/lib/api.js) inside the browser against sample ERP data
 * (fake-erp.js), so the ERP-connected version can be tried without Convex or ERP UAT.
 * It changes nothing global except window.fetch, and only for paths starting with /api/.
 */
import { handleApi } from '../convex/lib/api.js';
import { createErpClient } from '../convex/lib/erp.js';
import { buildRemark } from '../convex/lib/expenses.js';
import { createFakeErp } from './fake-erp.js';

const nativeFetch = window.fetch.bind(window);
const env = {
  ERP_BASE_URL: 'https://erp-preview.invalid', ERP_API_KEY: 'preview', ERP_API_SECRET: 'preview', CONVEX_SITE_URL: 'https://preview.invalid',
  UAT_LOGIN_PASSCODE: 'preview-pass', TRAVEL_ADMIN_EMAILS: 'aarav.reddy@prorackglobal.com', APP_ENVIRONMENT: 'PREVIEW', ADMIN_CAN_APPROVE: '1'
};
const fake = createFakeErp({ key: 'preview', secret: 'preview' });
const seed = (name, workflow_state, docstatus, purpose, from, to, depart, back, mode, creation) => fake.state.requests.push({
  name, employee: 'HR-EMP-00001', employee_name: 'Priya Sharma', travel_type: 'Domestic', purpose_of_travel: purpose, workflow_state, docstatus, creation,
  description: 'Raised from ProRack Move.', itinerary: [
    { travel_from: from, travel_to: to, mode_of_travel: mode, departure_date: depart },
    ...(back ? [{ travel_from: to, travel_to: from, mode_of_travel: mode, departure_date: back }] : [])]
});
seed('HR-TRQ-2026-00031', 'Approved', 1, 'Customer Visit', 'Hyderabad', 'Mumbai', '2026-11-10 07:00:00', '2026-11-11 20:00:00', 'Flight', '2026-10-28 10:12:00');
seed('HR-TRQ-2026-00035', 'Pending HOD Approval', 0, 'Site Visit', 'Hyderabad', 'Bhiwandi Project Site', '2026-11-18 06:30:00', '', 'Train', '2026-11-03 09:40:00');
seed('HR-TRQ-2026-00027', 'Rejected', 0, 'Vendor Visit', 'Hyderabad', 'Pune', '2026-10-30 08:00:00', '', 'Flight', '2026-10-20 15:05:00');

// Sample expenses for Priya, dated relative to today so the calendar always has something to show.
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const claim = (name, age, erpType, type, category, amount, approval_status, docstatus, meta) => fake.state.claims.push({
  name, employee: 'HR-EMP-00001', employee_name: 'Priya Sharma', company: 'Prorack Storage Solutions India Private Limited', posting_date: daysAgo(age), approval_status, docstatus,
  expense_approver: 'hod.sales@prorackglobal.com', total_claimed_amount: amount, creation: `${daysAgo(age)} 10:00:00`,
  remark: buildRemark('Raised from ProRack Move.', { type, category, date: daysAgo(age), ...meta }),
  expenses: [{ expense_date: daysAgo(age), expense_type: erpType, description: meta.description || '', amount, sanctioned_amount: amount }]
});
claim('HR-EXP-2026-00091', 3, 'Local Conveyance', 'conveyance', 'local', 750, 'Draft', 0, { purpose: 'Customer Visit', legs: [{ from: 'Residence', to: 'Customer site', category: 'four_wheeler', km: 30, amount: 450 }, { from: 'Customer site', to: 'Office', category: 'four_wheeler', km: 20, amount: 300 }] });
claim('HR-EXP-2026-00088', 6, 'Hotel', 'hotel', 'inland', 6400, 'Draft', 0, { purpose: 'Site Visit', status: 'pending', report: 'RPT-SAMPLE-A1', billName: 'hotel-invoice.pdf', description: 'Two nights near the project site' });
claim('HR-EXP-2026-00082', 9, 'Food', 'food', 'inland', 880, 'Approved', 1, { purpose: 'Customer Visit', billName: 'meal-bill.jpg', report: 'RPT-SAMPLE-B2', decidedBy: 'hod.sales@prorackglobal.com' });
claim('HR-EXP-2026-00079', 12, 'Taxi', 'taxi', 'inland', 1250, 'Approved', 1, { purpose: 'Customer Visit', billName: 'taxi.pdf', report: 'RPT-SAMPLE-B2', decidedBy: 'hod.sales@prorackglobal.com' });
claim('HR-EXP-2026-00074', 16, 'Miscellaneous', 'exceptional', 'inland', 2300, 'Rejected', 1, { purpose: 'Vendor Visit', billName: 'receipt.jpg', report: 'RPT-SAMPLE-C3', decidedBy: 'hod.sales@prorackglobal.com', decisionNote: 'Please split this into hotel and food.' });

// Keep the sample data and sign-in for this tab (sign-out reloads the page); works without storage too.
const KEY = 'prorack-move-preview-v3';
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { saved = null; }
if (saved?.requests) { fake.state.requests = saved.requests; fake.state.seq = saved.seq; fake.state.claims = saved.claims || fake.state.claims; fake.state.claimSeq = saved.claimSeq || fake.state.claimSeq; }
let session = saved?.session || null;
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ requests: fake.state.requests, seq: fake.state.seq, claims: fake.state.claims, claimSeq: fake.state.claimSeq, session })); } catch { /* no storage */ } };

// One person signs in at a time in the preview, so the session is kept here instead of in a cookie
// (browsers do not let scripts set cookies on synthetic requests).
const store = {
  saveState: async () => {}, takeState: async () => null,
  createSession: async s => { session = s; save(); },
  getSession: async () => (session && session.expiresAt > Date.now() ? session : null),
  deleteSession: async () => { session = null; save(); }
};
const deps = { env, erp: createErpClient(env, fake.fetch), store, fetch: fake.fetch, now: () => Date.now() };

window.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input?.url || '';
  const path = raw.startsWith('/') ? raw : (() => { try { return new URL(raw).pathname + new URL(raw).search; } catch { return ''; } })();
  if (!path.startsWith('/api/')) return nativeFetch(input, init);
  const h = new Map(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  h.set('cookie', 'pm_session=preview');
  const request = {
    url: 'https://preview.invalid' + path, method: (init.method || 'GET').toUpperCase(),
    headers: { get: k => h.get(String(k).toLowerCase()) ?? null },
    json: async () => JSON.parse(init.body || '{}')
  };
  const res = await handleApi(request, deps);
  if (request.method === 'POST') save();
  return res;
};

function banner() {
  const b = document.createElement('div');
  b.className = 'preview-banner';
  b.innerHTML = '<strong>Preview with sample ERP data</strong> · nothing is sent to ERP. Sign in with passcode <code>preview-pass</code> as '
    + '<code>priya.sharma@prorackglobal.com</code> (employee) or <code>aarav.reddy@prorackglobal.com</code> (Travel Admin). <a href="?demo=1">Open the older persona demo</a>.';
  document.body.prepend(b);
  const st = document.createElement('style');
  st.textContent = '.preview-banner{position:relative;z-index:300;background:#fff7e8;border-bottom:1px solid #f1dcb5;color:#6b4a1d;font-size:12px;line-height:1.6;padding:8px 16px;text-align:center}.preview-banner code{background:#fff;border:1px solid #f1dcb5;border-radius:5px;padding:1px 5px;font-size:11px}';
  document.head.append(st);
}
if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
