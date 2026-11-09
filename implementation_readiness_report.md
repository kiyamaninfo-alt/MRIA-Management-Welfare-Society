# Stage 9: Implementation Readiness Test Report

**Target File:** `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/targeted_design_enhancement_and_bug_remediation.md`  
**Scope:** Detailed Implementation Plan & Verification Plan (`Lines 778..940` and related Pillar sections `Lines 300..777`)  
**Report Path Target:** `/home/anjana/Documents/Software/MRIA Welfare Association /implementation_readiness_report.md`

---

## Reviewer Status

| Reviewer | Lens | Status | Findings Count |
| :--- | :--- | :--- | :--- |
| `egm-implementation-readiness` | Specification completeness, API signatures, zero architectural ambiguity | completed | 4 Blockers, 5 Majors, 2 Nits |
| `egm-codebase-details` | Codebase mapping, missing target files, PostgreSQL schema & RLS invariants | completed | 4 Blockers, 5 Majors, 1 Nit |
| `egm-style` | Structural consistency, naming conventions, parameter cleanliness, dates | completed | 0 Blockers, 1 Major, 3 Nits |

**Severity Breakdown:**
- 🔴 **Blockers:** 4
- 🟡 **Majors:** 7
- 🟢 **Nits:** 4
- **Total Unique Findings:** 15

---

# Implementation Readiness Audit Report

```markdown
# Implementation Readiness Test Report: Targeted Design Enhancement & Bug Remediation

**Target:** `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/targeted_design_enhancement_and_bug_remediation.md` (`Lines 778..940`)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

## Executive Summary

The Detailed Implementation Plan (Lines 778..940) provides strong foundational coverage of the 18 remediation items, detailing target files, PostgreSQL migrations, and functional verification journeys. However, the audit revealed **4 critical Blockers** that would prevent successful implementation without implementer architectural invention:
1. Omitting `supabase/functions/upload-slip/index.ts` from Target Files while falsely stating `js/storage.js` generates Cloudflare R2 storage keys for welfare claim documents.
2. Missing RLS `FOR UPDATE` policies on `public.notifications` and `public.admin_inquiries`, causing read receipts and inquiry resolution to crash with permission errors.
3. Missing `js/auth.js` and `js/page-unauthorized.js` from Target Files, trapping unapproved applicants in redirect loops and preventing the locked preview mode from functioning.
4. Omitting a `status = 'verified'` pre-condition check in `void_payment_receipt`, allowing unverified or rejected receipts to be voided and injecting compensating outflows that desynchronize the treasury balance.

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Missing Edge Function Target File: `supabase/functions/upload-slip/index.ts` - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 780-886 (Target Files to Create / Modify, Item 8 `js/storage.js` and Pillar 4 lines 596-599)
* **Discrepancy Description**: Target File Item 8 (`js/storage.js`) states: *"Generalizes `uploadBankSlip()` to support `claims` folder for claim proof documents. Generates keys formatted as `claims/YYYY-MM/{member_id}_{uuid}.{ext}`."* In the actual codebase, `js/storage.js` does NOT generate storage keys or interact directly with Cloudflare R2; it requests a presigned PUT URL from the Supabase Edge Function `supabase/functions/upload-slip/index.ts`. That Edge Function hardcodes `const slipKey = slips/${yearMonth}/${member.id}_${uniqueId}.${ext};` and does not accept a folder/category parameter. `upload-slip/index.ts` is omitted from the Target Files list.
* **Rationale & Recommendation**: Cloudflare R2 presigned PUT URLs bind strictly to the S3 `Key` signed by the backend function. Client-side code cannot generate or alter this key. Add `supabase/functions/upload-slip/index.ts` to Target Files to Modify, and specify updating its request schema to accept `folder: "slips" | "claims"` (defaulting to `"slips"`), formatting the R2 object key accordingly.

---

### 2. Missing RLS `FOR UPDATE` Policies for `notifications` and `admin_inquiries` - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 782-791 (Item 1 Migration) and lines 556-581, 624-654 (Pillar 4)
* **Discrepancy Description**: The migration enables Row Level Security on `public.notifications` and `public.admin_inquiries`, but specifies only `FOR SELECT` and `FOR INSERT` policies. There are NO `FOR UPDATE` policies defined. However, the design requires `markNotificationAsRead(notificationId)` in `api.js` (which executes `UPDATE public.notifications SET is_read = true`) and `resolveAdminInquiry(inquiryId, notes)` in `api.js` (which executes `UPDATE public.admin_inquiries SET status = 'resolved'`).
* **Rationale & Recommendation**: Under PostgreSQL RLS, any `UPDATE` without a matching permissive policy fails with error `42501 (insufficient_privilege / new row violates row-level security policy)`. In the migration specification, add:
  1. `CREATE POLICY "Members update own notifications" ON public.notifications FOR UPDATE USING (recipient_id = (SELECT id FROM public.members WHERE user_id = auth.uid()));`
  2. `CREATE POLICY "Staff update inquiries" ON public.admin_inquiries FOR UPDATE USING (EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = auth.uid() AND m.role IN ('admin', 'secretary', 'treasurer', 'manager')));`

---

### 3. Missing Auth Flow Target Files: `js/auth.js` and `js/page-unauthorized.js` - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 804-813 (Item 3 `dashboard.html`), lines 836-846 (Item 6 `js/page-dashboard.js`), and CUJ 6 (lines 107-115)
* **Discrepancy Description**: CUJ 6 and Item 16 mandate that unapproved Google OAuth applicants are redirected to `dashboard.html` to view the read-only locked preview banner (`#lockedDashboardBanner`). However, `js/page-dashboard.js` line 42 calls `requireAuth({ requireApproved: true })`, which triggers `js/auth.js` line 223 to bounce unapproved members back to `/unauthorized.html`. Furthermore, `js/page-unauthorized.js` never redirects applicants to `dashboard.html` after form submission (it merely toggles a static success message). Neither `js/auth.js` nor `js/page-unauthorized.js` is included in the Target Files to Modify list.
* **Rationale & Recommendation**: Without modifying `js/auth.js`, unapproved applicants will experience an infinite redirect loop between `dashboard.html` and `unauthorized.html`. Add `js/auth.js` and `js/page-unauthorized.js` to Target Files to Modify. Specify that `page-dashboard.js` calls `requireAuth({ requireApproved: false })`, `js/auth.js` allows unapproved members when `requireApproved === false`, and `js/page-unauthorized.js` redirects to `dashboard.html` upon successful application submission.

