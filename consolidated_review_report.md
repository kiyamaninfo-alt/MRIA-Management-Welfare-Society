# Consolidated Review Report: Targeted Design Enhancement & Bug Remediation

**Target Document:** [`docs/designs/targeted_design_enhancement_and_bug_remediation.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/targeted_design_enhancement_and_bug_remediation.md)  
**Total Lines Audited:** 940  
**Semantic Boundary:** Feature Specifications: `Lines 1..777` | Detailed Implementation Plan: `Lines 778..940`  
**Review Pipeline:** Uninterrupted Full Flow across all EGM Goldfish Review Lenses:
* Stage 5: Initial Zoom-Out (`egm-zoom-out`)
* Stage 6: Comprehension Test (`egm-comprehension`)
* Stage 7: Critic Review (`egm-design`, `egm-structural`, `egm-style`)
* Stage 8: Intermediate Zoom-Out (`egm-zoom-out`)
* Stage 9: Implementation Readiness (`egm-implementation-readiness`, `egm-codebase-details`)

---

## 1. Executive Summary & Verdict

### Final Review Verdict: **APPROVED WITH MANDATORY ARCHITECTURAL STREAMLINING**

The technical specification comprehensively addresses the 18 user-requested enhancements and defect remediations across all 5 functional pillars of the MRIA Management Welfare Association PWA. However, through the multi-lens Goldfish review pipeline, **6 Blocker severity issues**, **9 Major severity issues**, and **6 Nit severity issues** were identified. 

Crucially, the intermediate zoom-out and implementation audits prevented two major architectural anti-patterns:
1. **Enum Pollution:** Rather than mutating the `app_role` PostgreSQL enum to add `'archived'` (which destroys staff role history and breaks frontend routing), the architecture adopts an explicit `is_archived BOOLEAN` flag on `public.members`.
2. **Duplicate Notification Subsystems:** Rather than creating a multi-table messaging system with broken 1-to-many read states for broadcasts, `public.notifications` is strictly scoped to 1-to-1 targeted alerts (`recipient_id UUID NOT NULL`), while public circulars remain managed by the existing `announcements` engine.

All findings have been synthesized, deduplicated, and mapped to concrete, actionable code and schema fixes below.

---

## 2. Prioritized Consolidated Action Items

### 🔴 Blockers (Must Resolve in Design Before Implementation)

| ID | Issue Description | Root Cause / Risk | Recommended Remediation |
| :--- | :--- | :--- | :--- |
| **BLK-01** | **Database Runtime Exception on Archival (`app_role` Enum Violation)** | `delete_or_archive_member` executes `role = 'archived'`. Because `'archived'` is not in the `app_role` enum, PostgreSQL throws error `22P02: invalid input value for enum app_role`. Mutating the enum destroys statutory officer history. | Retain `role` intact. Add `is_archived BOOLEAN NOT NULL DEFAULT false` to `public.members`. Procedure sets `is_approved = false, is_archived = true, updated_at = NOW()`. |
| **BLK-02** | **Receipt Voiding Missing `status = 'verified'` Guard & Source Account Lookup** | `void_payment_receipt` can be invoked on unverified or rejected payments, creating erroneous compensating outflows. It also uses a hardcoded `CASE` statement rather than checking the original transaction account. | Add guard: `IF v_payment.status != 'verified' THEN RAISE EXCEPTION 'Only verified receipts can be voided'; END IF;`. Query original `destination_account_id` from `treasury_transactions WHERE payment_id = p_payment_id`. |
| **BLK-03** | **Foreign Key Constraint Crash on Staff Deletion (`delete_or_archive_member`)** | The procedure only counts records where `member_id = p_member_id`. If a staff member recorded cash, verified slips, or approved claims, deleting them throws PostgreSQL foreign key error `23503 (ON DELETE RESTRICT)`. | Expand check to include staff audit references (`payments.verified_by`, `treasury_transactions.recorded_by`, `benefit_claims.disbursed_by`). If references exist, enforce soft archival. |
| **BLK-04** | **Missing Auth Flow Target Files Causing Redirect Loop on Locked Preview** | `js/auth.js` bounces unapproved users to `/unauthorized.html` immediately. `page-unauthorized.js` does not redirect applicants. Neither file is in Target Files. | Add `js/auth.js` and `js/page-unauthorized.js` to Target Files. Support `requireApproved: false` for dashboard preview, and redirect applicants to `dashboard.html` upon form submission. |
| **BLK-05** | **Cloudflare R2 Edge Function Disconnect & Claim Document Privacy Leak** | `upload-slip/index.ts` hardcodes `slips/...` and is omitted from Target Files. `get-slip-url/index.ts` allows any authenticated user to download confidential medical/bereavement proof documents. | Add `upload-slip/index.ts` to Target Files to support `folder: "slips" \| "claims"`. Update `get-slip-url/index.ts` to enforce tenant ownership: non-staff can only download their own claims documents. |
| **BLK-06** | **Offline PWA Violation & Race Condition in Print Engine** | `printReceipt()` creates an iframe injecting external Tailwind CDN script via `setTimeout(..., 500)`. Fails completely when offline and races on slow devices. | Inject local cached `/assets/styles.css` and Noto Sans Sinhala font into the iframe, and trigger printing via `iframe.onload`. Unify under a single reusable `printIsolatedElement(elementId, title)` helper. |

---

### 🟡 Majors (High Priority Architecture & Implementation Fixes)

| ID | Issue Description | Root Cause / Risk | Recommended Remediation |
| :--- | :--- | :--- | :--- |
| **MAJ-01** | **Arrears Calculation Contradicts Month-End (31st) Cutoff Rule** | `calculateNetDuesStanding` evaluates `d.billing_month <= today`, falsely flagging the active current month as overdue midway through the month. | Filter arrears strictly for prior months (`billing_month < date_trunc('month', now())`). Current month dues only become overdue arrears after the month-end cutoff. |
| **MAJ-02** | **Ambiguous Shared Read-State on Broadcast Notifications** | `public.notifications` contains a single `is_read BOOLEAN` column. Marking a broadcast (`recipient_id IS NULL`) as read marks it read for all association members. | Scope `public.notifications` strictly to 1-to-1 targeted alerts (`recipient_id UUID NOT NULL`). Public association circulars remain handled by `announcements` with local storage dismissal. |
| **MAJ-03** | **Missing RLS `FOR UPDATE` Policies for Notifications and Inquiries** | `public.notifications` and `public.admin_inquiries` lack `FOR UPDATE` policies, causing `markNotificationAsRead` and `resolveAdminInquiry` to fail with error `42501 (insufficient_privilege)`. | Add `FOR UPDATE` policies in migration: members can update their own notifications; staff can update inquiry resolution status. |
| **MAJ-04** | **Insecure Public `INSERT` Policy on `admin_inquiries`** | `CREATE POLICY ... FOR INSERT WITH CHECK (true)` allows anonymous callers to flood the database using the anon key. | Restrict insertion to authenticated users: `FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL)`. |
| **MAJ-05** | **Omission of `submitBenefitClaim` Update in `js/api.js`** | `submitBenefitClaim` in `api.js` is not updated to accept `documentKey`, causing uploaded R2 proof document keys to be dropped during claim submission. | Update `submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes, documentKey })` to insert `document_key: documentKey`. |
| **MAJ-06** | **Welfare Grant Voucher Excluded from Print Isolation** | `window.printGrantVoucher()` in `js/receipt.js` still executes `window.print()`, suffering from full-page chrome bleed. | Wire both `window.printReceipt()` and `window.printGrantVoucher()` through the shared `printIsolatedElement()` routine. |
| **MAJ-07** | **Unspecified "View Proof Document" Button in Admin UI Markup** | The verification plan tests viewing claim attachments, but the markup and wiring for the button in Claims Queue and Payout Desk are missing from the spec. | Add explicit button markup and wiring in `admin.html` and `js/page-admin.js` calling `getSignedSlipUrl(claim.document_key)`. |
| **MAJ-08** | **Announcement Circulars Leaked in Locked Preview** | Unapproved OAuth users can view internal society announcements before membership vetting. | In locked preview mode on `dashboard.html`, hide `#dashboardNotificationCenter` and show a placeholder banner. |
| **MAJ-09** | **Currency Prefix Duplication in UI Views** | Concatenating `-Rs. ${formatCurrency(amount)}` creates redundant prefixes (e.g. `-Rs. Rs. 500.00`). | Add `{ showSign: true }` parameter to `formatCurrency()` in `js/ui.js` and eliminate manual `Rs. ` string concatenation. |

