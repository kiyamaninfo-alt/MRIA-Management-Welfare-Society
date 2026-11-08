# Stage 5 Review Report: Initial Zoom Out & Skeptical Architecture Audit

* **Target Document:** `/docs/designs/mria_management_welfare_association_pwa.md` (Lines 1 to 502)
* **Auditor:** Skeptical Architect (Zoom Out Goldfish)
* **Focus Areas:** High-altitude simplicity, minimalism, YAGNI, statutory & financial risk, and codebase reuse.

---

### Executive Architectural Summary

The design document presents a well-structured vision for elevating the MRIA Welfare Association PWA into a formal, statutory platform. It correctly identifies the core real-world pain points: linguistic contamination, public leakage of private executive numbers, absence of airport roster credentials (EPF/Designation), and unsegregated treasury tracking.

However, from a **high-altitude architectural and statutory risk** perspective, the proposal introduces several severe flaws:
1. **Critical Privilege Escalation Vector**: Regular members are granted unrestricted write access on their own profiles, enabling trivial self-promotion to `admin`.
2. **Breaking Schema Regression**: Redefining `members.id` as `REFERENCES auth.users(id)` breaks the existing database schema, destroys member pre-seeding, and invalidates all existing foreign keys.
3. **Dual-Bookkeeping Disconnection**: Treasury transactions are modeled as a parallel, disconnected ledger without database-enforced atomicity with member dues payments and welfare disbursements.
4. **YAGNI Over-Engineering**: Building a custom relational CMS (`cms_documents`) with private Cloudflare R2 presigned URLs to host two static Constitution PDFs that change once every few years at an AGM.
5. **Operational Deadlocks**: Background cron jobs (pg_cron monthly dues) will crash due to strict `NOT NULL user_email` audit trigger constraints, and client-side notification triggers remain vulnerable to tarmac network drops.

Below is the detailed findings report with actionable recommendations.

---

### Detailed Findings

#### 1. Privilege Escalation Risk on Member Profiles (Statutory & Security Vulnerability)
* **Severity:** **Blocker**
* **Affected Scope:** Section 3: *Granular Row Level Security (RLS) Policy Matrix* (Line 295)
* **Simplicity Rationale & Risk:**
  The RLS matrix grants the `member` role **"Own Profile (R/W)"** on `public.members`. In PostgreSQL RLS, a standard `FOR UPDATE USING (auth.uid() = user_id)` policy allows the authenticated user to update *any* column in their row unless explicitly restricted. A standard member could open browser DevTools and execute:
  ```javascript
  await supabase.from('members').update({ role: 'admin', is_approved: true }).eq('user_id', user.id);
  ```
  This immediately elevates the user to Administrator, completely bypassing Secretary verification and allowing unauthorized treasury and member ledger mutations.
* **Recommendation:**
  Never grant open `UPDATE` permissions on `public.members` to `member`. Either:
  1. Restrict member self-updates strictly to safe contact attributes (`phone`, `address`) via a dedicated PostgreSQL trigger that raises an exception if `role`, `is_approved`, or `epf_number` change; or
  2. Channel profile modifications through a secure RPC function (`SECURITY DEFINER`).

---

#### 2. Schema Regression Breaking Member Pre-Seeding (Architectural Dead-End)
* **Severity:** **Blocker**
* **Affected Scope:** Section 2.B: *Member Profiles Schema (`public.members`)* (Line 175)
* **Simplicity Rationale & Risk:**
  Line 175 specifies:
  ```sql
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  ```
  In the existing database (`20261108000001_initial_schema.sql`), `public.members.id` is an independent UUID (`DEFAULT gen_random_uuid()`), and `user_id` is a nullable foreign key (`REFERENCES auth.users(id)`). The entire pre-seeding workflow (CUJ 1 & Goal 3) depends on the Secretary creating member records *before* employees log in via Google OAuth. When an employee subsequently signs in, trigger `on_auth_user_created` links `user_id = NEW.id` based on email match.
  
  If `members.id` is changed to reference `auth.users(id)`:
  - The Secretary **cannot pre-seed** any employee who has not already signed in.
  - All existing foreign keys across `payments.member_id`, `member_dues.member_id`, `benefit_claims.member_id`, and `announcements.created_by` reference `members.id` and would be broken.
