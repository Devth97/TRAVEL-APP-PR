/**
 * Policy engine: pure functions over the tables in policy.js. No DOM, no storage, no ERP writes.
 * Request evaluation runs against the PROPOSED policy and labels its results as such; the
 * current ERP rules are reported alongside for comparison, never overwritten.
 */
import { PROPOSED_POLICY_2026, ERP_CURRENT_RULES, GRADES, ERP_GRADES, ERP_TO_PROPOSED_CANDIDATES } from './policy.js';

const DEFAULT = PROPOSED_POLICY_2026;
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const rowFor = (rows, gradeId) => rows.find(r => r.grades.includes(gradeId)) || null;
const unique = list => [...new Set(list)];

export const gradeById = id => GRADES.find(gr => gr.id === id) || null;
export const isErpGrade = value => ERP_GRADES.some(gr => gr.id === value);

/**
 * Resolve an employee's grade.
 *  - `erpGrade` is the employee's saved ERP assignment and is shown as-is.
 *  - The proposed-policy grade is `confirmed` only when HR has confirmed `policyGrade`.
 *    Otherwise it is `provisional` (candidates from the ERP grade, or an unconfirmed HR draft)
 *    or `unassigned`. Designation and role are never used to infer a grade.
 */
export function resolveGrade(user) {
  const erpGrade = isErpGrade(user?.erpGrade) ? user.erpGrade : null;
  const draft = gradeById(user?.policyGrade);
  let status, candidates, source;
  if (draft && user?.policyGradeConfirmed === true) { status = 'confirmed'; candidates = [draft.id]; source = 'HR confirmed'; }
  else if (draft) { status = 'provisional'; candidates = [draft.id]; source = 'HR draft, not confirmed'; }
  else if (erpGrade && ERP_TO_PROPOSED_CANDIDATES[erpGrade].length) { status = 'provisional'; candidates = [...ERP_TO_PROPOSED_CANDIDATES[erpGrade]]; source = `Provisional mapping from ERP grade “${erpGrade}”`; }
  else { status = 'unassigned'; candidates = []; source = erpGrade ? `ERP grade “${erpGrade}” has no policy mapping` : 'No ERP grade on record'; }
  const gradeId = candidates.length === 1 ? candidates[0] : null;
  const label = gradeId ? gradeById(gradeId).label
    : candidates.length ? candidates.map(id => gradeById(id).label).join(' / ') : 'Not assigned';
  return { erpGrade, status, confirmed: status === 'confirmed', candidates, gradeId, label, source };
}

/** A value that is the same for every candidate grade, or null when they disagree / there are none. */
function agreed(candidates, fn) {
  const values = unique(candidates.map(id => JSON.stringify(fn(id) ?? null)));
  return values.length === 1 ? JSON.parse(values[0]) : null;
}
const range = nums => nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;

export function classifyCity(place, policy = DEFAULT) {
  const text = ` ${norm(place)} `;
  if (!text.trim()) return { category:null, city:null };
  for (const name of policy.domesticCities.unresolved || []) {
    if (text.includes(` ${norm(name)} `)) return { category:null, city:name, unresolved:true };
  }
  for (const [city, aliases] of Object.entries(policy.domesticCities.A)) {
    const names = [city, ...city.split('/'), ...aliases].map(norm).filter(Boolean);
    if (names.some(n => text.includes(` ${n} `))) return { category:'A', city };
  }
  return { category:'B', city:null };
}

export function classifyCountry(country, policy = DEFAULT) {
  const text = ` ${norm(country)} `;
  if (!text.trim()) return null;
  return policy.internationalCountries.A.some(c => text.includes(` ${norm(c)} `)) ? 'A' : 'B';
}

