import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADES, ERP_GRADES, ERP_CURRENT_RULES as ERP, PROPOSED_POLICY_2026 as P, ERP_TO_PROPOSED_CANDIDATES } from '../src/policy.js';
import {
  resolveGrade, classifyCity, classifyCountry, domesticEntitlement, sanctioningAuthority, domesticDailyLimits,
  internationalDailyLimits, internationalClass, evaluateRequest, timeAway, farePremium, localConveyanceStatus,
  cabProvision, assessDomesticClaim, assessMileage, domesticExtras
} from '../src/entitlements.js';

const TODAY = '2026-11-04';
const confirmed = grade => ({ policyGrade:grade, policyGradeConfirmed:true });
const plusDays = n => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const levels = (r, rule) => r.checks.filter(c => c.rule === rule).map(c => c.level);

/* ---------- Policy versions ---------- */

test('current ERP rules are kept separately: four grades, ₹15/₹7 mileage, EUR international', () => {
  assert.equal(ERP_GRADES.length, 4);
  assert.deepEqual(ERP.mileage, { four_wheeler:15, two_wheeler:7 });
  assert.equal(ERP.currency.international, 'EUR');
  assert.deepEqual(ERP.lodging['Manager to DGM'], { first:10000, second:7000 });
  assert.deepEqual(ERP.perDiem['Manager to DGM'], { first:2000, second:1500 });
  assert.equal(ERP.shortNoticeRule, null);
  assert.equal(ERP.distanceRules, null);
});

test('the proposed policy is marked as not in force and does not alter ERP values', () => {
  assert.match(P.status, /not in force/);
  assert.equal(P.supersedesErp, null);
  assert.equal(P.effectiveDate, null);
  assert.deepEqual(P.localConveyance.rates, { four_wheeler:12, two_wheeler:4 });
  assert.equal(P.currency.international, 'USD');
  assert.equal(assessMileage({ gradeId:'gm', vehicle:'four_wheeler', km:10 }).amount, 120);
  assert.equal(assessMileage({ gradeId:'gm', vehicle:'four_wheeler', km:10, rules:'erp' }).amount, 150);
  assert.equal(assessMileage({ vehicle:'two_wheeler', km:10, rules:'erp' }).amount, 70);
  assert.equal(ERP.mileage.four_wheeler, 15, 'ERP value unchanged after evaluation');
});

test('unresolved items stay listed: supersession, grades, Kathmandu, 4.4.9, effective date, office locations', () => {
  const ids = P.unresolved.map(u => u.id);
  for (const id of ['supersession', 'grade-mapping', 'kathmandu', 'clause-4-4-9', 'effective-date', 'office-locations', 'cab-km-basis', 'time-buffers'])
    assert.ok(ids.includes(id), id);
  assert.equal(classifyCity('Kathmandu').category, null);
  assert.equal(classifyCity('Kathmandu').unresolved, true);
  assert.ok(assessDomesticClaim({ gradeId:'mgr', days:1, stay:'personal' }).notes.some(n => /4\.4\.9/.test(n)));
});

/* ---------- Grades ---------- */

test('ERP grade is used and the policy grade stays provisional until HR confirms it', () => {
  const g = resolveGrade({ erpGrade:'Manager to DGM' });
  assert.equal(g.erpGrade, 'Manager to DGM');
  assert.equal(g.status, 'provisional');
  assert.deepEqual(g.candidates, ERP_TO_PROPOSED_CANDIDATES['Manager to DGM']);
  assert.equal(g.gradeId, null);
  const hr = resolveGrade({ erpGrade:'Manager to DGM', policyGrade:'mgr', policyGradeConfirmed:true });
  assert.equal(hr.status, 'confirmed');
  assert.equal(hr.gradeId, 'mgr');
  assert.equal(resolveGrade({ policyGrade:'mgr' }).status, 'provisional', 'HR draft without confirmation');
});

test('designation and role are never used to infer a grade', () => {
  for (const user of [{ designation:'Managing Director' }, { designation:'Sales Manager', role:'manager' }, { role:'worker' }, null]) {
    const g = resolveGrade(user);
    assert.equal(g.status, 'unassigned');
    assert.deepEqual(g.candidates, []);
  }
  assert.equal(resolveGrade({ erpGrade:'Others' }).status, 'unassigned');
  assert.equal(resolveGrade({ erpGrade:'Not an ERP grade' }).status, 'unassigned');
});

test('a flight request on a provisional grade needs review, even if every candidate is air-entitled', () => {
  const r = evaluateRequest({ destination:'Mumbai', departDate:plusDays(20), preferredMode:'flight' }, { erpGrade:'GM & Above' }, { today:TODAY });
  assert.equal(r.air.value, true);
  assert.equal(r.air.confirmed, false);
  assert.deepEqual(levels(r, 'TP 4.3'), ['review']);
  assert.ok(r.approvals.some(a => a.reason === 'Confirm air entitlement'));
  assert.ok(!r.approvals.some(a => a.reason === 'Air travel above entitlement'));
});

