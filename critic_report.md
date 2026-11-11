# Stage 7: Critic Review Report

**Target Document:** [`docs/designs/comprehensive_remediation_and_governance_refinement.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/comprehensive_remediation_and_governance_refinement.md) (FeatureRange: `lines 1..358`)  
**Reviewers:** `[egm-design, egm-structural, egm-style]`  
**Date:** 2026-11-11  

---

## Severity Breakdown
* 🔴 **Blocker:** 4
* 🟡 **Major:** 5
* 🟢 **Nit:** 2
* **Total Prioritized Findings:** 11

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Broken Payment Submission Runtime Binding (`paymentMonthSelect` vs `paymentMonthHiddenInput`) - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Section 5 (Lines 221-251), Section 1 Architecture Diagram (Lines 120, 149)
* **Discrepancy Description**: Section 5 explicitly replaces `<select id="paymentMonthSelect">` in `dashboard.html` with a locked display container and `<input type="hidden" id="paymentMonthHiddenInput" name="billing_month" />`. However, in `js/page-dashboard.js` (line 1000), the form submit event listener reads:
  ```javascript
  const selectedMonth = document.getElementById("paymentMonthSelect")?.value;
  ```
  Neither Section 5 nor the Technical Plan specifies updating this selector in `js/page-dashboard.js` to target `paymentMonthHiddenInput`. Consequently, at runtime `document.getElementById("paymentMonthSelect")` evaluates to `null`, `selectedMonth` evaluates to `undefined`, and line 1028 (`if (category === "monthly_due" && selectedMonth)`) silently evaluates to false. The payment is submitted with zero billing month annotation in the notes, breaking ledger attribution.
* **Rationale & Recommendation**: A breaking DOM modification must be explicitly accompanied by the corresponding JS selector contract update in the spec. Update Section 5 to mandate:
  1. In `js/page-dashboard.js`, update the submit listener to extract `selectedMonth = document.getElementById("paymentMonthHiddenInput")?.value`.
  2. Fallback to extracting the attribute or defaulting cleanly if the hidden input is absent.

---

### 2. Card 1 Dues Settled Display Masking Active Month Pending Dues - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 4 (Lines 199-210), Goal 5 (Lines 51-52)
* **Discrepancy Description**: Section 4 states that when `balanceInfo.priorArrears === 0`, Card 1 must display:
  * Title: `Dues Settled` / `හිඟ මුදල් නැත`
  * Amount: `Rs. 0.00`
  * Badge: `Settled` / `ගෙවා ඇත`
  However, in [`js/api.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/api.js#L51-L59), `priorArrears` strictly filters for dues prior to the current calendar month (`d.billing_month < currentMonthStr`). For the current month, dues are generated on the 1st of each month and tracked as `currentMonthDue` (included in `totalPending`). Under the proposed design, throughout any active month, a member who has NOT paid the current month will see Card 1 declare their account "Settled" (`Rs. 0.00 / Settled`). Yet when they click "Pay Dues", the payment modal displays an outstanding due of Rs. 300/= for the current month.
* **Rationale & Recommendation**: Showing "Dues Settled (Rs. 0.00)" to a member who owes dues for the active month creates a false impression that no payment is required. Refine Card 1 logic:
  * When `priorArrears > 0`: Display red `-Rs. ${priorArrears.toFixed(2)}` with `Arrears` / `හිඟ මුදල්` badge.
  * When `priorArrears === 0` AND `currentMonthDue` is pending: Display `Current Month Due` / `වත්මන් මාසික මුදල` with amount `Rs. ${currentMonthDue.amount.toFixed(2)}` and `Due` / `ගෙවිය යුතුය` warning badge.
  * When `totalPending === 0`: Display `Dues Settled` / `හිඟ මුදල් නැත` with `Rs. 0.00` and emerald `Settled` / `ගෙවා ඇත` badge.

---

### 3. Inexecutable Arrears Targeting Query (`priorArrears > 0`) without Database Column or RPC - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Section 6 (Lines 263-267), CUJ 4 (Lines 95-98), Goal 8 (Line 57)
* **Discrepancy Description**: Section 6 specifies that when dispatching to arrears defaults, the system will:
  > "Query members with `priorArrears > 0` and batch-insert notifications."
  However, `priorArrears` is NOT a database column in `public.members`. In the codebase, `priorArrears` is a client-side aggregated metric computed by `calculateMemberBalance(member)` in `js/api.js`, which requires multiple queries per member. The spec provides zero database mechanism (no SQL query, no view, no RPC) to identify this cohort across all members. If implemented naively on the client, the browser would have to fetch all members and make hundreds of individual queries in a loop, triggering severe rate-limiting and browser freeze.
* **Rationale & Recommendation**: Define the backend mechanism explicitly:
  * Leverage the existing PostgreSQL view `public.defaulters_roster` or execute a single targeted query against `public.member_dues`:
    ```javascript
    const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    const { data: arrearsDues } = await supabase
      .from("member_dues")
      .select("member_id")
      .eq("status", "pending")
      .lt("billing_month", currentMonthStr);
    const targetMemberIds = [...new Set((arrearsDues || []).map((d) => d.member_id))];
    ```

---

### 4. Announcement Vanishing Trap in Notifications Modal Centralization - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Section 3 (Lines 183-193), Goal 2 (Line 48)
* **Discrepancy Description**: Section 3 mandates removing `#dashboardNotificationCenter` from `dashboard.html` and removing announcement rendering from `refreshDashboardData()`, directing:
  > "3. Route general announcements and 1-to-1 notifications into `#notificationsModal`"
  However, in `js/page-dashboard.js`, `openNotificationsModal()` strictly calls `getNotifications(currentMember.id)`, which only fetches records from `public.notifications` (`WHERE recipient_id = memberId`). It does NOT query `public.announcements`. If dashboard banners are removed without adding announcement fetching into the modal, all announcements published by the committee in `public.announcements` will become completely invisible to members.
* **Rationale & Recommendation**: Specify the concrete data integration model in Section 3:
  1. Define how `loadNotifications()` queries both `public.notifications` and active rows from `public.announcements`.
  2. Define how unread status for announcements is tracked (e.g., maintaining the existing `localStorage` dismissed array `mria_dismissed_announcements`).

---

### 5. Card 3 Semantic & Accounting Discrepancy (`disbursed` vs `approved` Claims) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 4 (Lines 215-218), Goal 5 (Line 54)
* **Discrepancy Description**: Goal 5 and Card 3 designate the metric as "Cumulative Lifetime Welfare Benefits Received ('ලබාගත් සුබසාධන ආධාර')", yet the calculation rule in Section 4 sums claims where `c.status === "disbursed" || c.status === "approved"`.
  1. Semantic & Accounting conflict: "Received" (ලබාගත්) means funds actually paid out. An "approved" claim has only been committee-sanctioned; the cash/bank outflow has not yet occurred.
  2. Value fluctuation: In `js/page-dashboard.js` line 525, the calculation evaluates `Number(c.disbursed_amount || c.claim_amount || 0)`. When a claim is approved for a reduced sum, `c.disbursed_amount` is null while in `approved` status, so the card temporarily sums `c.claim_amount`. Once disbursed, it switches to `c.disbursed_amount`, causing the member's lifetime metric to drop unexpectedly upon receiving funds.
* **Rationale & Recommendation**: Align metric definition and formula: Strictly filter by `c.status === "disbursed"` and sum `c.disbursed_amount`.

---

### 6. FIFO Locked Month Semantic Mismatch on Multi-Month and Partial Payments - Severity: 🟡 Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 5 (Lines 221-251), CUJ 1 (Lines 80-84), Alternative 1 (Lines 326-331)
* **Discrepancy Description**: Section 5 locks the payment modal's billing month strictly to the single earliest unpaid month (or current month if clear), but leaves `#paymentAmountInput` editable.
  * If a member pays Rs. 900 for Jan, Feb, and Mar 2026, the modal locks to `January 2026` and writes `[Billing Month: 2026-01]` into payment notes. Although PostgreSQL's trigger (`reconcile_verified_payment`) reconciles all 3 months, the receipt voucher states that the Rs. 900 payment was for January 2026 only, generating confusion during financial audits.
* **Rationale & Recommendation**: Dynamically format payment notes to reflect multi-month coverage (e.g. `[Settling Dues via FIFO starting from: 2026-01]`) rather than attributing the entire sum to a single month string.

---

### 7. Client-Side Broadcast Dispatch Anti-Pattern & API Abstraction Violation - Severity: 🟡 Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Section 6 (Lines 263-267), Section 1 Architecture Diagram (Lines 125-126, 154-155)
* **Discrepancy Description**: Section 6 states that when dispatching to `all`, `js/page-admin.js` will "Fetch all active members and execute batch insert into `public.notifications`."
  * There is NO batch dispatch function in `js/api.js`. `sendNotification` only accepts a single recipient.
  * Performing fan-out on the client by looping `sendNotification` incurs N network round-trips.
* **Rationale & Recommendation**: Add `sendBatchNotifications(rows)` to `js/api.js` using Supabase's native array insert: `supabase.from("notifications").insert(rows)`.

---

### 8. Unhandled Database `NOT NULL` Constraints on Bilingual Notification Fields - Severity: 🟡 Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Section 2 (Lines 164-167), Section 6 (Lines 258-268)
* **Discrepancy Description**: In the live PostgreSQL schema for `public.notifications`, columns `title_en`, `title_si`, `message_en`, and `message_si` are all defined as `NOT NULL`. If an administrator enters a message in only one language, the form submission will crash with a PostgreSQL NOT NULL violation.
* **Rationale & Recommendation**: If an administrator supplies text in only one language, auto-populate the alternate language field with the same text to satisfy the schema invariant.

---

### 9. Omission of Error States, Edge Cases, and Premature "Zero Open Questions" Declaration - Severity: 🟡 Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Section Open Questions (Lines 72-76), CUJs 1-5 (Lines 78-106)
* **Discrepancy Description**: Specifications must define error conditions and failure modes. CUJs depict only happy-path scenarios, omitting slip upload network drops or partial batch insert failures.
* **Rationale & Recommendation**: Expand CUJs to include recovery flows and list implementation directives in Open Questions.

---

### 10. Traceability Void for "19 Scoped Bug Remediations" - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Overview (Line 13), Technical Plan Intro (Line 112), Detailed Plan (Line 361)
* **Discrepancy Description**: The document repeatedly cites "19 scoped bug remediations", yet nowhere is there a cross-reference table mapping each item to its architectural solution and target files.
* **Rationale & Recommendation**: Insert a cross-reference table mapping Bug Item IDs (1..19) to their respective problem category, target file, and technical plan section.

---

### 11. Bilingual Terminology Inconsistency in Card 3 ("Claimed" vs "Received") - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Section 4 (Line 216)
* **Discrepancy Description**: Line 216 defines `Title: Total Welfare Benefits Claimed / ලබාගත් සුබසාධන ආධාර`. "Claimed" means applied for, whereas "ලබාගත්" explicitly means received/obtained.
* **Rationale & Recommendation**: Align the English title to `Total Welfare Benefits Received` to match the Sinhala title and Goal 5.
