# ProRack Move — Changelog

## Unreleased: Convex hosting and ERP UAT connection (5 November 2026)

- ERP is the system of record. A Convex connector (`convex/`) reads the signed-in employee, ERP grade, designation, department and expense approver from ERP. It also reads travel purposes and Travel Request options.
- Employees raise Travel Requests that are created in ERP and submitted to the **Travel Request Approval** workflow (Pending HOD Approval). The app's policy check is written into the request. HODs approve in ERP, and the app shows the live ERP status.
- Microsoft 365 sign-in (Entra, authorization code + PKCE), plus an optional UAT passcode sign-in for testing. Convex stores only hashed, 12-hour sessions.
- The web app is hosted on Convex with `@convex-dev/static-hosting` (`npm run deploy`). Setup is in `docs/CONVEX_ERP_SETUP.md`.
- ERP mode in the frontend: sign-in page, ERP profile, ERP purposes, submit / save draft to ERP, *Refresh from ERP*, *Open in ERP*, and an *All requests* view for Travel Admins. Demo-only tools (route planning, allocations, people) stay in the local demo.
- Opt-in browser preview: `?preview=erp` (or `#preview-erp`) runs ERP mode against sample ERP data with no backend, for testing on static hosts such as Netlify.
- `npm run dev:erp` runs ERP mode locally against an in-memory fake ERP. 16 new API tests run against that fake ERP.

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
