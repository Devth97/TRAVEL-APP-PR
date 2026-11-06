import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../convex/lib/api.js';
import { createErpClient } from '../convex/lib/erp.js';
import { billRequired, buildRemark, canDecide, expenseSummary, legAmount, monthGrid, normaliseExpense, parseRemark, shiftMonth } from '../convex/lib/expenses.js';
import { createFakeErp, memoryStore } from '../src/fake-erp.js';
import { buildPlan, datesProblem, detectIntent, extractDates, matchPurpose, nextQuestion, readMessage } from '../src/assistant.js';

const BASE = 'https://happy-otter-123.convex.site';
const ENV = { ERP_BASE_URL: 'https://erpuat.prorackglobal.com', ERP_API_KEY: 'k', ERP_API_SECRET: 's', CONVEX_SITE_URL: BASE, UAT_LOGIN_PASSCODE: 'uat-pass-2026', TRAVEL_ADMIN_EMAILS: 'aarav.reddy@prorackglobal.com' };
const PRIYA = 'priya.sharma@prorackglobal.com', AARAV = 'aarav.reddy@prorackglobal.com', HOD = 'hod.sales@prorackglobal.com';
const TODAY = '2026-11-06';
const PURPOSES = ['Customer Visit', 'Site Visit', 'Vendor Visit', 'Training / Conference'];
const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

