# ProRack Move — Local MVP Preview v1.1

> **Connected version (UAT):** ProRack Move runs on Convex against ERP UAT, with Microsoft 365 sign-in. ERP is the system of record. See [docs/CONVEX_ERP_SETUP.md](docs/CONVEX_ERP_SETUP.md). Locally, `npm run dev` is the sample-data demo and `npm run dev:erp` is ERP mode against a fake ERP. On any hosted copy (e.g. Netlify), add `?preview=erp` to the address to try ERP mode with sample ERP data in the browser; sign in with passcode `preview-pass` as `priya.sharma@prorackglobal.com` (employee) or `aarav.reddy@prorackglobal.com` (Travel Admin).

**UI transformation included:** a cohesive light-theme design system, 15 newly generated travel illustrations, improved mobile navigation, request search and accessible dialogs. See [UI_CHANGELOG.md](UI_CHANGELOG.md) and [ASSET_MANIFEST.md](ASSET_MANIFEST.md). Preview this updated workspace with `start-preview.bat`; the older v1.1 ZIP predates this refresh.

**ProRack Move** is a premium, light-themed, working demonstration of an employee travel and transportation management app for ProRack. It operates entirely in your browser using synthetic sample data. **No cloud accounts, real credentials, bookings, payments or live location services are involved.**

> **Fastest way to preview on your Windows company or personal laptop:** Extract the ZIP, open the `prorack-move-mvp` folder, then double-click **`start-preview.bat`**. Open `http://localhost:5173` in Chrome or Edge.

## Requirements

- Windows 10/11, macOS or Linux
- **Node.js 18 or newer** installed (for the tiny local server)
- A modern browser
- No `npm install` or Internet access required; there are **zero external npm dependencies**.

## Run inside VS Code

1. Extract `ProRack_Move_MVP_Source.zip`.
2. In VS Code choose **File → Open Folder** and select `prorack-move-mvp`.
3. Open **Terminal → New Terminal**.
4. Run:

   ```powershell
   npm run dev
   ```

5. Open **http://localhost:5173** in your browser.
6. To stop, press **Ctrl+C** in the terminal.

If port 5173 is already occupied, close that process or run `set PORT=5174` in Windows Command Prompt before launching the server. In PowerShell, use `$env:PORT=5174`.

**Avoid opening `index.html` directly by double-clicking it.** Browser JavaScript modules work reliably when served over localhost.

## Demo personas

Select a persona on the welcome page. These are **demo role selectors, not real account logins**:

| Persona | Demo name | Try |
|---|---|---|
| Site worker | Mahesh Patil | Create travel request; no preferred-mode field |
| Employee / engineer | Aarav Reddy | View allocated trip; request site travel |
| Manager | Priya Sharma | Mumbai client visit; optional flight preference |
| Travel Admin | Ananya Rao | Review requests, plan routes and allocate transport |

You can change the persona via the profile button in the top-right header without signing out.

## Five-minute stakeholder demonstration

1. **Guided tour** → Click **Guided tour** for the 7-step stakeholder walkthrough. Or explore manually:
2. **Worker view** → Select **Site worker** → **Enter demo workspace**. Show the light-themed home, new travel request, My requests and My trips.
3. **Submit a request** → **Plan a new journey** → choose *Site visit* → origin *Kothur*, destination *ProRack Kothur Plant*, future date, one traveler, and an optional note → submit.
4. **Admin view** → Top-right profile → choose **Travel Admin**. Show needs-attention queue and the emergency request from Imran Khan.
5. **Route planning** → choose the **ProRack Kothur Plant** shared-pickup suggestion. It combines sample requests from **Kothur, Shamshabad and Kondapur** when travel dates/times match. Explain that actual road feasibility is **not verified**.
6. **Allocate transport** → Review/approve → select a vehicle mode and capacity → set pickup and provider → confirm. Switch back to Site worker and view the updated request or notification.
7. **Bulk trip** → Review the 50-person **Bhiwandi** sample; rail is a *planning suggestion*, not a booked or live-availability result.
8. **Review an existing trip** → **Transport plans → View plan → Edit details**, update pickup instructions, preview the printable itinerary.
9. **Reset before another demo** → Admin → Settings → **Reset all demo data**.

