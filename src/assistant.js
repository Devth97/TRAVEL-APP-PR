/**
 * The travel assistant's brain: a rule-based reader of what employees type. Pure and testable.
 * It only fills in a request for the employee to confirm. It never approves or books anything.
 * A real AI model can later replace `readMessage()` by returning the same trip details.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = s => new Date(`${s}T00:00:00Z`);
export const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

function realDate(y, m, d) {
  const out = new Date(Date.UTC(y, m, d));
  return out.getUTCMonth() === m && out.getUTCDate() === d ? iso(out) : null;
}
/** A date written without a year means its next occurrence. */
function nextOccurrence(today, m, d, year) {
  if (year) return realDate(year < 100 ? 2000 + year : year, m, d);
  const y = Number(today.slice(0, 4));
  const first = realDate(y, m, d);
  return first && first >= today ? first : realDate(y + 1, m, d);
}

const DATE_PATTERNS = [
  [/\bday after tomorrow\b/i, (m, t) => addDays(t, 2)],
  [/\btomorrow\b/i, (m, t) => addDays(t, 1)],
  [/\btoday\b/i, (m, t) => t],
  [/\b(\d{4})-(\d{2})-(\d{2})\b/, m => realDate(+m[1], +m[2] - 1, +m[3])],
  // Indian order: day/month[/year]
  [/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/, (m, t) => nextOccurrence(t, +m[2] - 1, +m[1], m[3] && +m[3])],
  [/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/i, (m, t) => nextOccurrence(t, MONTHS.indexOf(m[2].toLowerCase()), +m[1], m[3] && +m[3])],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i, (m, t) => nextOccurrence(t, MONTHS.indexOf(m[1].toLowerCase()), +m[2], m[3] && +m[3])],
  [/\b(next|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m, t) => {
    let ahead = (DAYS.indexOf(m[2].toLowerCase()) - utc(t).getUTCDay() + 7) % 7;
    if (ahead === 0) ahead = 7;
    if (/next/i.test(m[1] || '') && ahead < 7) ahead += 7;
    return addDays(t, ahead);
  }]
];

/** Pull every date out of the text, in the order written. Returns the dates and the leftover text. */
export function extractDates(text, today) {
  let rest = String(text || '');
  const found = [];
  for (const [re, fn] of DATE_PATTERNS) {
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    rest = rest.replace(all, (...args) => {
      const groups = args.slice(0, -2);
      const at = args[args.length - 2];
      const value = fn(groups, today);
      if (!value) return args[0];
      found.push({ at, value });
      return ' '.repeat(args[0].length);
    });
  }
  return { dates: found.sort((a, b) => a.at - b.at).map(f => f.value), rest };
}

