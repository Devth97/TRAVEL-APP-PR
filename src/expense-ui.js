/** Expense tracker and approval centre (ERP mode). Data lives in ERP; this module only renders and calls /api. */
import { esc, niceDate, shortDate, dateOffset } from './logic.js';
import { icon } from './icons.js';
import { button, emptyState, topSection } from './ui.js';
import { erpApi } from './erp-client.js';
import { domesticDailyLimits, resolveGrade } from './entitlements.js';
import { ERP_CURRENT_RULES, PROPOSED_POLICY_2026 } from './policy.js';
import { BILL_EXTENSIONS, BILL_MAX_BYTES, EXPENSE_TYPES, LEG_CATEGORIES, billRequired, expenseSummary, legAmount, legsKm, legsTotal, monthGrid, shiftMonth } from '../convex/lib/expenses.js';

export const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const KM_LIMIT = PROPOSED_POLICY_2026.localConveyance.maxRoundTripKm;
const blankLeg = () => ({ from: '', to: '', category: 'four_wheeler', km: '', amount: '' });
const typeIcons = { conveyance: 'car', local_food: 'gift', hotel: 'building', food: 'gift', fare: 'plane', own_vehicle: 'car', taxi: 'car', incidental: 'file', exceptional: 'alert' };
const statusLabels = { ready: 'Ready', estimate: 'Estimate', pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected', submitted: 'Pending approval' };
const badgeClass = { ready: 'draft', estimate: 'draft', pending: 'submitted', submitted: 'submitted', approved: 'approved', rejected: 'rejected' };
const statusBadge = s => `<span class="badge badge-${badgeClass[s] || 'draft'}"><i aria-hidden="true"></i>${esc(statusLabels[s] || s)}</span>`;
const readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(Error('That file could not be read.'));
  r.readAsDataURL(file);
});

/** The arrangements line the assistant writes into a travel request's notes. */
export const arrangementsOf = r => /Arrangements requested \(Travel Admin to book\): (.*)/.exec(r?.notes || '')?.[1] || '';

