# Goldfish Annotated Review Report

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (`full file`)
**Status:** Resolved (All 17 findings accepted and applied to design document)

## Prioritized Findings & AI Suggestions

### Issue 1: Pre-Seeding Schema PK Regression on `public.members` [`egm-zoom-out` / `egm-design`] - Severity: Blocker
* **Affected Scope:** Lines 175, 36, 61-69 (Section 2.B, Goals, CUJ 1)
* **Discrepancy Description:** Declaring `id UUID PRIMARY KEY REFERENCES auth.users(id)` breaks the existing database schema, destroys the Secretary's ability to pre-seed employees before they log in via Google OAuth, and invalidates all existing foreign keys across payments, dues, and claims.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Retaining `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` with a nullable `user_id UUID UNIQUE REFERENCES auth.users(id)` preserves the existing working pattern from Migration 1 & 3, allowing pre-seeding and automatic OAuth binding upon first login.
* **Proposed Edit:**
  * Location: Section 2.B (Line 175)
  * Change: Retain `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL`.

---

### Issue 2: PostgreSQL Transactional Migration Failure on Enum Mutation (`app_role`) [`egm-implementation-readiness` / `egm-design`] - Severity: Blocker
* **Affected Scope:** Lines 161-171, 442, 465-466 (Section 2.A, Implementation Step 1)
* **Discrepancy Description:** `ALTER TYPE app_role ADD VALUE ...` cannot be referenced in subsequent DML statements (`UPDATE members SET role = 'committee_member'`) within the same PostgreSQL transaction block.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Splitting into two discrete migration files satisfies PostgreSQL transactional isolation rules.
* **Proposed Edit:**
  * Location: Section 2.A & Implementation Manifest
  * Change: Specify `20261108000004_add_app_roles.sql` for DDL enum expansion, followed by `20261108000005_comprehensive_overhaul.sql` for data migration, tables, triggers, and RLS.

---

### Issue 3: Member Self-Privilege Escalation Vulnerability [`egm-zoom-out` / `egm-design`] - Severity: Blocker
* **Affected Scope:** Lines 295, 35 (Section 3 RLS Matrix)
* **Discrepancy Description:** An open `R/W` policy on `public.members` for authenticated members allows clients to issue REST `PATCH` requests setting `role = 'admin'` and `is_approved = true`.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Restrict `members` to SELECT-only for regular members, with contact updates mediated by a strict `BEFORE UPDATE` trigger function (`fn_protect_member_sensitive_columns()`) that raises an exception if `role`, `is_approved`, or `epf_number` change.
* **Proposed Edit:**
  * Location: Section 2.B, Section 3 RLS Matrix
  * Change: Specify `fn_protect_member_sensitive_columns()` trigger blocking non-admin mutations to sensitive columns.

---

### Issue 4: Immutability Trigger Bypassed by `TRUNCATE` [`egm-structural` / `egm-design`] - Severity: Blocker
* **Affected Scope:** Lines 203-214 (Section 2.C)
* **Discrepancy Description:** The row-level trigger on `audit_logs` does not fire on `TRUNCATE`, leaving the audit table vulnerable to total deletion.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** A statement-level trigger `BEFORE TRUNCATE ON public.audit_logs` closes this security loophole.
* **Proposed Edit:**
  * Location: Section 2.C (Line 214)
  * Change: Add `CREATE TRIGGER trg_audit_logs_prevent_truncate BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.fn_prevent_audit_tampering();`.

---

### Issue 5: Unhandled `NOT NULL` Constraint on Pre-Existing Member Table Records [`egm-implementation-readiness`] - Severity: Blocker
* **Affected Scope:** Lines 178-179, 442, 467 (Section 2.B, Implementation Step 1)
* **Discrepancy Description:** Adding `epf_number UNIQUE NOT NULL` and `designation NOT NULL` directly aborts on non-empty tables because existing admin/seed records contain null values.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Adding columns as nullable, backfilling existing admin records, and then applying `NOT NULL` guarantees zero-downtime execution.
* **Proposed Edit:**
  * Location: Section 2.B & Implementation Step 1
  * Change: Specify phased migration: add columns as nullable -> backfill `krishaja@gmail.com` with `EPF-0001` / `System Administrator` -> set `NOT NULL` and `UNIQUE`.

