# Comprehension Test Report

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 1..582)
**Reviewer:** `egm-comprehension` (Naive Reader)

---

## Paraphrase

### What this proposes
The document proposes a lightweight, bilingual (Sinhala and English) Progressive Web Application (PWA) for the MRIA Management Welfare Association, built with Vanilla HTML5/ES6 modules, Tailwind CSS, Supabase (PostgreSQL 17), and private Cloudflare R2 storage. The system automates monthly dues generation on the 1st of every month, allows members to upload bank transfer slips via 15-minute presigned URLs, supports on-the-spot cash receipt logging by treasurers, and tracks bereavement welfare claims. Access is guarded by Google OAuth whitelisting where unregistered users are blocked with a localized WhatsApp referral, and overdue dues past the month-end calendar boundary are restricted to administrative defaulter rosters.

### How the existing system works, per this document
The association currently depends on manual, informal processes, tracking monthly contributions across paper logs or spreadsheets without a centralized ledger. Members deposit money through Cash Deposit Machines (CDMs) or mobile bank transfers and send payment screenshots over WhatsApp, leading to untracked transactions, lost slips, and lack of an audit trail. Overdue accounts are reconciled manually without automated defaulter tracking, risking public friction if debts are exposed, and urgent welfare aid claims (such as bereavement assistance) require manual verification of member standing and past records.

---

## Findings

### 1. Undefined Member Onboarding and Whitelist Population Workflow
* **Severity**: 🟡 Major
* **Affected Scope**: CUJ 1 (Lines 46–50), Section 5.A (Lines 311–345), Section Detailed Implementation Plan 4.3 (`admin.html`, Line 508)
* **Description & Rationale**: The security model requires users to exist in `public.members` with their Google email prior to signing in; otherwise, they are redirected to `unauthorized.html` and instructed to message the association's WhatsApp line. However, the document never specifies how an administrator registers or approves a new member in `public.members` after receiving their WhatsApp message. The feature list for `admin.html` mentions slip review, cash logging, defaulter viewing, role allocation, and Bank QR management, but omits a member directory or registration/creation interface. An engineer cannot tell whether member creation is an admin UI capability, a seed script task, or an external process.

### 2. Missing Dues Reconciliation Trigger and Payment Allocation Logic
* **Severity**: 🟡 Major
* **Affected Scope**: Sequence Diagram B (Lines 161–163), Schema Table 6 (`payment_dues_reconciliation`, Lines 230–237), Section 5 (Lines 307–370), Migration Plan (Line 478)
* **Description & Rationale**: Sequence Diagram B specifies that when a treasurer marks a payment as `verified`, a database trigger automatically reconciles `member_dues` to `paid`. Table 6 also introduces a junction table `payment_dues_reconciliation (payment_id, due_id, allocated_amount)`. However, Section 5 (Database Triggers & Stored Functions) and the migration file descriptions only implement `handle_auth_user_created` and `generate_monthly_dues_for_period`. The trigger or business logic that maps a verified payment to specific due records (e.g., handling lump-sum payments covering multiple months, partial payments, or FIFO settlement of overdue dues) is completely missing.

### 3. Dual Role Architecture Discrepancy (`members.role` vs. `user_roles`)
* **Severity**: 🟡 Major
* **Affected Scope**: Database Schema Tables 2 & 3 (Lines 178–201), RLS Matrix (Lines 290–305), Edge Functions (Line 384)
* **Description & Rationale**: The schema defines a `role app_role` column directly on `public.members` (defaulting to `'member'`), while also defining a separate junction table `public.user_roles (user_id, role)`. Throughout the rest of the document (the RLS policy matrix, the auth linker trigger, and the Edge Function access checks), role verification is performed solely against `members.role`. The document does not define why `user_roles` exists, whether the application supports multiple concurrent roles per user, or how `user_roles` is kept in sync with `members.role`.

