import { dateOffset } from './logic.js';
const d=(n)=>dateOffset(n);
const now=()=>new Date().toISOString();
export const identities=[
  {id:'usr-worker',erpGrade:'',designation:'Site Worker',name:'Mahesh Patil',first:'Mahesh',role:'worker',subtitle:'Site worker · Kothur',department:'Site Operations',location:'Kothur',tone:'peach',login:'Admin-provided credentials (demo)'},
  {id:'usr-employee',erpGrade:'Jr Executive to Dy Manager',designation:'Site Engineer',name:'Aarav Reddy',first:'Aarav',role:'employee',subtitle:'Site engineer · Operations',department:'Engineering',location:'Hyderabad',tone:'blue',login:'Microsoft 365 (demo)'},
  {id:'usr-manager',erpGrade:'Manager to DGM',designation:'Sales Manager',name:'Priya Sharma',first:'Priya',role:'manager',subtitle:'Sales manager · Regional',department:'Sales',location:'Hyderabad',tone:'purple',login:'Microsoft 365 (demo)'},
  {id:'usr-admin',erpGrade:'Jr Executive to Dy Manager',designation:'Sr. Executive – Admin',name:'Ananya Rao',first:'Ananya',role:'admin',subtitle:'Travel administrator',department:'Administration',location:'Kothur',tone:'mint',login:'Microsoft 365 (demo)'},
  {id:'usr-devi',erpGrade:'',designation:'Assembly Worker',name:'Devi Singh',first:'Devi',role:'worker',subtitle:'Assembly worker',department:'Site Operations',location:'Shamshabad',tone:'mint',login:'Admin-provided credentials (demo)'},
  {id:'usr-suresh',erpGrade:'',designation:'Installation Worker',name:'Suresh Naik',first:'Suresh',role:'worker',subtitle:'Installation worker',department:'Site Operations',location:'Kondapur',tone:'blue',login:'Admin-provided credentials (demo)'},
  {id:'usr-imran',erpGrade:'Jr Executive to Dy Manager',designation:'Field Engineer',name:'Imran Khan',first:'Imran',role:'employee',subtitle:'Field engineer',department:'Engineering',location:'Hyderabad',tone:'peach',login:'Microsoft 365 (demo)'},
  {id:'usr-ritesh',erpGrade:'Manager to DGM',designation:'Projects Manager',name:'Ritesh Mehta',first:'Ritesh',role:'manager',subtitle:'Projects manager',department:'Projects',location:'Hyderabad',tone:'purple',login:'Microsoft 365 (demo)'}
];
const request=(id,userId,origin,destination,offset,departTime,people,purpose,status,extra={})=>({
 id, userId,origin,destination,departDate:d(offset),departTime,requiredArrivalDate:'',requiredArrival:'',returnDate:'',returnTime:'',people,purpose,priority:'planned',notes:'',department:'Site Operations',site:destination,flexibility:'30',preferredMode:'',roster:'',createdAt:now(),status,planId:null,...extra
});
export function buildSeed(){
 const users=structuredClone(identities);
 const requests=[
  request('TR-1001','usr-worker','Kothur','ProRack Kothur Plant',2,'07:00',1,'Site visit','submitted',{notes:'Morning shift pickup requested.'}),
  request('TR-1002','usr-devi','Shamshabad','ProRack Kothur Plant',2,'06:45',1,'Site visit','submitted',{notes:'Pickup near Shamshabad bus stop.'}),
  request('TR-1003','usr-suresh','Kondapur','ProRack Kothur Plant',2,'06:30',1,'Project work','under_review',{notes:'Need to arrive before the morning toolbox meeting.'}),
  request('TR-1004','usr-manager','Hyderabad','Mumbai – Client Office',5,'08:00',1,'Client visit','submitted',{department:'Sales',site:'Mumbai client office',preferredMode:'flight',returnDate:d(6),notes:'Quarterly client review; preference is a morning flight.'}),
  request('TR-1005','usr-admin','Hyderabad','Bhiwandi Project Site, Maharashtra',8,'18:30',50,'Project work','approved',{department:'Installation',site:'Bhiwandi Project Site',notes:'Bulk site mobilization; verified roster to be supplied by Admin.',roster:'Roster verification pending'}),
  request('TR-1006','usr-imran','Hyderabad','Shamshabad',1,'12:30',1,'Site visit','submitted',{priority:'emergency',department:'Engineering',notes:'Urgent visit to inspect unexpected installation issue.'}),
  request('TR-1007','usr-employee','Gachibowli','ProRack Kothur Plant',3,'08:00',2,'Project work','allocated',{department:'Engineering',notes:'Design and production coordination.' ,planId:'PL-2001'}),
  request('TR-1008','usr-worker','Kothur','Shadnagar Project Site',4,'07:30',1,'Site visit','allocated',{notes:'Pickup confirmed with site coordinator.',planId:'PL-2002'}),
  request('TR-1009','usr-employee','Hyderabad','Pune Client Warehouse',6,'09:30',1,'Meeting','under_review',{department:'Engineering',notes:'Technical drawings review.'}),
  request('TR-1010','usr-manager','Hyderabad','Bengaluru Customer Office',10,'07:00',1,'Client visit','allocated',{department:'Sales',preferredMode:'flight',planId:'PL-2003',notes:'Customer visit, ticket reference recorded.'}),
  request('TR-1011','usr-ritesh','Hyderabad','ProRack Kothur Plant',4,'06:50',3,'Project work','submitted',{department:'Projects',notes:'Project coordination visit.'})
 ];
 const plans=[
  {id:'PL-2001',requestIds:['TR-1007'],mode:'van',capacity:12,departure:`${d(3)}T07:45`,provider:'ProRack Transport',identifier:'PR-STAFF-02',pickup:'Gachibowli main junction',drop:'ProRack Kothur Plant',bookingRef:'',notes:'Coordinator will confirm pickup 30 minutes before.',status:'allocated',createdAt:now()},
  {id:'PL-2002',requestIds:['TR-1008'],mode:'car',capacity:4,departure:`${d(4)}T07:20`,provider:'Company vehicle',identifier:'PR-CAR-04',pickup:'Kothur main road',drop:'Shadnagar Project Site',bookingRef:'',notes:'Site entry pass required.',status:'allocated',createdAt:now()},
  {id:'PL-2003',requestIds:['TR-1010'],mode:'flight',capacity:1,departure:`${d(10)}T07:00`,provider:'Booked by Travel Admin',identifier:'Flight details available with Admin',pickup:'Hyderabad Airport',drop:'Bengaluru Airport',bookingRef:'DEMO-BOOKING-487',notes:'Synthetic reference for demo only.',status:'allocated',createdAt:now()}
 ];
 const activity=[{id:'ACT-1',actorId:'usr-admin',kind:'system',message:'Demo workspace prepared with sample travel requests.',requestId:null,time:now()}];
 const notifications=[{id:'NT-1',userId:'usr-admin',text:'Urgent travel request from Imran Khan needs attention.',read:false,time:now(),requestId:'TR-1006'},{id:'NT-2',userId:'usr-worker',text:'Your trip to Shadnagar has a transport allocation.',read:false,time:now(),requestId:'TR-1008'}];
 return {users,requests,plans,activity,notifications};
}
