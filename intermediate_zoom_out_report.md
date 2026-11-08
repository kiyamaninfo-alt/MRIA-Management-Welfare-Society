# Intermediate Zoom-Out Architectural Review Report (Stage 8)

**Target:** `docs/designs/mria_management_welfare_association_pwa.md` (Lines 1..582)  
**Standard:** Zoom-Out Standard (`resources/document_standards/zoom-out-standard.md`)  
**Reviewer:** `egm-zoom-out` (Skeptical Architect)

---

## 1. High-Altitude Architectural Assessment

Re-evaluating the complete specification following the Comprehension, Critic, and Implementation Readiness audits confirms that the design has solid foundations for community requirements, but carries three major structural liabilities that must be pruned before implementation:

### 1.1 The Multi-Cloud Fallacy (Cloudflare R2 Egress Justification)
The decision to introduce Cloudflare R2 alongside Supabase was driven by an assumption of avoiding egress fees. However, this decision introduces:
1. Two custom serverless Edge Functions (`upload-slip`, `get-slip-url`).
2. S3 SDK presigning dependencies (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
3. External API keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`).
4. Cross-cloud failure modes (ghost uploads in R2 unlinked to database rows, slip spoofing).

**Zoom-Out Directive:** For an association of several hundred members uploading one slip per month (~500 images/month = ~250 MB/month), Supabase Native Storage handles private buckets, RLS, and 15-minute signed URLs in zero additional lines of code and well within free tier limits. Sticking to single-cloud Supabase storage eliminates 50% of the project's external moving parts.

### 1.2 Over-Engineered Ledger Junctions vs. Simple Monthly Records
The junction table `payment_dues_reconciliation` with partial amount allocations (`allocated_amount NUMERIC`) attempts to model complex double-entry multi-invoice accounting. In a voluntary welfare society with fixed 500 LKR monthly contributions:
* Payments map directly to a `billing_month` or `admission_fee`.
* Adding a `due_id UUID REFERENCES member_dues(id)` or `reconciled_due_ids UUID[]` directly on `payments` completely eliminates the junction table and its complex missing trigger logic.

### 1.3 State Synchronization vs. Dynamic Read Views (Defaulters)
Treating "defaulter" as an active system transition triggered at midnight introduces midnight cron jobs, date parsing traps, and timezone skew (UTC vs. UTC+05:30).
* A member with `status = 'pending'` on a past billing month is naturally overdue.
* Replacing the state-machine concept with a standard PostgreSQL view (`CREATE VIEW v_defaulters AS SELECT ... WHERE status = 'pending' AND billing_month < date_trunc('month', TIMEZONE('Asia/Colombo', now()))`) eliminates the entire synchronization mechanism, leap-year edge cases, and cron dependency.

---

## 2. Summary Verdict for Implementation
The document can proceed to implementation once the multi-cloud overhead is pruned, the reconciliation logic is clarified, and RLS recursion is resolved.