function setup(env = ENV) {
  const fake = createFakeErp();
  const deps = { env, erp: createErpClient(env, fake.fetch), store: memoryStore(), fetch: fake.fetch, now: () => Date.now() };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = new Headers();
    if (cookie) h.set('cookie', cookie);
    if (method === 'POST') h.set('x-prorack-move', '1');
    if (body !== undefined) h.set('content-type', 'application/json');
    const res = await handleApi(new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = email => call('POST', '/api/auth/passcode', { email, passcode: 'uat-pass-2026' });
  return { fake, call, login };
}
const HOTEL = { type: 'hotel', date: yesterday, amount: 5000, purpose: 'Site visit' };
const INCIDENTAL = { type: 'incidental', date: yesterday, amount: 200 };
const BILL = Buffer.from('fake bill').toString('base64');

/* ---------- expense rules ---------- */
test('own-vehicle legs use ERP rates and the browser cannot set the amount', () => {
  assert.equal(legAmount({ category: 'four_wheeler', km: 10, amount: 99999 }), 150);
  assert.equal(legAmount({ category: 'two_wheeler', km: 10 }), 70);
  assert.equal(legAmount({ category: 'toll', amount: 120 }), 120);
  const e = normaliseExpense({ type: 'conveyance', date: yesterday, legs: [{ from: 'A', to: 'B', category: 'four_wheeler', km: 20, amount: 999999 }] });
  assert.equal(e.amount, 300);
});

test('expense validation refuses bad input', () => {
  assert.throws(() => normaliseExpense({ type: 'nope', date: yesterday, amount: 1 }), /valid expense type/);
  assert.throws(() => normaliseExpense({ type: 'food', date: 'soon', amount: 1 }), /valid expense date/);
  assert.throws(() => normaliseExpense({ type: 'food', date: '2099-01-01', amount: 1 }), /future/);
  assert.throws(() => normaliseExpense({ type: 'food', date: yesterday, amount: -5 }), /greater than zero/);
  assert.throws(() => normaliseExpense({ type: 'conveyance', date: yesterday, legs: [] }), /at least one/);
  assert.throws(() => normaliseExpense({ type: 'conveyance', date: yesterday, legs: [{ from: 'A', to: 'B', category: 'four_wheeler', km: 0 }] }), /distance/);
});

test('bills are required for the right expenses, never for estimates', () => {
  assert.equal(billRequired({ type: 'hotel' }), true);
  assert.equal(billRequired({ type: 'incidental' }), false);
  assert.equal(billRequired({ type: 'conveyance', legs: [{ category: 'four_wheeler' }] }), false);
  assert.equal(billRequired({ type: 'conveyance', legs: [{ category: 'toll' }] }), true);
  assert.equal(billRequired({ type: 'hotel', estimate: true }), false);
});

test('remark data survives a round trip and a damaged marker is harmless', () => {
  const { summary, meta } = parseRemark(buildRemark('Raised from ProRack Move.', { type: 'food', report: 'R1' }));
  assert.equal(summary, 'Raised from ProRack Move.');
  assert.deepEqual(meta, { type: 'food', report: 'R1' });
  assert.deepEqual(parseRemark('ProRack Move data: {broken').meta, {});
  assert.equal(parseRemark('Typed by hand in ERP').summary, 'Typed by hand in ERP');
});

test('nobody can approve their own request; a Travel Admin needs the explicit setting', () => {
  const session = { employeeId: 'E1', email: 'boss@x.com' };
  assert.equal(canDecide({ session, requester: { name: 'E1', expense_approver: 'boss@x.com' } }), false);
  assert.equal(canDecide({ session, requester: { name: 'E2', expense_approver: 'BOSS@x.com' } }), true);
  assert.equal(canDecide({ session, requester: { name: 'E2', expense_approver: 'other@x.com' }, isAdmin: true }), false);
  assert.equal(canDecide({ session, requester: { name: 'E2', expense_approver: 'other@x.com' }, isAdmin: true, env: { ADMIN_CAN_APPROVE: '1' } }), true);
  assert.equal(canDecide({ session: { employeeId: 'E1', email: '' }, requester: { name: 'E2', expense_approver: '' } }), false);
});

test('month grid, summary and month shifting', () => {
  const items = [{ date: '2026-09-04', amount: 432, status: 'approved' }, { date: '2026-09-04', amount: 100, status: 'ready' }, { date: '2026-09-08', amount: 50, status: 'approved', estimate: true }];
  const g = monthGrid('2026-09', items);
  assert.equal(g.cells.length % 7, 0);
  assert.equal(g.cells.filter(Boolean).length, 30);
  assert.equal(g.cells.find(c => c?.day === 4).total, 532);
  assert.equal(g.total, 532, 'estimates are not spend');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.deepEqual(expenseSummary(items).approved, [2, 482]);
});

/* ---------- expenses through the API and fake ERP ---------- */
test('expense life cycle: create, bill, send, approve', async () => {
  const s = setup();
  await s.login(PRIYA);
  const { body: { expense } } = await s.call('POST', '/api/expenses', { expense: HOTEL });
  assert.equal(expense.status, 'ready');
  assert.equal(expense.needsBill, true);
  assert.equal(s.fake.state.claims[0].expenses[0].expense_type, 'Hotel');
  assert.equal(s.fake.state.claims[0].expense_approver, HOD);

  const noBill = await s.call('POST', '/api/expenses/send', { names: [expense.id] });
  assert.equal(noBill.status, 400);
  assert.match(noBill.body.error, /needs a bill/);

  const billed = await s.call('POST', '/api/expenses/bill', { name: expense.id, fileName: 'hotel.pdf', data: BILL });
  assert.equal(billed.body.expense.billName, 'hotel.pdf');
  assert.equal(s.fake.state.uploads[0].isPrivate, '1');

  const sent = await s.call('POST', '/api/expenses/send', { names: [expense.id] });
  assert.equal(sent.status, 200);
  assert.match(sent.body.report, /^RPT-\d{8}-/);
  assert.equal(sent.body.expenses[0].status, 'pending');
  assert.equal((await s.call('POST', '/api/expenses/send', { names: [expense.id] })).status, 409, 'cannot send twice');
  assert.equal((await s.call('POST', '/api/expenses/delete', { name: expense.id })).status, 409, 'cannot delete once sent');

  await s.login(HOD);
  const queue = await s.call('GET', '/api/approvals');
  assert.deepEqual(queue.body.expenses.map(e => e.id), [expense.id]);
  const ok = await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'approve' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.expense.status, 'approved');
  assert.equal(ok.body.expense.decidedBy, HOD);
  assert.equal(s.fake.state.claims[0].docstatus, 1);
  assert.equal((await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'reject', note: 'too late' })).status, 409);
});

