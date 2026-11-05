# ProRack Move on Convex, connected to ERP UAT

ProRack Move is the employee-facing interface; **ERP is the system of record**. Convex hosts the web app and a small connector that signs people in with Microsoft 365 and reads and writes ERP. Convex stores only sign-in sessions. Employees, grades, approvers and Travel Requests live in ERP.

```
Browser ──► https://<deployment>.convex.site
              ├─ /            static web app (@convex-dev/static-hosting)
              └─ /api/...     Convex HTTP actions ──► ERP UAT REST API (API key)
                                                  └─► Microsoft Entra (sign-in)
```

| What the app does in ERP | How |
|---|---|
| Finds the signed-in employee | `Employee` where `user_id` or `company_email` = Microsoft email, status Active |
| Reads grade, designation, department, expense approver | `Employee` record (the **ERP grade** is used as-is; the 10-grade policy mapping stays provisional) |
| Lists travel purposes and options | `Purpose of Travel`, Travel Request meta |
| Creates a Travel Request | `POST /api/resource/Travel Request`, itinerary rows, policy check written into *Any other details* |
| Submits it for HOD approval | workflow action **Submit for Approval** (`Travel Request Approval`) |
| Approvals | stay in ERP: the HOD approves or rejects in the ERP desk; the app shows the live status |

## 1. ERP UAT: an API user (once)

Follow the kit's convention (like `api.powerfab@prorackglobal.com`):

1. In **erpuat.prorackglobal.com** create user **`api.travel@prorackglobal.com`** (System User, no login needed).
2. Roles: **HR User** (read Employees, create Travel Requests for any employee) and **Employee** (the role allowed to run *Submit for Approval*).
3. User → **Settings → API Access → Generate Keys**. Copy the key and secret straight into Convex (step 3). Never paste them anywhere else.
4. Check every employee who will test has **User ID** (or *Company Email*) set to their Microsoft 365 address, and an **Expense Approver** (HOD).

ERP will show `api.travel@…` as the creator of requests; the *Employee* field is the actual traveller.

## 2. Microsoft Entra: app registration (once)

Create a separate registration (recommended) rather than reusing *ERPNext SSO*:

1. Entra admin centre → App registrations → **New registration**, name **ProRack Move**, *single tenant*.
2. Redirect URI, platform **Web**: `https://<deployment>.convex.site/api/auth/callback`. You get the deployment name in step 3. Add the redirect after the first deploy.
3. Certificates & secrets → **New client secret**. Copy the value.
4. API permissions: the defaults (`openid`, `profile`, `email`, `User.Read`) are enough.

Until this is done you can test with the UAT passcode (step 3, `UAT_LOGIN_PASSCODE`).

## 3. Convex: create the project and deploy (on your laptop, PowerShell)

```powershell
git clone https://github.com/itadminprorack/TRAVEL-APP-PR.git
cd TRAVEL-APP-PR
git checkout feat/convex-erp
npm install
npx convex dev --once          # first run: log in, choose "create a new project", name it prorack-move
npm run deploy                 # deploys the backend to Production and uploads the web app
```

`npm run deploy` prints the site URL, `https://<random-name>.convex.site`. Convex assigns the name.

Set the environment variables on the **Production** deployment: dashboard → *prorack-move* → Production → Settings → Environment Variables. You can also use the CLI, for example `npx convex env set ERP_BASE_URL https://erpuat.prorackglobal.com --prod`.

| Variable | Value |
|---|---|
| `ERP_BASE_URL` | `https://erpuat.prorackglobal.com` |
| `ERP_API_KEY` / `ERP_API_SECRET` | from step 1 |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | from step 2 |
| `TRAVEL_ADMIN_EMAILS` | comma-separated emails that may see all requests |
| `APP_ENVIRONMENT` | `UAT` |
| `UAT_LOGIN_PASSCODE` | optional, 8+ characters, enables email + passcode sign-in for testing. **Remove before production.** |

Changing a variable takes effect immediately; no redeploy is needed.

## 4. Check it

1. Open `https://<deployment>.convex.site/api/health`. Expect `"erpConfigured": true, "erpReachable": true, "erpUser": "api.travel@prorackglobal.com"`. The `redirectUri` shown there is the one to register in Entra.
2. Open `https://<deployment>.convex.site`, sign in, and raise a test request. It should appear in ERP UAT as a **Travel Request** in *Pending HOD Approval*.
3. Approve it in ERP as the HOD, then press **Refresh from ERP** in the app.

If ERP refuses a request, the app shows ERP's own message. For example, a field ERP treats as mandatory is reported as *"ERP needs these fields before it will accept the request: …"*.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `npm run deploy` stops on a TypeScript error | Send me the output. To get UAT up meanwhile: `npx convex deploy --typecheck=disable`, then `npx @convex-dev/static-hosting upload --prod --build-command "npm run build"` |
| `/api/health` shows `erpReachable: false` with 401/403 | API key or secret wrong, or the API user is disabled |
| Sign-in says *No active ERP employee record is linked to …* | Set that employee's **User ID** or **Company Email** in ERP to their Microsoft address |
| Microsoft says *redirect URI mismatch* | Register exactly the `redirectUri` shown by `/api/health` |
| Submit says *"Submit for Approval" failed* | The request is saved in ERP as Draft. Give the API user the **Employee** role, then submit it from ERP or raise it again |

## Updating

Pull the latest change and run `npm run deploy` again. Old web files are cleaned up automatically.

## Later: custom domain

`travel.prorack.ai` needs a Convex Pro plan (custom domains). Once it is set up:

- set `APP_BASE_URL=https://travel.prorack.ai`;
- add `https://travel.prorack.ai/api/auth/callback` as an extra Entra redirect URI.

## Local work without ERP or Convex

- `npm run dev`: the original demo with sample data (no sign-in).
- `npm run dev:erp`: ERP mode against an in-memory fake ERP on http://localhost:5174. Sign in with passcode `local-passcode` as `priya.sharma@prorackglobal.com` (employee) or `aarav.reddy@prorackglobal.com` (Travel Admin).
- `npm test`: unit tests, including the API and ERP mapping against the fake ERP.

## Security notes

- ERP and Microsoft secrets exist only as Convex environment variables, used server-side. Nothing secret is sent to the browser.
- Sessions use a random token in an HttpOnly, Secure, SameSite=Lax cookie. Only its SHA-256 hash is stored, and it expires after 12 hours.
- Microsoft sign-in uses the authorization-code flow with PKCE and a one-time state. Tenant, audience, issuer and expiry are checked.
- Every write needs a custom header, so cross-site form posts are refused.
- An employee sees only their own requests; `TRAVEL_ADMIN_EMAILS` can list all of them. Approvals are never made by the app.
