/** HTML for policy checks and the policy reference page. Pure string builders. */
import { esc } from './logic.js';
import { icon } from './icons.js';
import { GRADES, ERP_GRADES, ERP_CURRENT_RULES as ERP, PROPOSED_POLICY_2026 as P, ERP_TO_PROPOSED_CANDIDATES } from './policy.js';
import { domesticEntitlement, sanctioningAuthority, destinationTravel, internationalClass, internationalDailyLimits, gradeById } from './entitlements.js';

const inr = n => `₹${Number(n).toLocaleString('en-IN')}`;
const usd = n => `$${Number(n).toLocaleString('en-US')}`;
const span = (r, fmt) => !r ? '—' : r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
const hrs = n => `${Math.round(n * 10) / 10} h`;
const LEVEL = { block:['alert','Not allowed as requested'], approval:['shield','Extra approval needed'], review:['search','Needs review'], warn:['clock','Advisory'], info:['info','Note'] };
const GRADE_STATUS = { confirmed:'Confirmed by HR', provisional:'Provisional', unassigned:'Not assigned' };

export const erpGradeOptions = selected => `<option value="">No ERP grade</option>${ERP_GRADES.map(gr => `<option value="${esc(gr.id)}" ${gr.id === selected ? 'selected' : ''}>${esc(gr.label)}</option>`).join('')}`;
export const policyGradeOptions = selected => `<option value="">Not set (provisional from ERP grade)</option>${GRADES.map(gr => `<option value="${gr.id}" ${gr.id === selected ? 'selected' : ''}>${esc(gr.label)}</option>`).join('')}`;

export function gradeSummary(grade) {
  const policy = grade.candidates.length > 2 ? `${grade.candidates.length} possible grades` : grade.label;
  return `${grade.erpGrade ? `ERP: ${grade.erpGrade}` : 'No ERP grade'} · Policy: ${policy} (${GRADE_STATUS[grade.status]})`;
}

/** Chip label for a transport mode in the request wizard, or '' when nothing needs saying. */
export function modeTag(evaluation, modeId) {
  if (!evaluation || evaluation.international) return '';
  if (modeId === 'flight') return evaluation.air?.confirmed ? (evaluation.air.value ? '' : 'Needs approval') : 'Needs review';
  if (['car', 'van'].includes(modeId)) return 'Needs approval';
  return '';
}