export function createExpenses({ render, notify, user, isAdmin }) {
  const s = { loaded: false, loading: false, items: [], tab: 'ready', selected: new Set(), month: dateOffset(0).slice(0, 7), adding: null, openId: null, busy: false,
    approvals: null, approvalsLoading: false, apTab: 'pending' };

  const load = () => {
    if (s.loading) return Promise.resolve();
    s.loading = true;
    return erpApi.expenses().then(r => { s.items = r.expenses; s.loaded = true; }).catch(e => { s.loaded = true; notify(e.message, 'error'); }).finally(() => { s.loading = false; });
  };
  const loadApprovals = () => {
    s.approvalsLoading = true;
    return erpApi.approvals().then(r => { s.approvals = r; }).catch(e => { s.approvals = { travel: [], expenses: [] }; notify(e.message, 'error'); }).finally(() => { s.approvalsLoading = false; });
  };
  const busy = (promise, done) => {
    if (s.busy) return;
    s.busy = true; render();
    promise.then(done).catch(e => notify(e.message, 'error')).finally(() => { s.busy = false; render(); });
  };

  /* ---------- policy hints: advisory, from the proposed policy ---------- */
  function limitHint(type) {
    const key = { hotel: 'hotel', food: 'food', local_food: 'food', incidental: 'incidental' }[type];
    if (!key) return '';
    const ids = resolveGrade(user()).candidates || [];
    const values = cat => ids.map(id => domesticDailyLimits(id, cat, undefined)?.[key]).filter(Boolean);
    const show = v => v.length ? (Math.min(...v) === Math.max(...v) ? money(v[0]) : `${money(Math.min(...v))} to ${money(Math.max(...v))}`) : '';
    const a = show(values('A')), b = show(values('B'));
    if (!a) return 'No policy limit shown: your policy grade is not assigned yet.';
    const per = key === 'hotel' ? 'a night' : 'a day';
    return `Proposed policy limit (not in force yet): ${a === b ? a : `A-city ${a}, B-city ${b}`} ${per}.`;
  }

  /* ---------- add expense ---------- */
  function typeCards() {
    const a = s.adding;
    const cat = a.category;
    return `<div class="xp-seg" role="group" aria-label="Expense category">${[['local', 'Local'], ['inland', 'Inland (domestic)']].map(([id, label]) => `<button type="button" class="${cat === id ? 'active' : ''}" aria-pressed="${cat === id}" data-action="xp-category" data-id="${id}">${label}</button>`).join('')}</div>
    <div class="xp-types">${Object.entries(EXPENSE_TYPES).filter(([, t]) => t.category === cat).map(([id, t]) => `<button type="button" class="xp-type ${a.type === id ? 'selected' : ''}" aria-pressed="${a.type === id}" data-action="xp-type" data-id="${id}"><span>${icon(typeIcons[id] || 'file', 20)}</span>${esc(t.label)}</button>`).join('')}</div>`;
  }
  function legRow(l, i) {
    const cat = LEG_CATEGORIES[l.category];
    return `<div class="xp-leg" data-leg="${i}">
      <label class="form-field"><span class="field-label">From</span><input data-leg-field="from" value="${esc(l.from)}" placeholder="Residence" /></label>
      <label class="form-field"><span class="field-label">To</span><input data-leg-field="to" value="${esc(l.to)}" placeholder="Customer site" /></label>
      <label class="form-field"><span class="field-label">Category</span><select data-leg-field="category">${Object.entries(LEG_CATEGORIES).map(([id, c]) => `<option value="${id}" ${l.category === id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
      ${cat.perKm
    ? `<label class="form-field"><span class="field-label">Distance (km)</span><input data-leg-field="km" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(l.km)}" /></label>`
    : `<label class="form-field"><span class="field-label">Amount (₹)</span><input data-leg-field="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(l.amount)}" /></label>`}
      <div class="xp-leg-amount"><span class="field-label">Claim</span><strong data-leg-amount>${money(legAmount(l))}</strong></div>
      <button type="button" class="btn btn-text xp-leg-remove" data-action="xp-leg-remove" data-id="${i}" aria-label="Remove leg ${i + 1}">${icon('x', 16)}</button>
    </div>`;
  }
  function kmMeter(legs) {
    const km = legsKm(legs), pct = Math.min(100, (km / KM_LIMIT) * 100);
    return `<div class="xp-meter ${km > KM_LIMIT ? 'over' : ''}"><div class="xp-meter-top"><span><strong data-km-used>${km}</strong> km used</span><span>Local limit ${KM_LIMIT} km round trip (proposed policy)</span></div><div class="xp-meter-bar"><i data-km-bar style="width:${pct}%"></i></div></div>`;
  }
  function addForm() {
    const a = s.adding, def = EXPENSE_TYPES[a.type];
    const bill = billRequired({ type: a.type, legs: a.legs });
    const fields = !def ? '' : a.type === 'conveyance'
      ? `${kmMeter(a.legs)}<div class="xp-legs">${a.legs.map(legRow).join('')}</div>
         <div class="xp-legs-foot">${button('Add leg', 'xp-leg-add', { variant: 'btn-outline', icon: 'plus' })}<span>Total claim <strong data-legs-total>${money(legsTotal(a.legs))}</strong></span></div>
         <p class="field-hint">Own vehicle rates in force in ERP: ₹${ERP_CURRENT_RULES.mileage.four_wheeler}/km for a 4-wheeler and ₹${ERP_CURRENT_RULES.mileage.two_wheeler}/km for a 2-wheeler. Toll, parking and taxi legs need a bill.</p>`
      : `<label class="form-field"><span class="field-label">Amount (₹) <i>*</i></span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" required value="${esc(a.amount || '')}" />${limitHint(a.type) ? `<span class="field-hint">${esc(limitHint(a.type))}</span>` : ''}</label>`;
    return `<section class="surface-card xp-add"><div class="card-heading"><h2>${icon('plus', 19)}Add an expense</h2>${button('Close', 'xp-add-close', { variant: 'btn-text' })}</div>
      ${typeCards()}
      ${def ? `<form id="expense-form" class="xp-form">
        <div class="form-grid">
          <label class="form-field"><span class="field-label">Expense date <i>*</i></span><input name="date" type="date" required max="${dateOffset(0)}" value="${esc(a.date)}" /></label>
          <label class="form-field"><span class="field-label">Purpose</span><input name="purpose" maxlength="140" value="${esc(a.purpose || '')}" placeholder="Site visit to Bhiwandi" /></label>
          ${a.type === 'conveyance' ? '' : `<label class="form-field"><span class="field-label">Description</span><input name="description" maxlength="300" value="${esc(a.description || '')}" /></label>`}
        </div>
        ${fields}
        <label class="form-field xp-bill-field"><span class="field-label">Bill or invoice ${bill ? '<i>*</i>' : '(optional)'}</span><input name="bill" type="file" accept=".jpg,.jpeg,.png,.pdf" /><span class="field-hint">JPG, PNG or PDF, up to 4 MB.${bill ? ' You can add it later, but it is needed before you send this for approval.' : ''}</span></label>
        <div class="xp-form-actions">${button('Cancel', 'xp-add-close', { variant: 'btn-outline' })}<button class="btn btn-primary" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Saving to ERP…' : 'Save expense'}</button></div>
      </form>` : '<p class="field-hint">Choose an expense type to continue.</p>'}
    </section>`;
  }

  /* ---------- lists ---------- */
  function detail(e) {
    const legs = (e.legs || []).length ? `<table class="xp-table"><thead><tr><th>From</th><th>To</th><th>Category</th><th>Km</th><th>Claim</th></tr></thead><tbody>${e.legs.map(l => `<tr><td>${esc(l.from)}</td><td>${esc(l.to)}</td><td>${esc(LEG_CATEGORIES[l.category]?.label || l.category)}</td><td>${LEG_CATEGORIES[l.category]?.perKm ? esc(l.km) : '—'}</td><td>${money(l.amount)}</td></tr>`).join('')}</tbody></table>` : '';
    const rows = (e.rows || []).length ? `<table class="xp-table"><thead><tr><th>Item</th><th>Basis</th><th>Estimate</th></tr></thead><tbody>${e.rows.map(r => `<tr><td>${esc(EXPENSE_TYPES[r.type]?.label || r.type)}</td><td>${esc(r.description)}</td><td>${money(r.amount)}</td></tr>`).join('')}</tbody></table>` : '';
    const facts = [['ERP record', e.id], ['Purpose', e.purpose], ['Description', e.description], ['Travel request', e.request], ['Report', e.report], ['Bill', e.billName || (e.needsBill ? 'Needed before sending' : '')], ['Decided by', e.decidedBy], ['Note', e.decisionNote]].filter(([, v]) => v);
    return `<div class="xp-detail"><dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${legs}${rows}</div>`;
  }
  function row(e, { selectable = false, actions = '' } = {}) {
    const open = s.openId === e.id;
    return `<article class="xp-row ${e.status === 'estimate' ? 'is-estimate' : ''}">
      <div class="xp-row-main">
        ${selectable ? `<input type="checkbox" class="xp-check" aria-label="Select ${esc(e.id)}" data-action="xp-select" data-id="${esc(e.id)}" ${s.selected.has(e.id) ? 'checked' : ''} />` : ''}
        <span class="xp-row-icon">${icon(typeIcons[e.type] || 'file', 18)}</span>
        <div class="xp-row-text"><strong>${esc(e.estimate ? 'Trip expense estimate' : (EXPENSE_TYPES[e.type]?.label || 'Expense'))}</strong><small>${esc(niceDate(e.date))}${e.purpose ? ` · ${esc(e.purpose)}` : ''}${e.report ? ` · ${esc(e.report)}` : ''}</small>
        ${e.needsBill ? `<small class="xp-warn">${icon('alert', 13)} Bill needed before sending</small>` : ''}${e.billName ? `<small class="xp-ok">${icon('file', 13)} ${esc(e.billName)}</small>` : ''}${e.status === 'estimate' ? '<small class="xp-muted">Planning figure only. Add actual expenses with bills after the trip.</small>' : ''}${e.status === 'rejected' && e.decisionNote ? `<small class="xp-warn">Reason: ${esc(e.decisionNote)}</small>` : ''}</div>
        <div class="xp-row-end"><strong class="xp-amount">${money(e.amount)}</strong>${statusBadge(e.status)}</div>
      </div>
      <div class="xp-row-actions">${button(open ? 'Hide details' : 'View', 'xp-open', { variant: 'btn-text', data: `data-id="${esc(e.id)}"` })}${actions}</div>
      ${open ? detail(e) : ''}
    </article>`;
  }
  function readyTab(items) {
    const claimable = items.filter(e => e.status === 'ready');
    const chosen = claimable.filter(e => s.selected.has(e.id));
    const total = chosen.reduce((sum, e) => sum + e.amount, 0);
    const actions = e => `<label class="btn btn-text xp-bill-btn">${icon('upload', 15)}${e.billName ? 'Replace bill' : 'Add bill'}<input type="file" accept=".jpg,.jpeg,.png,.pdf" class="xp-bill-input" data-id="${esc(e.id)}" /></label>${button('Delete', 'xp-delete', { variant: 'btn-text', class: 'xp-danger', data: `data-id="${esc(e.id)}"` })}`;
    return `<div class="xp-howto">${icon('info', 18)}<div><strong>How to claim</strong><p>Tick the expenses you want reimbursed, then choose Generate report and send. Track them under Pending and Approved.</p></div></div>
      ${chosen.length ? `<div class="xp-selection"><span><strong>${chosen.length}</strong> selected · ${money(total)}</span><div>${button('Clear', 'xp-clear', { variant: 'btn-outline' })}${button(s.busy ? 'Sending…' : 'Generate report and send', 'xp-send', { icon: 'file', disabled: s.busy })}</div></div>` : ''}
      <div class="xp-list">${items.length ? items.map(e => row(e, { selectable: e.status === 'ready', actions: e.status === 'estimate' ? button('Delete', 'xp-delete', { variant: 'btn-text', class: 'xp-danger', data: `data-id="${esc(e.id)}"` }) : actions(e) })).join('') : emptyState('Nothing waiting to be claimed', 'Add an expense, or ask the travel assistant to plan a trip.', 'clipboard', button('Add expense', 'xp-add', { variant: 'btn-soft' }))}</div>`;
  }
  function calendar() {
    const g = monthGrid(s.month, s.items);
    const title = new Date(`${s.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return `<div class="xp-cal"><div class="xp-cal-top"><button type="button" class="btn btn-outline" data-action="xp-month" data-id="-1" aria-label="Previous month">${icon('arrowLeft', 16)}</button><strong>${esc(title)}</strong><button type="button" class="btn btn-outline" data-action="xp-month" data-id="1" aria-label="Next month">${icon('arrowRight', 16)}</button><span class="xp-cal-total">${g.count} ${g.count === 1 ? 'expense' : 'expenses'} · ${money(g.total)}</span></div>
      <div class="xp-cal-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<b>${d}</b>`).join('')}${g.cells.map(c => !c ? '<div class="xp-day blank"></div>' : `<div class="xp-day ${c.items.length ? `has st-${[...new Set(c.items.map(i => i.status))].length === 1 ? c.items[0].status : 'mixed'}` : ''} ${c.date === dateOffset(0) ? 'today' : ''}"><span>${c.day}</span>${c.items.length ? `<strong>${money(c.total)}</strong><small>${c.items.length} item${c.items.length === 1 ? '' : 's'}</small>` : ''}</div>`).join('')}</div>
      <div class="xp-cal-legend"><span class="st-approved">Approved</span><span class="st-pending">Pending</span><span class="st-ready">Ready</span><span class="st-rejected">Rejected</span></div></div>`;
  }

  function view() {
    if (!s.loaded && !s.loading) load().then(render);
    const sum = expenseSummary(s.items);
    const tabs = [['ready', 'Ready', sum.ready[0] + sum.estimate[0]], ['pending', 'Pending', sum.pending[0]], ['approved', 'Approved', sum.approved[0]], ['rejected', 'Rejected', sum.rejected[0]], ['calendar', 'Calendar', null]];
    const list = st => s.items.filter(e => e.status === st);
    const body = !s.loaded ? '<p class="xp-loading">Loading from ERP…</p>'
      : s.tab === 'ready' ? readyTab(s.items.filter(e => ['ready', 'estimate'].includes(e.status)))
        : s.tab === 'calendar' ? calendar()
          : `<div class="xp-list">${list(s.tab).length ? list(s.tab).map(e => row(e)).join('') : emptyState(`Nothing ${statusLabels[s.tab].toLowerCase()}`, 'Expenses appear here as they move through approval.', 'clipboard')}</div>`;
    return `${topSection('EXPENSES', 'Expense tracker', 'Record what you spent on a trip and send it for approval. ERP keeps the record.', s.adding ? '' : button('Add expense', 'xp-add', { icon: 'plus' }))}
      ${s.adding ? addForm() : ''}
      <div class="xp-stats"><div><span>Ready to claim</span><strong>${money(sum.ready[1])}</strong></div><div><span>Pending approval</span><strong>${money(sum.pending[1])}</strong></div><div><span>Approved</span><strong>${money(sum.approved[1])}</strong></div></div>
      <section class="surface-card page-card"><div class="tab-row" role="tablist">${tabs.map(([id, label, n]) => `<button type="button" role="tab" aria-selected="${s.tab === id}" class="tab ${s.tab === id ? 'active' : ''}" data-action="xp-tab" data-id="${id}">${label}${n === null ? '' : ` <span class="xp-count">${n}</span>`}</button>`).join('')}</div><div class="xp-panel">${body}</div></section>`;
  }

  /* ---------- approvals ---------- */
  function approvalCard(kind, r) {
    const isTrip = kind === 'travel';
    const pending = isTrip ? r.status === 'submitted' : r.status === 'pending';
    const id = esc(r.id);
    const headline = isTrip ? `${esc(r.origin)} → ${esc(r.destination)}` : `${esc(EXPENSE_TYPES[r.type]?.label || 'Expense')} · ${money(r.amount)}`;
    const sub = isTrip ? `${esc(r.purpose)} · ${esc(shortDate(r.departDate))}${r.returnDate ? ` to ${esc(shortDate(r.returnDate))}` : ''}` : `${esc(niceDate(r.date))}${r.purpose ? ` · ${esc(r.purpose)}` : ''}${r.report ? ` · ${esc(r.report)}` : ''}`;
    const extra = isTrip && arrangementsOf(r) ? `<p class="xp-arrange">${icon('building', 14)} ${esc(arrangementsOf(r))}</p>` : (!isTrip && r.billName ? `<p class="xp-arrange">${icon('file', 14)} ${esc(r.billName)}</p>` : '');
    return `<article class="xp-approval"><div class="xp-approval-head"><span class="xp-row-icon">${icon(isTrip ? 'route' : (typeIcons[r.type] || 'file'), 18)}</span><div><span class="xp-kind">${isTrip ? 'Travel request' : 'Expense'} · ${esc(r.employeeName)}</span><strong>${headline}</strong><small>${sub}</small>${extra}</div>${statusBadge(r.status)}</div>
      ${pending ? `<div class="xp-approval-actions"><input class="xp-note" data-note-for="${id}" maxlength="300" aria-label="Note for ${id}" placeholder="Note (needed if you reject)" />${button('Reject', 'ap-decide', { variant: 'btn-danger-outline', disabled: s.busy, data: `data-id="${id}" data-kind="${kind}" data-decision="reject"` })}${button('Approve', 'ap-decide', { variant: 'btn-success', disabled: s.busy, data: `data-id="${id}" data-kind="${kind}" data-decision="approve"` })}</div>` : (r.decisionNote ? `<p class="xp-muted">${esc(r.decisionNote)}</p>` : '')}</article>`;
  }
  function approvalsView() {
    if (!s.approvals && !s.approvalsLoading) loadApprovals().then(render);
    const a = s.approvals || { travel: [], expenses: [] };
    const all = [...a.travel.map(r => ['travel', r]), ...a.expenses.map(r => ['expense', r])];
    const isPending = ([k, r]) => (k === 'travel' ? r.status === 'submitted' : r.status === 'pending');
    const count = st => all.filter(([, r]) => r.status === st).length;
    const pendingItems = all.filter(isPending), decided = all.filter(x => !isPending(x));
    const toBook = a.travel.filter(r => r.status === 'approved' && arrangementsOf(r));
    const tabs = [['pending', 'Pending', pendingItems.length], ['decided', 'Decided', decided.length], ...(isAdmin() ? [['arrange', 'To arrange', toBook.length]] : [])];
    const tab = tabs.some(t => t[0] === s.apTab) ? s.apTab : 'pending';
    const items = tab === 'pending' ? pendingItems : decided;
    const body = !s.approvals ? '<p class="xp-loading">Loading from ERP…</p>'
      : tab === 'arrange' ? (toBook.length ? `<div class="xp-howto">${icon('info', 18)}<div><strong>Book these with your usual providers</strong><p>ProRack Move does not book hotels or cabs itself. These approved trips asked for arrangements.</p></div></div><div class="xp-list">${toBook.map(r => approvalCard('travel', r)).join('')}</div>` : emptyState('Nothing to arrange', 'Approved trips that ask for a hotel or cab appear here.', 'checkCircle'))
        : items.length ? `<div class="xp-list">${items.map(([k, r]) => approvalCard(k, r)).join('')}</div>`
          : emptyState(tab === 'pending' ? 'All clear' : 'No decisions yet', tab === 'pending' ? 'No requests are waiting for your approval.' : 'Requests you decide appear here.', 'checkCircle');
    return `${topSection('APPROVALS', 'Approval centre', 'Review the travel requests and expenses waiting for your decision.', button('Refresh', 'ap-refresh', { variant: 'btn-outline', icon: 'refresh' }))}
      <div class="xp-stats"><div><span>Pending</span><strong>${pendingItems.length}</strong></div><div><span>Approved</span><strong>${count('approved')}</strong></div><div><span>Rejected</span><strong>${count('rejected')}</strong></div></div>
      <section class="surface-card page-card"><div class="tab-row" role="tablist">${tabs.map(([id, label, n]) => `<button type="button" role="tab" aria-selected="${tab === id}" class="tab ${tab === id ? 'active' : ''}" data-action="ap-tab" data-id="${id}">${label} <span class="xp-count">${n}</span></button>`).join('')}</div><div class="xp-panel">${body}</div></section>`;
  }

  /* ---------- events ---------- */
  function captureAdding(form) {
    if (!s.adding || !form) return;
    for (const el of form.querySelectorAll('input[name]:not([type="file"])')) s.adding[el.name] = el.value;
  }
  const startAdding = () => ({ category: 'local', type: '', date: dateOffset(0), legs: [blankLeg()] });

  function action(name, el) {
    const id = el.dataset.id;
    switch (name) {
      case 'xp-tab': s.tab = id; render(); return true;
      case 'xp-add': s.adding = startAdding(); render(); return true;
      case 'xp-add-close': s.adding = null; render(); return true;
      case 'xp-category': captureAdding(document.getElementById('expense-form')); s.adding.category = id; s.adding.type = ''; render(); return true;
      case 'xp-type': captureAdding(document.getElementById('expense-form')); s.adding.type = id; render(); return true;
      case 'xp-leg-add': captureAdding(document.getElementById('expense-form')); s.adding.legs.push({ ...blankLeg(), from: s.adding.legs.at(-1)?.to || '' }); render(); return true;
      case 'xp-leg-remove': captureAdding(document.getElementById('expense-form')); s.adding.legs.splice(Number(id), 1); if (!s.adding.legs.length) s.adding.legs.push(blankLeg()); render(); return true;
      case 'xp-open': s.openId = s.openId === id ? null : id; render(); return true;
      case 'xp-select': if (el.checked) s.selected.add(id); else s.selected.delete(id); render(); return true;
      case 'xp-clear': s.selected.clear(); render(); return true;
      case 'xp-month': s.month = shiftMonth(s.month, Number(id)); render(); return true;
      case 'xp-delete': busy(erpApi.deleteExpense(id).then(load), () => { s.selected.delete(id); notify('Expense deleted.'); }); return true;
      case 'xp-send': {
        const names = s.items.filter(e => e.status === 'ready' && s.selected.has(e.id)).map(e => e.id);
        busy(erpApi.sendExpenses(names).then(async r => { await load(); return r; }), r => { s.selected.clear(); s.tab = 'pending'; s.approvals = null; notify(`Report ${r.report} sent for approval.`); });
        return true;
      }
      case 'ap-tab': s.apTab = id; render(); return true;
      case 'ap-refresh': s.approvals = null; render(); return true;
      case 'ap-decide': {
        const note = [...document.querySelectorAll('[data-note-for]')].find(n => n.dataset.noteFor === id)?.value || '';
        const call = el.dataset.kind === 'travel' ? erpApi.decideTravel(id, el.dataset.decision, note) : erpApi.decideExpense(id, el.dataset.decision, note);
        busy(call.then(async r => { await loadApprovals(); s.loaded = false; return r; }), r => { notify(r.warning || (el.dataset.decision === 'approve' ? 'Approved.' : 'Rejected. The employee can see your reason.'), r.warning ? 'error' : undefined); });
        return true;
      }
      default: return false;
    }
  }
  /** Keep typed values and live totals up to date without redrawing the form. */
  function input(target) {
    const legEl = target.closest?.('[data-leg]');
    if (!legEl || !s.adding) return false;
    const leg = s.adding.legs[Number(legEl.dataset.leg)];
    leg[target.dataset.legField] = target.value;
    const amount = legEl.querySelector('[data-leg-amount]');
    if (amount) amount.textContent = money(legAmount(leg));
    const total = document.querySelector('[data-legs-total]'), used = document.querySelector('[data-km-used]'), bar = document.querySelector('[data-km-bar]');
    const km = legsKm(s.adding.legs);
    if (total) total.textContent = money(legsTotal(s.adding.legs));
    if (used) used.textContent = String(km);
    if (bar) { bar.style.width = `${Math.min(100, (km / KM_LIMIT) * 100)}%`; bar.closest('.xp-meter')?.classList.toggle('over', km > KM_LIMIT); }
    return true;
  }
  function checkBill(file) {
    if (!BILL_EXTENSIONS.test(file.name)) throw Error('Bills must be JPG, PNG or PDF files.');
    if (file.size > BILL_MAX_BYTES) throw Error('Bills must be 4 MB or smaller.');
  }
  function change(target) {
    if (target.dataset?.legField === 'category') {
      captureAdding(document.getElementById('expense-form'));
      const leg = s.adding.legs[Number(target.closest('[data-leg]').dataset.leg)];
      leg.category = target.value; render(); return true;
    }
    if (target.classList?.contains('xp-bill-input') && target.files?.[0]) {
      const file = target.files[0], id = target.dataset.id;
      try { checkBill(file); } catch (e) { notify(e.message, 'error'); return true; }
      busy(readFile(file).then(data => erpApi.uploadBill(id, file.name, data)).then(load), () => notify('Bill attached.'));
      return true;
    }
    return false;
  }
  function submit(form, values) {
    if (form.id !== 'expense-form') return false;
    const a = s.adding;
    const expense = { type: a.type, date: values.date, purpose: values.purpose, description: values.description, amount: values.amount, legs: a.type === 'conveyance' ? a.legs : undefined };
    const file = form.querySelector('input[type="file"]')?.files?.[0];
    try { if (file) checkBill(file); } catch (e) { notify(e.message, 'error'); return true; }
    captureAdding(form);
    busy((async () => {
      const { expense: created } = await erpApi.createExpense(expense);
      if (file) await erpApi.uploadBill(created.id, file.name, await readFile(file));
      await load();
      return created;
    })(), created => { s.adding = null; s.tab = 'ready'; notify(`Saved in ERP as ${created.id}.`); });
    return true;
  }
  return { view, approvalsView, action, input, change, submit, invalidate: () => { s.loaded = false; s.approvals = null; }, reload: load };
}