### 4. Ambiguous "Defaulter" Mechanism: Account Flag vs. Dynamic Query
* **Severity**: 🟡 Major
* **Affected Scope**: Goals (Line 25), CUJ 5 (Lines 66–70), Schema (Lines 178–214), Verification Plan (Line 567)
* **Description & Rationale**: Goal 1 and CUJ 5 state that at 00:00:00 on the 1st of each month, "the system flags the account as a defaulter", and the Design System specifies an "Overdue / Defaulter State". However, neither `members` nor `member_dues` possesses a defaulter status column (`member_dues.status` only allows `'pending'`, `'paid'`, `'waived'`). Verification Plan 2 reveals that defaulters are identified dynamically at query time (`status = 'pending' AND billing_month < current_month`). Describing this as "the system flags the account" misleadingly implies a scheduled background mutation or dedicated column rather than a computed view.

### 5. Undefined Project Concept: Legacy Member (`is_legacy_member`)
* **Severity**: 🟡 Major
* **Affected Scope**: Schema Table 2 (Line 186), Alternative 1 (Line 414)
* **Description & Rationale**: The column `is_legacy_member BOOLEAN NOT NULL DEFAULT false` is added to `members`, and Alternative 1 references `(admission_fee IF !is_legacy)`. However, the concept of a "legacy member" is never defined in the Overview, Problem statement, or User Journeys. A new reader has no context for what criteria define a legacy member, how they bypass admission fees, or who sets this attribute.

### 6. Admission Fee Invoicing and Tracking Omission
* **Severity**: 🟢 Nit
* **Affected Scope**: Schema Table 4 & 5 (Lines 204–228), Open Question 1 (Line 41), Seed Data (Line 482)
* **Description & Rationale**: `payment_category` defines `'admission_fee'`, and seed settings specify `admission_fee_amount = 1000`. However, the dues ledger (`member_dues`) requires `billing_month DATE NOT NULL` (stored as `YYYY-MM-01`). The document does not clarify whether admission fees are billed as records in `member_dues` or recorded standalone in `payments`, nor how an unapproved member's admission fee settlement is tracked before account activation.

### 7. Undefined Tooling Reference: "Stitch MCP Scaffolded"
* **Severity**: 🟢 Nit
* **Affected Scope**: Detailed Implementation Plan, Section 4.3 (Lines 499, 502, 505, 508)
* **Description & Rationale**: The HTML views (`index.html`, `unauthorized.html`, `dashboard.html`, `admin.html`) are annotated with `(Stitch MCP Scaffolded)`. For a team member without external context, "Stitch MCP" is an undefined acronym and tool with no documentation link or explanation of how or when scaffolding is performed.

### 8. Undefined Association Roles (`manager` vs. `official` vs. `treasurer`)
* **Severity**: 🟢 Nit
* **Affected Scope**: Schema Table 1 (Line 171), RLS Policy Matrix (Lines 290–305)
* **Description & Rationale**: The `app_role` enum includes `admin`, `manager`, `official`, `treasurer`, and `member`. While the responsibilities of administrators and treasurers are described in the CUJs, the document does not define the real-world responsibilities or permission boundaries distinguishing a `manager` from an `official`.

### 9. Column Identity Discrepancy in Verification Plan 1
* **Severity**: 🟢 Nit
* **Affected Scope**: Verification Plan, Section 1 (Line 561)
* **Discrepancy Description & Rationale**: The RLS test states: "assert that only records where `member_id = auth.uid()` are returned." In the schema, `member_dues.member_id` is a foreign key to `public.members(id)` (an internal UUID), whereas `auth.uid()` references `auth.users(id)`. The correct relationship is `member_id = (SELECT id FROM members WHERE user_id = auth.uid())`, which is accurately specified in the RLS matrix (Line 296) but misstated in the verification instructions.

### 10. Undefined Closing Acronym ("EGM")
* **Severity**: 🟢 Nit
* **Affected Scope**: Line 582
* **Description & Rationale**: The document concludes with `*Drafted with EGM*`. "EGM" is an undefined abbreviation within the document.