* **Recommendation:**
  Preserve the proven existing pattern:
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL
  ```
  Do not alter `id` to reference `auth.users(id)`.

---

#### 3. Disconnected Treasury Ledger & Dual-Bookkeeping Desynchronization
* **Severity:** **Blocker**
* **Affected Scope:** Section 2.D (Lines 237–270), CUJ 3 (Lines 81–90), and Manifest (Lines 446, 458)
* **Simplicity Rationale & Risk:**
  The design labels `treasury_transactions` as a "full double-entry transaction ledger". In reality:
  - It is a single-entry table with transfer pairings (`source_account_id` / `destination_account_id`).
  - **It is completely decoupled from `public.payments` and `public.benefit_claims`.**
  
  In CUJ 3, when cash is collected, the design expects the client-side JavaScript to perform dual writes: first to `payments`, then to `treasury_transactions`. If the network fails between these two calls, the member dues ledger will record a payment, but the Treasury balance will not reflect the cash. Worse, when the Treasurer verifies a bank transfer slip (`verifyPayment`), the design specifies no automated entry into `treasury_transactions`. As a result, the Bank of Ceylon operating savings balance in `treasury_account_balances` will never match the actual bank account.
* **Recommendation:**
  Ensure transactional atomicity and eliminate dual bookkeeping:
  1. Add a PostgreSQL database trigger on `public.payments` (`AFTER UPDATE OF status` to `'verified'`) that automatically inserts an `'inflow'` transaction into `treasury_transactions` (allocating to `'cash_in_hand'` if `payment_method = 'cash'`, or `'boc_savings'` if `payment_method = 'bank_transfer'`).
  2. Automatically generate an `'outflow'` transaction when a welfare claim is disbursed.
  3. Never rely on the client UI to execute uncoordinated multi-table accounting writes.

---

#### 4. Migration Failure on Live Admin Record (`epf_number UNIQUE NOT NULL`)
* **Severity:** **Major**
* **Affected Scope:** Section 2.B: *Member Profiles Schema* (Lines 178–179)
* **Simplicity Rationale & Risk:**
  The design proposes adding `epf_number VARCHAR(50) UNIQUE NOT NULL` and `designation VARCHAR(150) NOT NULL`.
  
  Database inspection confirms that the root administrator (`krishaja@gmail.com`) is already present in `public.members` with `NULL` for both columns. Running `ALTER TABLE public.members ADD COLUMN epf_number VARCHAR(50) UNIQUE NOT NULL` will immediately crash the migration with:
  `ERROR: column "epf_number" of relation "members" contains null values`.
  
  Furthermore, strictly enforcing `NOT NULL` on `epf_number` prevents the Secretary from pre-seeding member records when an employee's official EPF index is temporarily unavailable, and locks out honorary or non-AASL administrative staff.
* **Recommendation:**
  1. Add the columns as nullable initially: `ALTER TABLE public.members ADD COLUMN epf_number VARCHAR(50) UNIQUE, ADD COLUMN designation VARCHAR(150);`.
  2. Backfill existing admin/system accounts with a reserved identifier (e.g., `EPF-ADMIN-001`).
  3. Require `epf_number` and `designation` for standard member approval, rather than enforcing a blanket database-level `NOT NULL` constraint that breaks migrations and pre-seeding.

---

#### 5. YAGNI Over-Engineering: "Statutory Governance CMS" & Private R2 Storage
* **Severity:** **Major**
* **Affected Scope:** Section 2.E (Lines 273–286), Goals (Line 41), Manifest (Lines 442, 458)
* **Simplicity Rationale & Risk:**
  The association constitution is a formal statutory charter amended solely at an Annual General Meeting (AGM) or Extraordinary General Meeting (EGM) via a two-thirds majority vote. It does not change on a weekly or monthly basis.
  
  Building:
  - A database table (`public.cms_documents`) with Markdown bodies, bilingual slugs, and version fields,
  - Cloudflare R2 bucket configurations,
  - Presigned URL generation Edge Functions, and
  - An administrative upload console tab,
  
  just to serve two static documents (`constitution_si.pdf` and `constitution_en.pdf`) is extreme YAGNI over-engineering. Furthermore, the design specifies that Constitution files live in a *private* R2 bucket, but fails to define any Edge Function for signing member download requests, creating an architectural dead-end.
* **Recommendation:**
  Radically simplify:
  - Store `constitution_si.pdf` and `constitution_en.pdf` as static files in the PWA repository (`/assets/docs/`) or in a public Supabase Storage bucket (`mria-documents`).
  - Eliminate the `cms_documents` table and avoid building a custom mini-CMS. When the constitution is amended at an AGM, the Secretary or admin can update the static file or upload it directly to the public bucket.

---

#### 6. Fragile Notification Pipeline & Resend Domain Verification Dependency
* **Severity:** **Major**
* **Affected Scope:** Section 4: *Asynchronous Claim Notification Edge Function* (Lines 306–313), CUJ 2 (Lines 71–80)
* **Simplicity Rationale & Risk:**
  1. **Client-Side Triggering**: The design dictates that the frontend browser fires an asynchronous `fetch('/functions/v1/send-claim-notification')` after committing the claim. On airport tarmac connections or spotty mobile data, if the user submits a claim and immediately locks their phone or navigates away, the browser cancels outstanding fetch requests unless `keepalive: true` is set.
  2. **Resend Domain Verification**: Resend enforces strict anti-spam controls. An unverified Resend account can **only** deliver emails to the account owner's single registered email address. Dispatching notifications to committee members' personal or airport emails (`@airport.lk`, `@gmail.com`) strictly requires a verified custom domain with DNS DKIM/SPF records. The design fails to state this prerequisite or provide a graceful fallback.
* **Recommendation:**
  1. Decouple notification dispatch from the client: Use Supabase Database Webhooks on `INSERT ON public.benefit_claims` to trigger the Edge Function automatically on the server side.
  2. Document the verified domain requirement for Resend. As an immediate zero-dependency fallback, populate an in-app administrative notification banner for committee members so claim alerts never depend solely on external SMTP deliverability.

---

#### 7. Audit Log Trigger Blocking pg_cron Monthly Dues Generation
* **Severity:** **Major**
* **Affected Scope:** Section 2.C: *Immutable Audit Trail Schema* (Line 194) & Migration 3 (`generate_monthly_dues_for_period`)
* **Simplicity Rationale & Risk:**
  Table `audit_logs` defines:
  ```sql
  user_email VARCHAR(255) NOT NULL
  ```
  The scheduled pg_cron routine `generate_monthly_dues_for_period()` runs on the 1st of every month directly in PostgreSQL. During pg_cron execution, `auth.uid()` and session JWT claims are `NULL`.
  
  If the automated table-level audit trigger attaches to `public.member_dues` and attempts to capture inserts, it will fail to resolve `user_email`. Because `user_email` is `NOT NULL`, PostgreSQL will throw a constraint violation exception, **causing the monthly dues generation cron job to abort and roll back for all members**.
* **Recommendation:**
  1. Alter `user_email` in `audit_logs` to allow `NULL` or provide a default fallback:
     ```sql
     user_email VARCHAR(255) NOT NULL DEFAULT 'SYSTEM'
     ```
  2. In the audit trigger function, safely resolve the actor:
     ```sql
     COALESCE(auth.jwt() ->> 'email', 'SYSTEM')
     ```

---

#### 8. Speculative RBAC Actions ("Read / Vote" on Benefit Claims)
* **Severity:** **Nit**
* **Affected Scope:** Section 3: *RLS Policy Matrix* (Line 298)
* **Simplicity Rationale & Risk:**
  The RLS matrix specifies `committee_member`: `Read / Vote` for `benefit_claims`. However, nowhere in the database schema, data models, or file manifest is there a table or column for tracking committee member votes (e.g. `claim_votes`). Specifying permissions for an imaginary voting mechanism violates YAGNI and creates confusion during implementation.
* **Recommendation:**
  Simplify the committee role to `Read Only` for `benefit_claims` until a formal multi-signature voting workflow is actually scoped and architected.

---

### Verification & Codebase Reuse Matrix

| Proposed Feature | Existing Codebase Asset | Skeptical Architect Recommendation |
| :--- | :--- | :--- |
| **Bilingual Localization** | `js/i18n.js` (complete `en`/`si` dictionary already implemented) | **Reuse 100%**: Simply expand the dictionary keys and toggle `.lang-si` on `<body>`. Do not introduce new localization libraries. |
| **Member Verification & Roles** | `js/api.js` (`updateMemberRole`, `createMember`), `js/auth.js` | **Reuse & Extend**: Add `epf_number` and `designation` parameters to existing functions. |
| **Constitution Storage** | Static `/assets/` directory or Supabase Storage | **Reuse Existing Storage**: Replace the complex private R2 + CMS table proposal with a simple static or public asset download. |
| **Audit Logs** | PostgreSQL Trigger on mutations | **Refine**: Ensure actor resolution defaults to `'SYSTEM'` so background pg_cron routines do not crash. |
| **Treasury Accounting** | `payments` + `payment_dues_reconciliation` | **Integrate via Triggers**: Automatically sync verified payments into treasury balances instead of dual-writing from the client. |

---

### Conclusion & Stage 5 Sign-Off Recommendation

The design is **fundamentally sound in its objectives**, but contains **3 Blocker issues** (Member RLS privilege escalation, schema PK regression, and disconnected treasury dual-bookkeeping) and **4 Major operational/YAGNI risks** (migration null errors, CMS over-engineering, fragile client-side notifications, and pg_cron audit deadlocks).

**Recommendation**: Require these architectural corrections in the design document before proceeding to detailed implementation.
