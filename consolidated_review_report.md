# Consolidated Multi-Lens Review Report: MRIA PWA 19-Point Remediation & Governance Refinement

**Target Document:** [`docs/designs/comprehensive_remediation_and_governance_refinement.md`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/docs/designs/comprehensive_remediation_and_governance_refinement.md)  
**Date:** 2026-11-11  
**Review Execution Pipeline:** Uninterrupted Full Flow (Stages 5, 6, 7, 8, 9)  

---

## 1. Executive Summary & Review Swarm Verdict

The multi-stage review across all Elephant-Goldfish personas (`egm-zoom-out`, `egm-comprehension`, `egm-design`, `egm-structural`, `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`) has concluded.

* **High-Altitude Principles:** Strongly affirmed. Retaining `recipient_id`, simplifying to a single locked FIFO required month, establishing bank neutrality, allowing attachment-free claims, and preserving existing layouts were validated across all lenses.
* **Findings Identified:**
  * 🔴 **Blockers:** 5
  * 🟡 **Majors:** 5
  * 🟢 **Nits:** 3
  * **Total Actionable Remediations:** 13
* **Verdict:** **CONDITIONAL PASS** — The technical design specification is architecturally sound and can proceed immediately to execution once the 5 blockers and 5 major remediations synthesized below are incorporated into the implementation phase.

---

## 2. Prioritized Consolidated Action Items

| Item ID | Severity | Category | Affected Files | Description & Concrete Resolution |
| :--- | :---: | :--- | :--- | :--- |
| **BLK-01** | 🔴 Blocker | Runtime DOM Binding | `js/page-dashboard.js`, `dashboard.html` | **Payment Submit Handler Wiring:** Replacing `<select id="paymentMonthSelect">` with a locked display container causes `selectedMonth` to evaluate to `undefined` in `js/page-dashboard.js` line 1000. **Resolution:** Wire the submit listener to read `document.getElementById("paymentMonthHiddenInput")?.value \|\| document.getElementById("paymentMonthSelect")?.value`. |
| **BLK-02** | 🔴 Blocker | Form Validation | `admin.html`, `js/page-admin.js` | **Hidden Input Validation Lockup:** `#notifRecipientSelect` has the HTML5 `required` attribute. When dispatching to `All` or `Arrears`, the hidden select triggers a silent browser validation halt (`An invalid form control is not focusable`). **Resolution:** Dynamically toggle `required` and `disabled` on `#notifRecipientSelect` based on target selection, and update pre-submit validation guards in `js/page-admin.js`. |
| **BLK-03** | 🔴 Blocker | Architecture / API | `js/api.js`, `js/page-admin.js` | **Omission of `js/api.js` & Missing Batch API:** `js/api.js` was omitted from touched files, and `sendNotification` only handles single inserts. **Resolution:** Add `js/api.js` as File 14. Export `sendBatchNotifications(notificationsArray)` using Supabase's native array insert (`supabase.from("notifications").insert(rows)`). |
| **BLK-04** | 🔴 Blocker | Ledger State Machine | `js/page-dashboard.js` | **Card 1 Dues Settled Masking Active Dues:** Displaying `Rs. 0.00 Settled` whenever `priorArrears === 0` hides active current-month pending dues. **Resolution:** Retain `netStanding` in `renderMetrics()`. If `netStanding < 0`, display red arrears; if `netStanding > 0`, display emerald advance; if `netStanding === 0`, display `Rs. 0.00 Settled`. |
| **BLK-05** | 🔴 Blocker | Database Querying | `js/page-admin.js`, `js/api.js` | **Arrears Cohort Querying:** `priorArrears` is not a DB column; computing it client-side generates an O(N) waterfall of 300+ queries. **Resolution:** Reuse the existing PostgreSQL view `public.defaulters_roster` via existing API `getDefaultersRoster()`, mapping distinct `member_id`s with zero new SQL queries. |
| **MAJ-01** | 🟡 Major | Architecture | `dashboard.html`, `js/page-dashboard.js` | **Announcement Evaporation:** Removing `#dashboardNotificationCenter` without modal ingestion leaves announcements stranded. **Resolution:** Administrative broadcast notifications in `public.notifications` (Target: All Members) officially replace `public.announcements` for ongoing alerts. |
| **MAJ-02** | 🟡 Major | Financial Accounting | `js/page-dashboard.js`, `js/i18n.js` | **Card 3 Semantic & Value Fluctuation:** Label states "Received" (`ලබාගත්`), but formula was summing both approved and disbursed claims. **Resolution:** Strictly filter by `c.status === "disbursed"` and sum `c.disbursed_amount`. Align English title to "Total Welfare Benefits Received". |
| **MAJ-03** | 🟡 Major | Audit Annotation | `js/page-dashboard.js` | **Multi-Month Payment Note Annotation:** If a member pays a lump sum covering multiple months, single-month note annotation `[Billing Month: YYYY-MM]` misrepresents multi-month coverage. **Resolution:** Format payment notes to reflect FIFO sequence starting point: `[Settling Dues via FIFO starting from: YYYY-MM]`. |
| **MAJ-04** | 🟡 Major | Mobile Viewport | `js/receipt.js` | **Incomplete Action Button Scope:** `renderReceiptHtml()` was updated, but `renderGrantVoucherHtml()` retained the identical rigid 3-column grid. **Resolution:** Update both `renderReceiptHtml()` and `renderGrantVoucherHtml()` to responsive wrapping flex layouts. |
| **MAJ-05** | 🟡 Major | Schema Validation | `admin.html`, `js/page-admin.js` | **Bilingual `NOT NULL` Constraints:** Database columns `title_en`, `title_si`, `message_en`, `message_si` are `NOT NULL`. **Resolution:** If the admin enters text in only one language, auto-populate the alternate language fields to satisfy database NOT NULL constraints. |
| **NIT-01** | 🟢 Nit | UI Cleanup | `dashboard.html` | **Card 1 Subtext Removal:** Instruction cited literal text which is dynamically assembled. **Resolution:** Remove `data-i18n="click_for_history"` anchor element from Card 1 footer. |
| **NIT-02** | 🟢 Nit | UI Clarity | `dashboard.html` | **Welfare Claim Proof Label:** Top label lacked "(Optional)". **Resolution:** Update label to `Proof Document (Optional) / සහතික ලේඛනය (විකල්පයි)`. |
| **NIT-03** | 🟢 Nit | Testing Scenarios | `docs/designs/...` | **Testing Completeness:** Expand test scenarios to explicitly verify All, Arrears, and Single dispatch paths. |