const STOP_WORDS = /^(travel|go|going|book|visit|arrange|fly|assign|raise|create|make|get|see|attend|me|my|a|an|the|work|meet|come|return|come back|submit|have|please|office)\b/i;
const PLACE = String.raw`([A-Za-z0-9][\w.'-]*(?:\s+[A-Za-z0-9][\w.'-]*){0,3}?)`;
const PLACE_END = String.raw`(?=\s+(?:for|on|from|by|via|next|this|and|with|to|at|in|starting|returning|back|tomorrow|today|book|arrange)\b|\s*[,.!?;]|\s*$)`;
const titled = s => s.trim().split(/\s+/).map(w => /[0-9]/.test(w) ? w.toUpperCase() : w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

function findPlace(rest, words) {
  const re = new RegExp(String.raw`\b(?:${words})\s+${PLACE}${PLACE_END}`, 'gi');
  for (const m of rest.matchAll(re)) {
    if (!STOP_WORDS.test(m[1])) return titled(m[1]);
  }
  return '';
}

const PURPOSE_WORDS = [
  [/\bsite\b/i, ['Site Visit', 'Site visit', 'Project work']],
  [/\b(customer|client)\b/i, ['Customer Visit', 'Client visit']],
  [/\bvendor|supplier\b/i, ['Vendor Visit']],
  [/\b(training|conference|workshop|seminar)\b/i, ['Training / Conference', 'Training']],
  [/\bmeeting\b/i, ['Meeting']]
];
export function matchPurpose(text, purposes = []) {
  const t = String(text || '').trim().toLowerCase();
  const exact = purposes.find(p => p.toLowerCase() === t);
  if (exact) return exact;
  for (const [re, names] of PURPOSE_WORDS) {
    if (!re.test(text)) continue;
    const hit = names.find(n => purposes.includes(n)) || purposes.find(p => re.test(p));
    if (hit) return hit;
  }
  return '';
}

const MODE_WORDS = [[/\b(flight|fly|air|plane)\b/i, 'flight'], [/\b(train|rail)\b/i, 'train'], [/\bby\s+(bus|volvo)\b/i, 'bus'], [/\bby\s+(cab|car|taxi)\b/i, 'car']];
const TRIP_WORDS = /\b(travel|trip|tour|journey|fly|go(?:ing)?\s+to|visit|book|arrange|need to be in)\b/i;
export const NO_WORDS = /^(no|nope|neither|none|not needed|nothing)\b/i;
export const YES_WORDS = /^(yes|yeah|yep|ok|okay|sure|both|please do|confirm)\b/i;

/** Decide what a message is about. */
export function detectIntent(text) {
  const t = String(text || '');
  if (/^\s*(cancel|start over|reset|never ?mind)\b/i.test(t)) return 'reset';
  if (/^\s*(hi|hello|hey|help|what can you do)\b[\s!?.]*$/i.test(t)) return 'help';
  if (TRIP_WORDS.test(t)) return 'trip';
  if (/\b(status|my requests?|pending requests?|where is my)\b/i.test(t)) return 'status';
  if (/\b(claim|reimburse|expense|bill|receipt)\b/i.test(t)) return 'expense';
  return 'unknown';
}

/**
 * Merge a message into the trip details gathered so far.
 * `asking` is the question just asked, so a bare answer such as "Hyderabad" lands in the right place.
 */
export function readMessage(text, slots = {}, { today, purposes = [], asking = '' } = {}) {
  const out = { ...slots };
  const raw = String(text || '').trim();
  const { dates, rest } = extractDates(raw, today);
  const stay = /\bfor\s+(\d{1,2})\s+(day|night)s?\b/i.exec(rest);

  const place = findPlace(rest, 'to|visit(?:ing)?|at|in');
  const origin = findPlace(rest, 'from|starting from');
  if (origin) out.origin = origin;
  if (place && (!out.destination || asking !== 'origin')) out.destination = place;

  const returnWords = /\b(return(?:ing)?|back|come back)\b/i.test(raw);
  const departWords = /\b(depart(?:ing)?|leav(?:e|ing)|start(?:ing)?)\b/i.test(raw);
  if (dates.length >= 2) { out.departDate = dates[0]; out.returnDate = dates[1]; out.oneWay = false; }
  else if (dates.length === 1) {
    if (returnWords || asking === 'returnDate') { out.returnDate = dates[0]; out.oneWay = false; }
    else if (departWords || asking === 'departDate' || !out.departDate) out.departDate = dates[0];
  }
  if (stay && out.departDate) {
    const n = Number(stay[1]);
    out.returnDate = addDays(out.departDate, stay[2].toLowerCase() === 'night' ? n : Math.max(n - 1, 0));
    out.oneWay = false;
  }
  if (asking === 'returnDate' && (/\bone[- ]?way\b/i.test(raw) || NO_WORDS.test(raw))) { out.oneWay = true; out.returnDate = ''; }
  if (/\bone[- ]?way\b/i.test(raw)) { out.oneWay = true; out.returnDate = ''; }

  const purpose = matchPurpose(raw, purposes);
  if (purpose) out.purpose = purpose;

  for (const [re, mode] of MODE_WORDS) if (re.test(raw)) { out.mode = mode; break; }

  const hotelNo = /\b(no|without|skip|don'?t need(?: a)?)\s+(hotel|room|stay|accommodation)\b/i.test(raw);
  const cabNo = /\b(no|without|skip|don'?t need(?: a)?)\s+(cab|taxi)\b/i.test(raw);
  const hotelYes = !hotelNo && /\b(hotel|room|stay|accommodation)\b/i.test(raw);
  const cabYes = !cabNo && !/\bby\s+(cab|taxi)\b/i.test(raw) && /\b(cab|taxi)\b/i.test(raw);
  if (hotelNo) out.hotel = false; else if (hotelYes) out.hotel = true;
  if (cabNo) out.cab = false; else if (cabYes) out.cab = true;
  if (asking === 'arrangements') {
    if (YES_WORDS.test(raw)) { out.hotel = out.hotel ?? true; out.cab = out.cab ?? true; }
    if (NO_WORDS.test(raw)) { out.hotel = false; out.cab = false; }
    if (out.hotel === true && out.cab === undefined) out.cab = false;
    if (out.cab === true && out.hotel === undefined) out.hotel = false;
  }

  // A bare answer to a direct question.
  const bare = rest.replace(/[.!?]/g, ' ').trim();
  if (bare && /^[A-Za-z0-9][\w .'-]{0,50}$/.test(bare) && !YES_WORDS.test(bare) && !NO_WORDS.test(bare)) {
    if (asking === 'destination' && !place) out.destination = titled(bare);
    if (asking === 'origin' && !origin) out.origin = titled(bare.replace(/^from\s+/i, ''));
  }
  return out;
}

/** The next thing to ask, or '' when the plan can be shown. */
export function nextQuestion(slots) {
  if (!slots.destination) return 'destination';
  if (!slots.origin) return 'origin';
  if (!slots.departDate) return 'departDate';
  if (!slots.returnDate && !slots.oneWay) return 'returnDate';
  if (!slots.purpose) return 'purpose';
  if (slots.hotel === undefined || slots.cab === undefined) return 'arrangements';
  return '';
}

export const QUESTIONS = {
  destination: 'Where do you need to go?',
  origin: 'Where will you be travelling from?',
  departDate: 'What date do you leave? You can say "12 Nov" or "next Monday".',
  returnDate: 'When do you come back? Say "one way" if there is no return.',
  purpose: 'What is the purpose of this trip?',
  arrangements: 'Do you need a hotel and a cab? You can say "both", "hotel only", "cab only" or "no".'
};

/** Validate the dates. Returns a message for the employee, or ''. */
export function datesProblem(slots, today) {
  if (slots.departDate && slots.departDate < today) return 'That departure date has already passed. Which date do you leave?';
  if (slots.returnDate && slots.departDate && slots.returnDate < slots.departDate) return 'The return date is before the departure date. When do you come back?';
  return '';
}

/**
 * Turn the details into the app's request shape and an expense estimate.
 * `daily` holds the policy's daily limits as { hotel, food, incidental }, each { min, max }, or null if unknown.
 * Amounts are ceilings from the policy, never quotes, and cabs have no amount until the Travel Admin books one.
 */
export function buildPlan(slots, { daily = null, department = '' } = {}) {
  const days = slots.returnDate ? daysBetween(slots.departDate, slots.returnDate) + 1 : 1;
  const nights = slots.returnDate ? Math.max(days - 1, 0) : 0;
  const arrangements = [];
  if (slots.hotel) arrangements.push(`Hotel at ${slots.destination}${nights ? `, ${nights} night${nights === 1 ? '' : 's'}` : ''}`);
  if (slots.cab) arrangements.push(`Cab at ${slots.destination}`);
  const rows = [];
  if (daily) {
    if (slots.hotel && nights) rows.push({ type: 'hotel', amount: daily.hotel.max * nights, description: `Hotel limit × ${nights} night${nights === 1 ? '' : 's'}` });
    rows.push({ type: 'food', amount: daily.food.max * days, description: `Food limit × ${days} day${days === 1 ? '' : 's'}` });
    rows.push({ type: 'incidental', amount: daily.incidental.max * days, description: `Incidental limit × ${days} day${days === 1 ? '' : 's'}` });
  }
  const estimateTotal = rows.reduce((sum, r) => sum + r.amount, 0);
  const request = {
    purpose: slots.purpose, priority: 'planned', tripType: 'domestic', country: '', roundTripKm: '', normalFare: '', quotedFare: '',
    origin: slots.origin, destination: slots.destination, departDate: slots.departDate, departTime: '09:00', requiredArrivalDate: '', requiredArrival: '',
    returnDate: slots.returnDate || '', returnTime: slots.returnDate ? '18:00' : '', people: '1', department, site: '', flexibility: '30',
    notes: 'Raised through the ProRack Move travel assistant.', roster: '', preferredMode: slots.mode || '',
    arrangements: arrangements.join('; '), estimateTotal: estimateTotal ? String(estimateTotal) : ''
  };
  return { request, rows, estimateTotal, days, nights, arrangements };
}
