# Stage 7 Critic Review Report: Targeted Design Enhancement & Bug Remediation

**Target:** `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/targeted_design_enhancement_and_bug_remediation.md` (`Lines 1..777`)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-structural` | completed |
| `egm-design` | completed |
| `egm-style` | completed |

---

## Executive Summary of Findings

* 🔴 **Blockers:** 4
* 🟡 **Majors:** 5
* 🟢 **Nits:** 4

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Double-Entry Ledger Failure: `void_payment_receipt` Omits Account Balance Updates and Breaks Non-Dues Receipts - Severity: Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 391-487` (Pillar 2, Item 4) & `Lines 201-213` (State Machine)
* **Discrepancy Description**: 
  1. The stored procedure `public.void_payment_receipt` inserts a compensating outflow into `treasury_transactions`, but does NOT decrement `treasury_accounts.current_balance`, directly contradicting state diagram step `DecrementBalance` (Line 207) and the specification rationale (Line 789).
  2. The function hardcodes dues un-settling via `payment_dues_reconciliation` (Lines 428-440) and assumes all voided payments are monthly dues. If an `admission_fee` (Rs. 500) or `donation` payment is voided, dues reconciliation returns 0 rows, and the member's admission fee liability is not restored in `calculateMemberBalance` because the payment status transition alone does not re-evaluate admission exemptions.
  3. The function infers the outflow source account strictly via a coarse `CASE WHEN payment_method = 'cash' THEN 'cash_in_hand' ELSE 'boc_savings' END` instead of inspecting the original `treasury_transactions` row generated during payment verification. If the payment was made via `qr_payment` or deposited into another designated account, the reversal debits the wrong treasury asset account.
* **Rationale & Recommendation**: 
  Double-entry ledger safety requires absolute mathematical and relational parity. Update `void_payment_receipt` to:
  1. Check `v_payment.payment_type`. If `admission_fee`, explicitly audit that the admission fee requirement is re-activated for non-legacy members.
  2. Query `treasury_transactions WHERE reference_no LIKE '%' || p_payment_id::text` or inspect the original inflow to ensure the exact matching account is debited.
  3. Include an explicit balance update: `UPDATE public.treasury_accounts SET current_balance = current_balance - v_payment.amount WHERE id = v_source_account;` (if balances are stored in a table rather than a dynamic view).

---

### 2. Fatal Database Runtime Exception: `delete_or_archive_member` Assigns Unlisted Enum Value `'archived'` - Severity: Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 320-389` (Pillar 2, Item 3) & Migration Plan `Line 785`
* **Discrepancy Description**: 
  In `supabase/migrations/20261108000001_initial_schema.sql` (Line 5), the role enum is defined as:
  `CREATE TYPE app_role AS ENUM ('admin', 'manager', 'official', 'treasurer', 'member');`
  In `delete_or_archive_member` (Line 351), the procedure executes:
  `UPDATE public.members SET is_approved = false, role = 'archived' WHERE id = p_member_id;`
  Because `'archived'` is not a recognized value of `app_role`, PostgreSQL will throw a fatal runtime exception (`22P02: invalid input value for enum app_role: "archived"`), aborting the transaction and blocking all soft archival operations. The migration plan on Line 785 only specifies adding `'voided'` to `payment_status`, completely omitting `'archived'` from `app_role`.
* **Rationale & Recommendation**: 
  Add `ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'archived';` to `supabase/migrations/20261109000006_enhanced_governance_remediations.sql`. Furthermore, verify that frontend role checks (e.g., `ROLE_TABS` in `js/page-admin.js`) do not throw `undefined` errors when encountering an archived user.

---

