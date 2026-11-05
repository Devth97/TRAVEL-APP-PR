/**
 * ProRack travel & expense rules as data, in two clearly separate versions:
 *
 *  1. ERP_CURRENT_RULES — what the production ERP enforces today, as reported from its API on
 *     4 Nov 2026. Read-only reference. The app never writes to ERP.
 *  2. PROPOSED_POLICY_2026 — the new written policy (Travel Policy v1.0 + Local Conveyance Policy).
 *     It is a PROPOSAL: it has no effective date and has not been confirmed to supersede ERP.
 *
 * Clause references: "TP" = Travel Policy, "LC" = Local Conveyance Policy.
 * Interpretations awaiting the policy owner are listed in `unresolved` and in docs/POLICY_RULES.md.
 */

/* ------------------------------------------------------------------------------------------------
 * 1. Current ERP rules (reference only)
 * ---------------------------------------------------------------------------------------------- */
export const ERP_GRADES = [
  { id:'GM & Above',                 label:'GM & Above' },
  { id:'Manager to DGM',             label:'Manager to DGM' },
  { id:'Jr Executive to Dy Manager', label:'Jr Executive to Dy Manager' },
  { id:'Others',                     label:'Others' }
];

export const ERP_CURRENT_RULES = {
  id:'erp-current',
  name:'Current ERP rules',
  status:'in force (ERP)',
  source:'Production ERP API, read 4 Nov 2026: Employee Grade master, Travel Request Approval workflow, HR Expense Policy server script',
  grades: ERP_GRADES,
  currency:{ domestic:'INR', international:'EUR' },
  classACities:['Delhi','Mumbai','Kolkata','Chennai','Hyderabad','Bengaluru'],
  /** Only the Manager to DGM figures were reported; other grades were not captured. */
  lodging:   { 'Manager to DGM':{ first:10000, second:7000 } },
  perDiem:   { 'Manager to DGM':{ first:2000,  second:1500 } },
  amountsNote:'Reported as ₹10,000 / ₹7,000 lodging and ₹2,000 / ₹1,500 per diem; which city class each figure applies to was not captured. Per diem is reduced for trips under 12 hours and where meals are provided.',
  mileage:{ four_wheeler:15, two_wheeler:7 }, // INR per km
  international:{ currency:'EUR', amounts:null, note:'EUR reference amounts exist in ERP; values not captured.' },
  workflow:['Draft','Pending HOD Approval','Approved / Rejected'],
  approver:'Employee’s assigned expense approver or HR',
  shortNoticeRule:null,   // none found in ERP
  farePremiumRule:null,   // none found in ERP
  distanceRules:null      // neither 150 km nor 100 km is enforced in ERP
};

/* ------------------------------------------------------------------------------------------------
 * 2. Proposed written policy
 * ---------------------------------------------------------------------------------------------- */

/** The ten designation groups from TP Annexure-II, highest first. */
export const GRADES = [
  { id:'ed',          rank:1,  label:'ED Group' },
  { id:'gm',          rank:2,  label:'GM Group' },
  { id:'mgr',         rank:3,  label:'Manager – II to Sr. Mktg. Manager Group' },
  { id:'dy_mgr',      rank:4,  label:'Dy. Manager / Jt. Manager / Jt. Sales Manager' },
  { id:'asst_mgr',    rank:5,  label:'Assistant Manager' },
  { id:'sr_exec',     rank:6,  label:'Sr. Sales Officer / Sr. Service Engineer / Sr. Executive / Sr. Engineer' },
  { id:'exec',        rank:7,  label:'Sales Officer / Executive / Engineer / Service Engineer' },
  { id:'asst_exec',   rank:8,  label:'ASO / Asst. Executive / Asst. Engineer / Asst. Service Engr., CET / GET / SOT' },
  { id:'staff',       rank:9,  label:'Sr. Sales Rep. / Sales Rep. / DET / Associates (HO) & Works Staff' },
  { id:'blue_collar', rank:10, label:'Blue Collar / Peon / Driver / E-Coupon Coordinator' }
];

/**
 * PROVISIONAL: which proposed-policy grades each ERP grade could correspond to.
 * Used only until HR confirms an employee's policy grade. Designation is never used to infer a grade.
 * "Others" has no candidates: it cannot be mapped without HR.
 */
export const ERP_TO_PROPOSED_CANDIDATES = {
  'GM & Above':                 ['ed', 'gm'],
  'Manager to DGM':             ['gm', 'mgr'],
  'Jr Executive to Dy Manager': ['dy_mgr', 'asst_mgr', 'sr_exec', 'exec', 'asst_exec'],
  'Others':                     []
};

