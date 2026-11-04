/** Pure domain logic shared by the app and its no-dependency test suite. */
export const STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'allocated', 'completed', 'rejected', 'cancelled', 'needs_info'];
export const MODES = [
  { id:'bus', label:'Company bus', seats:40 }, { id:'van', label:'Passenger van', seats:12 },
  { id:'car', label:'Car / cab', seats:4 }, { id:'train', label:'Train', seats:100 },
  { id:'flight', label:'Flight', seats:180 }, { id:'sea', label:'Sea transport', seats:80 }
];
export const PURPOSES = [ 'Site visit', 'Client visit', 'Project work', 'Training', 'Meeting', 'Other' ];
export const isManager = role => role === 'manager' || role === 'senior_manager';
export const canRequestMode = role => isManager(role);
export const pad = value => String(value).padStart(2, '0');
export const dateOffset = (offset, date = new Date()) => {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth()+1)}-${pad(shifted.getDate())}`;
};
export const niceDate = (v, opts={ day:'numeric', month:'short', year:'numeric' }) => {
  if(!v) return '—';
  const t = new Date(`${v}T12:00:00`);
  return Number.isNaN(t.getTime()) ? v : new Intl.DateTimeFormat('en-IN', opts).format(t);
};
export const shortDate = v => niceDate(v, {day:'numeric', month:'short'});
export const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));
export function timeParts(value) {
 if(!validTime(value))return {hour:'',minute:'',period:''};
 const [hour,minute]=value.split(':');
 return {hour:pad(Number(hour)%12||12),minute,period:Number(hour)>=12?'PM':'AM'};
}
export function timeFromParts(hour,minute,period) {
 if(!/^(0?[1-9]|1[0-2])$/.test(String(hour))||!/^[0-5]\d$/.test(String(minute))||!['AM','PM'].includes(period))throw Error('Choose a valid hour, minute and AM/PM.');
 return `${pad(Number(hour)%12+(period==='PM'?12:0))}:${minute}`;
}
export function formatTime(value) {
 if(!validTime(value))return 'Not specified';
 const parts=timeParts(value);return `${parts.hour}:${parts.minute} ${parts.period}`;
}
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export function validateJourneyTiming(values) {
 const errors=[];
 for(const [name,label] of [['departDate','Departure date'],['requiredArrivalDate','Required arrival date'],['returnDate','Return date']])if(values[name]&&!validDate(values[name]))errors.push(`${label} must be a valid date.`);
 for(const [name,label] of [['departTime','Departure time'],['requiredArrival','Required arrival time'],['returnTime','Return time']])if(values[name]&&!validTime(values[name]))errors.push(`${label} must be a valid time.`);
 if(errors.length)return errors;
 const arrivalDate=values.requiredArrivalDate||(values.requiredArrival?values.departDate:'');
 if(arrivalDate&&values.departDate&&arrivalDate<values.departDate)errors.push('Required arrival date cannot be before departure.');
 else if(arrivalDate&&values.requiredArrival&&values.departDate&&values.departTime&&`${arrivalDate}T${values.requiredArrival}`<`${values.departDate}T${values.departTime}`)errors.push('Required arrival cannot be before departure.');
 if(values.returnDate&&values.returnTime&&values.departDate&&values.departTime&&`${values.returnDate}T${values.returnTime}`<`${values.departDate}T${values.departTime}`)errors.push('Return time cannot be before departure.');
 return errors;
}
export const initials = value => String(value||'?').split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
export const esc = raw => String(raw??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const key = raw => String(raw??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const region = loc => {
  const value=key(loc);
  if(['kothur','kondapur','shamshabad','hyderabad','gachibowli','nanakramguda','kodicherla','shadnagar'].some(s=>value.includes(s))) return 'hyderabad';
  if(['bhiwandi','mumbai','thane','navi'].some(s=>value.includes(s))) return 'mumbai';
  return value;
};
const minutes = time => {
  const [h,m] = String(time||'00:00').split(':').map(Number);
  return (h||0)*60+(m||0);
};
export const totalPeople = reqs => reqs.reduce((sum,r)=>sum+Number(r.people||0),0);
export const recommendMode = (reqs) => {
  const count=totalPeople(reqs);
  const from=region(reqs[0]?.origin), to=region(reqs[0]?.destination);
  if (from!==to && count>=15) return 'train';
  if (count>=13) return 'bus';
  if (count>=5) return 'van';
  if(count>=2) return 'car';
  return 'car';
};
export const validateCapacity = (reqs,capacity) => {
  if (!Number.isInteger(Number(capacity)) || Number(capacity)<1) return 'Enter a valid vehicle or service capacity.';
  const travelers=totalPeople(reqs);
  return travelers > Number(capacity) ? `${travelers} travelers exceed the ${capacity} seats available. Increase capacity or split the plan.` : '';
};
export function canTransition(from,to) {
  if (from===to) return true;
  const allowed={ draft:['submitted','cancelled'], submitted:['under_review','approved','needs_info','rejected','cancelled'], needs_info:['submitted','under_review','rejected','cancelled'], under_review:['approved','needs_info','rejected','cancelled'], approved:['allocated','cancelled'], allocated:['completed','cancelled'], completed:[], rejected:[], cancelled:[] };
  return (allowed[from]||[]).includes(to);
}
export function validateRequest(values,role='worker') {
  const errors=validateJourneyTiming(values);
  if(!PURPOSES.includes(values.purpose)) errors.push('Choose a travel purpose.');
  if(!values.origin?.trim() || !values.destination?.trim()) errors.push('Origin and destination are required.');
  if(values.tripType && !['domestic','international'].includes(values.tripType)) errors.push('Choose a valid trip type.');
  if(values.tripType==='international' && !String(values.country||'').trim()) errors.push('Enter the destination country for an international trip.');
  if(key(values.origin)===key(values.destination)) errors.push('Origin and destination must be different.');
  if(!values.departDate) errors.push('Choose a departure date.');
  if(values.departDate && values.departDate<dateOffset(0)) errors.push('Departure cannot be in the past.');
  if(!values.departTime) errors.push('Choose a departure time.');
  if(values.returnDate && values.departDate && values.returnDate<values.departDate) errors.push('Return date cannot precede departure.');
  const people=Number(values.people);
  if(!Number.isInteger(people) || people<1 || people>500) errors.push('Number of travelers must be between 1 and 500.');
  if(values.priority==='emergency' && String(values.notes||'').trim().length<8) errors.push('Emergency requests need a short explanation (at least 8 characters).');
  if(values.preferredMode && !canRequestMode(role)) errors.push('Only manager-level travelers can state a transport preference.');
  return errors;
}
export function eligiblePair(a,b) {
  if(a.id===b.id) return false;
  if (['cancelled','completed','rejected','draft','allocated'].includes(a.status) || ['cancelled','completed','rejected','draft','allocated'].includes(b.status)) return false;
  if(key(a.destination)!==key(b.destination) || a.departDate!==b.departDate) return false;
  if(Math.abs(minutes(a.departTime)-minutes(b.departTime))>75) return false;
  // This is a coarse DEMO region heuristic, not a real road/stop feasibility calculation.
  // Cross-region origins are never auto-grouped; Admin must validate each actual pickup corridor.
  if(region(a.origin)!==region(b.origin)) return false;
  return true;
}
export function getSuggestions(requests) {
  const options=requests.filter(r=>['submitted','under_review','approved','needs_info'].includes(r.status)).sort((a,b)=>a.departDate.localeCompare(b.departDate));
  const visited=new Set(), groups=[];
  for (const req of options) {
    if(visited.has(req.id)) continue;
    const cluster=[req]; visited.add(req.id);
    for (const other of options) {
      if(!visited.has(other.id) && cluster.every(member=>eligiblePair(member,other))) { cluster.push(other); visited.add(other.id); }
    }
    if (cluster.length<2 && Number(req.people)<12) continue;
    const count=totalPeople(cluster),mode=recommendMode(cluster);
    groups.push({ id:`suggest-${req.id}`, requestIds:cluster.map(v=>v.id), requests:cluster, people:count, mode,
      origin:cluster.length>1?`${cluster.length} pickup points`:req.origin,destination:req.destination,date:req.departDate,
      reason: cluster.length>1 ? `${cluster.length} requests share a destination, travel date and similar departure window. Origins are within the same broad region; verify actual road route and timings before assigning.` : `${count} travelers on one bulk request. ${mode==='train'?'Rail':'Shared road transport'} may be worth evaluating; availability and suitability have not been checked.`
    });
  }
  return groups.sort((a,b)=>b.people-a.people);
}
export function csvCell(raw) {
  const value=String(raw??'');
  const safe=/^[=+@\-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"','""')}"`;
}