### 3. Critical Security Flaw: Unauthenticated Anonymous Open INSERT Policy on `admin_inquiries` - Severity: Blocker
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 642-644` (Pillar 4, Item 17)
* **Discrepancy Description**: 
  The Row Level Security policy for inserting inquiries is defined as:
  ```sql
  CREATE POLICY "Users insert inquiries" ON public.admin_inquiries
      FOR INSERT WITH CHECK (true);
  ```
  `WITH CHECK (true)` allows completely unauthenticated, anonymous actors holding the public Supabase anon key to insert arbitrary rows. Attackers can forge `sender_id`, `sender_name`, `sender_email`, and `sender_epf` to impersonate association officials or flood the database with unauthenticated spam.
* **Rationale & Recommendation**: 
  Enforce authentication in RLS:
  ```sql
  CREATE POLICY "Authenticated members insert inquiries" ON public.admin_inquiries
      FOR INSERT TO authenticated
      WITH CHECK (
          auth.uid() IS NOT NULL AND 
          (sender_id IS NULL OR sender_id = (SELECT id FROM public.members WHERE user_id = auth.uid()))
      );
  ```
  If pre-registration inquiries from unapproved users are permitted, validate that `auth.uid() = (SELECT user_id FROM public.members WHERE id = sender_id)`.

---

### 4. Broken Financial Calculation: `calculateNetDuesStanding` Advance Formula Fails and Ignores Admission Fees - Severity: Blocker
* **Reviewer Lens:** `egm-structural` & `egm-design`
* **Affected Scope:** `Lines 501-524` (Pillar 3, Item 11)
* **Discrepancy Description**: 
  `calculateNetDuesStanding` computes advance payments using:
  `const futureSettled = dues.filter((d) => d.status === "settled" && d.billing_month > today);`
  In the MRIA system, future monthly dues rows are generated monthly; they are NOT pre-populated in `member_dues` months in advance. When a member pays for 4 months in advance, the payment is stored in `payments`, but `futureSettled` in `member_dues` evaluates to empty (`[]`). As a result, `totalAdvance` is always evaluated as 0!
  Furthermore, the formula completely ignores `admissionFeeDue` (Rs. 500/=). A newly admitted member with an unpaid admission fee and zero overdue monthly dues will be presented with `net === 0` ("All Settled / සම්පූර්ණයෙන්ම ගෙවා ඇත"), directly conflicting with Card 1 and the treasury audit balance.
* **Rationale & Recommendation**: 
  Refactor `calculateNetDuesStanding`:
  1. Retrieve verified payments sum for `monthly_due` vs total generated dues to calculate true prepaid credit balance.
  2. Factor in `admissionFeeDue` from `calculateMemberBalance` as an arrears component.
  3. Ensure that when `admissionFeeDue > 0`, the card displays the admission fee liability rather than showing an incorrect zero balance.

---

### 5. Print Engine Failure: External Tailwind CDN Dependency in Offline PWA & Timing Race Condition - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 671-715` (Pillar 5, Item 15)
* **Discrepancy Description**: 
  In `js/receipt.js`, `printReceipt()` injects `<script src="https://cdn.tailwindcss.com"></script>` into the print iframe.
  1. **Offline Breakage:** MRIA PWA operates offline via `sw.js`. If the Treasurer or member is offline or in an area with poor airport connectivity, the 3MB CDN script fails to load, rendering the receipt as broken, unstyled HTML.
  2. **Timing Race Condition:** Using `setTimeout(..., 500)` to trigger `iframe.contentWindow.print()` and then immediately calling `document.body.removeChild(iframe)` will abort the print dialog or print a blank page on slower mobile devices where layout takes >500ms.
  3. **Sinhala Font Corruption:** The iframe document lacks the `Noto Sans Sinhala` font import. Sinhala text (`අවලංගු කරන ලදී`, `MRIA කළමනාකාර සුබසාධක සංගමය`) will render as unreadable glyph boxes ("tofu") on devices without native Sinhala system fonts.
* **Rationale & Recommendation**: 
  1. Replace the CDN script with a `<link rel="stylesheet" href="/assets/styles.css" />` tag to reuse the local compiled Tailwind styles.
  2. Include `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700&display=swap">`.
  3. Use `iframe.onload = () => { iframe.contentWindow.print(); }` and listen to `iframe.contentWindow.onafterprint` before removing the iframe from the DOM.

---

### 6. Medical & Bereavement Privacy Risk: `get-slip-url` Lacks Claim Document Authorization Checks - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 596-600` (Pillar 4, Item 13) & `Lines 877-881` (Target File 11)
* **Discrepancy Description**: 
  The specification states: "Updates authorization check to permit presigned download if `payments.slip_key = slipKey` OR `benefit_claims.document_key = slipKey`."
  Benefit claim documents contain sensitive medical invoices, hospital diagnosis records, and death certificates. If the Edge Function only checks whether the key exists in `benefit_claims` without checking *who* is requesting it, any authenticated member can query and view confidential medical and bereavement records of other airport staff.
* **Rationale & Recommendation**: 
  The Edge Function `get-slip-url` MUST enforce strict ownership verification:
  Allow access only if:
  1. The caller is an executive staff member (`admin`, `secretary`, `treasurer`, `manager`), OR
  2. The caller's `member_id` strictly matches `benefit_claims.member_id`.

---

### 7. Auth User Desynchronization on Hard Deletion - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 369-386` (Pillar 2, Item 3)
* **Discrepancy Description**: 
  When a member with zero transactions is hard-deleted from `public.members`, their auth user record in Supabase `auth.users` remains alive because `members.user_id` has `ON DELETE SET NULL`. If this airport employee signs in again via Google OAuth, `js/auth.js` detects an active session in `auth.users` but cannot find their `public.members` record, causing an unhandled redirect loop or throwing exceptions.
