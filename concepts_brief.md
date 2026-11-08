# MRIA Management Welfare Association PWA (Comprehensive Redesign & Architectural Overhaul)

* **Author:** kiyamaninfo-alt
* **Date:** 2026-11-08

## Overview

The MRIA Management Welfare Association ("MRIA කළමනාකාර සුබසාධක සංගමය") Progressive Web Application is an enterprise-grade, offline-capable member self-service, treasury accounting, and statutory governance platform. Built using Vanilla HTML5, Vanilla ES6 JavaScript modules, Tailwind CSS, Supabase (PostgreSQL 17), and Cloudflare R2 object storage, this overhaul re-architects the system across six foundational pillars: statutory identity & contact CMS, strict single-language localization, universal PWA installation, granular 6-tier Role-Based Access Control (RBAC), interactive member ledger & claims dispatch, and an immutable audit trail with an asset-segregated treasury ledger and export engine.

## Analysis

### 1. Identity, Copywriting & Contact CMS
* **Official Nomenclature:** Standardized strictly to "MRIA කළමනාකාර සුබසාධක සංගමය" (Sinhala) and "MRIA Management Welfare Association" (English).
* **Hero Branding:** Tagline "Digital Platform - MRIA Management Welfare Association" with sub-headline "100% DEDICATED STAFF WELFARE".
* **Removal of Restrictive & Raw Contact Artifacts:** Eliminates legacy text ("Verified Airport Management Domain Only") and removes raw phone numbers from all public views.
* **Interactive Contact Administration:** Administrative contact actions route to `krishaja@gmail.com` via an interactive modal form that collects member inquiries and routes them directly to association administrators.
* **Voucher Integrity:** Removes legacy SMS references from digital vouchers in favor of: "Instant downloadable PDF vouchers with official verification seals for every contribution and emergency grant transaction."
* **Global Footer:** Strictly unified across all layouts to "© MRIA කළමනාකාර සුබසාධක සංගමය".

### 2. Strict Single-Language i18n Engine
* **Zero Mixed-Language Invariant:** When Sinhala is active, 100% of interface text, labels, statuses, table headers, and modal text must render in Sinhala (allowing only standard technical loanwords such as "Download / භාගත කරන්න"). When English is active, 100% renders in English.
* **Reactive DOM Engine:** A dictionary-backed reactive localization engine swaps DOM elements instantly via `data-i18n` attributes without page reload, maintaining synchronization with dynamic API responses.
* **Typographic Invariant:** HTML root class `.lang-si` applies relaxed line heights (`leading-relaxed`) and balanced scaling for Sinhala text, preventing table header wrapping or vertical clipping.
* **Bilingual CMS Content:** Static CMS documents (Constitution, Privacy Policy, Terms) and dynamic entity schemas (Announcements, Benefit Types) enforce paired language fields (`_en` and `_si`) to guarantee complete linguistic isolation.

### 3. True Multi-Platform PWA Installation
* **Cross-Platform Manifest & Lifecycle:** Upgraded `manifest.json` featuring comprehensive icon densities, splash configurations, display overrides (`standalone`), and platform-specific desktop/mobile shortcuts for Windows, Linux, Android, and iOS.
* **Custom Install Prompt:** In-app install banner with device-specific guidance (e.g., Safari iOS "Add to Home Screen" instructions vs. Chromium `beforeinstallprompt` event interception).
* **Cache Strategy (`sw.js` v3):** 
  - Cache-first strategy for immutable font webfonts (`fonts.gstatic.com`), Material Symbols, and official Bank QR media.
  - Network-first strategy for REST queries (`/rest/v1/*`), with an offline cache fallback for dues history.

### 4. Granular RBAC & Administrative Governance CMS
* **6-Tier Role Matrix:**
  1. `admin`: Full system control, role assignment, system settings, and bank details/BOC QR configuration.
  2. `manager`: Operations oversight, member review, and slip review.
  3. `secretary` (ලේකම්): Dedicated member profile administration (CRUD on Full Name, EPF Number, Designation, Contact).
  4. `treasurer` (භාණ්ඩාගාරික): Financial operations, slip verification, direct cash collection, and treasury fund accounting.
  5. `committee_member`: Governance review, benefit claim voting/visibility, and claim notification reception.
  6. `member`: Standard authenticated staff member (self-service profile, ledger history, claim submission).
