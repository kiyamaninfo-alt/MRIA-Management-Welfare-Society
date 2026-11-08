# MRIA Management Welfare Association PWA

* **Author:** kiyamaninfo-alt
* **Date:** 2026-11-08

## Overview

The MRIA Management Welfare Association (MRIA සුබසාධක කළමනාකරණ සංගමය) Progressive Web Application is a localized, offline-capable member and financial management system. Built using Vanilla HTML5, Vanilla ES6 JavaScript, Tailwind CSS, and a Supabase (PostgreSQL 17) backend, the platform manages member enrollment, recurring dues, bank slip verification, direct cash transactions, and bereavement/welfare aid disbursements. Interfaces and layouts are designed strictly through the Stitch MCP Server following a Fibonacci / Golden Ratio (1.618) typography and spacing scale on a minimalist white surface.

## Analysis

### 1. Architectural & Interface Topology
* **Frontend:** Vanilla HTML5 with modular ES6 JavaScript modules (`auth.js`, `api.js`, `i18n.js`, `storage.js`, `ui.js`) and Tailwind CSS.
* **Layout & Visual Design:** Built via the Stitch MCP server adhering strictly to the Golden Ratio (base 16px font scaled by 1.618 to 10px, 16px, 26px, 42px, 68px; Fibonacci spacing of 8px, 13px, 21px, 34px, 55px, 89px) with a minimalist palette (`#FFFFFF`, `#F8FAFC`, slate-900 typography, sky-600 accents, emerald-500 verified states, and rose-500 debt warnings).
* **Bilingual Localization:** Client-side i18n module supporting English (default) and Sinhala (සිංහල) toggling with persistent user preference storage.
* **PWA Offline Resilience:** Service Worker (`sw.js`) and `manifest.json` providing installability and read-only caching for dashboard statistics, announcements, last-known dues balance, and the organization's Bank QR image. All financial write actions are disabled offline with proactive warnings.

### 2. Identity, Whitelist & Access Control
* **Authentication Provider:** Google OAuth (Gmail) via Supabase Auth.
* **Whitelist Authorization Engine:** When an authenticated user signs in, their profile is checked against the `members` table by email. If unregistered or unapproved (`is_approved = false`), access is blocked with a localized message and a direct WhatsApp redirection button to the administration contact (`0759555924`).
* **Root Administrator Bootstrapping:** `krishaja@gmail.com` is seeded into `members` as `role = 'admin'` and `is_approved = true`. A PostgreSQL trigger (`on_auth_user_created`) maps the Supabase `auth.users` UUID to the seeded record on first OAuth login.
* **Role-Based Access Control (RBAC):** Five distinct roles (`admin`, `manager`, `official`, `treasurer`, `member`) enforced via PostgreSQL Row Level Security (RLS) policies.

### 3. Financial Ledger & Dues Engine
* **Ledger Model:** Uses a dedicated `member_dues` table tracking discrete monthly billing periods (`billing_month`, `amount`, `status: pending/paid`).
* **Monthly Billing Automation:** An automated cron job / Supabase Edge Function runs on the 1st of each month to generate pending due entries for active members.
* **End-of-Month Cutoff Invariant:** Dues are payable up to 23:59:59 on the final calendar day of each month (accounting for 28, 29, 30, and 31-day months). Defaulter status activates automatically at 00:00:00 on the 1st of the subsequent month.
* **Restricted Defaulter Visibility:** Unpaid member balances and the defaulters roster are restricted to `admin`, `manager`, and `official` roles; general members cannot view other members' debt status.
* **Admission Fees:** New registrants incur an admission fee before activation; legacy members (`is_legacy_member = true`) are exempt.

### 4. Payments, Verification & Cloudflare R2 Storage
* **Bank QR Transfers:** Members scan an updatable Bank QR code and upload transfer slips.
* **Storage Engine:** Slips are uploaded to a private Cloudflare R2 bucket over an S3-compatible API. The database persists only the object key (`slip_key`).
* **Presigned Access Control:** A secure Supabase Edge Function (`get-slip-url`) issues 15-minute temporary presigned URLs to the uploader member, manager, and treasurer for verification. The root administrator has permanent on-demand signed URL generation capability.
* **Cash Receipts:** The treasurer (භාණ්ඩාගාරික) can record physical cash payments directly, creating an immediate verified payment and generating a digital receipt.

