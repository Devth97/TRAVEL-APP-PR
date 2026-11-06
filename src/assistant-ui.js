/** Travel assistant chat (ERP mode). Reads what the employee types, shows a plan, and submits only after they confirm. */
import { esc, niceDate, dateOffset, validateRequest, MODES } from './logic.js';
import { icon } from './icons.js';
import { button, topSection } from './ui.js';
import { erpApi } from './erp-client.js';
import { evaluateRequest } from './entitlements.js';
import { QUESTIONS, buildPlan, datesProblem, detectIntent, nextQuestion, readMessage } from './assistant.js';
import { money } from './expense-ui.js';

const LEVEL_LABELS = { block: 'Not allowed', approval: 'Extra approval', review: 'Needs review', warn: 'Advisory', advisory: 'Advisory' };
const HELP = 'Tell me about your trip in one message, for example: "I need to travel to Bhiwandi from Hyderabad on 12 Nov for a site visit, back on 14 Nov, and I need a hotel and cab." I will fill in the travel request and an expense estimate, then you confirm before anything is sent.';
const SUGGESTIONS = ['I need to travel to Bhiwandi for a site visit next Monday for 3 days, book a hotel and cab', 'What is the status of my requests?', 'I want to claim an expense'];

export function createAssistant({ render, notify, user, me, purposes, policySummary, afterSubmit }) {
  const s = { messages: [{ role: 'bot', text: `Hi, I'm your travel assistant. ${HELP}` }], slots: null, asking: '', plan: null, busy: false };
  const say = (text, extra = {}) => s.messages.push({ role: 'bot', text, ...extra });
  const scrollDown = () => requestAnimationFrame(() => {
    const log = document.getElementById('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    document.getElementById('chat-input')?.focus();
  });
  const show = () => { render(); scrollDown(); };
  const reset = () => { s.slots = null; s.asking = ''; s.plan = null; };

  function makePlan() {
    const u = user();
    const m = me() || {};
    const draft = buildPlan(s.slots, { department: m.department || '' });
    const check = evaluateRequest(draft.request, u);
    const plan = buildPlan(s.slots, { daily: check.daily, department: m.department || '' });
    return { ...plan, check, approver: m.expenseApprover || '' };
  }
  function ask(q) {
    s.asking = q;
    say(QUESTIONS[q], q === 'purpose' ? { chips: purposes() } : q === 'arrangements' ? { chips: ['Both', 'Hotel only', 'Cab only', 'No'] } : q === 'returnDate' ? { chips: ['One way'] } : {});
  }
  function continueTrip() {
    const today = dateOffset(0);
    const problem = datesProblem(s.slots, today);
    if (problem) {
      const clearDepart = s.slots.departDate < today;
      if (clearDepart) s.slots.departDate = ''; else s.slots.returnDate = '';
      s.asking = clearDepart ? 'departDate' : 'returnDate';
      s.plan = null;
      say(problem);
      return;
    }
    const q = nextQuestion(s.slots);
    if (q) { s.plan = null; ask(q); return; }
    s.asking = '';
    s.plan = makePlan();
    say('Here is what I will send. Check it, then confirm. To change something, just tell me, for example "return on 15 Nov" or "no cab".', { plan: true });
  }
  function statusReply() {
    const rows = user() ? afterSubmit.requests().slice(0, 3) : [];
    if (!rows.length) { say('You have no travel requests yet. Tell me where you need to go and I will start one.'); return; }
    say(`Your latest requests:\n${rows.map(r => `${r.id}: ${r.origin} to ${r.destination}, ${niceDate(r.departDate)} (${r.workflowState || r.status})`).join('\n')}`, { links: [['requests', 'Open My requests']] });
  }
  function send(text) {
    const message = String(text || '').trim().slice(0, 600);
    if (!message || s.busy) return;
    s.messages.push({ role: 'user', text: message });
    const intent = detectIntent(message);
    if (intent === 'reset') { reset(); say('No problem, I have cleared that. Where do you need to go?'); show(); return; }
    if (!s.slots) {
      if (intent === 'status') { statusReply(); show(); return; }
      if (intent === 'expense') { say('You can add an expense and attach its bill on the Expenses page.', { links: [['expenses', 'Open Expenses']] }); show(); return; }
      if (intent === 'help') { say(HELP); show(); return; }
      if (intent === 'unknown') {
        const peek = readMessage(message, {}, { today: dateOffset(0), purposes: purposes() });
        if (!peek.destination) { say(`I did not catch that. ${HELP}`); show(); return; }
      }
      s.slots = { origin: me()?.location || '' };
    }
    const before = JSON.stringify(s.slots);
    s.slots = readMessage(message, s.slots, { today: dateOffset(0), purposes: purposes(), asking: s.asking });
    if (s.plan && JSON.stringify(s.slots) === before) {
      say('I did not catch a change there. You can say things like "return on 15 Nov", "from Pune", "by train" or "no hotel". Or use the buttons on the plan.');
      show();
      return;
    }
    continueTrip();
    show();
  }
  async function confirm() {
    if (!s.plan || s.busy) return;
    const plan = s.plan;
    const errors = validateRequest(plan.request, 'employee', { purposes: purposes(), allowMode: true });
    if (errors.length) { say(`I cannot send this yet: ${errors[0]} Tell me the correct details.`); show(); return; }
    s.busy = true; render();
    try {
      const res = await erpApi.create(plan.request, policySummary(plan.check), true);
      const lines = [];
      if (res.warning) lines.push(res.warning);
      else lines.push(`Travel request ${res.request.id} has been sent for approval.`);
      let estimateError = '';
      if (plan.rows.length) {
        try {
          const { expense } = await erpApi.createExpense({ type: plan.rows[0].type, date: plan.request.departDate, estimate: true, rows: plan.rows, request: res.request.id, purpose: `${plan.request.purpose}: ${plan.request.destination}` });
          lines.push(`Expense estimate ${expense.id} saved for ${money(expense.amount)}. It is a planning figure. Claim your actual costs with bills after the trip.`);
        } catch (e) { estimateError = e.message; }
      } else lines.push('I could not estimate expenses because your policy grade is not assigned yet.');
      if (estimateError) lines.push(`The travel request went through, but the expense estimate was not saved: ${estimateError}`);
      if (plan.arrangements.length) lines.push(`Nothing is booked yet. Once approved, the Travel Admin will arrange: ${plan.arrangements.join('; ')}.`);
      say(lines.join('\n'), { links: [['requests', 'Open My requests'], ['expenses', 'Open Expenses']] });
      reset();
      await afterSubmit.refresh().catch(() => null);
    } catch (e) {
      say(`That did not go through, and nothing was sent: ${e.message}`);
    } finally {
      s.busy = false;
      show();
    }
  }

  function planCard(plan) {
    const r = plan.request;
    const mode = MODES.find(m => m.id === r.preferredMode)?.label || 'Travel Admin to advise';
    const checks = plan.check.checks.filter(c => LEVEL_LABELS[c.level]);
    const blocked = plan.check.checks.some(c => c.level === 'block');
    return `<div class="chat-plan">
      <div class="chat-plan-route">${icon('route', 18)}<strong>${esc(r.origin)} → ${esc(r.destination)}</strong></div>
      <dl>
        <div><dt>Purpose</dt><dd>${esc(r.purpose)}</dd></div>
        <div><dt>Leaving</dt><dd>${esc(niceDate(r.departDate))}</dd></div>
        <div><dt>Returning</dt><dd>${r.returnDate ? esc(niceDate(r.returnDate)) : 'One way'}</dd></div>
        <div><dt>Travel mode</dt><dd>${esc(mode)}</dd></div>
        <div><dt>Hotel and cab</dt><dd>${plan.arrangements.length ? esc(plan.arrangements.join('; ')) : 'Not needed'}</dd></div>
        <div><dt>Goes to</dt><dd>${esc(plan.approver || 'Your HOD')} for approval</dd></div>
      </dl>
      ${plan.rows.length ? `<table class="xp-table"><thead><tr><th>Expense estimate</th><th>Basis</th><th>Up to</th></tr></thead><tbody>${plan.rows.map(x => `<tr><td>${esc({ hotel: 'Hotel', food: 'Food', incidental: 'Incidental' }[x.type])}</td><td>${esc(x.description)}</td><td>${money(x.amount)}</td></tr>`).join('')}<tr class="xp-total"><td colspan="2">Total, using proposed policy limits</td><td>${money(plan.estimateTotal)}</td></tr></tbody></table>` : '<p class="xp-muted">No expense estimate: your policy grade is not assigned yet.</p>'}
      ${plan.arrangements.length ? `<p class="xp-muted">${icon('info', 14)} Tickets, hotels and cabs are not booked by this assistant. The Travel Admin arranges them after approval.</p>` : ''}
      ${checks.length ? `<ul class="chat-checks">${checks.map(c => `<li class="lvl-${esc(c.level)}"><strong>${esc(LEVEL_LABELS[c.level])}:</strong> ${esc(c.message)}</li>`).join('')}</ul>` : ''}
      <div class="chat-plan-actions">${button('Start over', 'as-reset', { variant: 'btn-outline', disabled: s.busy })}${button(s.busy ? 'Sending to ERP…' : 'Confirm and submit', 'as-confirm', { disabled: s.busy || blocked, icon: 'check' })}</div>
      ${blocked ? '<p class="xp-warn">This trip cannot be submitted as asked. Change the details above, for example the travel mode.</p>' : ''}
    </div>`;
  }
  function bubble(m, last, showPlan) {
    const links = (m.links || []).map(([view, label]) => `<button type="button" class="btn btn-soft chat-link" data-nav="${esc(view)}">${esc(label)}</button>`).join('');
    const chips = last && m.chips ? `<div class="chat-chips">${m.chips.map(c => `<button type="button" data-action="as-say" data-id="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
    return `<div class="chat-msg ${m.role}">${m.role === 'bot' ? `<span class="chat-avatar">${icon('sparkle', 15)}</span>` : ''}<div class="chat-bubble"><p>${esc(m.text).replaceAll('\n', '<br>')}</p>${showPlan ? planCard(s.plan) : ''}${links ? `<div class="chat-links">${links}</div>` : ''}${chips}</div></div>`;
  }
  function view() {
    const fresh = s.messages.length === 1;
    // The plan stays on screen, on its latest message, until it is confirmed or replaced.
    const planAt = s.plan ? s.messages.map(m => Boolean(m.plan)).lastIndexOf(true) : -1;
    return `${topSection('TRAVEL ASSISTANT', 'Tell me about your trip', 'I fill in your travel request and expense estimate. You confirm, then your approver decides.')}
      <section class="surface-card chat-card">
        <div id="chat-log" class="chat-log" role="log" aria-live="polite">${s.messages.map((m, i) => bubble(m, i === s.messages.length - 1, i === planAt)).join('')}
          ${fresh ? `<div class="chat-chips chat-suggest">${SUGGESTIONS.map(c => `<button type="button" data-action="as-say" data-id="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</div>
        <form id="chat-form" class="chat-form"><input id="chat-input" name="message" autocomplete="off" maxlength="600" aria-label="Message the travel assistant" placeholder="Type your message…" ${s.busy ? 'disabled' : ''} /><button class="btn btn-primary" type="submit" ${s.busy ? 'disabled' : ''} aria-label="Send">${icon('arrowRight', 18)}</button></form>
      </section>`;
  }
  function action(name, el) {
    switch (name) {
      case 'as-say': send(el.dataset.id); return true;
      case 'as-confirm': confirm(); return true;
      case 'as-reset': reset(); say('No problem, I have cleared that. Where do you need to go?'); show(); return true;
      default: return false;
    }
  }
  function submit(form, values) {
    if (form.id !== 'chat-form') return false;
    send(values.message);
    return true;
  }
  return { view, action, submit, opened: scrollDown };
}