* **Backward-Compatible Enum Migration:**
  - `ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'secretary';`
  - `ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'committee_member';`
  - Existing `'official'` records migrate cleanly to `'committee_member'` or `'secretary'` before deprecation.
* **Hybrid EPF & Designation Onboarding:**
  - *Pre-Seeding:* Secretary pre-populates the airport staff roster with Full Name, EPF Number, Designation, and Email.
  - *Self-Service Registration Request:* Unrecognized Google OAuth sign-ins are routed to an interactive registration modal on `unauthorized.html` where users input their EPF Number, Designation, and Phone for Secretary approval.
* **Statutory Governance CMS:** In-app management for:
  - Editable Constitution: Dual-slot CMS managing `constitution_si.pdf` and `constitution_en.pdf` in Cloudflare R2 with versioned keys (e.g., `constitutions/constitution_si_v202611.pdf`), confirmation dialogs, and language-aware download triggers.
  - Privacy Policy and Security Terms stored in a dedicated `cms_documents` table with bilingual content.
  - Official Bank account details and BOC QR code image asset management.
* **View Filtering:** Strict UI filtering ensuring users only see navigation elements and modules permitted by their assigned role.

### 5. Member Self-Service, Notifications & Interactive Ledger
* **Member Identity Header:** Displays verified Full Name, EPF Number, and Airport Designation (`Full Name (EPF: [epf_number]) • [designation]`) directly in the application header.
* **Dismissible Notification Center:** Displays top 3 actionable alerts (e.g., pending monthly dues cutoff, claim status updates, official announcements) with dismissed IDs persisted in `localStorage` under `mria_dismissed_announcements`.
* **Interactive Dues Breakdown:**
  - Outstanding Dues Card: Clicking opens an interactive modal listing historical monthly ledger entries categorized into settled vs. pending months.
  - Current Month Due Card: Dynamically displays current billing period status, last payment settlement date, and transaction amount.
* **Welfare Claims & Automated Committee Notification:**
  - Claims card displaying lifetime disbursed grants, pending claim states, and last claim timestamp.
  - Secure Cloudflare R2 presigned slip upload for medical/bereavement proof documents.
  - Asynchronous automated email notification dispatch via Resend API gateway orchestrated through Supabase Edge Function `send-claim-notification`.
  - Claims strictly commit to the database even if email delivery encounters third-party latency or failures; failures are logged to the audit log.

### 6. Immutable Audit Trail & Treasury Fund Accounting
* **PostgreSQL Immutable Audit Log (`audit_logs`):**
  - Schema: `id`, `timestamp`, `user_email`, `full_name`, `epf_number`, `action`, `entity_type`, `entity_id`, `diff_json`.
  - Database-Level Invariant: PostgreSQL trigger strictly preventing `UPDATE` and `DELETE` on the `audit_logs` table (`BEFORE UPDATE OR DELETE -> RAISE EXCEPTION`).
  - Automated Table-Level Audit Triggers: Generated automatically via `SECURITY DEFINER` triggers on `members`, `payments`, `member_dues`, and `treasury_transactions`. Client-side direct inserts into `audit_logs` are blocked.
* **Treasury Transaction Ledger (`treasury_transactions`):**
  - Comprehensive double-entry ledger capturing all inflows, outflows, and internal asset transfers (excluding petty cash).
  - Schema: `id`, `transaction_date`, `transaction_type` (`inflow`, `outflow`, `transfer`), `source_account`, `destination_account`, `amount`, `reference_no`, `description`, `recorded_by`, `created_at`.
  - Constraint Invariants:
    - `inflow`: requires `destination_account` (e.g., `cash_in_hand` or `savings`).
    - `outflow`: requires `source_account` (e.g., `savings` for grant checks).
    - `transfer`: requires both `source_account` and `destination_account` with `source_account <> destination_account`.