/** Entitlement, checks and approval route for one request. */
export function policyPanel(ev, { compact = false } = {}) {
  if (!ev) return '';
  const rows = [['ERP grade', ev.grade.erpGrade || 'None on record'], ['Policy grade', `${ev.grade.label} · ${GRADE_STATUS[ev.grade.status]}`]];
  if (ev.international) {
    rows.push(['Country class', ev.countryCategory ? `${ev.countryCategory} class` : 'Not set']);
    rows.push(['Air class', ev.travelClass || 'Depends on grade']);
    rows.push(['Daily limit (USD, all heads)', span(ev.dailyTotal, usd)]);
  } else {
    rows.push(['Destination', ev.city.category ? (ev.city.city ? `${ev.city.city} · ${ev.city.category} category` : `${ev.city.category} category city`) : ev.city.unresolved ? `${ev.city.city} · unresolved` : 'Not set']);
    rows.push(['Air entitlement', ev.air.value === null ? 'Unknown until grade is confirmed' : `${ev.air.value ? 'Yes (economy)' : 'No'}${ev.air.confirmed ? '' : ' · provisional'}`]);
    if (ev.daily) rows.push(['Daily limit', `Hotel up to ${span(ev.daily.hotel, inr)} · Food up to ${span(ev.daily.food, inr)} · Incidental ${span(ev.daily.incidental, inr)}`]);
    rows.push(['Round trip', ev.local.km === null ? 'Not given' : `${ev.local.km} km · ${ev.local.status === 'local' ? 'local conveyance' : 'beyond local limit'}`]);
    if (!compact && ev.destinationTravel) rows.push(['At destination', ev.destinationTravel]);
  }
  if (ev.fare?.known) rows.push(['Fare vs normal', `${ev.fare.pct > 0 ? '+' : ''}${ev.fare.pct}%`]);
  if (ev.timeAway) {
    const t = ev.timeAway;
    rows.push(['Time away', `${hrs(t.journey.hours)} journey + ${hrs(t.buffers.before)} before + ${hrs(t.buffers.after)} after = ${hrs(t.hours)}${t.buffers.provisional && (t.buffers.before || t.buffers.after) ? ' (buffers provisional)' : ''}${!t.buffers.before && !t.buffers.after ? ' (no mode chosen, no buffers)' : ''}`]);
  }
  const checks = ev.checks.length
    ? `<ul class="policy-checks">${ev.checks.map(c => `<li class="policy-check policy-${c.level}">${icon(LEVEL[c.level][0], 16)}<span><strong>${LEVEL[c.level][1]}</strong> ${esc(c.message)} <small>${esc(c.rule)}</small></span></li>`).join('')}</ul>`
    : `<p class="policy-ok">${icon('checkCircle', 16)} No issues for the details given.</p>`;
  const chain = `<ol class="approval-chain">${ev.approvals.map(a => `<li><strong>${esc(a.role)}</strong><small>${esc(a.reason)} · ${esc(a.rule)}</small></li>`).join('')}</ol>`;
  return `<div class="policy-panel"><p class="policy-basis">${icon('info', 15)} Checked against the <strong>${esc(ev.policy.name)}</strong> (${esc(ev.policy.status)}). Current ERP workflow: ${esc(ev.erp.workflow.join(' → '))}.</p><div class="policy-grid">${rows.map(([k, v]) => `<div class="detail-item"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>${checks}<h4 class="policy-subhead">Approval route (proposed policy)</h4>${chain}</div>`;
}

const table = (head, body) => `<div class="admin-table-wrap"><table class="data-table policy-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const card = (iconName, title, body, tag = '') => `<section class="surface-card"><div class="card-heading"><h2>${icon(iconName, 19)}${esc(title)}</h2>${tag}</div>${body}</section>`;
const tag = (text, tone) => `<span class="version-tag ${tone}">${esc(text)}</span>`;

/** The admin Travel policy page: current ERP rules and the proposed policy, kept apart. */
export function policyTables() {
  const unresolved = card('alert', 'Unresolved — awaiting policy owner / HR',
    `<ul class="unresolved-list">${P.unresolved.map(u => `<li><strong>${esc(u.clause)}</strong> ${esc(u.topic)}</li>`).join('')}</ul>`);

  const erpBody = `<p class="settings-copy">${esc(ERP.source)}. Shown for comparison only; the app does not change ERP.</p>
    <div class="policy-rules">
      <div class="detail-item"><span>Grades</span><strong>${esc(ERP_GRADES.map(gr => gr.label).join(' · '))}</strong></div>
      <div class="detail-item"><span>Mileage</span><strong>${inr(ERP.mileage.four_wheeler)}/km four-wheeler · ${inr(ERP.mileage.two_wheeler)}/km two-wheeler</strong></div>
      <div class="detail-item"><span>Manager to DGM</span><strong>Lodging ${inr(ERP.lodging['Manager to DGM'].first)} / ${inr(ERP.lodging['Manager to DGM'].second)} · Per diem ${inr(ERP.perDiem['Manager to DGM'].first)} / ${inr(ERP.perDiem['Manager to DGM'].second)}</strong></div>
      <div class="detail-item"><span>International</span><strong>${esc(ERP.international.currency)} reference amounts (values not captured)</strong></div>
      <div class="detail-item"><span>Class A cities</span><strong>${esc(ERP.classACities.join(', '))}</strong></div>
      <div class="detail-item"><span>Workflow</span><strong>${esc(ERP.workflow.join(' → '))}</strong></div>
      <div class="detail-item"><span>Short notice / fare premium / distance</span><strong>No rule in ERP</strong></div>
    </div><p class="micro-disclaimer">${esc(ERP.amountsNote)}</p>`;

  const mapping = table(['ERP grade', 'Possible policy grades (provisional)'],
    ERP_GRADES.map(gr => [gr.label, ERP_TO_PROPOSED_CANDIDATES[gr.id].map(id => gradeById(id).label).join(' / ') || 'No mapping — HR to assign']));

  const daily = table(['Grade', 'Hotel A', 'Hotel B', 'Food (bills)', 'Incidental', 'Air', 'Sanctioned by', 'At destination'],
    GRADES.map(gr => {
      const d = P.domesticDaily[gr.id];
      return [gr.label, inr(d.hotelA), inr(d.hotelB), inr(d.food), inr(d.incidental), domesticEntitlement(gr.id).air ? 'Yes' : 'No', sanctioningAuthority(gr.id).authority, destinationTravel(gr.id).mode];
    }));
  const intl = table(['Grade', 'Class', 'A countries / day', 'B countries / day'],
    GRADES.map(gr => [gr.label, internationalClass(gr.id).cls, usd(internationalDailyLimits(gr.id, 'A').total), usd(internationalDailyLimits(gr.id, 'B').total)]));
  const lc = P.localConveyance, b = P.timeAwayBuffers;
  const rules = [
    ['A-category cities', Object.keys(P.domesticCities.A).join(', ') + '. All others are B. Kathmandu unresolved.'],
    ['Short notice', `Domestic under ${P.domesticAdvanceDays} days: advisory. International under ${P.internationalAdvanceDays} days: review by sanctioning authority.`],
    ['Fare premium', `${P.fareIncreaseApprovalPct}% or more above the normal fare needs prior ${P.fareApprover} approval (TP 18.10).`],
    ['Local conveyance', `Up to ${lc.maxRoundTripKm} km round trip, from the captured distance. ${inr(lc.rates.four_wheeler)}/km four-wheeler (Asst. Manager and above), ${inr(lc.rates.two_wheeler)}/km two-wheeler.`],
    ['Cab beyond 100 km', `Below Asst. Manager, with HOD approval (TP 6.1c). One-way vs round-trip basis unresolved, so 101–200 km goes to review.`],
    ['Time away', `Journey span plus buffers, shown separately. Provisional flight buffers: ${b.beforeDepartureHours.flight} h before, ${b.afterReturnHours.flight} h after.`],
    ['Intercity cab', `Only with ${P.intercityCabMinTravellers}+ employees and ED / Dy. ED approval (TP 7.1).`],
    ['Food vs hotel', `Pooled within the combined cap; food at most ${P.foodMaxShareOfHotel * 100}% of the hotel bill (TP 4.4.6).`]
  ];

  return `${unresolved}
  ${card('building', 'Current ERP rules', erpBody, tag('In force in ERP', 'erp'))}
  ${card('users', 'ERP grade → policy grade (provisional)', mapping + '<p class="micro-disclaimer">Used only until HR confirms each employee’s policy grade. Designation is never used. Air entitlement on a provisional grade always needs review.</p>', tag('Provisional', 'warn'))}
  ${card('layers', 'Proposed policy — domestic entitlements', daily, tag('Proposed · not in force', 'proposed'))}
  ${card('route', 'Proposed policy — international', intl, tag('Proposed · not in force', 'proposed'))}
  ${card('clipboard', 'Proposed policy — key rules', `<div class="policy-rules">${rules.map(([k, v]) => `<div class="detail-item"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`, tag('Proposed · not in force', 'proposed'))}`;
}
