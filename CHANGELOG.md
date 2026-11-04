# ProRack Move — Changelog

## Unreleased — Travel policy engine (4 November 2026)

- Added current ERP rules and the proposed Travel Policy v1.0 as two separate rule sets (`src/policy.js`). ERP values (4 grades, ₹15/₹7 mileage, EUR international) are reference-only; the proposed policy is labelled "not in force".
- Grades: employees keep their ERP grade. The ten-grade policy grade is provisional until HR confirms it; designation and role are never used to infer a grade, and air entitlement on a provisional grade goes to review.
- Policy engine (`src/entitlements.js`): approval routing, a 15% fare-premium approval, domestic short notice as advisory, international short notice as review, local conveyance from captured round-trip distance (150 km), a separate unresolved 100 km cab provision, and time away shown as journey span plus configurable buffers.
- Requests capture trip type, destination country, round-trip distance, and normal and quoted fare. The review step and request detail show the policy check and approval route.
- Admin **Travel policy** page lists unresolved items, current ERP rules, the provisional grade mapping and the proposed tables.
- 23 policy tests covering boundaries and exceptions; rules and open items documented in `docs/POLICY_RULES.md`.

## v1.1.0 — 29 October 2026

- Added interactive seven-step guided stakeholder tour for employee, manager and Admin use cases.
- Added edit action for existing Admin transport plans with status and seat-capacity safeguards.
- Notifies the affected demo traveler and writes an audit event when a plan is revised.
- Added printable itinerary preview marked **DEMO · NOT A TICKET**; no actual booking is implied.
- Added tests for plan edits, authorization, capacity and completed-plan locks.
- Verified responsive desktop and mobile interactions through a local browser test harness.

## v1.0.0 — Initial functional local MVP

- Travel request wizard, demo personas, approvals, deterministic route suggestions and allocations.
- Demo audit history, notifications, reports, CSV export, browser-local data persistence.
