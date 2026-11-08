# Implementation Readiness Audit Report (Stage 9)

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 465..582)  
**Standard:** Implementation Readiness Standard (`resources/document_standards/implementation-readiness-standard.md`)  
**Reviewers:** `egm-implementation-readiness` (Pragmatic Tech Lead), `egm-codebase-details` (Technical Quality Auditor)

---

## 1. Blockers (🔴)

### 1.1 Missing Dues Reconciliation Trigger & Allocation Logic
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 473, 477–479, 527
* **Description & Rationale:** Sequence Diagram B mandates: `DB->>DB: Trigger: Reconcile member_dues to 'paid'`, and table `payment_dues_reconciliation` exists to map payments to dues. However, in `20261108000003_triggers_and_functions.sql`, the plan only defines `handle_auth_user_created` and `generate_monthly_dues_for_period`. The dues reconciliation trigger or stored procedure is completely omitted. An engineer cannot implement the system without knowing whether payments are allocated via FIFO for oldest unpaid months, whether treasurers manually select due IDs, or how partial and advance payments are handled.
* **Remediation:** Provide the complete SQL stored procedure / trigger in the migration specification detailing the allocation algorithm.

### 1.2 Unresolvable Bare Specifier `@supabase/supabase-js` in Native ES6 Modules
* **Reviewer:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 461, 522–524
* **Description & Rationale:** The plan mandates pure Vanilla HTML5 and ES6 modules without bundlers, but specifies that `js/auth.js` wraps `@supabase/supabase-js`. In a native browser without a build step or `package.json`, bare specifiers like `import { createClient } from '@supabase/supabase-js'` throw fatal runtime errors (`Failed to resolve module specifier`).
* **Remediation:** Specify an Import Map (`<script type="importmap">`) in the HTML views mapping `@supabase/supabase-js` to an ESM CDN (`https://esm.sh/@supabase/supabase-js@2.46.1`).

### 1.3 Schema Foreign Key Contradiction in Verification Plan
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Line 561
* **Description & Rationale:** Verification Plan 1 asserts: `member_id = auth.uid()`. However, `member_dues.member_id` is a foreign key to `public.members(id)` (an internal UUID), not `auth.users(id)` (`auth.uid()`). The correct assertion must resolve the relation via `member_id = (SELECT id FROM public.members WHERE user_id = auth.uid())`.
* **Remediation:** Correct the verification SQL assertion in Line 561.

### 1.4 Missing PWA Static Assets in Target Files
* **Reviewer:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 510–516
* **Description & Rationale:** `manifest.json` references `icon-192.png` and `icon-512.png`, and `sw.js` pre-caches the static shell and Bank QR image. None of these asset files (`assets/icon-192.png`, `assets/icon-512.png`, `assets/default-bank-qr.png`) are listed in `Target Files to Create/Modify`. In standard Service Worker implementations, missing assets cause `cache.addAll()` to fail with 404, breaking Service Worker registration and PWA installation.
* **Remediation:** Add all required icons and placeholder assets under an `assets/` directory in the Target Files list.

### 1.5 Cron Architecture Contradiction & Unsecured Serverless Endpoint
* **Reviewer:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 93, 479, 492–495
* **Description & Rationale:** Section 1 (Line 93) specifies `pg_cron` running directly inside PostgreSQL. Yet Section 2 (Lines 492–495) specifies an Edge Function `monthly-dues-cron/index.ts` to call `generate_monthly_dues_for_period()`. If `pg_cron` is used, the Edge Function is redundant. If the Edge Function is used, it lacks authentication/authorization guards, exposing an unauthenticated public HTTP endpoint that could be triggered repeatedly to generate duplicate dues.
* **Remediation:** Standardize on pure database `pg_cron` scheduling inside migration scripts, eliminating the redundant Edge Function.

---

## 2. Majors (🟡)

### 2.1 Omission of Automated Test Files in Target File Manifest
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 467–550, 552–579
* **Description & Rationale:** All verification steps are written as manual CLI commands (`supabase db reset`, `curl`). There are no automated test files listed under Target Files (e.g., pgTAP SQL tests or Deno test suites).
* **Remediation:** Add `./supabase/tests/database.test.sql` (pgTAP) and `./supabase/functions/tests/slip-functions.test.ts` (Deno) to the Target Files manifest.

### 2.2 RLS Infinite Recursion Trap & Missing Helper Functions
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 474–476, 290–306
* **Description & Rationale:** The plan does not provide the `SECURITY DEFINER` function (e.g., `public.is_admin()`, `public.has_role()`) required to bypass RLS infinite recursion when evaluating `members.role`.
* **Remediation:** Include `SECURITY DEFINER` role-checking helper functions in `20261108000002_rls_policies.sql`.

### 2.3 Missing Request/Response API Signatures for Edge Functions
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 486–491
* **Description & Rationale:** Edge Functions lack documented interface contracts. The payload structures, allowed MIME types, file size ceilings, and response JSON schemas are not specified.
* **Remediation:** Document exact JSON request/response contracts for `upload-slip` and `get-slip-url`.

### 2.4 Omission of Supabase Project Configuration (`supabase/config.toml`)
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 471–483, 555–558
* **Description & Rationale:** Running `supabase db reset` requires a project configuration file. The workspace currently lacks `supabase/config.toml`.
* **Remediation:** Add `./supabase/config.toml` (`Create`) to the Target Files list.

### 2.5 Missing Deno Configuration / Import Map for Edge Functions
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 484–495
* **Description & Rationale:** Edge Functions use AWS SDK packages. Deno requires `deno.json` or `import_map.json` to resolve npm specifiers.
* **Remediation:** Add `./supabase/functions/deno.json` (`Create`) to manage external dependencies.

### 2.6 Missing CORS Preflight Handling Specification
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 486–491
* **Description & Rationale:** Cross-origin requests from the PWA require Edge Functions to handle `OPTIONS` preflight and return CORS headers.
* **Remediation:** Add `./supabase/functions/_shared/cors.ts` (`Create`) for shared CORS handling.

### 2.7 Undefined Tailwind CSS Pipeline and Delivery Model
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 80, 457, 496–516
* **Description & Rationale:** The plan specifies "compiled Tailwind CSS", but no build tooling, `tailwind.config.js`, or standalone CSS output file is cataloged in Target Files.
* **Remediation:** Catalog `./css/style.css` (compiled Tailwind) or explicitly define the standalone Tailwind CLI build step.

### 2.8 Client-Side Environment Variable Distribution
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 519–521, 543–545
* **Description & Rationale:** In a static HTML/JS project without a bundler, client code cannot read `.env` directly. The plan must clarify that `js/config.js` contains client-side public constants.
* **Remediation:** Document that `js/config.js` is populated with public Supabase constants.

### 2.9 Absence of Local Development Server Specification for PWA Testing
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 574–579
* **Description & Rationale:** Browsers refuse to register Service Workers over `file://`. A local web server is required.
* **Remediation:** Document `python3 -m http.server 8080` in setup instructions.

---

## 3. Nits (🟢)

### 3.1 Missing Local Edge Function Secrets Template (`supabase/.env.local.example`)
* **Reviewer:** `egm-codebase-details`
* **Affected Scope:** Lines 543–545

### 3.2 Missing DOM Element Selector Conventions
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 498–509, 525–540

### 3.3 Ambiguous "Golden Ratio Layout Adjustments" in `js/ui.js`
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Line 539

### 3.4 Unspecified Total Balance Calculation Formula
* **Reviewer:** `egm-implementation-readiness`
* **Affected Scope:** Lines 506, 527
