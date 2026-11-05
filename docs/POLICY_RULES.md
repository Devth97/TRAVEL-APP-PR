# Travel policy rules in ProRack Move

How the app applies ProRack's travel rules, what it does with the current ERP rules, and what is still unresolved.

## Two policy versions, kept separate

| | Current ERP rules | Proposed Travel Policy v1.0 |
|---|---|---|
| Status | In force in ERP | **Proposed, not in force.** No effective date; not confirmed to supersede ERP |
| Source | Production ERP API, read 4 Nov 2026 (Employee Grade master, Travel Request Approval workflow, HR Expense Policy script) | Prorack Travel Policy and Local Conveyance Policy documents |
| Grades | 4: GM & Above, Manager to DGM, Jr Executive to Dy Manager, Others | 10 designation groups (TP Annex II) |
| Mileage | ₹15/km four-wheeler, ₹7/km two-wheeler | ₹12/km four-wheeler, ₹4/km two-wheeler |
| International | EUR reference amounts (values not captured) | USD per day (TP Annex III) |
| Manager to DGM / Manager-II group | Lodging ₹10,000 / ₹7,000; per diem ₹2,000 / ₹1,500 (city-class split not captured) | Hotel ₹9,000 A / ₹7,500 B; food ₹1,200; incidental ₹300 |
| Workflow | Draft → Pending HOD Approval → Approved / Rejected | Sanctioning authority by grade, plus exception approvals |
| Short notice, fare premium, distance | No rule in ERP | See below |

Both are defined in `src/policy.js` (`ERP_CURRENT_RULES`, `PROPOSED_POLICY_2026`). Request checks run against the proposed policy and are labelled as such, with the current ERP workflow shown alongside. ERP values are read-only. **The app does not read from or write to the ERP**, and nothing in production changes.

## Grades

- Each employee keeps their **ERP grade** (`erpGrade`) exactly as assigned in ERP.
- The **proposed-policy grade** is confirmed only when HR sets `policyGrade` and ticks "HR has confirmed". Until then it is **provisional**:
  - from an unconfirmed HR draft, or
  - from the candidate grades for the employee's ERP grade (`ERP_TO_PROPOSED_CANDIDATES`).
- **Designation and role are never used to infer a grade.** An employee with no ERP grade, or with ERP grade "Others", is *not assigned*. Their requests get a review flag and no assumed entitlements.
- **Air entitlement on a provisional grade always needs review**, even if every candidate grade is air-entitled. On a confirmed grade without air entitlement, air needs ED / Dy. ED approval (TP 4.3.2).
- When candidate grades disagree, limits are shown as ranges and the sanctioning authority shows "to be confirmed".

| ERP grade | Possible policy grades (provisional) |
|---|---|
| GM & Above | ED Group / GM Group |
| Manager to DGM | GM Group / Manager-II to Sr. Mktg. Manager Group |
| Jr Executive to Dy Manager | Dy. Manager … ASO / CET / GET / SOT (5 grades) |
| Others | None: HR to assign |

## Rules and their boundaries

Check levels: **block** (not allowed as asked) · **approval** (extra sign-off) · **review** (a person must look) · **advisory** · **note**.

| Rule | Clause | Behaviour | Boundary tested |
|---|---|---|---|
| Domestic short notice | TP 18.1 | Advisory only. No approval added | 6 days ahead → advisory; 7 → none |
| Fare premium | TP 18.10 | Approval by ED / Dy. ED / HOD when the quoted fare is 15% or more above the normal fare. Fares are optional fields on the request | 14.99% → none; exactly 15% → approval |
| International short notice | TP 15.3 | **Review** by the sanctioning authority, not a hard block; the clause says "should" | 14 days → review; 15 → none |
| Local conveyance | LC 3 | Decided only from the captured **round-trip distance**, never from city names | 150 km → local; 151 km → beyond local; blank → undetermined |
| Cab beyond 100 km (below Asst. Manager) | TP 6.1(c) | Kept separate from the 150 km rule. Basis (one way or round trip) unresolved: definite only where both readings agree | ≤100 km → not allowed; 101–200 → review; >200 → allowed with HOD approval |
| Time away from home | TP 4.1 | Journey span and buffers shown separately. Buffers come from the policy data and can be overridden per call | 06:00 on 5 Nov → 19:00 on 7 Nov = 61 h journey + 3 h + 6 h provisional flight buffers = 70 h |
| Intercity cab | TP 7.1 | Blocked under 3 travellers; ED / Dy. ED approval otherwise | 2 → block; 3 → approval |
| Hotel/food pooling, food ≤ 50% of hotel bill, same-day, own stay, overnight journey | TP 4.4.6–4.4.7 | `assessDomesticClaim` | Covered in tests |
| Mileage | LC 4–5 / ERP | `assessMileage` with `rules: 'proposed'` (₹12/₹4) or `rules: 'erp'` (₹15/₹7) | 150 / 151 km; unconfirmed grade → review note |

## Unresolved (shown on the admin Travel policy page)

1. Whether the proposed policy supersedes the current ERP rules.
2. ERP grade and designation mapping to the ten policy grades.
3. Effective date (cover page reads [DD-MM-YYYY]).
4. [Head Office / NCR] and [Prorack plant / office locations] placeholders (TP 6.4, 6.5, 18.4).
5. Kathmandu in the domestic A-category list. Not classified until confirmed.
6. Clause 4.4.9 ("incidentals only at conferences") contradicts 4.4.5. Claim calculations show incidentals as a per diem with a review note.
7. Whether the 100 km cab threshold in TP 6.1(c) is one way or round trip.
8. Time-away buffers (3 h before and 6 h after a flight) come from the old TRF demo, not the policy.

## Not built yet

Expense claim screens (bill upload, expense calendar, Accounts approval), multi-city legs, tour category/purpose lists, forex, LTA claims, and an ERP import of employee grades. These wait until the policy basis and grade mapping are settled.