### 5. Extensible Welfare Benefit Module
* **Dynamic Benefit Schema:** Managed through a `benefit_types` table (e.g., Bereavement / Death Aid `මරණාධාර`) allowing administrators to add new aid categories (medical, retirement) without code alterations.
* **Member Claims History:** Dashboard aggregates lifetime benefits received, pending claim states, and disbursed amounts.

## Goals vs. Non-Goals

### In-Scope Goals
* Google OAuth integration with strict email whitelist verification and WhatsApp redirection fallback.
* Root administrator bootstrap for `krishaja@gmail.com` linking on initial login.
* Monthly dues ledger with automatic end-of-month defaulter calculation.
* Cloudflare R2 private bucket integration for payment slips with 15-minute presigned access.
* Treasurer approval queue for pending slips and direct cash receipt generation.
* Extensible welfare benefits management (`benefit_types`, `benefit_claims`).
* PWA offline caching for read-only member summaries and bank QR codes.
* Bilingual toggle (Sinhala / English) across all screens.
* Stitch MCP-scaffolded screens (`index.html`, `unauthorized.html`, `dashboard.html`, `admin.html`).

### Out-of-Scope Non-Goals
* Integration with automated card payment processors (e.g., Stripe, PayHere).
* Offline financial write queuing (slips/cash cannot be submitted offline).
* Automated outbound SMS/telephony gateways (all contact routes via WhatsApp deep links).
* Multi-organization multi-tenancy.

## Alternatives Weighed

* **Dynamic Dues Calculation vs. Monthly Ledger Table:**
  * *Rejected Dynamic Calculation:* Computing balances on the fly via `(months_active * monthly_fee) - sum(payments)` increases query latency over multi-year spans and complicates historical balance audits.
  * *Adopted Ledger:* A dedicated `member_dues` table with monthly records provides explicit line-item auditing and per-month reconciliation.
* **Supabase Storage vs. Cloudflare R2 Private Bucket:**
  * *Rejected Supabase Storage:* Cloudflare R2 eliminates egress fees for image-heavy transfer slips and provides native S3 presigned URL support for strict time-boxed access control.
  * *Adopted Cloudflare R2:* Slips are stored under private S3 keys, with signed access issued exclusively through a Supabase Edge Function.
* **Fixed 31st Day Rule vs. Final Calendar Day:**
  * *Rejected Fixed 31st:* Would fail or create date anomalies across February, April, June, September, and November.
  * *Adopted End-of-Month Invariant:* Cutoff triggers at 23:59:59 on the last valid calendar day of the given month.
* **Offline Mutation Queue vs. Offline Read-Only Banner:**
  * *Rejected Offline Queue:* Queuing financial uploads or payments locally risks synchronization conflicts, duplicate entries, and stale receipts.
  * *Adopted Strict Online Enforcement:* Financial mutations require an active network connection, while informational views remain cached offline.

## Key Decisions & Staging for Next Steps

1. **Database Migrations:** Create PostgreSQL schemas for `profiles`/`members`, `roles`, `user_roles`, `member_dues`, `payments`, `benefit_types`, `benefit_claims`, `announcements`, and `system_settings`.
2. **Seed Initial Admin:** Seed `krishaja@gmail.com` with role `admin` and `is_approved = true`.
3. **Cloudflare R2 Integration:** Configure S3 client in Edge Functions for slip upload signatures and 15-minute presigned retrieval.
4. **Stitch MCP UI Scaffolding:** Generate `index.html`, `unauthorized.html`, `dashboard.html`, and `admin.html` with responsive Tailwind layouts matching the Golden Ratio design system.
5. **Proceed to `/egm-draft`:** Transform this brief into the formal system design and implementation plan.
