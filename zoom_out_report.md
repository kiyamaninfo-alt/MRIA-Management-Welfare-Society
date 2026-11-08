# Initial Zoom-Out Architectural Review Report

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 1..582)  
**Standard:** Zoom-Out Standard (`resources/document_standards/zoom-out-standard.md`)
**Reviewer:** `egm-zoom-out` (Skeptical Architect)

---

## 1. Blocker

### Finding 1: Multi-Cloud Over-Engineering (Cloudflare R2 vs. Native Supabase Storage)
* **Affected Scope:** Section 1 (lines 96–98), Section 6 (lines 372–387), Alternative 2 (lines 419–425), Implementation Plan (lines 486–491, 528–530).
* **Rationale:** The proposal introduces a secondary cloud provider (Cloudflare R2) and serverless Edge Functions (`upload-slip`, `get-slip-url`) wrapping AWS S3 SDK v3 presigners, justified primarily by avoiding Supabase egress fees. For a local community welfare society with a few hundred members uploading monthly deposit receipts, Supabase's native Storage already provides private buckets with Row-Level Security, built-in time-boxed presigned URLs (`supabase.storage.from('slips').createSignedUrl(path, 900)`), and direct client-side SDK uploads without extra proxy functions. Introducing R2 adds redundant cloud vendor management, S3 access keys, CORS configuration, and two custom Deno Edge Functions to solve a problem already handled natively by Supabase in two lines of code.

---

## 2. Major

### Finding 2: Redundant Role Architecture & Conflicting Sources of Truth
* **Affected Scope:** Section 3 (lines 178–202).
* **Rationale:** The schema declares a `role app_role NOT NULL DEFAULT 'member'` column directly inside the `public.members` table (line 188), while simultaneously introducing a separate `public.user_roles` join table (lines 194–201). All subsequent RLS policies and application queries inspect `members.role`. Maintaining both a direct column and a separate RBAC table creates schema bloat and conflicting sources of truth for an application that only requires a single role per member.

### Finding 3: Premature ERP Ledger Reconciliation (`payment_dues_reconciliation`)
* **Affected Scope:** Section 3 (lines 230–237), CUJ 3 (line 59), CUJ 4 (line 64).
* **Rationale:** The design specifies an n-to-m dues allocation table with partial amounts (`allocated_amount NUMERIC`). MRIA welfare dues are fixed recurring sums (500 LKR/month) and fixed admission fees. Payments map 1:1 to either a monthly due or an admission fee. Introducing a partial-allocation reconciliation table adds substantial ledger complexity, trigger overhead, and transactional race conditions that are completely unnecessary for a simple welfare association dues ledger. A direct `due_id` reference on `payments` or a status flag on `member_dues` fulfills 100% of the requirements.

### Finding 4: Redundant Serverless Function Layer for Database Cron
* **Affected Scope:** Section 1 (lines 91–93), Section 5 (lines 347–370), Implementation Plan (lines 492–495).
* **Rationale:** The technical plan proposes deploying a Deno TypeScript Edge Function (`monthly-dues-cron`) to run on the 1st of each month to call the database stored procedure `generate_monthly_dues_for_period()`. Supabase provides the PostgreSQL extension `pg_cron` natively. A single in-database schedule (`cron.schedule('0 0 1 * *', 'SELECT generate_monthly_dues_for_period(CURRENT_DATE)')`) executes directly within Postgres without external network hops, cold starts, JWT management, or maintaining an extra serverless function.

### Finding 5: Hardcoding PII & Personal Credentials into Database Migrations
* **Affected Scope:** Section 5 (lines 318, 332–336), Section 6 (line 386), Implementation Plan (lines 479, 482).
* **Rationale:** The trigger `handle_auth_user_created` and the Edge Function specs hardcode personal credentials (`krishaja@gmail.com` and `0759555924`) directly into SQL DDL logic. Hardcoding production email addresses into immutable database trigger scripts creates brittle migrations, breaks local testing and staging environments, and introduces security and coupling hazards. Initial administrator seeding should be managed via `.env` or dedicated seed data (`supabase/seed.sql`), never embedded into core function definitions.

### Finding 6: Speculative Benefits Engine Amidst Unresolved Requirements
* **Affected Scope:** Section 3 (lines 240–265), Open Questions (lines 41–43).
* **Rationale:** Open Question 2 notes that the claim payout approval process remains undecided (treasurer manual transfer vs. formal multi-party approval). Despite this core requirement being unresolved, the design introduces a full-blown multi-type claims subsystem (`benefit_types`, `benefit_claims`) with a 5-state lifecycle (`submitted`, `under_review`, `approved`, `rejected`, `disbursed`), even though the only active benefit is bereavement welfare aid (`DEATH_AID`). Designing abstract schema for undetermined business rules violates YAGNI; start with a minimal bereavement claim structure and expand once the process is formalized.

---

## 3. Nit

### Finding 7: Altitude Drops: Verbatim DDL, PL/pgSQL Code, and Micro-Typography Specs
* **Affected Scope:** Section 3 (lines 169–288), Section 5 (lines 310–370), Section 7 (lines 388–408).
* **Rationale:** Over 180 lines of verbatim SQL DDL and PL/pgSQL procedural code belong in database migrations rather than an architectural overview. Concrete mathematical styling calculations down to fractional pixel values belong in Tailwind configuration or CSS rather than architectural specifications.

### Finding 8: Over-Complicated Defaulter Transition Mechanics
* **Affected Scope:** CUJ 5 (lines 66–70), Alternative 3 (lines 426–432), Section 5.
* **Rationale:** The document treats defaulter classification as an active system transition triggered at `23:59:59` on the final day of each month. In practice, "defaulter" is not an altered database record—it is simply a read-time condition (`status = 'pending' AND billing_month < date_trunc('month', CURRENT_DATE)`). Using a standard SQL view (`v_defaulters`) eliminates all state synchronization, midnight cron jobs, and calendar parsing edge cases entirely.