export function domesticEntitlement(gradeId, policy = DEFAULT) {
  const row = rowFor(policy.domesticModes, gradeId);
  return { air:!!row?.air, trainClasses:row?.train || [], busClasses:row?.bus || [], provisional:!!row?.provisional };
}
export function sanctioningAuthority(gradeId, policy = DEFAULT) {
  const row = rowFor(policy.sanctioning, gradeId);
  return { authority:row?.authority || null, alternate:row?.alternate || null, provisional:!!row?.provisional };
}
export const destinationTravel = (gradeId, policy = DEFAULT) => rowFor(policy.destinationTravel, gradeId);
export function domesticDailyLimits(gradeId, cityCategory, policy = DEFAULT) {
  const row = policy.domesticDaily[gradeId];
  return row ? { hotel: cityCategory === 'A' ? row.hotelA : row.hotelB, food:row.food, incidental:row.incidental } : null;
}
export function internationalDailyLimits(gradeId, countryCategory, policy = DEFAULT) {
  const row = policy.internationalDaily[countryCategory === 'A' ? 'A' : 'B'][policy.internationalBand[gradeId] || 'asstMgrAndBelow'];
  return { ...row, total: row.hotel + row.food + row.incidental + row.local, currency: policy.currency.international };
}
export function internationalClass(gradeId, policy = DEFAULT) {
  return { cls: rowFor(policy.internationalClass, gradeId)?.cls || null, sanction: policy.internationalSanction };
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const todayISO = () => new Date().toISOString().slice(0, 10);
const num = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);

/** TP 18.10 — fare premium over the normal fare. Exactly 15% needs approval. */
export function farePremium(normalFare, quotedFare, policy = DEFAULT) {
  const normal = num(normalFare), quoted = num(quotedFare);
  if (normal === null || quoted === null || normal <= 0) return { known:false, needsApproval:null };
  const pct = Math.round(((quoted - normal) / normal) * 10000) / 100;
  // integer comparison so 15.00% is exactly on the boundary
  const needsApproval = quoted * 100 >= normal * (100 + policy.fareIncreaseApprovalPct);
  return { known:true, pct, needsApproval };
}

/** LC 3 — local conveyance applies up to 150 km round trip. Decided only from a captured distance. */
export function localConveyanceStatus(roundTripKm, policy = DEFAULT) {
  const km = num(roundTripKm);
  if (km === null || km < 0) return { status:'unknown', km:null };
  return { status: km <= policy.localConveyance.maxRoundTripKm ? 'local' : 'beyond_local', km, limit: policy.localConveyance.maxRoundTripKm };
}

/**
 * TP 6.1(c) — cab for long-distance travel by grades below Assistant Manager, "more than 100 km, to and fro".
 * Kept separate from the 150 km local-conveyance rule. While `destinationCab.basis` is unresolved the
 * result is definite only when both readings agree.
 */
export function cabProvision(roundTripKm, policy = DEFAULT, basis = policy.destinationCab.basis) {
  const km = num(roundTripKm);
  if (km === null || km < 0) return { status:'unknown', basis };
  const limit = policy.destinationCab.km;
  const byRoundTrip = km > limit, byOneWay = km / 2 > limit;
  const exceeds = basis === 'round_trip' ? byRoundTrip : basis === 'one_way' ? byOneWay : (byRoundTrip === byOneWay ? byRoundTrip : null);
  return { status: exceeds === null ? 'unresolved' : exceeds ? 'allowed_with_approval' : 'not_allowed', km, basis, limit };
}

/**
 * Time away from home. Returns the journey span (departure → return) and the buffers separately;
 * `hours` is the total. Buffers default to the provisional policy values and can be overridden.
 * Datetimes are local 'YYYY-MM-DDTHH:MM'.
 */
export function timeAway({ depart, departMode, returnAt, returnMode }, { policy = DEFAULT, buffers } = {}) {
  const parse = v => { const t = Date.parse(`${v}:00Z`); if (Number.isNaN(t)) throw Error(`Invalid date-time: ${v}`); return t; };
  const b = policy.timeAwayBuffers;
  const before = buffers?.before ?? b.beforeDepartureHours[departMode] ?? 0;
  const after = buffers?.after ?? b.afterReturnHours[returnMode || departMode] ?? 0;
  const out = parse(depart), back = parse(returnAt);
  if (back < out) throw Error('Return must be after departure.');
  const fmt = t => new Date(t).toISOString().slice(0, 16);
  const journeyHours = (back - out) / 3600000;
  const hours = journeyHours + before + after;
  return {
    journey:{ start:fmt(out), end:fmt(back), hours:journeyHours },
    buffers:{ before, after, provisional: buffers ? false : !!b.provisional },
    start:fmt(out - before * 3600000), end:fmt(back + after * 3600000), hours,
    isTour: hours > policy.tourMinHours
  };
}