## New in v1.1 — Stakeholder demo improvements

- **Guided 7-step tour:** Click **Guided tour** in the top bar (or from the demo sign-in screen). The tour switches between worker, manager and Admin previews and highlights the main journeys.
- **Admin may edit allocated transport:** Open **Transport plans → View plan → Edit details**. Update a pickup point, vehicle, service, capacity or departure. Changes are saved to local browser storage and create traveler notifications + audit records. Completed plans cannot be edited.
- **Printable trip summary:** Open an allocated trip, then click **View travel pass → Print / Save as PDF**. The output explicitly states **DEMO — NOT A TICKET**. It is a sample planning itinerary, not a real booking.
- **Stronger tests:** 14 unit tests, a browserless end-to-end travel flow and desktop/mobile UI interaction checks were completed in the development environment.

## What is actually interactive

- Responsive Employee and Admin workspaces
- Role-switching demonstration, with role-appropriate UI
- Four-step travel request form, validation, draft/resubmission and emergency flag
- Manager-only preferred transport field
- Request status, detail views and progress timelines
- Admin review, approval, clarification and rejection with notes
- Deterministic grouping for compatible destinations, dates, travel windows and broad origin region
- Traveler inclusion/exclusion when proposing a shared plan
- Transport allocation with mode, capacity guardrails, operator, pickup, departure and optional booking reference
- In-browser notifications and audit activity
- Trip completion, basic charts, CSV export, user-directory demo and data reset
- Data persistence via browser `localStorage` across page refreshes

## What is *not* connected

- Microsoft Entra / Microsoft 365 sign-in or credential verification
- Local-worker passwords/account creation (user provisioning page is a mock preview)
- Convex database, company GitHub, hosting or other third-party accounts
- Live train/flight schedules, price estimates, bookings, route-ETA/map APIs or AI-provider calls
- ERPNext employee sync, company email, WhatsApp or SMS
- Any server-enforced access control: roles are simulated locally and are **not secure for real data**

**Do not enter real employee personal information into this MVP.** It is for internal demonstration and feedback only.

## Implementation notes

This preview deliberately uses **dependency-free, modular browser JavaScript and CSS** so it can launch reliably with no downloads or external access. It is an executable UX prototype, **not yet the React/TypeScript + Convex production implementation** proposed by the PRD/TRD. Modules (`src/logic.js`, `src/store.js`, `src/data.js`) separate domain and persistence logic to support a later company-owned React/TypeScript and Convex migration after stakeholder approval.

Company-owned systems are the required target. No personal GitHub/Convex accounts have been initialized.

## Source and checks

```bash
npm run verify       # JS syntax + domain tests
npm run qa:flows     # Browserless end-to-end smoke of request, review and allocation
npm run build        # Verify + generate static release in dist/
```

Note that `npm run build` is a static copy/verification step, not a webpack or Vite compile. The editable app runs directly from `/src`.

## Files to edit

| File | Responsibility |
|---|---|
| `src/app.js` | Interactive pages, wizard, Admin flows and event handling |
| `src/styles.css` | All premium light-theme design and responsive layouts |
| `src/logic.js` | Validation, role rules, grouping, capacity, status transitions |
| `src/store.js` | Browser-local repository and state mutations |
| `src/data.js` | Synthetic sample users, requests, plans and notifications |
| `src/art.js` | Local illustration helpers and the original route-map SVG |
| `src/premium.css` | Shared UI transformation tokens, components and responsive refinements |
| `src/assets/generated/` | 15 newly generated travel illustrations |
| `src/icons.js`, `src/ui.js` | Shared icons and view components |
| `server.mjs` | Minimal Node local-only HTTP server |
| `docs/` | Original PRD, TRD, design research and stakeholder guide |

ProRack Technology · Prototype version 1.1 · October 2026.
