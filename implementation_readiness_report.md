# Stage 9 (Implementation Readiness Test) Synthesized Findings Report

**Target:** `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/mria_management_welfare_association_pwa.md` (`Lines 413-502`)  
**Mode:** `IMPLEMENTATION_READINESS`  
**Standards:** `implementation-readiness-standard`

---

## Reviewer Status

| Reviewer | Status |
| :--- | :--- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

---

## Severity Breakdown

| Severity | Count |
| :--- | :--- |
| 🔴 **Blocker** | 4 |
| 🟡 **Major** | 7 |
| 🟢 **Nit** | 3 |
| **Total Findings** | **14** |

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Unhandled `NOT NULL` Constraint on Pre-Existing Member Table Records - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 442, 467 (`Step 1: Database Migration & Security Hardening`, Manifest Line 442)
* **Discrepancy Description:**  
  The implementation plan specifies adding `epf_number` (`VARCHAR(50) UNIQUE NOT NULL`) and `designation` (`VARCHAR(150) NOT NULL`) to `public.members` in `20261108000004_comprehensive_overhaul.sql`. However, actual database inspection reveals that `public.members` already contains pre-existing data (e.g., initial seed/admin record `krishaja@gmail.com`). Executing `ALTER TABLE public.members ADD COLUMN epf_number VARCHAR(50) UNIQUE NOT NULL;` on a non-empty table without a default value or backfill step causes PostgreSQL to immediately abort execution with `ERROR: column "epf_number" of relation "members" contains null values`.
* **Rationale & Recommendation:**  
  The migration plan must provide unambiguous, zero-downtime schema instructions. Explicitly instruct the implementer to:
  1. Add columns as nullable: `ALTER TABLE public.members ADD COLUMN IF NOT EXISTS epf_number VARCHAR(50), ADD COLUMN IF NOT EXISTS designation VARCHAR(150);`
  2. Backfill existing records: `UPDATE public.members SET epf_number = 'EPF-0001', designation = 'System Administrator' WHERE email = 'krishaja@gmail.com' AND epf_number IS NULL;`
  3. Enforce the non-null and uniqueness constraints: `ALTER TABLE public.members ALTER COLUMN epf_number SET NOT NULL, ALTER COLUMN designation SET NOT NULL, ADD CONSTRAINT members_epf_number_unique UNIQUE (epf_number);`

---

### 2. Self-Service Member Registration Blocked by Existing RLS Policies - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 442, 454, 488 (`Phase 4`, Step 4.3, Manifest Line 454)
* **Discrepancy Description:**  
  The plan mandates that `unauthorized.html` and `js/page-unauthorized.js` submit unrecognized staff registrations by "creating an unapproved record in `public.members`". In the current database schema (`supabase/migrations/20261108000002_rls_policies.sql`), only users with `admin` or `manager` roles can insert into `public.members` (`members_admin_manager_all`). A newly authenticated Google OAuth user has no row in `public.members`, meaning `public.get_current_user_role()` evaluates to `NULL`. Attempting an `INSERT` from `js/page-unauthorized.js` will immediately fail with a PostgreSQL Row-Level Security violation (`new row violates row-level security policy for table "members"`).
* **Rationale & Recommendation:**  
  The implementation plan cannot leave RLS bypass or policy creation to the implementer's whim (which risks privilege escalation if an unconstrained insert policy is added). The plan must explicitly mandate either:
  - A tightly scoped RLS policy:
    ```sql
    CREATE POLICY members_self_registration_insert ON public.members
        FOR INSERT TO authenticated
        WITH CHECK (
            auth.uid() = user_id 
            AND role = 'member'::app_role 
            AND is_approved = false
            AND is_legacy_member = false
        );
    ```
  - Or a dedicated `SECURITY DEFINER` RPC function: `public.submit_member_registration(epf_number TEXT, designation TEXT, phone TEXT)`.

---

### 3. PostgreSQL Transaction Failure on Enum Alteration (`ALTER TYPE ... ADD VALUE`) - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 442, 465-466 (`Step 1: Database Migration & Security Hardening`, Manifest Line 442)
* **Discrepancy Description:**  
  The plan bundles `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'secretary'` and `'committee_member'` alongside `UPDATE public.members SET role = 'committee_member' WHERE role = 'official'` into a single migration file `20261108000004_comprehensive_overhaul.sql`. In PostgreSQL, new enum values added with `ALTER TYPE ... ADD VALUE` cannot be referenced or used in DML statements (`UPDATE`, `INSERT`) within the same transaction block (`ERROR: unsafe use of new value "committee_member" of enum type app_role`). Because Supabase migration runners execute migration files wrapped in transactions by default, this script will fail.