---

### 🟢 Nits (Code Quality, Formatting & Naming Consistency)

| ID | Issue Description | Recommended Remediation |
| :--- | :--- | :--- |
| **NIT-01** | Null actor attributes in `log_user_activity` within stored procedures. | Query actor name, email, and EPF from `public.members` prior to calling `log_user_activity`. |
| **NIT-02** | Missing `sender_phone` column in `public.admin_inquiries`. | Add `sender_phone VARCHAR(20)` to schema and contact modal form for SMS/voice callback. |
| **NIT-03** | Missing `sender_id` parameter in `submitInquiry` API signature. | Pass `senderId` to `submitInquiry` and populate `sender_id` in database row. |
| **NIT-04** | Pagination limits do not reset when switching tabs or filters. | Encapsulate pagination counters (`paymentsRenderLimit`, `claimsRenderLimit`) and reset to 5 on filter changes. |
| **NIT-05** | Unused `payments` parameter in `calculateNetDuesStanding`. | Remove unused parameter or consolidate dues calculation inside `calculateMemberBalance` in `js/api.js`. |
| **NIT-06** | Storage helper naming reflects only bank slips (`uploadBankSlip`). | Generalize method name to `uploadStorageFile(file, folder = 'slips')` in `js/storage.js`. |

---

## 3. Comprehensive Traceability Matrix