---

### 4. `void_payment_receipt` Lacks `status = 'verified'` Check (Financial Desync Hazard) - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 393-487 (Pillar 2, Item 2) and line 789 (Item 1 Migration)
* **Discrepancy Description**: `public.void_payment_receipt(p_payment_id, p_reason, p_voided_by)` only checks `IF v_payment.status = 'voided' THEN RAISE EXCEPTION...`. It does NOT verify that `v_payment.status = 'verified'`. If called on a `pending_approval` or `rejected` payment, it will insert a compensating outflow transaction into `treasury_transactions` for funds that were never collected or deposited into bank/cash accounts.
* **Rationale & Recommendation**: In double-entry accounting, voiding uncollected drafts corrupts the ledger. Add an explicit invariant check:
  ```sql
  IF v_payment.status != 'verified' THEN
      RAISE EXCEPTION 'Only verified payment receipts can be voided (current status: %)', v_payment.status;
  END IF;
  ```

---

### 5. Algorithmic Arrears Contradiction with Month-End (31st) Cutoff Rule in `calculateNetDuesStanding` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-style`
* **Affected Scope:** Lines 501-518 (Pillar 3, Item 2) and lines 823, 842 (Items 4 & 6)
* **Discrepancy Description**: `calculateNetDuesStanding` computes arrears using `dues.filter(d => d.status === "pending" && d.billing_month <= today)`. If today is the 9th of November (`2026-11-09`), and November's billing month is `2026-11-01`, November's dues evaluate as overdue arrears immediately. This directly contradicts Constitutional Rule 14 (lines 38, 544) and CUJ 4 (lines 95-101), which state that current month dues only become overdue arrears after the month-end cutoff (23:59:59 on the final day of the month).
* **Rationale & Recommendation**: With the current implementation, every active member will be flagged with a negative red arrears badge on the 1st of every month. Update the calculation so that overdue arrears only include dues where `billing_month < currentMonthPrefix` (e.g., prior to `2026-11-01`), or compare against explicit month-end `due_date`.

---