/**
 * Check a travel request against the PROPOSED policy.
 * Levels: block (not allowed as asked) · approval (extra sign-off) · review (needs a person to look) ·
 * warn (advisory) · info.
 *
 * request fields: tripType, origin, destination, country, departDate, departTime, returnDate,
 * returnTime, preferredMode, people, roundTripKm, normalFare, quotedFare.
 */
export function evaluateRequest(request, user, { today = todayISO(), policy = DEFAULT, buffers } = {}) {
  const grade = resolveGrade(user);
  const international = request.tripType === 'international';
  const checks = [], approvals = [];
  const add = (level, rule, message) => checks.push({ level, rule, message });
  const needApproval = (role, reason, rule) => { if (!approvals.some(a => a.role === role && a.reason === reason)) approvals.push({ role, reason, rule }); };
  const c = grade.candidates;
  const leadDays = request.departDate ? daysBetween(today, request.departDate) : null;
  const result = { policy:{ id:policy.id, name:policy.name, status:policy.status }, grade, international, checks, approvals, leadDays,
    erp:{ name:ERP_CURRENT_RULES.name, grade:grade.erpGrade, workflow:ERP_CURRENT_RULES.workflow, approver:ERP_CURRENT_RULES.approver } };

  if (grade.status === 'unassigned') add('review', 'Grade', `No policy grade (${grade.source}). Entitlements cannot be checked until HR assigns one.`);
  else if (!grade.confirmed) add('review', 'Grade', `Policy grade is provisional (${grade.source}). Entitlements shown are not confirmed.`);

  // Sanctioning authority
  if (international) needApproval(policy.internationalSanction, 'Foreign tour sanction', 'TP 15.0');
  else {
    const authority = agreed(c, id => sanctioningAuthority(id, policy).authority);
    needApproval(authority || 'Sanctioning authority (to be confirmed)', 'Tour sanction', 'TP 5.0');
  }

  // TP 18.10 fare premium — applies to any booking where fares are known
  const fare = farePremium(request.normalFare, request.quotedFare, policy);
  result.fare = fare;
  if (fare.needsApproval) {
    add('approval', 'TP 18.10', `Quoted fare is ${fare.pct}% above the normal fare (${policy.fareIncreaseApprovalPct}% or more needs prior approval).`);
    needApproval(policy.fareApprover, `Fare ${policy.fareIncreaseApprovalPct}%+ above normal`, 'TP 18.10');
  }

  if (international) {
    const countryCategory = classifyCountry(request.country || request.destination, policy);
    Object.assign(result, {
      countryCategory,
      travelClass: agreed(c, id => internationalClass(id, policy).cls),
      dailyTotal: range(c.map(id => internationalDailyLimits(id, countryCategory, policy).total))
    });
    if (leadDays !== null && leadDays < policy.internationalAdvanceDays) {
      add('review', 'TP 15.3', `International tour plans should be made and approved at least ${policy.internationalAdvanceDays} days ahead; this one is ${leadDays} day${leadDays === 1 ? '' : 's'} away. Needs review by the sanctioning authority.`);
      needApproval(policy.internationalSanction, 'Review short-notice foreign tour', 'TP 15.3');
    }
    if (!request.country) add('info', 'TP Annex III', 'Destination country not given; B-class limits assumed.');
  } else {
    const city = classifyCity(request.destination, policy);
    const air = agreed(c, id => domesticEntitlement(id, policy).air);
    const dailies = c.map(id => domesticDailyLimits(id, city.category || 'B', policy));
    Object.assign(result, {
      city,
      air: { value: air, confirmed: grade.confirmed && air !== null },
      daily: dailies.length ? { hotel:range(dailies.map(d => d.hotel)), food:range(dailies.map(d => d.food)), incidental:range(dailies.map(d => d.incidental)) } : null,
      destinationTravel: agreed(c, id => destinationTravel(id, policy)?.mode)
    });
    if (city.unresolved) add('info', 'TP Annex I', `${city.city} is listed in the supplied A-category table but is unresolved; not classified.`);

    const mode = request.preferredMode;
    if (mode === 'flight') {
      if (grade.confirmed && air === false) {
        add('approval', 'TP 4.3.2', 'Not entitled to air travel. Air needs written ED / Dy. ED approval (business urgency or no train availability).');
        needApproval('ED / Dy. ED', 'Air travel above entitlement', 'TP 4.3.2');
      } else if (!grade.confirmed) {
        add('review', 'TP 4.3', 'Air entitlement is not confirmed because the policy grade is provisional. Confirm the grade, or treat as above entitlement (ED / Dy. ED approval).');
        needApproval('HR / Travel Admin', 'Confirm air entitlement', 'TP 4.3');
      }
    }
    if (['car', 'van'].includes(mode)) {
      const people = Number(request.people || 1);
      if (people < policy.intercityCabMinTravellers) add('block', 'TP 7.1', `Intercity cab needs at least ${policy.intercityCabMinTravellers} employees travelling together; this request has ${people}. Train or Volvo bus is the first preference.`);
      else add('approval', 'TP 7.1', 'Intercity cab for 3+ employees is an exception and needs ED / Dy. ED approval before the tour.');
      needApproval('ED / Dy. ED', 'Intercity cab', 'TP 7.1');
    }

    // TP 18.1 — advisory only
    if (leadDays !== null && leadDays < policy.domesticAdvanceDays) {
      add('warn', 'TP 18.1', `Planned ${leadDays} day${leadDays === 1 ? '' : 's'} ahead; the policy advises ${policy.domesticAdvanceDays}.` +
        (fare.known ? '' : ` Record the normal and quoted fare: ${policy.fareIncreaseApprovalPct}% or more above normal needs ${policy.fareApprover} approval.`));
    }

    // Distance: local conveyance (150 km) and the separate, unresolved 100 km cab provision
    const local = localConveyanceStatus(request.roundTripKm, policy);
    result.local = local;
    if (local.status === 'unknown') add('info', 'LC 3', 'Round-trip distance not given, so local-conveyance eligibility is not determined.');
    else if (local.status === 'local') add('info', 'LC 3', `${local.km} km round trip is within the ${local.limit} km local-conveyance limit; local conveyance rules apply.`);
    else add('info', 'LC 3, 9', `${local.km} km round trip is beyond the ${local.limit} km local limit; the travel policy applies and prior approval is needed.`);

    const below = c.length && c.every(id => destinationTravel(id, policy)?.cabProvision);
    if (below && local.status !== 'unknown') {
      const cab = cabProvision(request.roundTripKm, policy);
      result.cab = cab;
      if (cab.status === 'unresolved') add('review', 'TP 6.1(c)', `Cab eligibility at ${cab.km} km depends on whether the ${cab.limit} km threshold is one way or round trip, which is unresolved.`);
      else if (cab.status === 'allowed_with_approval') add('info', 'TP 6.1(c)', `Over ${cab.limit} km: a cab or company vehicle may be used with HOD / reporting-manager approval.`);
    }
  }

  // Time away: journey span and buffers kept separate
  if (request.departDate && request.departTime && request.returnDate && request.returnTime) {
    try {
      result.timeAway = timeAway({ depart:`${request.departDate}T${request.departTime}`, departMode:request.preferredMode || null,
        returnAt:`${request.returnDate}T${request.returnTime}`, returnMode:request.preferredMode || null }, { policy, buffers });
    } catch { /* invalid timing is reported by request validation */ }
  }
  return result;
}