* **Rationale & Recommendation:**  
  Instruct the implementer to split this into two discrete sequential migration steps or explicitly execute the enum expansion outside a transactional wrapper before running the data update and trigger bindings:
  - Step 1A (`20261108000004_add_roles.sql`): `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'secretary'; ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'committee_member';`
  - Step 1B (`20261108000005_comprehensive_overhaul.sql`): Data migration (`UPDATE members...`), tables, triggers, and RLS policies.

---

### 4. Service Worker `localStorage` Access Architectural Impossibility - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 449, 482 (Manifest Line 449, Step 3.5, and Architecture Section Line 329)
* **Discrepancy Description:**  
  Line 329 and Line 449 specify that `sw.js` (v3) implements "Network-First for API requests (`/rest/v1/*`), with local fallback to `mria_cached_member`". In the client architecture (`js/auth.js`), `mria_cached_member` is stored in browser `window.localStorage`. Under the W3C Web Workers / Service Worker specifications, `localStorage` is **synchronous and strictly unavailable** in the `ServiceWorkerGlobalScope`. Attempting to reference `localStorage` within `sw.js` throws a fatal `ReferenceError: localStorage is not defined`, crashing the service worker event listener.
* **Rationale & Recommendation:**  
  The Service Worker cannot read `localStorage`. Clarify that offline REST fallback within `sw.js` must either:
  1. Rely exclusively on the Cache API (`caches.open(CACHE_NAME)`), storing cloned GET responses for `/rest/v1/members*`.
  2. Or delegate member cache fallback entirely to the client-side JavaScript layer (`js/auth.js:getMemberProfile`), while `sw.js` returns a structured offline JSON response `{ offline: true }` when network fetch fails.

---

### 5. Cash Payment FIFO Dues Reconciliation Disconnect - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 446, 470, 500 (`Step 1`, Step 6.3, Manifest Line 446)
* **Discrepancy Description:**  
  CUJ 3 states that when the Treasurer collects cash, "1. A verified payment record is created... 2. The FIFO settlement engine marks the member's oldest pending monthly due in `member_dues` as `paid`". However, cross-referencing `supabase/migrations/20261108000003_triggers_and_functions.sql` reveals that `on_payment_verified_reconcile` is strictly defined as `AFTER UPDATE ON public.payments`. In `js/api.js:recordCashPayment`, cash payments are inserted directly with `status = 'verified'` (`INSERT INTO payments ... status = 'verified'`). Because this is an `INSERT` rather than an `UPDATE`, the FIFO trigger **never executes**, leaving member dues as `pending`.
* **Rationale & Recommendation:**  
  Step 1 must explicitly instruct the implementer to update trigger `on_payment_verified_reconcile` in `20261108000004_comprehensive_overhaul.sql` to fire on both `INSERT OR UPDATE`:
  ```sql
  DROP TRIGGER IF EXISTS on_payment_verified_reconcile ON public.payments;
  CREATE TRIGGER on_payment_verified_reconcile
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_verified_payment();
  ```
  And adjust `reconcile_verified_payment()` so that on `INSERT`, if `NEW.status = 'verified'`, it performs reconciliation.

---

### 6. Missing Trigger Function Definition for Mutation Auditing - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 442, 470 (`Step 1: Database Migration & Security Hardening`, Manifest Line 442)
* **Discrepancy Description:**  
  Line 470 specifies: "Attach table-level `SECURITY DEFINER` audit triggers on `members`, `payments`, `member_dues`, and `treasury_transactions`." However, the plan only specifies `fn_prevent_audit_tampering()` (which blocks UPDATE/DELETE on `audit_logs`). It completely fails to provide the signature, logic, or behavior for the function that *creates* the audit logs (e.g., `fn_audit_record_mutation()`). Design decisions are left unguided: how `user_email`, `full_name`, and `epf_number` are captured when `auth.uid()` is null (such as during cron jobs or automated system triggers), and how `diff_json` is constructed.
* **Rationale & Recommendation:**  
  Define the exact audit logging trigger function specification in Step 1, ensuring it gracefully handles non-interactive or cron mutations (falling back to `'system@mria.lk'` or `'cron_worker'` when `auth.jwt()` is absent) to avoid aborting valid business operations.