test('employees cannot read, send, delete or decide what is not theirs', async () => {
  const s = setup();
  await s.login(PRIYA);
  const { body: { expense } } = await s.call('POST', '/api/expenses', { expense: INCIDENTAL });
  await s.call('POST', '/api/expenses/send', { names: [expense.id] });
  const second = (await s.call('POST', '/api/expenses', { expense: INCIDENTAL })).body.expense;

  assert.equal((await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'approve' })).status, 403, 'not their own');

  await s.login(AARAV);
  assert.deepEqual((await s.call('GET', '/api/expenses')).body.expenses, []);
  assert.equal((await s.call('POST', '/api/expenses/send', { names: [second.id] })).status, 403);
  assert.equal((await s.call('POST', '/api/expenses/delete', { name: second.id })).status, 403);
  assert.equal((await s.call('POST', '/api/expenses/bill', { name: second.id, fileName: 'a.pdf', data: BILL })).status, 403);
  assert.equal((await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'approve' })).status, 403, 'Travel Admin without the setting');
  assert.deepEqual((await s.call('GET', '/api/approvals')).body, { travel: [], expenses: [] });
});

test('Travel Admin may decide only when ADMIN_CAN_APPROVE is set', async () => {
  const s = setup({ ...ENV, ADMIN_CAN_APPROVE: '1' });
  await s.login(PRIYA);
  const { body: { expense } } = await s.call('POST', '/api/expenses', { expense: INCIDENTAL });
  await s.call('POST', '/api/expenses/send', { names: [expense.id] });
  await s.login(AARAV);
  assert.equal((await s.call('GET', '/api/approvals')).body.expenses.length, 1);
  const noReason = await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'reject' });
  assert.equal(noReason.status, 400);
  const out = await s.call('POST', '/api/expenses/decide', { name: expense.id, decision: 'reject', note: 'Wrong month' });
  assert.equal(out.body.expense.status, 'rejected');
  assert.equal(out.body.expense.decisionNote, 'Wrong month');
});

test('bills: only JPG, PNG or PDF, up to 4 MB, and only before sending', async () => {
  const s = setup();
  await s.login(PRIYA);
  const { body: { expense } } = await s.call('POST', '/api/expenses', { expense: INCIDENTAL });
  assert.equal((await s.call('POST', '/api/expenses/bill', { name: expense.id, fileName: 'virus.exe', data: BILL })).status, 400);
  assert.equal((await s.call('POST', '/api/expenses/bill', { name: expense.id, fileName: 'big.pdf', data: 'A'.repeat(6 * 1024 * 1024) })).status, 400);
  await s.call('POST', '/api/expenses/send', { names: [expense.id] });
  assert.equal((await s.call('POST', '/api/expenses/bill', { name: expense.id, fileName: 'late.pdf', data: BILL })).status, 409);
});

test('estimates are saved but can never be sent as a claim', async () => {
  const s = setup();
  await s.login(PRIYA);
  const out = await s.call('POST', '/api/expenses', { expense: { type: 'hotel', date: '2099-01-01', estimate: true, rows: [{ type: 'hotel', amount: 9000, description: 'limit' }, { type: 'food', amount: 2400, description: 'limit' }], request: 'HR-TRQ-1' } });
  assert.equal(out.status, 201);
  assert.equal(out.body.expense.status, 'estimate');
  assert.equal(out.body.expense.amount, 11400);
  assert.equal(out.body.expense.needsBill, false);
  const send = await s.call('POST', '/api/expenses/send', { names: [out.body.expense.id] });
  assert.equal(send.status, 400);
  assert.match(send.body.error, /estimate/);
  assert.equal((await s.call('POST', '/api/expenses/delete', { name: out.body.expense.id })).status, 200);
});