* **Rationale & Recommendation**: 
  Specify that when hard-deleting an unlinked profile, the admin routine must also invoke the Supabase Admin API (`supabase.auth.admin.deleteUser(user_id)`) to purge the orphan auth record, or update `auth.js` to redirect authenticated users without a `members` record back to `unauthorized.html` for re-registration.

---

### 8. Locked Dashboard Preview Information Leak: Unapproved Users Access Society Announcements - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 602-621` (Pillar 4, Item 16)
* **Discrepancy Description**: 
  Item 16 allows unapproved Google OAuth users to access `dashboard.html` with disabled mutation buttons and zero-state financial cards. However, the document does not specify hiding the Association Notice Board (`#announcementsList`). Internal society circulars, financial announcements, or executive notices will be exposed to unvetted external Google accounts before the Secretary has approved their identity.
* **Rationale & Recommendation**: 
  Explicitly specify in Item 16 that when `member.is_approved === false`, `#announcementsList` and society updates are hidden or replaced with a "Pending Approval Notice" container.

---

### 9. Currency Prefix Duplication and Formatting Inconsistency - Severity: Major
* **Reviewer Lens:** `egm-design` & `egm-style`
* **Affected Scope:** `Lines 307-315` (Pillar 1, Item 7) & `Lines 520-523` (Pillar 3, Item 11)
* **Discrepancy Description**: 
  In Item 11, the display format is specified as `-Rs. ${displayAmount}`.
  However, in `js/ui.js` (Line 291), `formatCurrency(amount)` already prepends `Rs. `. If a developer passes `displayAmount` through `formatCurrency()`, the UI will render `-Rs. Rs. 500.00`. If they do not pass it through `formatCurrency()`, it lacks thousands comma separators (e.g., `-Rs. 1500` instead of `-Rs. 1,500.00`), directly violating Item 5.
* **Rationale & Recommendation**: 
  Update `formatCurrency` in `js/ui.js` to accept an options object: `formatCurrency(amount, { showSign: true })` producing `+Rs. 1,500.00` or `-Rs. 1,500.00`, and mandate that all UI views use this function rather than manual string concatenation.

---

### 10. Toolbar Flex Wrap Layout Collapse on Small Screens (320px-360px) - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 250-294` (Pillar 1, Item 2)
* **Discrepancy Description**: 
  In the Receipts toolbar, the search box has `min-w-[200px]`, the Category filter has `min-w-[130px]`, and the Method filter has `min-w-[120px]`. On a 320px mobile viewport, these minimum widths cause controls to stack vertically in 4 separate lines with uneven borders.
* **Rationale & Recommendation**: 
  Apply responsive full-width classes on mobile: `w-full sm:w-auto sm:min-w-[130px] flex-1`.

---

### 11. Pagination State Reset Omission on Tab Switch / Filter Change - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** `Lines 717-735` (Pillar 5, Item 18)
* **Discrepancy Description**: 
  `paymentsRenderLimit` is stored as a global module-level variable initialized to 5. When a member filters history or navigates between tabs, `paymentsRenderLimit` is never reset, leaving the DOM rendering 30+ items when the user expected the initial slice.
* **Rationale & Recommendation**: 
  Reset `paymentsRenderLimit = 5` whenever member data is reloaded, search filters change, or the history modal is re-opened.

---

### 12. Inquiry Schema Missing Contact Phone Number - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** `Lines 624-639` (Pillar 4, Item 17)
* **Discrepancy Description**: 
  The schema for `public.admin_inquiries` contains `sender_email` and `sender_epf`, but lacks `sender_phone`. Executive officers frequently need to call the employee back on their mobile phone for quick clarification when email delivery is delayed.
* **Rationale & Recommendation**: 
  Add `sender_phone VARCHAR(20)` to `admin_inquiries` and include the phone input field in the contact administration modal.

---

### 13. Missing Migration Rollback & Idempotency Safeguards - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** `Lines 782-791` (Target File 1)
* **Discrepancy Description**: 
  The implementation plan does not provide rollback DDL or idempotent guards for table creation, policy definitions, and enum modifications.
* **Rationale & Recommendation**: 
  Ensure all policies drop existing definitions before creation (`DROP POLICY IF EXISTS ... ON ...`), use `CREATE TABLE IF NOT EXISTS`, and document corresponding rollback statements.

---

### Next Action Recommendation
All 13 findings are structured and ready for immediate remediation. Please review and apply the required fixes to `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/targeted_design_enhancement_and_bug_remediation.md` and persist this report to `/home/anjana/Documents/Software/MRIA Welfare Association /critic_report.md`.