---

### 7. Missing Treasury Transaction Generation Mechanism on Payment Verification - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 446, 458, 500 (`Step 6: Executive Administration & Treasury Console`)
* **Discrepancy Description:**  
  CUJ 3 requires that when cash is collected, a corresponding transaction is recorded in `treasury_transactions` (`inflow` to `cash_in_hand`), and similarly bank slip verification should increment `boc_savings`. However, the implementation plan in Lines 446 and 500 leaves it ambiguous whether this is handled by a PostgreSQL database trigger or requires two separate client API calls from `js/page-admin.js`. If left to client-side calls without database transaction wrapping, partial network failures will cause the treasury balance to permanently desynchronize from verified member dues.
* **Rationale & Recommendation:**  
  Explicitly specify whether `treasury_transactions` inflow records are automatically generated via a PostgreSQL `AFTER UPDATE/INSERT` trigger on `payments` (when `status = 'verified'`), or if `recordTreasuryTransaction` must be called by `js/page-admin.js` with idempotent reference tracking.

---

### 8. Edge Function Invocations: Broken Relative Path, Missing Secrets & CORS - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 443, 473-476, 494 (`Step 2: Supabase Edge Function Deployment`, Line 308)
* **Discrepancy Description:**  
  1. In Line 308, the function execution trigger is written as `fetch('/functions/v1/send-claim-notification')`. On static PWA hosting (GitHub Pages/local server), this relative URL resolves to the static origin and returns a 404. It must use `${CONFIG.FUNCTIONS_URL}/send-claim-notification`.
  2. Step 2 only instructs configuring `RESEND_API_KEY`. It omits `SUPABASE_SERVICE_ROLE_KEY`, which is mandatory for the Edge Function to bypass RLS to read all committee members' emails and write failures to `audit_logs`.
  3. Step 2 omits instructions for handling HTTP CORS `OPTIONS` preflight requests, which will cause client browser fetches from `dashboard.html` to be rejected.
