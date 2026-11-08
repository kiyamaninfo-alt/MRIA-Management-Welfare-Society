## Feature Range Paraphrase
The Mattala Rajapaksa International Airport (MRIA) Management Welfare Association Progressive Web Application (PWA) is being overhauled to replace an informal digital prototype with a formal, auditable, and offline-capable self-service platform for airport staff. The system exists to eliminate governance risks, mixed-language clutter, exposure of private executive contacts, and unsegregated treasury accounting. It introduces strict single-language localization (Sinhala and English), a 6-tier Role-Based Access Control (RBAC) matrix, statutory airport employee identification, asynchronous email alerts for welfare aid claims via Resend, an immutable PostgreSQL audit trail, a 3-account segregated treasury ledger with CSV/PDF reporting, and a dual-slot bilingual constitution document repository.

## Detailed Implementation Range Paraphrase
The overhaul is executed across six sequential phases utilizing vanilla HTML5/ES6 JavaScript modules, Tailwind CSS, Supabase (PostgreSQL 17), a Deno TypeScript Edge Function, and Cloudflare R2 private object storage. Phase 1 runs a comprehensive database migration to update role enums, augment the member schema, create immutable audit triggers, establish treasury transaction tables, and enforce Row Level Security (RLS) policies. Phase 2 deploys the asynchronous `send-claim-notification` Edge Function integrating with the Resend API, while Phase 3 updates core client modules for i18n dictionary switching, API coordination, service worker caching (Cache-First for fonts/QR media), and statement exports. Phases 4 through 6 implement the user-facing views—adding self-service onboarding to the unauthorized landing page, dues breakdowns and claim submissions to the member dashboard, and role-gated management consoles for the Secretary and Treasurer on the administrative portal.

## Comprehension Findings & Ambiguities

### 1. Cloudflare R2 Presigned URL Generation Architecture
* **Severity**: Blocker
* **Affected Scope**: Technical Plan Sections 1 & 2.E (Lines 133–136, 150, 281–282); Detailed Implementation Manifest & Steps (Lines 422, 440–459, 472–476, 502)
* **Discrepancy Description & Rationale**: The document establishes that transfer slips and bilingual constitution files (`constitution_si.pdf` / `constitution_en.pdf`) reside in a "Private S3 Bucket" on Cloudflare R2 and access occurs via "S3 Presigned URLs" (Line 150). However, the implementation manifest and execution steps define only one backend Edge Function (`send-claim-notification`). There is no Edge Function, backend microservice, or Supabase Storage gateway specified to generate S3 presigned upload or download URLs. Because private Cloudflare R2 credentials (access key ID and secret) cannot be stored in client-side JavaScript (`js/page-admin.js` or `js/api.js`), a developer has no architectural mechanism to securely upload or retrieve private files from R2.

### 2. Missing Definitions for Statutory Acronyms (`EPF` and `NIC`)
* **Severity**: Major
* **Affected Scope**: The Problem #3 (Line 24); Goals (Line 36); CUJ 1 (Line 66); Schema Section 2.B (Lines 178, 181); Manifest (Lines 442, 453)
* **Discrepancy Description & Rationale**: The document elevates "EPF Number" (`epf_number`) to a mandatory, unique statutory identifier across member profiles, onboarding flows, and administrative rosters, and adds `nic VARCHAR(20)` to `public.members`. However, neither acronym is defined inline, expanded in a glossary, or accompanied by an explanatory link. For a reader without specific familiarity with Sri Lankan administrative frameworks, "EPF" (Employees' Provident Fund) and "NIC" (National Identity Card) are unexplained jargon.

### 3. Unspecified FIFO Settlement Engine Mechanism
* **Severity**: Major
* **Affected Scope**: CUJ 3 (Line 86); System Architecture Diagram (Line 129); Implementation Step 1 (Lines 465–471)
* **Discrepancy Description & Rationale**: CUJ 3 states that upon cash intake, "The FIFO settlement engine marks the member's oldest pending monthly due in `member_dues` as `paid`" (Line 86), and the high-level architecture diagram illustrates "SECURITY DEFINER Audit & FIFO Triggers" (Line 129). However, no FIFO settlement logic, PL/pgSQL trigger function, or client-side dues allocation algorithm is detailed in the schema migration (Lines 157–286) or the file manifest (Lines 441–459). It is unclear whether this is an existing database trigger being preserved, a new trigger required in migration `20261108000004_comprehensive_overhaul.sql`, or application code in `js/api.js`.

### 4. Self-Service Registration RLS & Routing Mechanics
* **Severity**: Major
* **Affected Scope**: CUJ 1 (Lines 61–70); RLS Policy Matrix (Lines 293–295); Implementation Phase 4 (Lines 453–454, 488–489)
* **Discrepancy Description & Rationale**: CUJ 1 describes a workflow where an unrecognized airport employee authenticates via Google OAuth, gets redirected to `unauthorized.html`, and submits their EPF and designation into `public.members` with `is_approved = false`. However, in the RLS Matrix (Line 295), the `member` role only has "Own Profile (R/W)" permissions. An unrecognized user who does not yet have a record in `public.members` will evaluate to `anon` or null in `get_current_user_role()`, which lacks INSERT permissions. The design does not specify an explicit RLS policy permitting authenticated users without member records to insert their initial pending registration. Furthermore, the routing logic that detects an unapproved or missing profile and redirects the browser to `unauthorized.html` is not attributed to any specific module or auth listener.

### 5. Undefined Data Sourcing for the Notification Center
* **Severity**: Major
* **Affected Scope**: Detailed Implementation Phase 3, 5 & Step 5 (Lines 448, 455, 492)
* **Discrepancy Description & Rationale**: The implementation plan requires a "top-3 dismissible Notification Center" on `dashboard.html` with dismissal persistence in `localStorage` (`mria_dismissed_announcements`). However, neither the schema section nor the API manifest defines where these announcements originate, how administrators publish them, or what database table/endpoint serves them. A new developer cannot determine if announcements are static HTML banners, stored in `cms_documents`, or fetched from an existing unmentioned table.

### 6. Edge Function Authentication and Member Status Filtering
* **Severity**: Nit
* **Affected Scope**: Section 4 (Lines 308–312); Detailed Implementation Phase 2 (Line 443)
* **Discrepancy Description & Rationale**: Section 4 indicates the client triggers the Edge Function via a simple `fetch('/functions/v1/send-claim-notification', ...)` without clarifying whether the request requires an `Authorization: Bearer <token>` header to prevent unauthorized callers from triggering bulk committee emails. Additionally, Line 310 states the function queries "all active members", but the `public.members` schema includes `is_approved` and not an `is_active` flag (unlike `public.treasury_accounts`), leaving the exact SQL filter slightly ambiguous.

### 7. Discrepancy in Institutional Routing Channels
* **Severity**: Nit
* **Affected Scope**: The Problem #1 (Line 20) vs. Implementation Phase 3 & 4 (Lines 444, 452)
* **Discrepancy Description & Rationale**: Problem #1 identifies the public exposure of private executive telephone numbers as a major flaw and mandates routing via "institutional routing channels." However, the solution configured in `js/config.js` and `js/page-index.js` routes contact requests to a personal Google account (`krishaja@gmail.com`) rather than an official association or airport domain email (e.g., `@mria.lk` or `@airport.lk`).
