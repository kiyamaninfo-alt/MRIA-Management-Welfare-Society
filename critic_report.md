# Critic Review Report (Stage 7)

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 1..464)  
**Standard:** Feature Spec Standard (`resources/document_standards/feature-spec-standard.md`)  
**Reviewers:** `egm-design` (Design Critic), `egm-style` (Technical Copy Editor)

---

## 1. Blockers (🔴)

### 1.1 RLS Infinite Recursion & Broken Authorization Subsystem
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 188, 193–201, 291–306
* **Description & Rationale:** The RLS Policy Matrix specifies administrative checks via subqueries against `public.members` (e.g., `"Role check via members.role"`). In PostgreSQL, querying `public.members` within an RLS policy applied to `public.members` triggers infinite recursion (`54001: stack depth limit exceeded`), failing all member and admin database queries. Additionally, maintaining both `members.role` and `public.user_roles` creates conflicting sources of truth.
* **Remediation:** 
  1. Deprecate `public.user_roles` in favor of a single authoritative `members.role` column, or vice-versa.
  2. Implement a `SECURITY DEFINER` helper function (`public.is_admin()`, `public.has_role()`) with `SET search_path = public` to evaluate caller roles without triggering recursive RLS evaluation.

### 1.2 Phantom Reconciliation Trigger & Unconstrained Payment Allocation
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 161–163, 216–237, 307–371
* **Description & Rationale:** Sequence Diagram B states: `"DB -> DB: Trigger: Reconcile member_dues to 'paid'"`. However, this trigger is completely absent from Section 5 (Triggers & Functions) and the migration specifications. Furthermore, there is no database constraint enforcing `SUM(allocated_amount) <= payments.amount`, and the design lacks business rules for FIFO allocation, multi-month advance payments, or partial settlements.
* **Remediation:** Define the exact reconciliation trigger/function in the schema, enforce allocation constraints, and specify FIFO settlement rules for overdue dues.

### 1.3 Client-Side Security Bypass for Google Auth Whitelist
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 46–50, 115–135, 291–306, 310–345
* **Description & Rationale:** Whitelisting is enforced purely via client-side redirection in `index.html` / `auth.js`. An attacker or unapproved user can bypass browser redirects using DevTools. Because `announcements`, `benefit_types`, and `system_settings` grant `SELECT` access to the Supabase `authenticated` role, any unapproved Google user can read internal association data directly via REST/GraphQL APIs.
* **Remediation:** Update all RLS policies granting `authenticated` access to strictly require `EXISTS (SELECT 1 FROM public.members WHERE user_id = auth.uid() AND is_approved = true)`.

### 1.4 Inconsistent RBAC Role Terminology for Defaulter Roster Access
* **Reviewer:** `egm-style`
* **Affected Scope:** Lines 29, 69, 297, 453
* **Description & Rationale:** Conflicting technical specifications across sections. Lines 29 and 69 restrict overdue member visibility to `admin`, `manager`, and `official`, omitting `treasurer`. In contrast, the RLS policy matrix (line 297) and security section (line 453) authorize `admin, manager, official, treasurer`.
* **Remediation:** Harmonize all sections to uniformly state `admin, manager, official, and treasurer`.

### 1.5 Unprovable Performance & Security Guarantees
* **Reviewer:** `egm-style`
* **Affected Scope:** Lines 424, 457
* **Description & Rationale:** Unprovable marketing claims in engineering specifications. Line 424 claims presigned URLs "guarantee zero public exposure", and Line 457 asserts a 150 KB bundle will "guarantee sub-second load times on 3G/4G cellular connections across Sri Lanka".
* **Remediation:** Replace with objective engineering language: "enforces private access controls" and "targets sub-second initial render times under typical 3G/4G conditions".

---

## 2. Majors (🟡)