* **Rationale & Recommendation:**  
  Update Step 2 and Step 5.4 to explicitly require:
  - Invoking `${CONFIG.FUNCTIONS_URL}/send-claim-notification` with `Authorization: Bearer ${session.access_token}`.
  - Adding `SUPABASE_SERVICE_ROLE_KEY` to required Edge Function environment secrets.
  - Implementing standard CORS preflight headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: ...`) in `supabase/functions/send-claim-notification/index.ts`.

---

### 9. Omission of `js/storage.js` from Manifest & Undefined Constitution PDF Upload - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 440-459 (`Comprehensive File Manifest`), Lines 495, 502
* **Discrepancy Description:**  
  Lines 458 and 502 require the Secretary to upload dual-slot Constitution PDFs (`constitution_si.pdf` and `constitution_en.pdf`) to Cloudflare R2, while Line 495 requires members to download them. However, `js/storage.js` is **completely absent from the File Manifest** (Lines 440-459). In the current codebase, `js/storage.js` only provides `uploadBankSlip`, which targets an Edge Function hardcoded for bank slips (`/upload-slip`). The plan specifies no function (e.g., `uploadConstitutionPdf`, `getConstitutionUrl`) or storage endpoint for CMS documents.
* **Rationale & Recommendation:**  
  Add `js/storage.js` to the File Manifest as **Modified**. Add explicit implementation instructions in Step 3 and Step 6 detailing the functions to generate presigned upload URLs for `cms_documents` and retrieve public/signed read URLs for the active language.

---

### 10. Opening Balance Computation Gap for Date-Filtered Treasury Statements - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 447, 481, 501 (`Step 3.4`, Step 6.4, Manifest Line 447)
* **Discrepancy Description:**  
  The plan mandates that `js/treasury-export.js` generate date-filtered statements (monthly, yearly, custom range) displaying "opening balance, detailed ledger rows, closing balances for all 3 asset accounts". However, the SQL view `treasury_account_balances` (Lines 256-270) only computes the *current aggregate balance* across all time. If a statement is requested for a date window (e.g., `2026-03-01` to `2026-03-31`), a query filtering `transaction_date BETWEEN start AND end` cannot determine the opening balance as of `2026-03-01`.
* **Rationale & Recommendation:**  
  Update Step 1 and Step 3.3 (`js/api.js`) to specify a PostgreSQL stored procedure or API query: `getTreasuryStatement(startDate, endDate)` that calculates `opening_balance = SUM(inflow - outflow)` for all transactions strictly prior to `startDate`, retrieves bounded rows, and computes `closing_balance = opening_balance + period_net`.

---

### 11. Admin RBAC Route Guard Lock-Out in `js/page-admin.js` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 457-458, 498-499 (`Step 6: Executive Administration & Treasury Console`)
* **Discrepancy Description:**  
  Step 6 directs re-architecting `admin.html` and `js/page-admin.js` into role-filtered workspaces for the Secretary, Treasurer, and Committee members. However, in `js/page-admin.js` (line 37), the page authentication check is hardcoded to:
  ```js
  const staffRoles = ["admin", "manager", "official", "treasurer"];
  const authState = await requireAuth({ requireApproved: true, allowedRoles: staffRoles });
  ```
  Because the migration renames `official` to `committee_member` and introduces `secretary`, any user with role `secretary` or `committee_member` attempting to load `admin.html` will be immediately rejected and redirected to `/unauthorized.html` or `/dashboard.html`.
* **Rationale & Recommendation:**  
  Explicitly specify in Step 6.1 that `allowedRoles` in `js/page-admin.js` must be updated to `['admin', 'manager', 'secretary', 'treasurer', 'committee_member']`.

---

### 12. Omission of `/js/treasury-export.js` in `sw.js` Pre-Cache - Severity: 🟡 Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 447, 449, 482 (`Step 3: Core Client Libraries & PWA Infrastructure`)
* **Discrepancy Description:**  
  The plan creates `js/treasury-export.js` as a new file (Line 447) and modifies `sw.js` to version `mria-welfare-v3`. However, Step 3.5 only instructs adding cache-first rules for fonts and bank QR media. It does not instruct adding `/js/treasury-export.js` to the `STATIC_ASSETS` pre-cache array in `sw.js`. If an executive attempts to access the Treasury Console or export data while offline, fetching `treasury-export.js` will fail with an unhandled network error.
* **Rationale & Recommendation:**  
  Explicitly specify in Step 3.5 that `/js/treasury-export.js` must be added to the `STATIC_ASSETS` array in `sw.js`.

---

### 13. Contact Modal Submission Protocol Ambiguity - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-codebase-details`, `egm-style`
* **Affected Scope:** Lines 452, 487 (`Step 4: Public Landing & Onboarding Workflows`)
* **Discrepancy Description:**  
  Line 452 states that `js/page-index.js` "Connects contact form submission logic routing to `krishaja@gmail.com`". It does not specify whether this triggers a client-side `mailto:` anchor or calls an unauthenticated backend API. If an implementer attempts to build an unauthenticated backend endpoint via the Edge Function or Resend API, it creates an open mail relay vulnerability.
* **Rationale & Recommendation:**  
  Clarify in Step 4.2 that the landing page contact modal generates a structured client-side `mailto:krishaja@gmail.com?subject=...&body=...` link or opens the user's default email client, adhering strictly to the Non-Goal of excluding public unauthenticated mail endpoints.

---

### 14. Incomplete Instructions for Purging Legacy Dual-Language Markup - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`
* **Affected Scope:** Lines 445, 486, 491, 498 (`Steps 4, 5, 6`)
* **Discrepancy Description:**  
  While Lines 445 and 479 mandate 100% strict single-language isolation, Steps 4, 5, and 6 only specifically instruct overhauling copywriting in `index.html`. Existing files (`dashboard.html`, `admin.html`, `unauthorized.html`) contain dozens of hardcoded bilingual strings (e.g., `බැංකු රිසිට්පත්... • Strict FIFO...`, `Sign Out / වෙනත් ගිණුමකින්`, `WhatsApp මඟින් සම්බන්ධ වන්න / 0759555924`). Without explicit instructions to sweep and replace these with `data-i18n` elements across all HTML templates, dual-language text will persist in production.
* **Rationale & Recommendation:**  
  Add an explicit instruction in Step 4, 5, and 6 to execute a systematic DOM cleanup replacing all mixed-language text nodes with single `<span data-i18n="...">` anchors.

---

## Conclusion & Next Actions

The implementation plan in Lines 413 to 502 possesses a clean high-level narrative and structural sequence, but contains **4 Blocker** and **7 Major** readiness gaps when cross-referenced against actual PostgreSQL behavior and codebase constraints. Addressing these 14 prioritized findings will ensure an unambiguous, fully actionable execution plan that implementers can execute without architectural improvisation.