### 6. Ambiguous Broadcast Notification Read State Architecture - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 556-566, 819 (Item 1 Migration & Item 4 `js/api.js`)
* **Discrepancy Description**: `public.notifications` contains a single `is_read BOOLEAN` column while supporting broadcast notifications where `recipient_id IS NULL`. If any member marks a broadcast notification as read via `markNotificationAsRead(notificationId)`, updating `is_read = true` on the database row marks it read for every member in the entire association.
* **Rationale & Recommendation**: The plan leaves the implementer to invent the read-tracking mechanism. Clarify the architectural boundary: specify that `notifications.is_read` is strictly for targeted notifications (`recipient_id IS NOT NULL`), while broadcast dismissals are persisted in member-local `localStorage` (matching the existing `mria_dismissed_announcements` pattern in `page-dashboard.js`).

---

### 7. Omission of `submitBenefitClaim` Signature Update in `js/api.js` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 814-824 (Target Files Item 4 `js/api.js`) and line 844 (Item 6)
* **Discrepancy Description**: Item 4 details the modified exports for `js/api.js`, but omits updating `submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes })` to accept `documentKey` / `document_key`. Line 844 instructs `page-dashboard.js` to store `document_key` on `benefit_claims`, but `page-dashboard.js` delegates claim submission entirely to `api.js`.
* **Rationale & Recommendation**: An implementer updating `js/api.js` per Item 4 will not update `submitBenefitClaim`, causing `documentKey` to be dropped. Explicitly specify updating `submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes, documentKey })` to insert `document_key: documentKey` into `public.benefit_claims`.

---

### 8. Foreign Key Deletion Hazard in `delete_or_archive_member` for Staff Actors - Severity: 🟡 Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 343-347, 370-385 (Pillar 2, Item 1) and line 790 (Item 1 Migration)
* **Discrepancy Description**: `delete_or_archive_member` counts member activity using `WHERE member_id = p_member_id` across `payments`, `member_dues`, and `benefit_claims`. It does not check if the member acted as a staff author/verifier (e.g. `payments.verified_by`, `treasury_transactions.recorded_by`, `benefit_claims.disbursed_by`). If an admin attempts to hard-delete a test staff profile with zero personal dues/payments, the hard delete will crash with PostgreSQL foreign key violation `23503` (`ON DELETE RESTRICT`).
* **Rationale & Recommendation**: Expand the check query to count staff audit references:
  ```sql
  SELECT COUNT(*) INTO v_staff_refs FROM (
      SELECT 1 FROM public.payments WHERE verified_by = p_member_id
      UNION ALL
      SELECT 1 FROM public.treasury_transactions WHERE recorded_by = p_member_id
      UNION ALL
      SELECT 1 FROM public.benefit_claims WHERE disbursed_by = p_member_id OR approved_by = p_member_id
  ) s;
  ```
  If `(v_pay_count + v_dues_count + v_claim_count + v_staff_refs) > 0`, enforce soft archival.

---

### 9. `get-slip-url/index.ts` Missing Tenant Scoping for Benefit Claims Documents - Severity: 🟡 Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 877-881 (Target Files Item 11 `supabase/functions/get-slip-url/index.ts`)
* **Discrepancy Description**: Line 880 specifies updating the authorization check to allow download if `payments.slip_key = slipKey OR benefit_claims.document_key = slipKey`. For non-staff members, the existing check validates ownership via `payments.member_id = member.id`. If the claims check is not similarly scoped to `benefit_claims.member_id = member.id`, any general member could generate presigned URLs for confidential medical or death bereavement certificates belonging to other members.
* **Rationale & Recommendation**: Explicitly specify that non-staff member authorization requires:
  `(payments.slip_key = slipKey AND payments.member_id = member.id) OR (benefit_claims.document_key = slipKey AND benefit_claims.member_id = member.id)`.

---

### 10. Unspecified "View Proof Document" Button in Admin UI Markup & Scripting - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 792-803 (Item 2 `admin.html`), lines 825-834 (Item 5 `js/page-admin.js`), and line 921 (Verification Plan)
* **Discrepancy Description**: Verification Plan step 921 asserts: *"Review claim in Admin Payout Desk -> verify 'View Proof Document' button opens the uploaded attachment."* However, neither Item 2 (`admin.html`) nor Item 5 (`js/page-admin.js`) specifies creating, styling, or wiring this button in the Claims Queue or Payout Desk.
* **Rationale & Recommendation**: Add explicit markup specifications for the "View Proof Document" button in `admin.html` (under Claims Queue and Payout Desk) and wiring in `page-admin.js` calling `getSignedSlipUrl(claim.document_key)`.

