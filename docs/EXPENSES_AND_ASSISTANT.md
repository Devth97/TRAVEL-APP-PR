# Expense tracker, approval centre and travel assistant

What the first release does, the decisions behind it, and what must be checked against ERP UAT before real use.

## Decisions

| Topic | Decision |
|---|---|
| Approval | The assistant fills in the request and the employee confirms it. A person always approves: nothing is auto-approved. |
| Assistant | Rule-based and built in, so it runs on Netlify with no key or cost. A real AI model can replace `readMessage()` in `src/assistant.js` later, on Convex, once a provider is approved. |
| Bookings | Nothing is booked. Hotel and cab needs are written into the Travel Request, and approved trips appear under Approvals → To arrange for the Travel Admin. |
| Data | ERP is the system of record. Each expense is one ERP **Expense Claim**. |
| Mileage | Own vehicle claims use the rates in force in ERP (₹15 and ₹7 per km). The server recalculates them, so the browser cannot set the amount. |
| Limits | Daily limits and the 150 km local limit come from the proposed policy and are advisory. They warn, and do not block. |

## The flow

1. An employee tells the assistant about a trip. It asks for anything missing: destination, origin, dates, purpose, hotel and cab.
2. It shows a plan with the policy checks and an expense estimate. The employee can change details by typing, for example "return on 15 Nov".
3. On **Confirm and submit**, the app creates the Travel Request, sends it into the approval workflow, and saves the estimate.
4. The approver decides in the **Approval centre**. Rejecting needs a reason.
5. After the trip, the employee adds actual expenses with bills, ticks them and chooses **Generate report and send**.

Policy blocks stop the plan from being submitted, for example an intercity cab for one person (TP 7.1).

**Estimates are not claims.** They are saved as a draft Expense Claim marked as an estimate, using policy limits as ceilings. They can be deleted but can never be sent for reimbursement. Cabs have no estimate, because no amount is known until one is booked.

## Who can do what

- Employees see, send and delete only their own expenses. Sent expenses cannot be deleted or changed.
- The approver is the requester's **Expense Approver** in ERP.
- Nobody can approve their own request.
- Travel Admins can approve only if `ADMIN_CAN_APPROVE=1` is set. It is off by default, and on only in the browser preview and `npm run dev:erp`, which have no real HOD to sign in as.
- Bills must be JPG, PNG or PDF, up to 4 MB, and are stored in ERP as private files.

Hotel, food, fare, taxi, exceptional, toll, parking and local food expenses need a bill before sending. This list is an assumption to confirm with Accounts (`EXPENSE_TYPES` and `LEG_CATEGORIES` in `convex/lib/expenses.js`).

## Check against ERP UAT before real use

The Expense Claim connector has only been tested against the fake ERP in `src/fake-erp.js`. On ERP UAT, check:

1. **API user permissions:** the API user can create, update, delete and submit Expense Claims, upload files and add Comments.
2. **Expense Claim Types:** the app matches its types to names such as Hotel, Food, Travel, Taxi, Mileage and Miscellaneous. If one is missing, it shows which, and HR must add it.
3. **Mandatory fields:** Expense Claim may require more on submit, such as a cost center or payable account. ERP's own message is shown if so.
4. **Workflow on Expense Claim:** the app assumes none. It marks "pending" in `remark`, then sets `approval_status` and submits. If UAT has a workflow, the send and decide steps must use it instead.
5. **Remark field:** app data is stored on a marked last line of `remark`. Confirm it exists and is long enough.
6. **Travel Request actions:** the app applies workflow actions named `Approve` and `Reject`. Confirm the names, and that the API user may apply them.
7. **Audit:** ERP will show the API user as the modifier. The real approver's email is recorded in a Comment on Travel Requests and in the data line on Expense Claims. Confirm this is enough for audit.

## Not in this release

Bill auto-reading, the 10-step travel form, 67-field master data, International expenses, soft-delete of requests, sponsorship and advances, payment status, email notifications, and tracking whether a hotel or cab has been booked.

Aadhaar, passport and date-of-birth fields from the reference portal are deliberately not collected. If they are ever needed, they belong in ERP with restricted access.

## Reference screenshots

`ui fields inspo/` shows another company's portal, including a real employee's personal details. It is listed in `.gitignore`. **Never commit it**, and consider deleting it once it is no longer needed. Only general ideas were taken from it: no branding, people, data or rule values.