const g = ids => ids.split(' ');

export const PROPOSED_POLICY_2026 = {
  id:'proposed-2026',
  name:'Proposed Travel Policy v1.0',
  status:'proposed — not in force',
  effectiveDate:null,          // UNRESOLVED: cover page reads [DD-MM-YYYY]
  supersedesErp:null,          // UNRESOLVED: not confirmed that this replaces ERP rules
  currency:{ domestic:'INR', international:'USD' },

  tourMinHours:8,              // TP 4.1

  /** TP Annexure-I. Everything not listed is B. Aliases matched case-insensitively. */
  domesticCities:{
    A:{
      'Ahmedabad':[],
      'Bengaluru':['bangalore','blr'],
      'Chennai':['madras','maa'],
      'Delhi / NCR':['delhi','new delhi','ncr','faridabad','ghaziabad','noida','greater noida','gurgaon','gurugram'],
      'Kolkata':['calcutta','ccu'],
      'Mumbai':['bombay','navi mumbai','thane','bom'],
      'Pune':['pnq'],
      'Coimbatore':['cjb'],
      'Indore':['idr'],
      'Hyderabad':['secunderabad','hyd'],
      'Mohali / Chandigarh':['mohali','chandigarh','ixc'],
      'Hosur':[]
    },
    unresolved:['Kathmandu']   // in the supplied Annexure-I; not classified until confirmed
  },

  internationalCountries:{
    A:['united states','usa','canada','mexico','brazil','argentina','chile','colombia','peru',
       'united kingdom','uk','england','scotland','germany','france','italy','spain','netherlands','belgium',
       'switzerland','austria','sweden','norway','denmark','finland','poland','portugal','ireland',
       'czech republic','greece','hungary','japan','singapore','china','hong kong','dubai']
  },

  /** TP 4.3 */
  domesticModes:[
    { grades:g('ed gm'), air:true, train:['1st AC','2nd AC','3rd AC','Chair Car'], bus:['Deluxe Bus','Volvo'] },
    { grades:g('mgr'), air:true, train:['2nd AC','3rd AC','Chair Car'], bus:['Deluxe Bus','Volvo'], provisional:true },
    { grades:g('dy_mgr asst_mgr sr_exec exec asst_exec staff blue_collar'), air:false, train:['2nd AC','3rd AC','Chair Car'], bus:['Deluxe Bus','Volvo'] }
  ],

  /** TP 5.0 */
  sanctioning:[
    { grades:g('ed'), authority:'MD & CEO' },
    { grades:g('gm'), authority:'ED / Dy. ED' },
    { grades:g('mgr dy_mgr asst_mgr'), authority:'HOD', alternate:'GM Group', provisional:true },
    { grades:g('sr_exec exec asst_exec staff blue_collar'), authority:'Departmental Manager', alternate:'Sr. Manager / RM' }
  ],

  /** TP Annexure-II — INR per day, excluding GST. */
  domesticDaily:{
    ed:{hotelA:10500,hotelB:9000,food:2000,incidental:500}, gm:{hotelA:9500,hotelB:8000,food:1500,incidental:500},
    mgr:{hotelA:9000,hotelB:7500,food:1200,incidental:300}, dy_mgr:{hotelA:3500,hotelB:2800,food:1000,incidental:200},
    asst_mgr:{hotelA:3000,hotelB:2500,food:950,incidental:200}, sr_exec:{hotelA:2500,hotelB:2300,food:900,incidental:200},
    exec:{hotelA:2300,hotelB:2100,food:850,incidental:200}, asst_exec:{hotelA:2100,hotelB:1900,food:750,incidental:200},
    staff:{hotelA:1700,hotelB:1500,food:600,incidental:200}, blue_collar:{hotelA:1300,hotelB:1100,food:500,incidental:200}
  },
  foodMaxShareOfHotel:0.5,     // TP 4.4.6(i)

  /** TP 6.1 */
  destinationTravel:[
    { grades:g('ed gm'), mode:'Taxi / Ola / Uber (full day)', provisional:true },
    { grades:g('mgr dy_mgr asst_mgr'), mode:'Taxi / Ola / Uber (point to point)' },
    { grades:g('sr_exec exec asst_exec staff blue_collar'), mode:'Bus / metro / train / 3-wheeler / Ola or Rapido bike', cabProvision:true }
  ],
  /**
   * TP 6.1(c): below Assistant Manager, a cab / company vehicle is allowed for long-distance travel
   * "more than 100 km, to and fro", with HOD / reporting-manager approval.
   * UNRESOLVED: whether 100 km is one way or the round trip. `basis: null` keeps it unresolved;
   * set 'round_trip' or 'one_way' once confirmed.
   */
  destinationCab:{ km:100, basis:null },
  autoNoBillLimit:400,          // TP 6.3

  intercityCabMinTravellers:3,  // TP 7.1
  overnightTrainAllowance:750,  // TP 7.2
  agentBookingChargeMax:500,    // TP 7.4
  flightMealMax:500,            // TP 4.3.3
  preferredSeatMax:600, preferredSeatGrades:g('ed'), // TP 18.2

  domesticAdvanceDays:7,        // TP 18.1 — advisory
  fareIncreaseApprovalPct:15,   // TP 18.10 — ≥ this % over normal fare needs prior ED / Dy. ED / HOD approval
  fareApprover:'ED / Dy. ED / HOD',
  internationalAdvanceDays:15,  // TP 15.3 — "should be made and approved": treated as review, not a hard block
  billSubmissionDays:7,         // TP 17.0
  foreignTourReportDays:5,      // TP 16.0

  /** TP 15.0 */
  internationalClass:[
    { grades:g('ed'), cls:'Business' },
    { grades:g('gm'), cls:'Premium Economy (Economy if unavailable)' },
    { grades:g('mgr dy_mgr asst_mgr sr_exec exec asst_exec staff blue_collar'), cls:'Economy' }
  ],
  internationalSanction:'MD & CEO',

  /** TP Annexure-III — USD per day. */
  internationalDaily:{
    A:{ ed:{hotel:140,food:70,incidental:20,local:40}, gmToDyMgr:{hotel:90,food:70,incidental:20,local:40}, asstMgrAndBelow:{hotel:90,food:65,incidental:15,local:40} },
    B:{ ed:{hotel:115,food:60,incidental:20,local:40}, gmToDyMgr:{hotel:70,food:55,incidental:20,local:40}, asstMgrAndBelow:{hotel:70,food:50,incidental:15,local:40} }
  },
  internationalBand:{ ed:'ed', gm:'gmToDyMgr', mgr:'gmToDyMgr', dy_mgr:'gmToDyMgr' },

  /** LC 3–5 */
  localConveyance:{
    maxRoundTripKm:150,
    fourWheelerGrades:g('ed gm mgr dy_mgr asst_mgr'),
    rates:{ four_wheeler:12, two_wheeler:4 }
  },

  /**
   * Time away from home = journey span (departure → return) plus buffers.
   * PROVISIONAL: the buffers are not in the written policy. Flight values reproduce the old TRF demo
   * (3 h before departure, 6 h after return). Override per call or per deployment.
   */
  timeAwayBuffers:{
    provisional:true,
    beforeDepartureHours:{ flight:3, train:1, bus:1, car:0.5, van:0.5, sea:2 },
    afterReturnHours:    { flight:6, train:1, bus:1, car:0.5, van:0.5, sea:2 }
  },

  /** Open items. The UI and docs show these; none is decided by the app. */
  unresolved:[
    { id:'supersession',     clause:'—',              topic:'Whether this policy supersedes the current ERP rules (4 grades, ₹15/₹7 mileage, EUR international).' },
    { id:'grade-mapping',    clause:'TP 4.3, 5.0, 6.1, Annex II', topic:'Mapping of ERP grades and designations to the ten policy grades; air entitlement is unconfirmed until HR confirms each grade.' },
    { id:'effective-date',   clause:'Cover page',     topic:'Effective date not set ([DD-MM-YYYY]).' },
    { id:'office-locations', clause:'TP 6.4, 6.5, 18.4', topic:'[Head Office / NCR] and [Prorack plant / office locations] placeholders not filled.' },
    { id:'kathmandu',        clause:'TP Annex I',     topic:'Kathmandu is listed as a domestic A-category city; not classified until confirmed.' },
    { id:'clause-4-4-9',     clause:'TP 4.4.9',       topic:'Says incidentals are paid only at conferences, contradicting 4.4.5. Interim: shown as per-diem, flagged for review.' },
    { id:'cab-km-basis',     clause:'TP 6.1(c)',      topic:'Whether the 100 km cab threshold is one way or round trip.' },
    { id:'time-buffers',     clause:'—',              topic:'Time-away buffers (flight: 3 h before, 6 h after) come from the old TRF demo, not the policy.' }
  ]
};

export const POLICY_VERSIONS = [ERP_CURRENT_RULES, PROPOSED_POLICY_2026];
