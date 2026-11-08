# Stage 7 (Critic Review) Consolidated Report

**Target:** `/home/anjana/Documents/Software/MRIA Welfare Association /docs/designs/mria_management_welfare_association_pwa.md` (`Lines 1 to 412`)

## Reviewer Status

| Reviewer | Status |
| :--- | :--- |
| `egm-design` | completed |
| `egm-structural` | completed |
| `egm-style` | completed |

## Severity Breakdown
* 🔴 **Blockers**: 4
* 🟡 **Major**: 6
* 🟢 **Nits**: 5
* **Total Prioritized Findings**: 15

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Pre-Seeding Foreign Key Deadlock on `public.members.id` - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 175, 36, 55, 61–69, 395 (Section 2.B, Goals, CUJ 1, Alternative 4)
* **Discrepancy Description:** `public.members.id` is defined as `UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`. However, the architecture explicitly relies on "Secretary pre-seeding" of airport employees into `public.members` prior to their initial sign-in. Before an airport employee authenticates via Supabase Google OAuth for the first time, no `auth.users` record exists for them. Any administrative attempt to insert a pre-seeded member record will immediately fail with a foreign key violation (`violates foreign key constraint "members_id_fkey"`).
* **Rationale & Recommendation:** Decouple the primary identity record from `auth.users`. Define `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` with an optional, nullable `user_id UUID UNIQUE REFERENCES auth.users(id)`. When an unlisted or pre-seeded member authenticates via Google OAuth, dynamically bind their `user_id` by matching their verified Google OAuth email.

---

### 2. Non-Atomic PostgreSQL Migration Failure on Enum Value Usage (`app_role`) - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 161–171 (Section 2.A)
* **Discrepancy Description:** Migration `20261108000004_comprehensive_overhaul.sql` runs `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'committee_member';` and immediately issues `UPDATE public.members SET role = 'committee_member' WHERE role = 'official';` within the same script. In PostgreSQL, a new enum value added via `ALTER TYPE ... ADD VALUE` cannot be referenced or assigned in any subsequent DML statement within the same transaction block (`ERROR: unsafe use of new value "committee_member" of enum type public.app_role. Hint: New enum values must be committed before they can be used.`). Because Supabase executes migrations in transactional wrappers, this migration will fatally crash during deployment.
* **Rationale & Recommendation:** Split the enum modification and data migration across two distinct migration files (`20261108000004_add_app_roles.sql` and `20261108000005_migrate_member_roles.sql`), ensuring transactional isolation boundaries are respected.

---

### 3. Missing Column-Level Mutation Guard Against Self-Privilege Escalation on `public.members` - Severity: Blocker
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 291–295 (Section 3)
* **Discrepancy Description:** The RLS policy matrix assigns role `member` "Own Profile (R/W)" permissions on `public.members`. In PostgreSQL RLS, a standard row-level `UPDATE` policy (`USING (auth.uid() = id)`) grants mutation rights across all columns of that row. Without explicit column-level restrictions or a `BEFORE UPDATE` trigger, an authenticated member can issue a Supabase REST payload (`PATCH /rest/v1/members?id=eq.<uid>`) updating `role = 'admin'` and `is_approved = true`, completely bypassing role-based access controls and escalating their own administrative privileges.
* **Rationale & Recommendation:** Specify a PostgreSQL `BEFORE UPDATE` trigger function (`fn_protect_member_sensitive_columns()`) that raises an exception if a non-admin mutates `role`, `is_approved`, `epf_number`, or `designation`, or enforce PostgreSQL column-level privileges.

---

### 4. Incomplete Immutability Trigger Bypassed by `TRUNCATE` - Severity: Blocker
* **Reviewer Lens:** `egm-design` / `egm-structural`
* **Affected Scope:** Lines 203–214 (Section 2.C)
* **Discrepancy Description:** Section 2.C defines the core invariant: "Strictly prevent modification or truncation". However, the trigger `trg_audit_logs_immutable` is attached only as `BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW`. In PostgreSQL, a `FOR EACH ROW` update/delete trigger does NOT fire on `TRUNCATE`. Any privileged database role, compromised backend service, or direct SQL execution can run `TRUNCATE public.audit_logs`, completely obliterating the forensic audit trail without triggering the exception.
* **Rationale & Recommendation:** Attach a statement-level truncate trigger to the table:
  ```sql
  CREATE TRIGGER trg_audit_logs_prevent_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_prevent_audit_tampering();
  ```