| Review Stage | Subagent Lens | Raw Finding | Consolidated Action ID | Resolution in Design |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 5: Initial Zoom Out** | `egm-zoom-out` | Archival overwriting `role = 'archived'` destroys officer history | **BLK-01** | Use `is_archived BOOLEAN` on `members` |
| **Stage 5: Initial Zoom Out** | `egm-zoom-out` | Broadcast notification `is_read` column is shared across all members | **MAJ-02** | Make `notifications.recipient_id NOT NULL` |
| **Stage 5: Initial Zoom Out** | `egm-zoom-out` | Print iframe injects Tailwind CDN, breaking offline PWA functionality | **BLK-06** | Inject local `/assets/styles.css` with `iframe.onload` |
| **Stage 5: Initial Zoom Out** | `egm-zoom-out` | Current month flagged as overdue arrears on day 1 | **MAJ-01** | Enforce Month-End (31st) Cutoff date rule |
| **Stage 6: Comprehension** | `egm-comprehension` | Stored procedure executes `role = 'archived'`, throwing enum error `22P02` | **BLK-01** | Addressed in BLK-01 (`is_archived` column) |
| **Stage 6: Comprehension** | `egm-comprehension` | Unclear balance decrement in `treasury_accounts` vs `treasury_transactions` | **Ledger Parity** | Clarified append-only ledger via view |
| **Stage 6: Comprehension** | `egm-comprehension` | `js/auth.js` omitted from Target Files, causing redirect loop | **BLK-04** | Added `js/auth.js` and `page-unauthorized.js` |
| **Stage 6: Comprehension** | `egm-comprehension` | `uploadBankSlip` signature lacks folder parameter for claim documents | **BLK-05, NIT-06** | Generalize helper to `uploadStorageFile` |
| **Stage 7: Critic Review** | `egm-structural` | `void_payment_receipt` can void unverified drafts and desync ledger | **BLK-02** | Add `status = 'verified'` precondition check |
| **Stage 7: Critic Review** | `egm-design` | RLS policy on `admin_inquiries` allows public anonymous spam | **MAJ-04** | Restrict INSERT policy to `authenticated` |
| **Stage 7: Critic Review** | `egm-design` | Unscoped claims attachment presigned URL allows unauthorized access | **BLK-05** | Add ownership check in `get-slip-url` |
| **Stage 7: Critic Review** | `egm-style` | Redundant currency prefixes (`-Rs. Rs. 500.00`) | **MAJ-09** | Update `formatCurrency({ showSign: true })` |
| **Stage 8: Intermediate Zoom Out**| `egm-zoom-out` | Anti-pattern: adding `'archived'` to `app_role` breaks tab RBAC mapping | **BLK-01** | Rejected enum mutation; adopted boolean flag |
| **Stage 8: Intermediate Zoom Out**| `egm-zoom-out` | Anti-pattern: multi-table notification joins for 150-member society | **MAJ-02** | Dedicated 1-to-1 table; announcements handle circulars |
| **Stage 8: Intermediate Zoom Out**| `egm-zoom-out` | Society announcements leaked to unvetted Google OAuth users | **MAJ-08** | Hide announcement board in locked preview |
| **Stage 9: Readiness Test** | `egm-codebase-details`| `upload-slip/index.ts` hardcodes slip key path and is missing from files | **BLK-05** | Added to Target Files with folder routing |
| **Stage 9: Readiness Test** | `egm-codebase-details`| Missing RLS `FOR UPDATE` on `notifications` and `admin_inquiries` | **MAJ-03** | Added `FOR UPDATE` policies in migration |
| **Stage 9: Readiness Test** | `egm-codebase-details`| Staff foreign key violations when deleting test staff members | **BLK-03** | Count staff references in `delete_or_archive_member` |
| **Stage 9: Readiness Test** | `egm-readiness` | `submitBenefitClaim` in `api.js` drops `documentKey` parameter | **MAJ-05** | Update `submitBenefitClaim` signature and query |
| **Stage 9: Readiness Test** | `egm-readiness` | Welfare grant voucher still uses `window.print()` with page bleed | **MAJ-06** | Unify `printGrantVoucher` with `printReceipt` |
| **Stage 9: Readiness Test** | `egm-readiness` | "View Proof Document" button missing from Admin Claims markup | **MAJ-07** | Added markup & wiring to `admin.html` & `page-admin.js` |

