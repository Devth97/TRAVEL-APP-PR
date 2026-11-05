import { buildSeed } from './data.js';
import { GRADES, ERP_GRADES } from './policy.js';
import { canTransition, canRequestMode, validateCapacity, totalPeople, validateRequest, MODES } from './logic.js';
const DB_KEY='prorack-move-mvp-v2'; const SESSION_KEY='prorack-move-demo-session-v2';
const safeRead=(key)=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const id=(prefix)=>`${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
const time=()=>new Date().toISOString();
export const loadDB=()=>{
 const value=safeRead(DB_KEY);
 return value && Array.isArray(value.requests)&&Array.isArray(value.users)&&Array.isArray(value.plans) ? value : buildSeed();
};
export const saveDB=(state)=>{try{localStorage.setItem(DB_KEY,JSON.stringify(state));}catch{throw Error('Browser storage is unavailable. No changes were saved.');}};
export const resetDB=()=>{const data=buildSeed();saveDB(data);return data;};
export const loadSession=()=>safeRead(SESSION_KEY)?.userId||null;
export const saveSession=id=>{try{if(id)localStorage.setItem(SESSION_KEY,JSON.stringify({userId:id}));else localStorage.removeItem(SESSION_KEY);}catch{/* noncritical */}};
export function appendEvent(db,actorId,kind,message,requestId=null,toUserId=null){
 db.activity.unshift({id:id('ACT'),actorId,kind,message,requestId,time:time()});
 if(toUserId) db.notifications.unshift({id:id('NT'),userId:toUserId,text:message,requestId,read:false,time:time()});
}
export function addRequest(db,details,actor) {
 const requester=db.users.find(u=>u.id===details.userId);
 if(!requester) throw Error('Choose a valid requester.');
 const errors=validateRequest(details,requester.role);
 if(errors.length) throw Error(errors.join(' '));
 const r={...details,id:id('TR'),createdAt:time(),status:'submitted',planId:null,priority:details.priority||'planned',preferredMode:canRequestMode(requester.role)?(details.preferredMode||''):''};
 db.requests.unshift(r);
 appendEvent(db,actor.id,'submitted',`${requester.name} submitted ${r.priority==='emergency'?'an urgent ': 'a '}travel request.`,r.id,'usr-admin');
 return r;
}
export function addDraft(db,details,actor) {
 const requester=db.users.find(u=>u.id===details.userId);
 if(!requester)throw Error('Choose a valid requester.');
 const draft={...details,id:id('TR'),createdAt:time(),status:'draft',planId:null,preferredMode:canRequestMode(requester.role)?(details.preferredMode||''):''};
 db.requests.unshift(draft);
 appendEvent(db,actor.id,'draft','Travel request saved as a draft.',draft.id);
 return draft;
}
export function updateStatus(db,reqId,target,actor,reason='') {
 if(actor.role!=='admin')throw Error('Only the Travel Admin can perform this action in this demo.');
 const req=db.requests.find(r=>r.id===reqId);
 if(!req)throw Error('Request not found.');
 if(!canTransition(req.status,target))throw Error(`Cannot change a ${req.status.replace('_',' ')} request to ${target.replace('_',' ')}.`);
 if(['rejected','needs_info','cancelled'].includes(target) && !reason.trim())throw Error('Please enter a reason for this decision.');
 const prev=req.status;req.status=target;
 appendEvent(db,actor.id,'status',`${req.id}: ${prev.replace('_',' ')} → ${target.replace('_',' ')}.${reason?' '+reason.trim():''}`,req.id,req.userId);
 return req;
}
export function cancelOwnRequest(db,reqId,actor,reason){
 const req=db.requests.find(r=>r.id===reqId);
 if(!req || req.userId!==actor.id)throw Error('You can only cancel your own request.');
 if(!['draft','submitted','needs_info','under_review'].includes(req.status))throw Error('This request can no longer be cancelled here. Contact Admin.');
 req.status='cancelled';appendEvent(db,actor.id,'cancelled',`${req.id}: cancellation requested. ${reason||''}`,req.id,'usr-admin');return req;
}
export function createPlan(db,values,actor){
 if(actor.role!=='admin')throw Error('Only the Travel Admin may allocate transport.');
 const uniqueIds=[...new Set(values.requestIds||[])];
 if(!uniqueIds.length)throw Error('Select at least one request.');
 const reqs=uniqueIds.map(id=>db.requests.find(r=>r.id===id));
 if(reqs.some(v=>!v))throw Error('Some requests could not be found.');
 if(reqs.some(v=>!['approved'].includes(v.status)))throw Error('Approve every selected request before allocating transport.');
 const problem=validateCapacity(reqs,values.capacity);
 if(problem)throw Error(problem);
 if(!values.departure || !MODES.some(m=>m.id===values.mode) || !values.pickup?.trim())throw Error('Choose a valid mode, departure and pickup instructions.');
 const plan={ id:id('PL'),requestIds:uniqueIds,mode:values.mode,capacity:Number(values.capacity),departure:values.departure,provider:values.provider?.trim()||'To be confirmed',identifier:values.identifier?.trim()||'',pickup:values.pickup.trim(),drop:values.drop?.trim()||reqs[0].destination,bookingRef:values.bookingRef?.trim()||'',notes:values.notes?.trim()||'',status:'allocated',createdAt:time()};
 db.plans.unshift(plan);
 for(const req of reqs){req.status='allocated';req.planId=plan.id;appendEvent(db,actor.id,'allocation',`${req.id}: ${totalPeople([req])} traveler(s) allocated to ${plan.mode} (${plan.id}).`,req.id,req.userId);}
 return plan;
}
/** Edit a previously allocated itinerary; preserve request membership and notify travelers. */
export function updatePlan(db,planId,values,actor){
 if(actor?.role!=='admin')throw Error('Only the Travel Admin may edit allocations.');
 const plan=db.plans.find(p=>p.id===planId);
 if(!plan)throw Error('Transport plan not found.');
 if(plan.status!=='allocated')throw Error('Completed plans cannot be edited.');
 const reqs=plan.requestIds.map(id=>db.requests.find(r=>r.id===id));
 if(reqs.some(r=>!r || r.planId!==plan.id || r.status!=='allocated'))throw Error('This plan has inconsistent requests and cannot be edited.');
 const problem=validateCapacity(reqs,values.capacity);
 if(problem)throw Error(problem);
 if(!MODES.some(m=>m.id===values.mode))throw Error('Select a supported transport mode.');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(values.departure||'')) || Number.isNaN(Date.parse(values.departure)))throw Error('Choose a valid departure date and time.');
 if(!String(values.pickup||'').trim())throw Error('Enter pickup or boarding instructions.');
 const updated={mode:values.mode,capacity:Number(values.capacity),departure:values.departure,
  pickup:String(values.pickup).trim(),drop:String(values.drop||'').trim()||reqs[0].destination,
  provider:String(values.provider||'').trim()||'To be confirmed',identifier:String(values.identifier||'').trim(),
  bookingRef:String(values.bookingRef||'').trim(),notes:String(values.notes||'').trim()};
 const changed=Object.keys(updated).filter(k=>String(plan[k]??'')!==String(updated[k]??''));
 if(!changed.length)throw Error('No changes were made to this plan.');
 Object.assign(plan,updated,{updatedAt:time()});
 for(const req of reqs){
  appendEvent(db,actor.id,'allocation_update',`${req.id}: travel plan updated (${changed.join(', ')}). Check your updated itinerary.`,req.id,req.userId);
 }
 return plan;
}
export function completePlan(db,planId,actor){
 if(actor.role!=='admin')throw Error('Admin role required.');
 const plan=db.plans.find(p=>p.id===planId);
 if(!plan)throw Error('Transport plan not found.');
 if(plan.status!=='allocated')throw Error('Only allocated plans can be marked completed.');
 plan.status='completed';
 for(const id of plan.requestIds){const req=db.requests.find(r=>r.id===id);if(req&&req.status==='allocated'){req.status='completed';appendEvent(db,actor.id,'completed',`${req.id}: travel completed.`,id,req.userId);}}
}
export function addPerson(db,details,actor){
 if(actor.role!=='admin')throw Error('Admin role required.');
 const name=String(details.name||'').trim();if(name.length<3)throw Error('Enter the employee’s full name.');
 if(!['worker','employee','manager','senior_manager'].includes(details.role))throw Error('Choose a valid role.');
 if(details.erpGrade&&!ERP_GRADES.some(gr=>gr.id===details.erpGrade))throw Error('Choose a valid ERP grade.');
 if(details.policyGrade&&!GRADES.some(gr=>gr.id===details.policyGrade))throw Error('Choose a valid policy grade.');
 if(details.policyGradeConfirmed==='yes'&&!details.policyGrade)throw Error('Choose the policy grade HR has confirmed.');
 const user={id:id('usr'),name,first:name.split(' ')[0],role:details.role,erpGrade:details.erpGrade||'',policyGrade:details.policyGrade||'',policyGradeConfirmed:details.policyGradeConfirmed==='yes'&&Boolean(details.policyGrade),designation:String(details.designation||'').trim(),subtitle:`${details.role.replace('_',' ')} · ${details.department||'Operations'}`,department:details.department||'Operations',location:details.location||'',tone:'blue',login:'Admin-provided credentials (demo)'};
 db.users.push(user);appendEvent(db,actor.id,'person',`${user.name} added to demo user directory.`);return user;
}
export function markRead(db,userId){db.notifications.filter(n=>n.userId===userId).forEach(n=>n.read=true);}