### 2.1 Unauthenticated S3 Keys, Ghost Uploads, and Slip Spoofing in Cloudflare R2
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 148–154, 216–228, 376–380
* **Description & Rationale:** The client requests a presigned PUT URL, uploads to R2, and independently inserts a record into `payments` with `slip_key`. This permits ghost uploads (R2 storage bloat with unlinked files), slip spoofing (inserting arbitrary or another user's `slip_key`), and unenforced binary payloads without size ceilings.
* **Remediation:** Require `upload-slip` to cryptographically sign max file size (5 MB) and MIME types. Route payment creation through an authenticated RPC/Edge Function that verifies the object exists in R2 via `HeadObjectCommand` before creating the database row.

### 2.2 Hardcoded Root Admin Email in DDL and Edge Functions
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 318, 332–336, 386
* **Description & Rationale:** Production email `krishaja@gmail.com` and phone `0759555924` are hardcoded directly into database triggers and Edge Function access rules. This breaks local/staging deployments and requires DDL migrations if the administrator changes.
* **Remediation:** Remove hardcoded credentials from DDL; manage bootstrap via `supabase/seed.sql` or environment variables.

### 2.3 Time-Zone Limbo (UTC vs. Sri Lanka Time UTC+05:30) in Cutoff & Cron Engine
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 25, 66–70, 353, 492–495
* **Description & Rationale:** Sri Lanka operates at UTC+05:30. Running scheduled cron jobs at 00:00:00 UTC causes dues generation and cutoff calculations to trigger at 05:30 AM local time, creating a 5.5-hour discrepancy where payments made after midnight are processed under the previous month's rules.
* **Remediation:** Anchor all date boundaries and schedules explicitly to `TIMEZONE('Asia/Colombo', now())` and schedule cron jobs at `30 18 * * *` UTC (midnight Sri Lanka time).

### 2.4 Missing Defaulter State Machine in Schema
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 25, 66–70, 204–213, 567
* **Description & Rationale:** Goals and CUJs state that "the system flags the account as a defaulter", but neither `members` nor `member_dues` has a defaulter status column. In practice, it is a computed query. The document fails to define the PostgreSQL view (`v_defaulters`) or query contract needed by `admin.html` and RLS.
* **Remediation:** Formally define the dynamic view `public.defaulters_roster` with explicit RLS enforcement.

### 2.5 Contradictory Offline Balance Caching Specification
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 30, 438, 458–459, 576
* **Description & Rationale:** Lines 30 and 576 specify that cached balances load offline, whereas line 458 states balance queries use `Network-Only`. If `Network-Only` is used, the PWA displays an error offline instead of the cached balance.
* **Remediation:** Specify a `Network-First` caching strategy with fallback to cached balances and a visible "Offline Data as of [Date]" indicator.

### 2.6 Unresolved Bereavement Welfare Aid Workflow & Eligibility Gating
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 42–43, 253–265, 301–302
* **Description & Rationale:** Open Question 2 remains unanswered in the architecture. There are no state transition rules defining who transitions claims from `submitted` to `disbursed`, and no validation check prevents defaulting or unapproved members from claiming welfare aid.
* **Remediation:** Define the exact approval lifecycle and gate claim submissions to members in good standing.

### 2.7 Pseudo-Academic Jargon & Marketing Language in Design System
* **Reviewer:** `egm-style`
* **Affected Scope:** Lines 388–408
* **Description & Rationale:** Phrasing such as "Mathematical Typography Scale", "~9.88px", and "Fibonacci Layout Spacing Scale" adds unnecessary marketing fluff. Technical CSS implementations require exact tokens without pseudo-academic rationalizations.
* **Remediation:** Simplify headings to "Typography Scale", "Spacing Scale", and "Color Palette Tokens", rounding fractional pixel approximations.

### 2.8 Editorializing and Loaded Language in Non-Functional Requirements
* **Reviewer:** `egm-style`
* **Affected Scope:** Line 461
* **Description & Rationale:** "Zero Heavy Framework Dependencies: Pure Vanilla HTML5 and ES6 modules eliminate bundler churn" contains loaded, opinionated phrasing.
* **Remediation:** Rephrase to objective terminology: "Native Web Platform Architecture: Standard HTML5 and ES6 modules are used without SPA frameworks to eliminate build pipeline overhead."

---

## 3. Nits (🟢)

### 3.1 Schema Duplication (`members.role` vs. `user_roles`)
* **Reviewer:** `egm-design`, `egm-style`
* **Affected Scope:** Lines 188, 193–201

### 3.2 Inconsistent Status Types and Missing Rejection Metadata
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 209, 216–228

### 3.3 Multi-Page PWA Navigation Latency
* **Reviewer:** `egm-design`
* **Affected Scope:** Lines 78–86, 498–510

### 3.4 Promotional Buzzwords & Conversational Fillers
* **Reviewer:** `egm-style`
* **Affected Scope:** Lines 11, 15, 17, 64, 416, 431


---

## 4. Structural Layout & Document Architecture (`egm-structural`)

### 4.1 Missing Required Section: "Risks & Mitigations"
* **Severity:** 🟡 Major
* **Affected Scope:** Lines 447–464
* **Description & Rationale:** `resources/document_standards/feature-spec-standard.md` mandates a structured failure mode analysis under "Risks & Mitigations". While `Non-Functional Requirements` touches on security and performance, the document lacks explicit failure analysis for Edge Function timeouts, Cloudflare R2 upload drops, network flutter, and service worker cache staleness.
* **Remediation:** Add a dedicated `## Risks & Mitigations` section mapping failure modes to defensive strategies.

### 4.2 Missing Template Requirement: "Rollout & Rollback"
* **Severity:** 🟡 Major
* **Affected Scope:** Lines 449–464
* **Description & Rationale:** `references/design_doc.md` requires a "Rollout & Rollback" sub-section under Non-Functional Requirements specifying migration deployment ordering, backward compatibility, and rollback commands for PostgreSQL 17 DDL and Cloudflare R2 configurations.
* **Remediation:** Add `### 4. Rollout & Rollback` to Non-Functional Requirements with forward migration steps and rollback procedures.

### 4.3 Structural Asymmetry: Omission of Tables from RLS Matrix
* **Severity:** 🟡 Major
* **Affected Scope:** Lines 165–288 vs. Lines 290–306
* **Description & Rationale:** Section 3 defines 10 database entities, but Section 4's RLS Policy Matrix omits policies for `public.user_roles` (lines 194–201) and `public.payment_dues_reconciliation` (lines 231–237). Under Supabase default-deny RLS semantics, omitting these tables leaves authorization undefined.
* **Remediation:** Explicitly include all declared tables in the RLS Policy Matrix or remove unneeded tables.

### 4.4 Structural Formatting Nits
* **Severity:** 🟢 Nit
* **Affected Scope:** Lines 47–49, 70–71, 114–115, 376, 412–440
* **Description & Rationale:** Missing blank lines before fenced code blocks (MD022/MD031), multiple consecutive blank lines (MD012), numeric vs. alphabetic alternative headers (`### Alternative 1` vs `### Alternative A`), and backticks nested inside bold tags (`**`code`:**`).
* **Remediation:** Apply clean Markdown linting conventions.