test('confirmed grades: entitled air passes; non-entitled air needs ED / Dy. ED approval', () => {
  const ok = evaluateRequest({ destination:'Mumbai', departDate:plusDays(20), preferredMode:'flight' }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(ok.approvals.map(a => a.role), ['HOD']);
  assert.equal(ok.checks.filter(c => ['block', 'approval', 'review'].includes(c.level)).length, 0);
  const no = evaluateRequest({ destination:'Mumbai', departDate:plusDays(20), preferredMode:'flight' }, confirmed('exec'), { today:TODAY });
  assert.deepEqual(levels(no, 'TP 4.3.2'), ['approval']);
  assert.deepEqual(no.approvals.map(a => a.role), ['Departmental Manager', 'ED / Dy. ED']);
});

test('an unassigned employee gets a review flag and no assumed entitlements', () => {
  const r = evaluateRequest({ destination:'Pune', departDate:plusDays(20) }, { role:'worker' }, { today:TODAY });
  assert.deepEqual(levels(r, 'Grade'), ['review']);
  assert.equal(r.daily, null);
  assert.equal(r.approvals[0].role, 'Sanctioning authority (to be confirmed)');
});

test('provisional grades show limit ranges across candidate grades', () => {
  const r = evaluateRequest({ destination:'Bengaluru', departDate:plusDays(20) }, { erpGrade:'Jr Executive to Dy Manager' }, { today:TODAY });
  assert.deepEqual(r.daily.hotel, { min:2100, max:3500 });
  assert.equal(r.approvals[0].role, 'Sanctioning authority (to be confirmed)', 'HOD vs Departmental Manager disagree');
});

/* ---------- Short notice and fares ---------- */

test('domestic: 6 days ahead is advisory, 7 days is not flagged, and neither adds an approval', () => {
  const six = evaluateRequest({ destination:'Pune', departDate:plusDays(6) }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(six, 'TP 18.1'), ['warn']);
  assert.deepEqual(six.approvals.map(a => a.role), ['HOD']);
  const seven = evaluateRequest({ destination:'Pune', departDate:plusDays(7) }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(seven, 'TP 18.1'), []);
});

test('fare premium: 14.99% passes, exactly 15% and above need prior approval', () => {
  assert.equal(farePremium(10000, 11499).needsApproval, false);
  assert.equal(farePremium(10000, 11500).needsApproval, true);
  assert.equal(farePremium(10000, 11500).pct, 15);
  assert.equal(farePremium(3999, 4599).needsApproval, true);  // 15.004%
  assert.equal(farePremium(4000, 4599).needsApproval, false); // 14.975%
  assert.equal(farePremium('', 5000).known, false);
  assert.equal(farePremium(0, 5000).known, false);
  const r = evaluateRequest({ destination:'Pune', departDate:plusDays(3), normalFare:'5000', quotedFare:'5750' }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(r, 'TP 18.10'), ['approval']);
  assert.ok(r.approvals.some(a => a.role === 'ED / Dy. ED / HOD'));
  const fine = evaluateRequest({ destination:'Pune', departDate:plusDays(3), normalFare:'5000', quotedFare:'5600' }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(fine, 'TP 18.10'), []);
  assert.deepEqual(levels(fine, 'TP 18.1'), ['warn']);
});

test('international under 15 days is a review, not a block; 15 days is clear', () => {
  const fourteen = evaluateRequest({ tripType:'international', country:'Germany', departDate:plusDays(14) }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(fourteen, 'TP 15.3'), ['review']);
  assert.ok(!fourteen.checks.some(c => c.level === 'block'));
  assert.ok(fourteen.approvals.some(a => a.reason === 'Review short-notice foreign tour'));
  const fifteen = evaluateRequest({ tripType:'international', country:'Germany', departDate:plusDays(15) }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(fifteen, 'TP 15.3'), []);
  assert.deepEqual(fifteen.dailyTotal, { min:220, max:220 });
});

/* ---------- Distance ---------- */

test('local conveyance is decided by captured round-trip distance: 150 km is local, 151 km is not', () => {
  assert.equal(localConveyanceStatus(150).status, 'local');
  assert.equal(localConveyanceStatus(151).status, 'beyond_local');
  assert.equal(localConveyanceStatus('').status, 'unknown');
  assert.equal(localConveyanceStatus(-5).status, 'unknown');
  const named = evaluateRequest({ origin:'Hyderabad', destination:'Hyderabad Gachibowli', departDate:plusDays(20) }, confirmed('exec'), { today:TODAY });
  assert.equal(named.local.status, 'unknown', 'same city name alone does not decide local travel');
  const near = evaluateRequest({ origin:'Hyderabad', destination:'Shadnagar', departDate:plusDays(20), roundTripKm:'120' }, confirmed('exec'), { today:TODAY });
  assert.equal(near.local.status, 'local');
});

test('the 100 km cab provision is separate and stays unresolved between 101 and 200 km', () => {
  assert.equal(cabProvision(100).status, 'not_allowed');
  assert.equal(cabProvision(101).status, 'unresolved');
  assert.equal(cabProvision(200).status, 'unresolved');
  assert.equal(cabProvision(201).status, 'allowed_with_approval');
  assert.equal(cabProvision(150, P, 'round_trip').status, 'allowed_with_approval');
  assert.equal(cabProvision(150, P, 'one_way').status, 'not_allowed');
  // 140 km: local conveyance applies (≤150) while the cab question remains open
  const r = evaluateRequest({ destination:'Shadnagar', departDate:plusDays(20), roundTripKm:140 }, confirmed('exec'), { today:TODAY });
  assert.equal(r.local.status, 'local');
  assert.equal(r.cab.status, 'unresolved');
  assert.deepEqual(levels(r, 'TP 6.1(c)'), ['review']);
  // Only applies below Assistant Manager
  const mgr = evaluateRequest({ destination:'Shadnagar', departDate:plusDays(20), roundTripKm:140 }, confirmed('mgr'), { today:TODAY });
  assert.equal(mgr.cab, undefined);
});

/* ---------- Time away ---------- */

test('time away shows the 61-hour journey and the provisional 3 h + 6 h buffers separately', () => {
  const t = timeAway({ depart:'2026-11-05T06:00', departMode:'flight', returnAt:'2026-11-07T19:00', returnMode:'flight' });
  assert.equal(t.journey.hours, 61);
  assert.deepEqual(t.buffers, { before:3, after:6, provisional:true });
  assert.equal(t.hours, 70);
  assert.equal(t.start, '2026-11-05T03:00');
  assert.equal(t.end, '2026-11-08T01:00');
});

test('time-away buffers are configurable', () => {
  const leg = { depart:'2026-11-05T06:00', departMode:'flight', returnAt:'2026-11-07T19:00', returnMode:'flight' };
  assert.equal(timeAway(leg, { buffers:{ before:0, after:0 } }).hours, 61);
  const custom = timeAway(leg, { buffers:{ before:2, after:2 } });
  assert.equal(custom.hours, 65);
  assert.equal(custom.buffers.provisional, false);
  const changed = { ...P, timeAwayBuffers:{ provisional:true, beforeDepartureHours:{ flight:1 }, afterReturnHours:{ flight:1 } } };
  assert.equal(timeAway(leg, { policy:changed }).hours, 63);
  assert.equal(timeAway({ ...leg, departMode:null, returnMode:null }).hours, 61, 'no mode, no buffer');
  assert.throws(() => timeAway({ depart:'2026-11-05T06:00', returnAt:'2026-11-04T06:00' }));
  const r = evaluateRequest({ destination:'Bengaluru', departDate:'2026-11-05', departTime:'06:00', returnDate:'2026-11-07', returnTime:'19:00', preferredMode:'flight' }, confirmed('mgr'), { today:TODAY });
  assert.equal(r.timeAway.journey.hours, 61);
  assert.equal(r.timeAway.hours, 70);
});

/* ---------- Proposed policy tables ---------- */

test('every proposed grade has exactly one row in each table', () => {
  assert.equal(GRADES.length, 10);
  for (const { id } of GRADES) {
    assert.ok(P.domesticDaily[id], id);
    for (const table of ['domesticModes', 'sanctioning', 'destinationTravel', 'internationalClass'])
      assert.equal(P[table].filter(r => r.grades.includes(id)).length, 1, `${table}: ${id}`);
  }
});

test('Annexure-II, entitlement and sanction values match the proposed policy', () => {
  assert.deepEqual(domesticDailyLimits('mgr', 'A'), { hotel:9000, food:1200, incidental:300 });
  assert.deepEqual(domesticDailyLimits('blue_collar', 'B'), { hotel:1100, food:500, incidental:200 });
  assert.equal(domesticEntitlement('mgr').air, true);
  assert.equal(domesticEntitlement('dy_mgr').air, false);
  assert.ok(domesticEntitlement('gm').trainClasses.includes('1st AC'));
  assert.equal(sanctioningAuthority('ed').authority, 'MD & CEO');
  assert.equal(sanctioningAuthority('exec').authority, 'Departmental Manager');
  assert.equal(internationalDailyLimits('ed', 'A').total, 270);
  assert.equal(internationalDailyLimits('staff', 'B').total, 175);
  assert.equal(internationalClass('gm').cls, 'Premium Economy (Economy if unavailable)');
  assert.equal(classifyCity('Bangalore Customer Office').category, 'A');
  assert.equal(classifyCity('Bhiwandi Project Site').category, 'B');
  assert.equal(classifyCountry('Dubai'), 'A');
  assert.equal(classifyCountry('Australia'), 'B');
});

test('intercity cab needs three travellers and ED approval (TP 7.1)', () => {
  const two = evaluateRequest({ destination:'Chennai', departDate:plusDays(20), preferredMode:'car', people:2 }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(two, 'TP 7.1'), ['block']);
  const three = evaluateRequest({ destination:'Chennai', departDate:plusDays(20), preferredMode:'car', people:3 }, confirmed('mgr'), { today:TODAY });
  assert.deepEqual(levels(three, 'TP 7.1'), ['approval']);
});

test('claim assessment: pooling, 50% food cap, same-day, own stay and overnight journey', () => {
  const pooled = assessDomesticClaim({ gradeId:'mgr', cityCategory:'A', nights:2, days:3, hotelSpend:19500, foodSpend:2000 });
  assert.equal(pooled.hotel, 19500);
  assert.equal(pooled.disallowed, 0);
  const over = assessDomesticClaim({ gradeId:'mgr', cityCategory:'A', nights:2, days:3, hotelSpend:20000, foodSpend:3000 });
  assert.equal(over.hotel + over.food, 21600);
  assert.equal(over.disallowed, 1400);
  assert.equal(assessDomesticClaim({ gradeId:'exec', cityCategory:'B', nights:1, days:1, hotelSpend:1000, foodSpend:800 }).food, 500);
  assert.equal(assessDomesticClaim({ gradeId:'mgr', days:1, foodSpend:1500, sameDayReturn:true }).food, 1200);
  assert.equal(assessDomesticClaim({ gradeId:'mgr', days:2, stay:'personal' }).admissible, 3000);
  const journey = assessDomesticClaim({ gradeId:'mgr', days:1, stay:'personal', overnightJourneyDays:1 });
  assert.equal(journey.food, 1800);
  assert.equal(journey.incidental, 600);
});

test('proposed mileage: grade limits, unconfirmed grade review, 150 km boundary', () => {
  assert.equal(assessMileage({ gradeId:'asst_mgr', vehicle:'four_wheeler', km:40 }).amount, 480);
  assert.equal(assessMileage({ gradeId:'exec', vehicle:'four_wheeler', km:40 }).rate, 4);
  assert.equal(assessMileage({ gradeId:'exec', vehicle:'four_wheeler', km:40, authorised:true }).rate, 12);
  const unknown = assessMileage({ gradeId:null, vehicle:'four_wheeler', km:40 });
  assert.equal(unknown.rate, 12);
  assert.ok(unknown.notes.some(n => /not confirmed/.test(n)));
  assert.equal(assessMileage({ gradeId:'gm', vehicle:'four_wheeler', km:150 }).withinLocalLimit, true);
  assert.equal(assessMileage({ gradeId:'gm', vehicle:'four_wheeler', km:151 }).withinLocalLimit, false);
  assert.throws(() => assessMileage({ gradeId:'gm', vehicle:'four_wheeler', km:0 }));
});

test('fixed extras follow entitlement (TP 4.3.3, 7.2, 18.2)', () => {
  assert.deepEqual(domesticExtras('mgr'), { flightMealMax:500, overnightTrainAllowance:750, preferredSeatMax:0, agentBookingChargeMax:500 });
  assert.equal(domesticExtras('ed').preferredSeatMax, 600);
  assert.equal(domesticExtras('exec').overnightTrainAllowance, 0);
});

test('adding a person stores ERP grade and policy grade separately and requires a grade before confirming', async () => {
  const { addPerson } = await import('../src/store.js');
  const db = { users:[], activity:[], notifications:[] };
  const admin = { id:'usr-admin', role:'admin' };
  const u = addPerson(db, { name:'Kavya Rao', role:'employee', erpGrade:'Manager to DGM', policyGrade:'mgr' }, admin);
  assert.equal(u.erpGrade, 'Manager to DGM');
  assert.equal(u.policyGradeConfirmed, false);
  assert.equal(resolveGrade(u).status, 'provisional');
  const c = addPerson(db, { name:'Ravi Kumar', role:'employee', policyGrade:'exec', policyGradeConfirmed:'yes' }, admin);
  assert.equal(resolveGrade(c).status, 'confirmed');
  assert.throws(() => addPerson(db, { name:'No Grade', role:'employee', policyGradeConfirmed:'yes' }, admin), /confirmed/);
  assert.throws(() => addPerson(db, { name:'Bad Grade', role:'employee', erpGrade:'Director' }, admin), /ERP grade/);
});
