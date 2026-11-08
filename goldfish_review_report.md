# Goldfish Annotated Review Report

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 1..582)  
**Status:** Resolved (Option A Accepted)  

---

## Escalated Decisions (User Confirmed)

### [ESCALATE-01] Storage Engine: Cloudflare R2 vs. Native Supabase Storage
* **Decision:** Option A Accepted (Retain Cloudflare R2 with hardened HeadObject validation, MIME validation, 5MB limit, and CORS preflight).
* **Affected Scope:** Lines 96–98, 372–387, 419–425, 486–491
* **Discrepancy Description:** The design introduces a secondary cloud infrastructure provider (Cloudflare R2) and serverless Edge Functions (`upload-slip`, `get-slip-url`) wrapping AWS S3 SDK v3 presigners.
* **Reviewer Critique (`egm-zoom-out`):** The reviewer flagged this as a Blocker (Finding 1), arguing that for a local community association of a few hundred members uploading ~500 slips/month, native Supabase Storage provides private buckets with Row-Level Security and built-in 15-minute presigned URLs (`supabase.storage.from('slips').createSignedUrl(path, 900)`) in zero extra lines of code, well within the free tier. Introducing R2 creates multi-cloud vendor management, S3 access keys, CORS configuration, and two custom Deno Edge Functions.
* **Context:** The user explicitly requested Cloudflare R2 during the brainstorm phase.
* ***AI Suggestion:*** `ESCALATE`
* ***Justification:*** This represents an intentional user architectural constraint versus a pure simplicity critique. 
  * **Option A (Retain Cloudflare R2):** Retain R2 as requested by the user, but harden it with `HeadObject` validation, CORS handling, and upload constraints.
  * **Option B (Switch to Supabase Storage):** Eliminate Cloudflare R2 and Deno functions, managing slip uploads and signed URLs natively in Supabase Storage with zero external dependencies.

---

## Prioritized Findings & AI Suggestions

### 1. Blockers (🔴)