const round2 = n => Math.round(n * 100) / 100;

/**
 * Domestic hotel + food + incidental claim under the proposed policy (TP 4.4, Annex II).
 * input: { gradeId, cityCategory, days, nights, hotelSpend, foodSpend, stay: 'hotel'|'personal'|'host',
 *          sameDayReturn, overnightJourneyDays }
 */
export function assessDomesticClaim(input, policy = DEFAULT) {
  const { gradeId, cityCategory = 'B', days = 1, nights = 0, hotelSpend = 0, foodSpend = 0, stay = 'hotel', sameDayReturn = false, overnightJourneyDays = 0 } = input;
  const lim = domesticDailyLimits(gradeId, cityCategory, policy);
  if (!lim) throw Error(`Unknown grade: ${gradeId}`);
  const notes = ['Incidental allowance shown as a per diem; clause 4.4.9 (“only” at conferences) is unresolved and needs review.'];
  let hotel = 0, food = 0;
  const incidental = lim.incidental * days;
  if (sameDayReturn) {
    food = Math.min(foodSpend, lim.food);
    if (foodSpend > food) notes.push(`Food capped at ₹${lim.food} for a same-day return (TP 4.4.6 ii).`);
  } else if (stay === 'personal' || stay === 'host') {
    food = lim.food * days;
    notes.push('Own / host arrangement: full food allowance without bills (TP 4.4.7).');
  } else {
    const foodClaimable = Math.min(foodSpend, policy.foodMaxShareOfHotel * hotelSpend);
    if (foodSpend > foodClaimable) notes.push(`Food limited to ${policy.foodMaxShareOfHotel * 100}% of the hotel bill (TP 4.4.6 i).`);
    const pooledCap = lim.hotel * nights + lim.food * days;
    const total = Math.min(hotelSpend + foodClaimable, pooledCap);
    if (hotelSpend + foodClaimable > pooledCap) notes.push(`Hotel + food capped at ₹${pooledCap} for ${nights} night(s) / ${days} day(s) (Annex II).`);
    hotel = Math.min(hotelSpend, total);
    food = total - hotel;
  }
  const journeyFood = 0.5 * lim.food * overnightJourneyDays, journeyIncidental = lim.incidental * overnightJourneyDays;
  if (overnightJourneyDays) notes.push('Overnight journey instead of hotel: +50% food and +100% incidental per night, no bills (TP 4.4.6 iii).');
  return { limits:lim, hotel:round2(hotel), food:round2(food + journeyFood), incidental:round2(incidental + journeyIncidental),
    admissible:round2(hotel + food + incidental + journeyFood + journeyIncidental), disallowed:round2(Math.max(0, hotelSpend + foodSpend - hotel - food)), notes };
}