---

### 11. Isolated Printing Neglects Welfare Benefit Grant Vouchers (`printGrantVoucher`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 673-715 (Pillar 5, Item 2) and lines 847-852 (Target Files Item 7 `js/receipt.js`)
* **Discrepancy Description**: `js/receipt.js` maintains two separate print routines: `window.printReceipt()` (for payment receipts) and `window.printGrantVoucher()` (for welfare grant vouchers). The design refactors only `printReceipt()` to use an isolated iframe, leaving `printGrantVoucher()` executing `window.print()` and suffering from the exact full-page bleed defect described in Problem 17.
* **Rationale & Recommendation**: Generalize the iframe print implementation into a reusable helper `printElementIsolated(elementId)` and wire both `printReceipt()` and `printGrantVoucher()` through it.

---

### 12. `sender_id` Omission in `submitInquiry` API Function Signature - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`
* **Affected Scope:** Line 821 (Item 4 `js/api.js`) and line 652 (Pillar 4)
* **Discrepancy Description**: `submitInquiry` signature is listed as `{ senderName, senderEmail, senderEpf, subject, message }`, omitting `senderId`. If `sender_id` is not passed or populated via `auth.uid()`, logged-in members cannot query their own submitted inquiries via RLS.
* **Rationale & Recommendation**: Update `submitInquiry` signature to `{ senderId, senderName, senderEmail, senderEpf, subject, message }` or set default `sender_id` in SQL.

---

### 13. Null Audit Actor Attributes in Stored Procedures - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-codebase-details`, `egm-style`
* **Affected Scope:** Lines 365, 382, 476 (Pillar 2 SQL procedures)
* **Discrepancy Description**: Both `delete_or_archive_member` and `void_payment_receipt` pass `NULL, NULL, NULL` for actor email, name, and EPF to `public.log_user_activity`, despite receiving `p_admin_id` or `p_voided_by`.
* **Rationale & Recommendation**: Look up the actor's details from `public.members WHERE id = p_admin_id` prior to invoking `log_user_activity` to ensure complete audit attribution.

---

### 14. Unused Parameter in `calculateNetDuesStanding` - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 502-518 (Pillar 3, Item 2)
* **Discrepancy Description**: `calculateNetDuesStanding(dues, payments)` declares `payments` in its signature, but never references it in the function body.
* **Rationale & Recommendation**: Either remove the unused `payments` parameter or incorporate unallocated payments into advance balance calculation.

---

### 15. Inconsistent Naming: `submitInquiry` vs `getAdminInquiries` / `resolveAdminInquiry` - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 821-822 (Item 4 `js/api.js`)
* **Discrepancy Description**: Naming is inconsistent between general inquiry submission (`submitInquiry`) and admin operations (`getAdminInquiries`, `resolveAdminInquiry`).
* **Rationale & Recommendation**: Standardize on either `submitInquiry` / `getInquiries` / `resolveInquiry` or prefix all with `adminInquiry`.
```

---

## Synthesis & Recommended Action Plan for Implementer

Before proceeding to code modification:
1. **Append Missing Files to Target List:**
   - `supabase/functions/upload-slip/index.ts`: update to support `folder: "slips" | "claims"`.
   - `js/auth.js`: support `requireApproved: false` for preview mode.
   - `js/page-unauthorized.js`: redirect to `dashboard.html` upon submission.
2. **Patch Migration Script (`20261109000006_enhanced_governance_remediations.sql`):**
   - Add RLS `UPDATE` policies for `public.notifications` and `public.admin_inquiries`.
   - Add `v_payment.status = 'verified'` guard to `void_payment_receipt`.
   - Add staff verifier references to `delete_or_archive_member`.
3. **Refine Date Comparison in `calculateNetDuesStanding`:**
   - Exclude current month from arrears until month-end cutoff.
4. **Generalize Iframe Print Engine in `js/receipt.js`:**
   - Apply isolated printing to both `printReceipt` and `printGrantVoucher`.