---

### Issue 6: Self-Service Registration Blocked by Existing RLS Policies [`egm-implementation-readiness` / `egm-comprehension`] - Severity: Blocker
* **Affected Scope:** Lines 442, 454, 488 (Phase 4, Step 4.3)
* **Discrepancy Description:** Newly authenticated Google OAuth users without a member record cannot insert into `public.members` because existing RLS policies require `admin` or `manager` roles.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** A scoped RLS policy `members_self_registration_insert` permits inserting an unapproved `role = 'member'` row where `auth.uid() = user_id`.
* **Proposed Edit:**
  * Location: Section 3 & Implementation Step 1
  * Change: Add `CREATE POLICY members_self_registration_insert ON public.members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND role = 'member'::app_role AND is_approved = false AND is_legacy_member = false);`.

---

### Issue 7: Service Worker `localStorage` Architectural Impossibility [`egm-codebase-details`] - Severity: Blocker
* **Affected Scope:** Lines 329, 449, 482 (Section 5.B, Manifest Line 449, Step 3.5)
* **Discrepancy Description:** Service Workers have no access to `window.localStorage`; referencing it crashes the service worker.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Clarify that `sw.js` uses Cache Storage API (`v3-runtime-cache`), while client-side fallback to `mria_cached_member` is executed in `js/auth.js`.
* **Proposed Edit:**
  * Location: Section 5.B & Implementation Step 3.5
  * Change: Replace `localStorage` reference with Cache Storage API.

---

### Issue 8: Disconnected Treasury Dual-Bookkeeping & Lack of Automation [`egm-zoom-out` / `egm-design`] - Severity: Blocker
* **Affected Scope:** Lines 237-270, 81-90, 446, 500 (Section 2.D, CUJ 3, Implementation Step 6)
* **Discrepancy Description:** Client-side JavaScript is tasked with performing uncoordinated writes to `payments` and `treasury_transactions`. Bank slip verifications don't automate treasury entries, causing ledger drift.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Inflows must be trigger-generated upon `payments.status = 'verified'`, outflows upon `benefit_claims.status = 'disbursed'`. Add foreign keys `payment_id` and `claim_id` to `treasury_transactions`.
* **Proposed Edit:**
  * Location: Section 2.D, CUJ 3, Implementation Step 1 & 6
  * Change: Add automated PostgreSQL triggers syncing verified payments and disbursed claims into `treasury_transactions`, with `payment_id` and `claim_id` foreign keys.

---

### Issue 9: YAGNI Over-Engineering: Private R2 and Custom CMS for Constitution [`egm-zoom-out`] - Severity: Major
* **Affected Scope:** Lines 273-286, 41, 442, 458 (Section 2.E, Goals, Manifest)
* **Discrepancy Description:** Building a custom database CMS table and private R2 presigned URL pipeline for two static Constitution PDFs that change once every few years is excessive accidental complexity.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Store `constitution_si.pdf` and `constitution_en.pdf` as static assets in `/assets/docs/` or a public Supabase Storage bucket (`mria-documents`), eliminating the `cms_documents` table and dedicated Edge Function.
* **Proposed Edit:**
  * Location: Section 2.E, Goals, File Manifest
  * Change: Simplify Constitution document hosting to public storage or `/assets/docs/`.

---

### Issue 10: Cash Payment FIFO Reconciliation Trigger Disconnect [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Lines 446, 470, 500 (Step 1, Step 6.3)
* **Discrepancy Description:** Trigger `on_payment_verified_reconcile` only fires on `UPDATE`. Direct cash payments are inserted with `status = 'verified'`, so FIFO dues reconciliation never executes.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Update trigger to fire on `AFTER INSERT OR UPDATE ON public.payments`.
* **Proposed Edit:**
  * Location: Implementation Step 1
  * Change: Update trigger `on_payment_verified_reconcile` to fire on `AFTER INSERT OR UPDATE`.

---

