# Consolidated Review Report: MRIA Management Welfare Association PWA

**Target Document:** [`docs/designs/mria_management_welfare_association_pwa.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/mria_management_welfare_association_pwa.md)  
**Total Lines Audited:** 582  
**Semantic Boundary:** Feature Range: `1..464` | Detailed Range: `465..582`  
**Review Pipeline:** Uninterrupted Full Flow across all EGM Goldfish lenses:
* Stage 5: Initial Zoom-Out (`egm-zoom-out`)
* Stage 6: Comprehension Test (`egm-comprehension`)
* Stage 7: Critic Review (`egm-design`, `egm-style`)
* Stage 8: Intermediate Zoom-Out (`egm-zoom-out`)
* Stage 9: Implementation Readiness (`egm-implementation-readiness`, `egm-codebase-details`)

---

## 1. Executive Summary & Verdict

The architectural specification provides a strong, user-centric foundation tailored to the local operational needs of the MRIA Welfare Association. However, the comprehensive review across all six auditing lenses identified **8 Blocker severity issues** and **14 Major severity issues** that would cause runtime failures, security bypasses, or implementation deadlocks if execution began immediately.

**Key Structural Themes:**
1. **Database & Authorization Defects:** Recursive RLS evaluation, client-side whitelist bypasses, and an unmapped payment reconciliation trigger.
2. **Architectural Over-Engineering:** Secondary cloud provider (Cloudflare R2) and serverless function layers where native Supabase features (`storage.objects` and `pg_cron`) eliminate 50% of the external moving parts.
3. **Browser ES6 & Asset Omissions:** Unresolvable bare specifiers (`@supabase/supabase-js`) in pure Vanilla JS and missing static assets causing Service Worker installation failure.
4. **Timezone & Defaulter Mechanics:** 5.5-hour UTC vs. Sri Lanka (UTC+05:30) date skew, and treating computed read-views as active state mutations.

---

## 2. Prioritized Consolidated Action Items

### 🔴 Blockers (Must Resolve Before Implementation)

| ID | Issue Description | Root Cause / Risk | Recommended Remediation |
| :--- | :--- | :--- | :--- |
| **BLK-01** | **RLS Policy Infinite Recursion** | Subquery on `public.members` inside policies protecting `public.members` triggers PostgreSQL `54001: stack depth limit exceeded`. | Introduce a `SECURITY DEFINER` helper function (`public.is_admin()`, `public.has_role()`) to evaluate roles without re-querying the protected table. |
| **BLK-02** | **Missing Payment Reconciliation Logic** | Sequence Diagram B relies on a trigger to mark dues as paid, but the trigger and allocation rules (FIFO, partial payments, overpayments) are missing from the schema and code specs. | Specify the exact SQL stored procedure/trigger (`reconcile_payment`) and define FIFO allocation rules for overdue months. |
| **BLK-03** | **Client-Side Whitelist Security Bypass** | Unregistered users are only redirected in browser JS; public tables grant `SELECT` to `authenticated`, allowing unapproved Google users to query data via API. | Update all RLS policies granting `authenticated` to strictly check `EXISTS (SELECT 1 FROM public.members WHERE user_id = auth.uid() AND is_approved = true)`. |
| **BLK-04** | **Bare Module Specifier `@supabase/supabase-js`** | Vanilla ES6 modules in browser without a bundler cannot resolve `@supabase/supabase-js`, throwing fatal runtime errors. | Provide an `<script type="importmap">` in HTML views mapping `@supabase/supabase-js` to an ESM CDN (`https://esm.sh/@supabase/supabase-js@2.46.1`). |
| **BLK-05** | **Missing PWA Shell Assets Breaking Service Worker** | `manifest.json` and `sw.js` reference icons and Bank QR images, but these files are omitted from target files; `cache.addAll()` fails with 404, breaking PWA installation. | Add `./assets/icon-192.png`, `./assets/icon-512.png`, and `./assets/default-bank-qr.png` to the Target Files list. |
| **BLK-06** | **Schema Foreign Key Contradiction in Verification Plan** | Verification Plan 1 asserts `member_id = auth.uid()`, but `member_dues.member_id` is an internal UUID referencing `public.members.id`, not `auth.users.id`. | Correct Line 561 to assert `member_id = (SELECT id FROM public.members WHERE user_id = auth.uid())`. |
| **BLK-07** | **Multi-Cloud Over-Engineering (Cloudflare R2)** | Introducing R2 requires S3 SDKs, external keys, and two custom Edge Functions; native Supabase Storage provides private buckets and 15-minute signed URLs in zero extra code. | Standardize on native Supabase Storage (`supabase.storage.from('slips').createSignedUrl(...)`), eliminating external cloud dependencies and Deno functions. |
| **BLK-08** | **Inconsistent Defaulter Roster RBAC Permissions** | Goals and CUJ 5 omit `treasurer` from viewing defaulters, while RLS matrix and security NFR include `treasurer`. | Harmonize all sections to uniformly authorize `admin, manager, official, and treasurer`. |

---

### 🟡 Majors (High Priority Architecture & Quality Fixes)

| ID | Issue Description | Root Cause / Risk | Recommended Remediation |
| :--- | :--- | :--- | :--- |
| **MAJ-01** | **Dual Role Architecture Discrepancy** | Schema has both `members.role` column and `public.user_roles` table, creating conflicting sources of truth. | Deprecate `user_roles` if single-role tenancy is intended, or state that `user_roles` is reserved for future expansion. |
| **MAJ-02** | **Time-Zone Limbo (UTC vs. Asia/Colombo UTC+05:30)** | Running scheduled cron at 00:00:00 UTC triggers at 05:30 AM Sri Lanka time, creating a 5.5-hour date skew on month-end cutoffs. | Anchor all calendar logic to `TIMEZONE('Asia/Colombo', now())` and schedule cron at `30 18 * * *` UTC (midnight local time). |
| **MAJ-03** | **Hardcoded Personal Email in DDL Triggers** | `krishaja@gmail.com` and `0759555924` are hardcoded inside database migration triggers and Edge Functions. | Move administrator bootstrap seeding to `supabase/seed.sql` or environment variables; remove hardcoded PII from DDL. |
| **MAJ-04** | **Missing Defaulter State Machine / View** | The spec describes defaulters as an altered state, but neither `members` nor `member_dues` has a defaulter column. | Replace state transition concept with an explicit PostgreSQL computed view (`CREATE VIEW v_defaulters`). |
| **MAJ-05** | **Cron Architecture Contradiction** | Section 1 specifies in-database `pg_cron`, while Section 3 introduces an Edge Function `monthly-dues-cron`. | Standardize on native database `pg_cron` scheduling inside migration scripts. |
| **MAJ-06** | **Contradictory Offline Balance Caching** | Goals state balances are viewable offline, but NFR specifies `Network-Only` caching. | Specify `Network-First` with fallback to cached balances and a visible "Offline Data as of [Date]" indicator. |
| **MAJ-07** | **Omission of `supabase/config.toml` & Deno Config** | Missing `supabase/config.toml` breaks `supabase db reset`, and missing `deno.json` prevents dependency resolution. | Catalog `./supabase/config.toml` and `./supabase/functions/deno.json` in Target Files. |
| **MAJ-08** | **Missing CORS Preflight Handling** | Cross-origin fetch requests from PWA will fail without explicit `OPTIONS` handling in Edge Functions. | Add `./supabase/functions/_shared/cors.ts` to Target Files. |
| **MAJ-09** | **Undefined Tailwind CSS Pipeline & Delivery Model** | Plan refers to "compiled Tailwind CSS" but omits stylesheet paths, build tooling, or CDN delivery details. | Catalog `./css/style.css` and define the standalone Tailwind build step. |
| **MAJ-10** | **Client-Side Environment Variable Distribution** | Browser ES6 cannot parse `.env` at runtime; mechanism for populating `js/config.js` is undocumented. | Document that `js/config.js` contains client-side public constants. |
| **MAJ-11** | **Absence of Local Development Server Instructions** | Browsers strictly refuse to register Service Workers over `file://`. | Add local web server instructions (`python3 -m http.server 8080`) to setup documentation. |
| **MAJ-12** | **Unresolved Bereavement Aid Workflow & Eligibility Gating** | Open Question 2 remains unanswered; no validation prevents members in default from claiming aid. | Formally define the approval lifecycle and gate claim submissions to members in good financial standing. |
| **MAJ-13** | **Undefined Member Onboarding Workflow in `admin.html`** | Whitelist requires pre-existing `members` row, but `admin.html` omits a member creation/approval view. | Add a member registration and whitelist management table to `admin.html`. |
| **MAJ-14** | **Undefined Concept of "Legacy Member"** | `is_legacy_member` is used in schema, but never defined in problem statement or overview. | Define legacy member criteria and admission fee exemption rules in Overview. |

---

### 🟢 Nits (Code Quality, Style & Minor Improvements)

| ID | Issue Description | Recommended Remediation |
| :--- | :--- | :--- |
| **NIT-01** | Pseudo-academic jargon in design tokens (fractional pixels `~9.88px`, "Mathematical Scale"). | Simplify to clean engineering tokens (`10px`, `16px`, `26px`, `42px`, `68px`). |
| **NIT-02** | Poetic networking metaphors ("when network handshakes flutter") and loaded buzzwords. | Use objective terminology ("intermittent network connections", "standard HTML5/ES6 architecture"). |
| **NIT-03** | Missing DOM element selector conventions. | Define standard IDs (`#slip-file-input`, `#cash-collection-form`, `#i18n-toggle`) for UI wiring. |
| **NIT-04** | Inconsistent status types (`TEXT CHECK` vs `ENUM`) and missing rejection metadata. | Create `due_status` ENUM and add `rejection_reason TEXT` to `payments`. |
| **NIT-05** | Missing automated test files. | Add `./supabase/tests/database.test.sql` (pgTAP) to the Target Files manifest. |
| **NIT-06** | Missing local Edge Function secrets template. | Add `./supabase/.env.local.example`. |
| **NIT-07** | Undefined association roles (`manager` vs `official`). | Document real-world operational boundaries for each role. |
| **NIT-08** | Undefined acronyms ("EGM", "Stitch MCP"). | Provide inline definition or documentation links. |

---

## 3. Traceability Matrix

| Consolidated ID | Primary Auditing Lens | Original Stage Report | Impact Area |
| :--- | :--- | :--- | :--- |
| **BLK-01** | `egm-design`, `egm-implementation-readiness` | `critic_report.md` §1.1, `implementation_readiness_report.md` §2.2 | PostgreSQL RLS / Authorization |
| **BLK-02** | `egm-design`, `egm-comprehension`, `egm-implementation-readiness` | `critic_report.md` §1.2, `comprehension_report.md` §2, `implementation_readiness_report.md` §1.1 | Financial Ledger & Reconciliations |
| **BLK-03** | `egm-design` | `critic_report.md` §1.3 | Security & Access Whitelist |
| **BLK-04** | `egm-implementation-readiness`, `egm-codebase-details` | `implementation_readiness_report.md` §1.2, `codebase_details` §2 | Client PWA Architecture |
| **BLK-05** | `egm-implementation-readiness`, `egm-codebase-details` | `implementation_readiness_report.md` §1.4, `codebase_details` §3 | Service Worker & Offline Caching |
| **BLK-06** | `egm-codebase-details`, `egm-comprehension` | `codebase_details` §1, `comprehension_report.md` §9 | Verification & Test Automation |
| **BLK-07** | `egm-zoom-out` | `zoom_out_report.md` §1, `intermediate_zoom_out_report.md` §1.1 | Cloud Architecture & Storage |
| **BLK-08** | `egm-style` | `critic_report.md` §1.4 | RBAC Consistency |
| **MAJ-01** | `egm-zoom-out`, `egm-comprehension`, `egm-style` | `zoom_out_report.md` §2, `comprehension_report.md` §3, `critic_report.md` §1.3 | Relational Schema Model |
| **MAJ-02** | `egm-design` | `critic_report.md` §2.3 | Scheduling & Calendar Invariants |
| **MAJ-03** | `egm-zoom-out`, `egm-design` | `zoom_out_report.md` §5, `critic_report.md` §2.2 | Security & DDL Decoupling |
| **MAJ-04** | `egm-zoom-out`, `egm-design`, `egm-comprehension` | `zoom_out_report.md` §8, `critic_report.md` §2.4, `comprehension_report.md` §4 | Database State Machine vs Views |
| **MAJ-05** | `egm-zoom-out`, `egm-implementation-readiness` | `zoom_out_report.md` §4, `implementation_readiness_report.md` §1.3 | Database Cron Infrastructure |
| **MAJ-06** | `egm-design` | `critic_report.md` §2.5 | PWA Caching Strategy |
| **MAJ-07** | `egm-codebase-details` | `implementation_readiness_report.md` §2.4, §2.5 | Tooling & Local Development |
| **MAJ-08** | `egm-codebase-details` | `implementation_readiness_report.md` §2.6 | Cross-Origin Networking |
| **MAJ-09** | `egm-codebase-details` | `implementation_readiness_report.md` §2.7 | CSS Distribution |
| **MAJ-10** | `egm-codebase-details` | `implementation_readiness_report.md` §2.8 | Client Configuration |
| **MAJ-11** | `egm-codebase-details` | `implementation_readiness_report.md` §2.9 | Local Testing Environment |
| **MAJ-12** | `egm-zoom-out`, `egm-design` | `zoom_out_report.md` §6, `critic_report.md` §2.6 | Welfare Benefits Subsystem |
| **MAJ-13** | `egm-comprehension` | `comprehension_report.md` §1 | Member Onboarding UX |
| **MAJ-14** | `egm-comprehension` | `comprehension_report.md` §5 | Business Domain Terminology |
| **NIT-01..08** | `egm-style`, `egm-structural`, `egm-implementation-readiness` | `critic_report.md` §2.7, §3.1–3.4; `implementation_readiness_report.md` §3.1–3.4 | Code Quality, Style, & Ergonomics |

---

## 4. Next Step Recommendation

All raw stage review files have been preserved:
* [zoom_out_report.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/zoom_out_report.md)
* [comprehension_report.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/comprehension_report.md)
* [critic_report.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/critic_report.md)
* [intermediate_zoom_out_report.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/intermediate_zoom_out_report.md)
* [implementation_readiness_report.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/implementation_readiness_report.md)

To resolve these findings and bring [mria_management_welfare_association_pwa.md](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/mria_management_welfare_association_pwa.md) to an implementation-ready state, run:

```bash
egm-resolve docs/designs/mria_management_welfare_association_pwa.md
```