---

## 4. Final Remediation Directives

The architectural design in [`docs/designs/targeted_design_enhancement_and_bug_remediation.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/targeted_design_enhancement_and_bug_remediation.md) and [`design_draft.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/design_draft.md) will be updated with:
1. **Clean Database Migration (`20261109000006_enhanced_governance_remediations.sql`):**
   - Add `is_archived BOOLEAN NOT NULL DEFAULT false` to `members` (leaving `app_role` untouched).
   - Implement `delete_or_archive_member` with comprehensive staff reference checks and actor lookup.
   - Implement `void_payment_receipt` with `status = 'verified'` precondition, accurate source account lookup, and dues un-settling.
   - Define `public.notifications` strictly for 1-to-1 alerts (`recipient_id UUID NOT NULL`).
   - Add RLS `UPDATE` policies for notifications and inquiries, and enforce `TO authenticated` on inquiry inserts.
2. **Centralized Financial Logic in `js/api.js`:**
   - Enhance `calculateMemberBalance()` to handle positive advance balances and negative arrears under the Month-End (31st) Cutoff rule.
   - Update `submitBenefitClaim` to persist `document_key`.
3. **Robust Storage & Presigned URLs:**
   - Update `supabase/functions/upload-slip/index.ts` to accept `folder: "slips" | "claims"`.
   - Update `supabase/functions/get-slip-url/index.ts` to enforce tenant ownership for claim documents.
4. **Offline PWA Print Engine in `js/receipt.js`:**
   - Reusable `printIsolatedElement(elementId, title)` injecting local cached `/assets/styles.css` with `iframe.onload`.
   - Unify both receipt printing and grant voucher printing.
5. **Auth & Locked Dashboard Preview:**
   - Update `js/auth.js` to support `requireApproved: false`.
   - Update `js/page-unauthorized.js` to redirect pending applicants to `dashboard.html`.
   - In `dashboard.html` / `js/page-dashboard.js`, render the locked preview with zeroed balances, hidden announcements, and enabled Sign Out / PDF downloads / Contact Admin.