---

### 5. Missing Relational Integrity & Traceability Between Treasury Ledger, Payments, and Claims - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 237–253, 81–89 (Section 2.D, CUJ 3)
* **Discrepancy Description:** The `treasury_transactions` table relies solely on an unindexed, unconstrained `reference_no VARCHAR(100)` to record inflows and outflows. There are no relational foreign key links to `public.payments(id)` (for member dues collected in cash or bank transfer) or to `public.benefit_claims(id)` (for welfare disbursements). If a dues payment is disputed or a welfare disbursement is audited, there is no foreign-key-backed relational integrity connecting the treasury movement back to the underlying statutory payment or claim record.
* **Rationale & Recommendation:** Add optional foreign key columns `payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL` and `claim_id UUID REFERENCES public.benefit_claims(id) ON DELETE SET NULL` to `treasury_transactions`, along with an explicit database index on `reference_no`.

---

### 6. Missing Schema Definition for `benefit_claims` and Claim Approval Workflow - Severity: Major
* **Reviewer Lens:** `egm-structural` / `egm-design`
* **Affected Scope:** Lines 71–80, 298 (CUJ 2, Section 3)
* **Discrepancy Description:** CUJ 2 and Section 3 describe member claim submissions, committee voting ("Read / Vote"), manager review ("Review / Approve"), and treasurer disbursement ("Read / Disburse") on `benefit_claims`. However, Section 2 (Database Schema & Data Models) completely omits the table definition for `public.benefit_claims` and fails to specify how votes, approval thresholds, disbursement states, and receipt attachments are modeled and persisted.
* **Rationale & Recommendation:** Expand Section 2 to include the complete schema for `public.benefit_claims` (including status enums, amounts, disbursement tracking, and voting/approval sub-tables or columns) to ensure architectural completeness and alignment with the RLS matrix.

---

### 7. Schema vs. RLS Policy Mismatch on `public.cms_documents` ("Read Published") - Severity: Major
* **Reviewer Lens:** `egm-structural` / `egm-design`
* **Affected Scope:** Lines 273–286, 301 (Section 2.E, Section 3)
* **Discrepancy Description:** The RLS Matrix states that `member`, `committee_member`, and `treasurer` have "Read Published" access to `public.cms_documents`. However, the schema definition for `public.cms_documents` contains no `is_published`, `status`, or `published_at` column. An RLS policy filtering for "Published" documents cannot be compiled against the documented schema.
* **Rationale & Recommendation:** Add `is_published BOOLEAN NOT NULL DEFAULT TRUE` to the `public.cms_documents` schema in Section 2.E.

---

### 8. Unauthenticated / Unrestricted Edge Function Invocation Vulnerability (`send-claim-notification`) - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 305–313 (Section 4)
* **Discrepancy Description:** Section 4 specifies that the frontend sends a `POST` request with `{ claim_id }` to `/functions/v1/send-claim-notification`. It specifies no JWT verification, caller validation, or rate limiting. An unauthenticated external actor could invoke this endpoint in an automated loop with arbitrary claim IDs, triggering email spam floods to all executive committee members, exhausting Resend API rate limits, or incurring service denial.
* **Rationale & Recommendation:** Explicitly specify that `send-claim-notification` validates the Supabase Auth Bearer token, checks that the caller's `auth.uid()` matches the submitter of `claim_id` (or holds an executive role), and rejects unauthenticated or unauthorized invocations with HTTP 401/403.

---

### 9. Missing Cloudflare R2 Token / Presigned URL Generation Endpoint - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 133–136, 150, 316–338 (Section 1, Section 5)
* **Discrepancy Description:** The architecture diagram depicts the client accessing private Cloudflare R2 storage buckets via "S3 Presigned URLs". However, neither Section 4 nor Section 5 defines any backend Edge Function or secure API endpoint that signs and issues these presigned URLs. Client-side Vanilla JS cannot hold private Cloudflare R2 API keys without severe credential compromise.
* **Rationale & Recommendation:** Add a dedicated Edge Function (`get-storage-url`) or Supabase Storage wrapper that authenticates members and generates short-lived presigned GET/PUT URLs for transfer slips and Constitution PDFs.