---

## 3. Cross-Stage Traceability Matrix

| Consolidated Item ID | Stage 5: Initial Zoom Out | Stage 6: Comprehension | Stage 7: Critic Review | Stage 8: Intermediate Zoom Out | Stage 9: Readiness Test |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **BLK-01** | Finding 2 | — | Finding 1 | Finding 2 | Finding 3 |
| **BLK-02** | Finding 3 | — | Finding 8 | — | Finding 2 |
| **BLK-03** | Finding 1 | Finding 1 | Finding 7 | Finding 4 | Finding 1 |
| **BLK-04** | — | Finding 4 | Finding 2 | Finding 3 | — |
| **BLK-05** | Finding 1 | Finding 2 | Finding 3 | Finding 1 | Finding 4 |
| **MAJ-01** | Finding 4 | — | Finding 4 | Finding 5 | — |
| **MAJ-02** | Finding 6 | Finding 5 | Finding 5, 11 | — | — |
| **MAJ-03** | — | — | Finding 6 | — | — |
| **MAJ-04** | — | — | — | — | Finding 5 |
| **MAJ-05** | — | — | Finding 8 | Finding 6 | — |
| **NIT-01** | Finding 5 | — | — | Finding 3 | — |
| **NIT-02** | — | — | — | — | Finding 6 |
| **NIT-03** | — | — | Finding 9 | — | Finding 7 |

---

## 4. Final Execution File Manifest (14 Files Total)

1. [`index.html`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/index.html) - Legal name update, mobile header text clamping.
2. [`dashboard.html`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/dashboard.html) - Legal name, banner removal, Card 1 subtext removal, locked month container, optional claim label, BOC removal.
3. [`admin.html`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/admin.html) - Legal name, BOC removal, multi-target notification radio, dynamic required select handling.
4. [`unauthorized.html`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/unauthorized.html) - Legal name consistency.
5. [`manifest.json`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/manifest.json) - PWA branding update.
6. [`js/config.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/config.js) - App title constants update.
7. [`js/i18n.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/i18n.js) - Strict single-language cleanup, BOC removal, Card 3 title alignment, new keys.
8. [`js/api.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/api.js) - Export `sendBatchNotifications(notificationsArray)`.
9. [`js/page-dashboard.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/page-dashboard.js) - Banner removal, Card 1/2/3 calculations, red unread modal styling, payment submit listener wiring (`#paymentMonthHiddenInput`), FIFO note formatting.
10. [`js/page-admin.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/page-admin.js) - Multi-target dispatch logic (`getDefaultersRoster()`, `sendBatchNotifications()`), BOC removal, toast cleanup.
11. [`js/receipt.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/receipt.js) - Legal name, BOC removal, responsive wrapping button layouts for both receipts and grant vouchers.
12. [`js/treasury-export.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/js/treasury-export.js) - Legal name, neutral bank account display.
13. [`assets/default-bank-qr.svg`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/assets/default-bank-qr.svg) - BOC center emblem replacement.
14. [`sw.js`](file:///home/anjana/Documents/Software/MRIA%20Welfare%20Association%20/sw.js) - Service worker cache version bump to `v7`.