test('a travel request from the assistant reaches the approver with its arrangements, then the decision applies', async () => {
  const s = setup();
  await s.login(PRIYA);
  const { request } = buildPlan({ origin: 'Hyderabad', destination: 'Bhiwandi', departDate: '2099-01-10', returnDate: '2099-01-12', purpose: 'Site Visit', hotel: true, cab: true }, {});
  const created = await s.call('POST', '/api/travel-requests', { request, submit: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.submitted, true);
  const id = created.body.request.id;
  assert.equal((await s.call('POST', '/api/approvals/travel', { name: id, decision: 'approve' })).status, 403, 'not their own');

  await s.login(HOD);
  const queue = (await s.call('GET', '/api/approvals')).body.travel;
  assert.equal(queue[0].id, id);
  assert.match(queue[0].notes, /Arrangements requested \(Travel Admin to book\): Hotel at Bhiwandi, 2 nights; Cab at Bhiwandi/);
  const ok = await s.call('POST', '/api/approvals/travel', { name: id, decision: 'approve', note: 'Fine' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.request.status, 'approved');
  assert.match(s.fake.state.comments[0].content, /Approved in ProRack Move by hod\.sales/);
  assert.equal((await s.call('POST', '/api/approvals/travel', { name: id, decision: 'reject', note: 'again' })).status, 409);
});

test('signed-out expense calls are refused', async () => {
  const s = setup();
  for (const [m, p] of [['GET', '/api/expenses'], ['GET', '/api/approvals'], ['POST', '/api/expenses'], ['POST', '/api/expenses/decide']]) {
    assert.equal((await s.call(m, p, m === 'POST' ? {} : undefined)).status, 401, p);
  }
});

/* ---------- the assistant's reading of messages ---------- */
const read = (text, slots = {}, asking = '') => readMessage(text, slots, { today: TODAY, purposes: PURPOSES, asking });

test('reads the example request from the brief', () => {
  const t = 'hey I want to travel to B1D for a site visit and arrange me a travel request as well expense request and book a hotel room and cab';
  assert.equal(detectIntent(t), 'trip');
  const s = read(t);
  assert.equal(s.destination, 'B1D');
  assert.equal(s.purpose, 'Site Visit');
  assert.equal(s.hotel, true);
  assert.equal(s.cab, true);
});

test('reads places, dates, modes and refusals', () => {
  const a = read('Travel to Bhiwandi from Hyderabad from 12 Nov to 14 Nov for a client meeting, no cab');
  assert.deepEqual([a.origin, a.destination, a.departDate, a.returnDate, a.purpose, a.cab], ['Hyderabad', 'Bhiwandi', '2026-11-12', '2026-11-14', 'Customer Visit', false]);
  const b = read('Need to go to new delhi next monday for 3 days by flight');
  assert.deepEqual([b.destination, b.departDate, b.returnDate, b.mode], ['New Delhi', '2026-11-16', '2026-11-18', 'flight']);
  const c = read('fly to Pune tomorrow, one way, without hotel');
  assert.deepEqual([c.destination, c.departDate, c.oneWay, c.hotel, c.mode], ['Pune', '2026-11-07', true, false, 'flight']);
  assert.equal(read('going to Chennai by cab').mode, 'car');
  assert.equal(read('going to Chennai by cab').cab, undefined, '"by cab" is the travel mode, not a local cab request');
});

test('date formats: Indian day/month, next year rollover, invalid dates ignored', () => {
  assert.deepEqual(extractDates('on 12/11', TODAY).dates, ['2026-11-12']);
  assert.deepEqual(extractDates('on 5 Jan', TODAY).dates, ['2027-01-05']);
  assert.deepEqual(extractDates('nov 20 2026', TODAY).dates, ['2026-11-20']);
  assert.deepEqual(extractDates('2026-12-01 then 2026-12-03', TODAY).dates, ['2026-12-01', '2026-12-03']);
  assert.deepEqual(extractDates('31 Feb', TODAY).dates, []);
  assert.deepEqual(extractDates('day after tomorrow', TODAY).dates, ['2026-11-08']);
});

test('short answers land in the question that was asked', () => {
  assert.equal(read('Hyderabad', {}, 'origin').origin, 'Hyderabad');
  assert.equal(read('b1d', {}, 'destination').destination, 'B1D');
  assert.equal(read('15 Nov', { departDate: '2026-11-12' }, 'returnDate').returnDate, '2026-11-15');
  assert.equal(read('one way', { departDate: '2026-11-12' }, 'returnDate').oneWay, true);
  assert.deepEqual((({ hotel, cab }) => [hotel, cab])(read('both', {}, 'arrangements')), [true, true]);
  assert.deepEqual((({ hotel, cab }) => [hotel, cab])(read('no', {}, 'arrangements')), [false, false]);
  assert.deepEqual((({ hotel, cab }) => [hotel, cab])(read('hotel only', {}, 'arrangements')), [true, false]);
  assert.deepEqual((({ hotel, cab }) => [hotel, cab])(read('cab only', {}, 'arrangements')), [false, true]);
});

test('changes after the plan is shown', () => {
  const plan = { origin: 'Hyderabad', destination: 'Pune', departDate: '2026-11-12', returnDate: '2026-11-14', purpose: 'Site Visit', hotel: true, cab: true };
  assert.equal(read('return on 15 Nov', plan).returnDate, '2026-11-15');
  assert.equal(read('leave on 10 Nov', plan).departDate, '2026-11-10');
  assert.equal(read('no cab', plan).cab, false);
  assert.equal(read('from Mumbai', plan).origin, 'Mumbai');
  assert.equal(read('by train', plan).mode, 'train');
  assert.equal(read('hmm', plan).destination, 'Pune');
});

test('asks for what is missing, in order, then is ready', () => {
  const order = [];
  let s = {};
  for (const [q, patch] of [['destination', { destination: 'Pune' }], ['origin', { origin: 'Hyderabad' }], ['departDate', { departDate: '2026-11-12' }], ['returnDate', { oneWay: true }], ['purpose', { purpose: 'Site Visit' }], ['arrangements', { hotel: false, cab: false }]]) {
    order.push(nextQuestion(s) === q);
    s = { ...s, ...patch };
  }
  assert.ok(order.every(Boolean));
  assert.equal(nextQuestion(s), '');
});

test('date problems and intents', () => {
  assert.match(datesProblem({ departDate: '2026-11-01' }, TODAY), /already passed/);
  assert.match(datesProblem({ departDate: '2026-11-10', returnDate: '2026-11-08' }, TODAY), /before the departure/);
  assert.equal(datesProblem({ departDate: '2026-11-10', returnDate: '2026-11-10' }, TODAY), '');
  assert.equal(detectIntent('cancel'), 'reset');
  assert.equal(detectIntent('What is the status of my requests?'), 'status');
  assert.equal(detectIntent('I want to claim an expense'), 'expense');
  assert.equal(detectIntent('hello'), 'help');
  assert.equal(matchPurpose('nothing relevant', PURPOSES), '');
});

test('the plan estimates from limits, adds no cab amount and never invents a booking', () => {
  const daily = { hotel: { min: 7500, max: 9000 }, food: { min: 1200, max: 1200 }, incidental: { min: 300, max: 300 } };
  const p = buildPlan({ origin: 'Hyderabad', destination: 'Pune', departDate: '2026-11-12', returnDate: '2026-11-14', purpose: 'Site Visit', hotel: true, cab: true }, { daily });
  assert.deepEqual([p.days, p.nights], [3, 2]);
  assert.deepEqual(p.rows.map(r => [r.type, r.amount]), [['hotel', 18000], ['food', 3600], ['incidental', 900]]);
  assert.equal(p.estimateTotal, 22500);
  assert.deepEqual(p.arrangements, ['Hotel at Pune, 2 nights', 'Cab at Pune']);
  const noGrade = buildPlan({ origin: 'A', destination: 'B', departDate: '2026-11-12', oneWay: true, purpose: 'Site Visit', hotel: false, cab: false }, {});
  assert.deepEqual([noGrade.rows, noGrade.estimateTotal, noGrade.arrangements], [[], 0, []]);
  assert.equal(noGrade.request.returnDate, '');
});