#### [BLK-01] RLS Policy Infinite Recursion [`egm-design`]
* **Affected Scope:** [Lines 188, 193–201, 291–306](docs/designs/mria_management_welfare_association_pwa.md#L188) (Database Schema & RLS Matrix)
* **Discrepancy Description:** Subquery on `public.members` inside policies protecting `public.members` triggers PostgreSQL `54001: stack depth limit exceeded`.
* **Rationale:** Direct recursive self-references in RLS crash all member and admin queries.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Valid PostgreSQL bug. Creating a `SECURITY DEFINER` function with `SET search_path = public` executes role lookups with bypass permissions, eliminating recursion.
* ***Proposed Edit:***
  * Location: Section 5 (Database Triggers & Stored Functions)
  * Change: Add `public.get_current_user_role() RETURNS app_role` as `SECURITY DEFINER` and update RLS policies to call `public.get_current_user_role() = 'admin'`.

#### [BLK-02] Missing Payment Reconciliation Logic [`egm-design`, `egm-comprehension`, `egm-implementation-readiness`]
* **Affected Scope:** [Lines 161–163, 216–237, 307–371](docs/designs/mria_management_welfare_association_pwa.md#L161)
* **Discrepancy Description:** Sequence Diagram B mandates an automatic trigger reconciling dues to paid upon payment verification, but the trigger and allocation rules (FIFO, partial payments) are missing from the schema.
* **Rationale:** Implementers have no specification for allocating funds across overdue months.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** The allocation algorithm must be formally defined to ensure financial consistency.
* ***Proposed Edit:***
  * Location: Section 5 (Database Triggers & Stored Functions)
  * Change: Define `public.reconcile_verified_payment(payment_uuid UUID)` which applies verified payment funds to unpaid `member_dues` in chronological order (FIFO), inserting audit records into `payment_dues_reconciliation` and updating `member_dues.status = 'paid'`.

#### [BLK-03] Client-Side Whitelist Security Bypass [`egm-design`]
* **Affected Scope:** [Lines 46–50, 115–135, 291–306](docs/designs/mria_management_welfare_association_pwa.md#L46)
* **Discrepancy Description:** Unregistered users are only redirected client-side; public tables grant `SELECT` to `authenticated`, allowing unapproved Google users to query data via API.
* **Rationale:** Client-side JavaScript redirects can be bypassed in DevTools.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Security boundaries must be enforced at the database layer.
* ***Proposed Edit:***
  * Location: Section 4 (RLS Policy Matrix)
  * Change: Update policies for `announcements`, `benefit_types`, and `system_settings` to require: `EXISTS (SELECT 1 FROM public.members WHERE user_id = auth.uid() AND is_approved = true)`.

#### [BLK-04] Bare Module Specifier `@supabase/supabase-js` [`egm-implementation-readiness`, `egm-codebase-details`]
* **Affected Scope:** [Lines 461, 522–524](docs/designs/mria_management_welfare_association_pwa.md#L461)
* **Discrepancy Description:** Vanilla ES6 modules in browser without a bundler cannot resolve bare `@supabase/supabase-js`, throwing fatal runtime errors.
* **Rationale:** Native browser ES6 requires relative paths or an Import Map.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Adding an `<script type="importmap">` resolves bare imports cleanly while preserving zero-bundler simplicity.
* ***Proposed Edit:***
  * Location: Section 3 & 4 (PWA Views & ES6 Modules)
  * Change: Specify `<script type="importmap">` in all HTML templates mapping `@supabase/supabase-js` to `https://esm.sh/@supabase/supabase-js@2.46.1`.

#### [BLK-05] Missing PWA Shell Assets Breaking Service Worker [`egm-implementation-readiness`, `egm-codebase-details`]
* **Affected Scope:** [Lines 510–516](docs/designs/mria_management_welfare_association_pwa.md#L510)
* **Discrepancy Description:** `manifest.json` and `sw.js` reference icons and Bank QR images, but these files are omitted from target files; `cache.addAll()` fails with 404, breaking PWA installation.
* **Rationale:** Missing pre-cached assets cause Service Worker registration rejection.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Required static shell assets must be cataloged in the manifest.
* ***Proposed Edit:***
  * Location: Detailed Implementation Plan, Section 4.3 & 4.5
  * Change: Add `./assets/icon-192.png`, `./assets/icon-512.png`, and `./assets/default-bank-qr.png` to Target Files.

#### [BLK-06] Schema Foreign Key Contradiction in Verification Plan [`egm-codebase-details`, `egm-comprehension`]
* **Affected Scope:** [Line 561](docs/designs/mria_management_welfare_association_pwa.md#L561)
* **Discrepancy Description:** Verification Plan 1 asserts `member_id = auth.uid()`, but `member_dues.member_id` is an internal UUID referencing `public.members.id`, not `auth.users.id`.
* **Rationale:** Asserting against the wrong foreign key will cause automated tests to fail.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Fix relational expression in verification instructions.
* ***Proposed Edit:***
  * Location: Verification Plan, Section 1
  * Change: Update assertion to: `member_id = (SELECT id FROM public.members WHERE user_id = auth.uid())`.

#### [BLK-07] Inconsistent Defaulter Roster RBAC Permissions [`egm-style`]
* **Affected Scope:** [Lines 29, 69, 297, 453](docs/designs/mria_management_welfare_association_pwa.md#L29)
* **Discrepancy Description:** Goals and CUJ 5 omit `treasurer` from viewing defaulters, while RLS matrix and security NFR include `treasurer`.
* **Rationale:** Inconsistent authorization specifications invite implementation bugs.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** The treasurer manages dues and collections and must have access to overdue rosters.
* ***Proposed Edit:***
  * Location: Goals (Line 29) and CUJ 5 (Line 69)
  * Change: Harmonize text to explicitly state `admin, manager, official, and treasurer`.

---

### 2. Majors (🟡)

#### [MAJ-01] Dual Role Architecture Discrepancy [`egm-zoom-out`, `egm-comprehension`, `egm-style`]
* **Affected Scope:** Lines 178–202
* **Discrepancy Description:** Schema has both `members.role` column and `public.user_roles` join table.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** For single-role membership, maintaining `members.role app_role NOT NULL DEFAULT 'member'` is sufficient and eliminates table joins.
* ***Proposed Edit:*** Drop `public.user_roles` table from schema and RLS matrix.

#### [MAJ-02] Time-Zone Limbo (UTC vs. Asia/Colombo UTC+05:30) [`egm-design`]
* **Affected Scope:** Lines 25, 66–70, 353, 492–495
* **Discrepancy Description:** Cron at 00:00:00 UTC triggers at 05:30 AM Sri Lanka time, causing a 5.5-hour month-end date skew.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Sri Lanka operates at UTC+05:30 with no daylight saving time.
* ***Proposed Edit:*** Anchor calendar boundaries to `TIMEZONE('Asia/Colombo', now())` and schedule cron at `30 18 * * *` UTC.

#### [MAJ-03] Hardcoded Personal Email in DDL Triggers [`egm-zoom-out`, `egm-design`]
* **Affected Scope:** Lines 318, 332–336, 386
* **Discrepancy Description:** `krishaja@gmail.com` and `0759555924` hardcoded in DDL trigger and edge functions.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** DDL must not contain personal PII. Seeding belongs in `seed.sql`.
* ***Proposed Edit:*** Move root admin bootstrap into `supabase/seed.sql` and read contact phone from `system_settings`.

#### [MAJ-04] Missing Defaulter State Machine / View [`egm-zoom-out`, `egm-design`, `egm-comprehension`]
* **Affected Scope:** Lines 25, 66–70, 204–213, 567
* **Discrepancy Description:** Defaulters are described as an altered state, but neither `members` nor `member_dues` has a defaulter status column.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Defaulter status is a computed query, not a mutation.
* ***Proposed Edit:*** Define explicit PostgreSQL view:
  ```sql
  CREATE VIEW public.defaulters_roster AS
  SELECT m.id, m.full_name, m.phone, d.billing_month, d.amount
  FROM public.members m
  JOIN public.member_dues d ON d.member_id = m.id
  WHERE d.status = 'pending' AND d.billing_month < date_trunc('month', TIMEZONE('Asia/Colombo', now()))::DATE;
  ```

#### [MAJ-05] Cron Architecture Contradiction [`egm-zoom-out`, `egm-implementation-readiness`]
* **Affected Scope:** Lines 93, 479, 492–495
* **Discrepancy Description:** Diagram specifies `pg_cron`, while implementation plan introduces an Edge Function `monthly-dues-cron`.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Native `pg_cron` inside PostgreSQL eliminates network hops and cold starts.
* ***Proposed Edit:*** Schedule dues generation via `cron.schedule()` in migration scripts; remove Edge Function `monthly-dues-cron`.

#### [MAJ-06] Contradictory Offline Balance Caching [`egm-design`]
* **Affected Scope:** Lines 30, 438, 458–459, 576
* **Discrepancy Description:** Goals state balances are viewable offline, but NFR specifies `Network-Only`.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Balance caching allows members to see their last verified standing offline.
* ***Proposed Edit:*** Standardize on `Network-First` with fallback to cached balance and a prominent "Offline as of [Date]" badge.

#### [MAJ-07] Omission of `supabase/config.toml` & Deno Config [`egm-codebase-details`]
* **Affected Scope:** Lines 471–483, 555–558
* **Discrepancy Description:** Missing project configuration breaks `supabase db reset`.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Supabase CLI requires `config.toml`.
* ***Proposed Edit:*** Add `./supabase/config.toml` to Target Files.

#### [MAJ-08] Missing CORS Preflight Handling [`egm-codebase-details`]
* **Affected Scope:** Lines 486–491
* **Discrepancy Description:** Cross-origin browser fetch requests fail without CORS `OPTIONS` handling.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Required for web fetch requests.
* ***Proposed Edit:*** Add `./supabase/functions/_shared/cors.ts` to Target Files.

#### [MAJ-09] Undefined Tailwind CSS Pipeline [`egm-codebase-details`]
* **Affected Scope:** Lines 80, 457, 496–516
* **Discrepancy Description:** Plan refers to "compiled Tailwind" without stylesheet paths or build steps.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Offline PWA requires a standalone cached CSS file.
* ***Proposed Edit:*** Catalog `./css/style.css` (compiled Tailwind) and document Tailwind standalone CLI compilation.

#### [MAJ-10] Client-Side Environment Variable Distribution [`egm-codebase-details`]
* **Affected Scope:** Lines 519–521, 543–545
* **Discrepancy Description:** Browser ES6 cannot parse `.env` directly.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** `js/config.js` should declare public configuration constants directly.
* ***Proposed Edit:*** Document that `js/config.js` contains client-safe public keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

#### [MAJ-11] Absence of Local Development Server Instructions [`egm-codebase-details`]
* **Affected Scope:** Lines 574–579
* **Discrepancy Description:** Service Workers will not register over `file://`.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Developers need a local HTTP serving command.
* ***Proposed Edit:*** Add `python3 -m http.server 8080` to setup instructions.

#### [MAJ-12] Unresolved Bereavement Aid Workflow & Eligibility Gating [`egm-zoom-out`, `egm-design`]
* **Affected Scope:** Lines 42–43, 253–265, 301–302
* **Discrepancy Description:** Open Question 2 remains unanswered; defaulting members could claim aid.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Define workflow: Manager approves claim, Treasurer logs disbursement; members with overdue balances cannot claim bereavement aid without board waiver.
* ***Proposed Edit:*** Add state transitions and eligibility gating to `benefit_claims` in Section 3 and CUJs.

#### [MAJ-13] Undefined Member Onboarding Workflow in `admin.html` [`egm-comprehension`]
* **Affected Scope:** Lines 46–50, 508
* **Discrepancy Description:** Whitelist requires pre-existing `members` row, but `admin.html` omits a member creation/approval view.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Administrators need an interface to approve members who contact via WhatsApp.
* ***Proposed Edit:*** Add Member Directory & Onboarding management table to `admin.html`.

#### [MAJ-14] Undefined Concept of "Legacy Member" [`egm-comprehension`]
* **Affected Scope:** Lines 186, 414
* **Discrepancy Description:** `is_legacy_member` is used in schema, but never defined in problem statement or overview.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Domain terms must be defined for fresh readers.
* ***Proposed Edit:*** Add definition in Overview: members enrolled prior to system deployment are "legacy members" exempt from the one-time admission fee.

#### [MAJ-15] Missing "Risks & Mitigations" Section [`egm-structural`]
* **Affected Scope:** Lines 447–464
* **Discrepancy Description:** Mandated section missing from specification.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Document must analyze failure modes.
* ***Proposed Edit:*** Add `## Risks & Mitigations` section mapping failure modes to defensive strategies.

#### [MAJ-16] Missing "Rollout & Rollback" Template Requirement [`egm-structural`]
* **Affected Scope:** Lines 449–464
* **Discrepancy Description:** Non-Functional Requirements omits deployment sequencing and rollback commands.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** Standard requirement for database migrations.
* ***Proposed Edit:*** Add `### 4. Rollout & Rollback` to Non-Functional Requirements.

#### [MAJ-17] Structural Asymmetry between Schema and RLS Matrix [`egm-structural`]
* **Affected Scope:** Lines 165–288 vs Lines 290–306
* **Discrepancy Description:** Schema declared `user_roles` and `payment_dues_reconciliation`, but RLS policy matrix omitted them.
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Justification:** All declared tables must have defined RLS policies.
* ***Proposed Edit:*** Add RLS policy for `payment_dues_reconciliation` (and drop redundant `user_roles`).

---

### 3. Nits (🟢)

#### [NIT-01..14] Code Quality, Style & Formatting Fixes
* **Affected Scope:** Multiple lines across document
* ***AI Suggestion:*** `PROPOSE FIX`
* ***Proposed Edits:***
  * Normalize design token typography and spacing to clean numbers (`10px`, `16px`, `26px`, `42px`, `68px`).
  * Remove emotional and promotional buzzwords ("chaotic", "tedious", "instant").
  * Fix Markdown linting: add blank lines before fenced code blocks (MD022/MD031), consolidate consecutive blank lines (MD012), use alphabetic alternative headers (`Alternative A`).
  * Add standard DOM element IDs (`#slip-file-input`, `#cash-collection-form`) for Stitch UI wiring.
  * Add automated test files (`supabase/tests/database.test.sql`) to Target Files manifest.