/**
 * Self-owned vehicle mileage. Computed under both versions so neither overwrites the other:
 * `rules: 'proposed'` (₹12 / ₹4, LC 4–5) or `rules: 'erp'` (₹15 / ₹7, current ERP).
 */
export function assessMileage({ gradeId, vehicle, km, authorised = false, rules = 'proposed' }, policy = DEFAULT) {
  const distance = Number(km);
  if (!Number.isFinite(distance) || distance <= 0) throw Error('Enter the distance travelled in km.');
  if (!['four_wheeler', 'two_wheeler'].includes(vehicle)) throw Error('Vehicle must be four_wheeler or two_wheeler.');
  const notes = [];
  if (rules === 'erp') {
    const rate = ERP_CURRENT_RULES.mileage[vehicle];
    return { rules:'erp', rate, amount:round2(rate * distance), withinLocalLimit:null, notes:['Current ERP rate; ERP enforces no distance limit.'] };
  }
  const lc = policy.localConveyance;
  let rate = lc.rates[vehicle];
  if (vehicle === 'four_wheeler' && !authorised) {
    if (!gradeId) { notes.push('Policy grade not confirmed; four-wheeler eligibility needs review (LC 4).'); }
    else if (!lc.fourWheelerGrades.includes(gradeId)) { rate = lc.rates.two_wheeler; notes.push('Four-wheeler mileage is for Assistant Manager and above unless authorised; paid at the two-wheeler rate (LC 4).'); }
  }
  const local = localConveyanceStatus(distance, policy);
  if (local.status === 'beyond_local') notes.push(`Over ${lc.maxRoundTripKm} km round trip is not local travel; the travel policy applies (LC 3, 9).`);
  return { rules:'proposed', rate, amount:round2(rate * distance), withinLocalLimit: local.status === 'local', notes };
}

export function domesticExtras(gradeId, policy = DEFAULT) {
  const ent = domesticEntitlement(gradeId, policy);
  return {
    flightMealMax: ent.air ? policy.flightMealMax : 0,
    overnightTrainAllowance: ent.air ? policy.overnightTrainAllowance : 0,
    preferredSeatMax: policy.preferredSeatGrades.includes(gradeId) ? policy.preferredSeatMax : 0,
    agentBookingChargeMax: policy.agentBookingChargeMax
  };
}