### Issue 11: Audit Trigger Blocking Automated Monthly Dues Cron Job [`egm-zoom-out` / `egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Lines 194, 470 (Section 2.C, Step 1)
* **Discrepancy Description:** `audit_logs.user_email` is `NOT NULL`. During pg_cron monthly dues generation, `auth.jwt()` is null, causing the trigger to throw an exception and abort dues generation.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Declare `user_email DEFAULT 'SYSTEM'` and resolve actor with `COALESCE(auth.jwt() ->> 'email', 'SYSTEM')`.
* **Proposed Edit:**
  * Location: Section 2.C & Implementation Step 1
  * Change: Add safe system actor fallback in `audit_logs` schema and trigger function.

---

### Issue 12: Edge Function Invocations: Relative Path, Secrets, and CORS [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Lines 308, 443, 473-476 (Section 4, Step 2)
* **Discrepancy Description:** Relative `/functions/v1/...` URL 404s on static hosting, `SUPABASE_SERVICE_ROLE_KEY` is omitted from secrets, and CORS handling is unspecified.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Use `${CONFIG.FUNCTIONS_URL}/send-claim-notification`, add service role key, validate JWT Bearer token, and handle CORS `OPTIONS`.
* **Proposed Edit:**
  * Location: Section 4 & Implementation Step 2
  * Change: Add exact URL, service role secret, caller JWT verification, and CORS preflight headers.

---

### Issue 13: Opening Balance Computation Gap for Date-Filtered Statements [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Lines 447, 481, 501 (Step 3.4, Step 6.4)
* **Discrepancy Description:** The `treasury_account_balances` view only returns all-time totals; date-filtered exports cannot determine opening balances prior to `start_date`.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Add stored procedure or API query `get_treasury_statement(start_date, end_date)` calculating opening balance for prior periods.
* **Proposed Edit:**
  * Location: Section 2.D, Step 1 & Step 3.3
  * Change: Add `get_treasury_statement(start_date, end_date)` specification.

---

### Issue 14: Admin RBAC Route Guard Lock-Out in `js/page-admin.js` [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** Lines 457-458, 498-499 (Step 6)
* **Discrepancy Description:** `js/page-admin.js` hardcodes `staffRoles = ["admin", "manager", "official", "treasurer"]`, locking out newly introduced `secretary` and `committee_member` roles.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Update `allowedRoles` to include `secretary` and `committee_member`.
* **Proposed Edit:**
  * Location: Implementation Step 6.1
  * Change: Update `allowedRoles` to `['admin', 'manager', 'secretary', 'treasurer', 'committee_member']`.

---

### Issue 15: Omission of `/js/treasury-export.js` in `sw.js` Pre-Cache [`egm-codebase-details`] - Severity: Major
* **Affected Scope:** Lines 447, 449, 482 (Step 3.5)
* **Discrepancy Description:** Newly created `treasury-export.js` is omitted from `STATIC_ASSETS`, failing offline execution.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Include `/js/treasury-export.js` in `STATIC_ASSETS` in `sw.js`.
* **Proposed Edit:**
  * Location: Implementation Step 3.5
  * Change: Add `/js/treasury-export.js` to `STATIC_ASSETS`.

---

### Issue 16: Statutory Acronym Glossary & Institutional Routing Clarification [`egm-comprehension` / `egm-style`] - Severity: Nit
* **Affected Scope:** Lines 20, 24, 36, 178 (Section 2.B, Goals, The Problem)
* **Discrepancy Description:** Acronyms `EPF` and `NIC` lack inline expansion; personal liaison Gmail `krishaja@gmail.com` needs clear contextualization.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Add glossary expansions and clarify initial liaison routing.
* **Proposed Edit:**
  * Location: Goals & Section 2.B
  * Change: Define `EPF` (Employees' Provident Fund) and `NIC` (National Identity Card); label `krishaja@gmail.com` as liaison administrator.

---

### Issue 17: Systematic Template Dual-Language Purge [`egm-style`] - Severity: Nit
* **Affected Scope:** Lines 445, 486, 491, 498 (Steps 4, 5, 6)
* **Discrepancy Description:** Steps focus on `index.html`; `dashboard.html`, `admin.html`, and `unauthorized.html` still contain hardcoded mixed strings.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** Explicitly instruct replacing all hardcoded bilingual strings with single `data-i18n` anchors across all HTML templates.
* **Proposed Edit:**
  * Location: Implementation Steps 4, 5, 6
  * Change: Add instruction to sweep all HTML files for dual-language text nodes and replace with `<span data-i18n="...">`.