---

### 10. Account ID Discrepancy in CUJ 3 vs. Schema Seeding (`savings` vs `boc_savings`) - Severity: Major
* **Reviewer Lens:** `egm-structural` / `egm-style`
* **Affected Scope:** Lines 89, 232 (CUJ 3, Section 2.D)
* **Discrepancy Description:** CUJ 3 specifies recording a transfer transaction with `destination_account = 'savings'`. However, Section 2.D explicitly seeds the primary operational account with `id = 'boc_savings'`. Attempting to insert a transaction with `destination_account = 'savings'` will immediately fail foreign key validation against `public.treasury_accounts(id)`.
* **Rationale & Recommendation:** Correct the reference in CUJ 3 (line 89) from `destination_account = 'savings'` to `destination_account = 'boc_savings'`.

---

### 11. Institutional Routing vs. Personal Gmail Address - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 20, 444, 452 (The Problem, File Manifest)
* **Discrepancy Description:** Problem 1 criticizes exposing private executive contacts and calls for "institutional routing channels". However, the technical implementation binds the institutional contact email to `krishaja@gmail.com`, which is a personal commercial Gmail account rather than an official association or airport mailbox (e.g., `welfare@mria.aero`).
* **Rationale & Recommendation:** Clarify that `krishaja@gmail.com` serves as the initial liaison administrator while official institutional mail routing is provisioned.

---

### 12. PostgreSQL RLS "Read Summary" Column-Filtering Imprecision - Severity: Nit
* **Reviewer Lens:** `egm-design` / `egm-structural`
* **Affected Scope:** Lines 299–301 (Section 3)
* **Discrepancy Description:** In the RLS matrix, `committee_member` and `secretary` are granted "Read Summary" access on `treasury_transactions`. Standard PostgreSQL Row Level Security filters rows, not columns or aggregations.
* **Rationale & Recommendation:** Clarify that summary access is granted via the `public.treasury_account_balances` view with `SECURITY DEFINER` privileges, while direct table-level `SELECT` on `treasury_transactions` is restricted to treasurer and admin roles.

---

### 13. Unspecified Migration Backfill Strategy for NOT NULL Columns on Existing Members - Severity: Nit
* **Reviewer Lens:** `egm-design` / `egm-structural`
* **Affected Scope:** Lines 178–179 (Section 2.B)
* **Discrepancy Description:** Adding `epf_number VARCHAR(50) UNIQUE NOT NULL` and `designation VARCHAR(150) NOT NULL` to `public.members` will fail on an existing non-empty table unless a default value or multi-step migration (add nullable -> backfill -> set not null) is specified.
* **Rationale & Recommendation:** Specify a phased DDL migration strategy: add columns as nullable, run a backfill or prompt for legacy members, then apply `SET NOT NULL` and `ADD CONSTRAINT UNIQUE`.

---

### 14. Service Worker Fallback Reference to Client-Side LocalStorage Name - Severity: Nit
* **Reviewer Lens:** `egm-style` / `egm-design`
* **Affected Scope:** Line 329 (Section 5.B)
* **Discrepancy Description:** Section 5.B states that `sw.js` falls back to `mria_cached_member`. Service workers have no access to DOM `localStorage`.
* **Rationale & Recommendation:** Clarify that the Service Worker falls back to cached responses in the Cache Storage API (`v3-runtime-cache`), not `window.localStorage`.

---

### 15. Missing Problem Statement for PWA Multi-Platform Deficiencies - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 15–31, 42 (The Problem, Goals)
* **Discrepancy Description:** Goal 9 and Section 5.B prioritize "True Multi-Platform PWA" installation shortcuts and caching, but "The Problem" section omits any mention of existing PWA installability, caching, or mobile shortcut deficiencies.
* **Rationale & Recommendation:** Add a concise entry in "The Problem" section noting that the prototype lacks desktop/mobile installation shortcuts and offline asset caching for critical media.
