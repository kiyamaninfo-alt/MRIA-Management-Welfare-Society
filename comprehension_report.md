# Stage 6: Comprehension Test Report

**Target Document:** [`docs/designs/comprehensive_remediation_and_governance_refinement.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/comprehensive_remediation_and_governance_refinement.md)  
**Reviewer:** `egm-comprehension`  
**Date:** 2026-11-11  

---

**What this proposes**  
This document proposes a comprehensive 19-point remediation and governance refinement for the Mattala Rajapaksa International Airport (MRIA) Management Welfare Association's Progressive Web Application (PWA). Across 13 identified frontend and configuration files, it eliminates persistent login announcement banners in favor of a centralized notifications modal with high-visibility red unread styling, neutralizes hardcoded "Bank of Ceylon" (BOC) branding into generic institutional coordinates, and updates the association's legal title to its constitutional standard. It refines the dashboard's financial ledger cards to display cumulative lifetime payments and prominent red overdue arrears, locks dues payments to the single earliest unpaid month to maintain first-in, first-out (FIFO) ledger integrity, and makes welfare claim attachments optional. Additionally, it expands the administrative notification desk with multi-target dispatching (all members, members in arrears, and individual members) and refines mobile responsive layouts down to 320px viewport widths.

**How the existing system works, per this document**  
The existing platform operates as a client-side PWA built with vanilla ES6 JavaScript modules, Tailwind CSS, Supabase (PostgreSQL 17), and Cloudflare R2 object storage. Member inquiries, notifications, and welfare benefit claims have encountered runtime PostgREST errors (`PGRST204`, `PGRST205`) due to missing table columns or unapplied database schema migrations on the remote Supabase database. The dashboard currently displays persistent announcement cards that clutter the screen across logins, while the payment modal allows members to pick arbitrary billing months out of chronological order. In addition, the admin notification console is strictly restricted to one-to-one individual member selection, financial cards show confusing settlement subtext with calendar year-to-date metrics rather than lifetime historical sums, welfare claim submissions fail if proof files are omitted, and mobile viewports suffer from clipped top app bars and rigid receipt action grids.

---

### Findings

#### Finding 1: Disconnect in Notification Batch Insert Implementation Scope
* **Severity**: Major
* **Affected Scope**: Section 1 (High-Level Architecture, lines 126, 154), Section 6 (Multi-Target Administrative Notification Dispatch Console, lines 263–267), and Section 2 (Comprehensive File Enumeration, lines 391–497).
* **Discrepancy Description & Rationale**:
  The architecture and technical plan state that when an administrator selects `Target: All Active Members` or `Target: Members with Pending Arrears`, the system executes a "batch insert into `public.notifications`" via `API_Notif` (lines 126, 154, 264–265). However:
  1. In the codebase, `sendNotification()` in `js/api.js` (lines 1165–1175) only accepts a single recipient (`recipientId`) and executes a single row insert.
  2. `js/api.js` is not included among the 13 files enumerated for modification in the Detailed Implementation Plan (lines 391–497).
  3. `js/page-admin.js` imports `sendNotification` from `./api.js` and does not import the Supabase client directly.
  
  A developer reading this implementation plan with zero assumed context cannot determine whether `js/api.js` must be updated to export a batch insert function (e.g., `sendBatchNotifications()`), whether `js/page-admin.js` is expected to iterate through members invoking `sendNotification()` in a sequential/concurrent loop (incurring N network round-trips), or if `supabase` should be directly imported into `js/page-admin.js`. The plan should explicitly add `js/api.js` to the modification list or clarify the client-side dispatch mechanism.

---

#### Finding 2: Ambiguous Query Mechanism for "Members with Pending Arrears"
* **Severity**: Major
* **Affected Scope**: Section 6 (line 265), CUJ 4 (line 98), and Section 9 (line 469): *"Query members with `priorArrears > 0` and batch-insert notifications."*
* **Discrepancy Description & Rationale**:
  The plan instructs that when dispatching arrears reminders, the system should "Query members with `priorArrears > 0`". To an engineer unfamiliar with the codebase, this reads like a database query (e.g., `supabase.from('members').select('*').gt('priorArrears', 0)`). However, `priorArrears` is not a column in `public.members` (or any other table listed in the schema section on lines 132–139); it is a calculated client-side property produced by `calculateMemberBalance()` in `js/api.js`.
  
  The document does not explain how the admin page identifies these members—whether it should query the existing `defaulters_roster` database view via `getDefaultersRoster()`, iterate over `allMembers` evaluating `calculateMemberBalance()` for each member, or execute a query against `public.member_dues`. This lack of specification creates ambiguity during implementation.

---

#### Finding 3: Undefined Reference to "Migration 6"
* **Severity**: Nit
* **Affected Scope**: Section 1 (Problem, line 22) and Alternative 2 (line 338).
* **Discrepancy Description & Rationale**:
  The document references "migration 6" as the cause of schema drift ("failed with PGRST205 errors because migration 6 had not been applied to the remote Supabase database" and "keeping `recipient_id` in migration 6"). However, the document neither links to a migration file path (such as `supabase/migrations/`) nor provides its contents. A fresh reader inspecting the repository finds migrations with timestamped names (e.g., `20261108000005_comprehensive_overhaul`) and cannot locate a file named "migration 6". While line 162 notes that the live PostgreSQL schema was synchronized via the Supabase API, referencing an unlinked, informal identifier ("migration 6") creates confusion for external auditing and environment reproducibility.

---

#### Finding 4: Omission of Advance Balance State in Financial Ledger Card 1
* **Severity**: Nit
* **Affected Scope**: Section 4 (Card 1: Outstanding Overdue Arrears, lines 202–210) and Section 8 (Modification Rationales, line 449).
* **Discrepancy Description & Rationale**:
  The specification for Card 1 defines behavior for two states:
  - `balanceInfo.priorArrears > 0`: Display bold red text `-Rs. ${priorArrears.toFixed(2)}` with a red `Arrears` badge.
  - `balanceInfo.priorArrears === 0`: Display `Rs. 0.00` in neutral dark text with an emerald `Settled` badge.
  
  However, in the existing ledger engine (`calculateMemberBalance` in `js/api.js`), a member can have a positive advance credit balance (`advanceBalance > 0` / `netStanding > 0`). The design document omits this case, leaving it unclear whether the existing emerald "Advance Balance" display should be preserved when `advanceBalance > 0` or whether Card 1 must strictly display `Rs. 0.00` whenever `priorArrears === 0`.

---

#### Finding 5: Redundant Rationale for Card 3 Welfare Benefits Aggregation
* **Severity**: Nit
* **Affected Scope**: Section 3 (The Problem, line 30), Section 4 (Card 3, lines 215–218), and Section 8 (Modification Rationales, line 451).
* **Discrepancy Description & Rationale**:
  The document states that "Card 3 lacked lifetime cumulative welfare grant aggregation" (line 30) and prescribes: *"In `renderClaimsSummary()`, sum all claims where `c.status === "disbursed" || c.status === "approved"`"* (line 217). However, the existing implementation of `renderClaimsSummary()` in `js/page-dashboard.js` (lines 522–526) already filters and sums claims using that exact logic. Describing this as a missing aggregation is confusing to a reader examining the source code, as no mathematical change to Card 3 is actually required beyond any label/localization updates.

---

#### Finding 6: Undefined Acronym `EPF`
* **Severity**: Nit
* **Affected Scope**: Section 2 (Database Schema Alignment, line 169: `sender_epf`) and Section CUJ 4 / Detailed Plan (lines 241, 341).
* **Discrepancy Description & Rationale**:
  The term `EPF` / `sender_epf` is referenced repeatedly as a member attribute without definition or context. In Sri Lankan corporate and government contexts, EPF stands for "Employees' Provident Fund" and serves as the employee ID number. For an engineer joining the project with zero prior local institutional knowledge, this acronym should be defined on first use.