* **Real-Time Asset Segregation:**
  - Tracks running balances across three segregated accounts:
    1. **Savings Account** (Bank of Ceylon main operating account)
    2. **Cash in Hand** (Physical cash received by Treasurer awaiting bank deposit)
    3. **Fixed Deposits** (Capital reserve accounts)
  - Calculated dynamically via real-time summary view `public.treasury_account_balances`.
* **Date-Filtered Export & Reporting Engine:**
  - Treasurer statement downloads filtered by:
    a. Monthly statement
    b. Yearly statement
    c. Custom date range (`start_date` to `end_date`)
  - Formats:
    - Clean RFC 4180 CSV export with ISO dates (`YYYY-MM-DD`) and fixed decimals (`0.00`).
    - Structured printable PDF statement via dedicated CSS-paged print view with official seal headers and Treasurer signature slot.

## Goals vs. Non-Goals

### In-Scope Goals
* Complete architectural overhaul of database schemas, RLS policies, and Edge Functions.
* Granular 6-role RBAC enforcement across Supabase and frontend views.
* EPF Number and Designation integration throughout member profiles, headers, and receipts.
* Strict single-language translation covering 100% of interface labels and dynamic entities.
* Immutable audit trigger preventing any modification or purging of audit records.
* Treasury transaction ledger with asset segregation (Savings, Cash in Hand, Fixed Deposits).
* Date-filtered CSV and PDF export engine for treasury statements.
* Dual-slot Constitution PDF CMS (`constitution_si.pdf`, `constitution_en.pdf`).
* Asynchronous Resend email dispatch Edge Function for new claim notifications with audit fallback.
* Hybrid member onboarding flow (Secretary pre-seeding + `unauthorized.html` request form).

### Out-of-Scope Non-Goals
* Integration with automated payment merchant gateways (credit/debit cards).
* Automated outbound SMS/telephony gateways.
* Automated integration with commercial bank core banking APIs (accounts remain verified via slips and cash entries).
* Direct petty cash daily tracking (tracked at withdrawal/replenishment batch levels).

## Alternatives Weighed

* **Synchronous vs. Asynchronous Claim Email Notifications:**
  * *Rejected Synchronous Block:* Blocking claim creation on third-party Resend API response introduces external latency and causes member transaction drops during email outages.
  * *Adopted Asynchronous Execution:* Claim record commits immediately to PostgreSQL; notification runs asynchronously via Edge Function, logging any delivery exception to `audit_logs`.
* **Manual Asset Revaluation vs. Transactional Asset Segregation:**
  * *Rejected Manual Revaluation:* Manual balance overrides lack line-item reconciliation, obscuring cash deposit delays or interest posting dates.
  * *Adopted Treasury Transaction Ledger:* All capital movements between Cash in Hand, Savings, and Fixed Deposits require explicit ledger entries, ensuring continuous mathematical balance integrity.
* **Single Bilingual Constitution vs. Dual-Slot CMS:**
  * *Rejected Single File:* Violates the strict single-language invariant by forcing users to view mixed English/Sinhala legal text.
  * *Adopted Dual-Slot CMS:* Dispatches `constitution_si.pdf` when in Sinhala mode and `constitution_en.pdf` when in English mode.
* **Strict Admin Seeding vs. Hybrid Member Onboarding:**
  * *Rejected Pure Pre-Seeding:* Forces members who change emails or new hires to wait for offline administrative coordination.
  * *Adopted Hybrid Onboarding:* Pre-seeding covers existing staff; unlisted members submit EPF and Designation via `unauthorized.html` for Secretary one-click verification.

## Key Decisions & Staging for Next Steps

1. **Database Migrations:** Create PostgreSQL schemas for `audit_logs`, `cms_documents`, `treasury_transactions`, `treasury_accounts`, updating `members` with `epf_number` and `designation`, and updating `roles` to 6-tier matrix.
2. **Edge Function `send-claim-notification`:** Configure Resend API gateway invocation on claim creation.
3. **Frontend Overhaul:** Update `index.html`, `dashboard.html`, `admin.html`, and `unauthorized.html` with new branding, strict i18n, EPF headers, interactive dues popup, dual-slot CMS, and Treasury reporting engine.
4. **Draft Formal Design Document:** Compile updated architectural specification in `docs/designs/mria_management_welfare_association_pwa.md`.
