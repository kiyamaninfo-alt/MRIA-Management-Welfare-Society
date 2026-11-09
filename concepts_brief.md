# MRIA Management Welfare Association PWA: Targeted Design Enhancement & Bug Remediation Cycle

* **Author:** kiyamaninfo-alt
* **Date:** 2026-11-09

## Overview

This engineering brief defines the targeted design enhancement, bug remediation, and statutory governance cycle for the MRIA Management Welfare Association ("MRIA කළමනාකාර සුබසාධක සංගමය") Progressive Web Application (PWA). Built using Vanilla ES6 JavaScript modules, Tailwind CSS, Supabase (PostgreSQL 17), and Cloudflare R2 object storage, the platform manages member self-service, treasury accounting, and welfare benefit disbursements for Mattala Rajapaksa International Airport staff.

This cycle delivers 18 specific technical enhancements and bug fixes structured across five functional pillars:
1. **UI/UX Layout, Alignment & Numbers Formatting** (Items 1, 2, 5, 6, 7)
2. **RBAC Deletions, Approvals & Immutable Audit Logging** (Items 3, 4)
3. **Dues Logic, Dynamic Titles & Next-Month Auto-Selection** (Items 10, 11, 12, 14)
4. **Onboarding, Locked Dashboard Preview & Internal Inquiries** (Items 8, 13, 16, 17)
5. **Print Engine, App Installation & History Pagination** (Items 9, 15, 18)

---

## Analysis

### Pillar 1: UI/UX Layout, Alignment & Numbers Formatting

#### Item 1: Missing Download Button in Admin > Direct Cash Collection Desk
* **Root Cause:** In `admin.html` under `#tab-content-cash`, `window.downloadReceiptFile()` exists in `js/receipt.js`, but the card header above `#cashReceiptPreview` lacks a direct export action button before or after settlement.
* **Mechanism:** Add an action button (`#btnDownloadCashVoucher`) in the preview card header. Ensure it triggers `window.downloadReceiptFile()` for both draft previews and issued official vouchers.

#### Item 2: Receipts & Vouchers Toolbar Redesign & Compacting
* **Root Cause:** In `tab-content-receipts`, the toolbar currently uses a 12-column grid (`grid-cols-1 sm:grid-cols-12 gap-3`). On wide monitors, the search input, category filter, payment method filter, and sorting dropdowns stretch excessively, whereas on mid-sized screens text is clipped.
* **Mechanism:** Refactor the toolbar into a compact flexbox layout (`flex flex-wrap items-center gap-2.5`). Constrain search bar width (`max-w-xs sm:max-w-sm`) and dropdown widths (`min-w-[140px]`), grouping sorting controls inline to prevent horizontal sprawl.

#### Item 5: Universal Right-Alignment for Numerical and Currency Fields
* **Root Cause:** Numerical amounts in the Receipts Register, Slips Approval Queue, Cash Book, Defaulters Roster, and Member Directory are intermittently left-aligned or centered, obstructing visual scanning of digits and decimal points.
* **Mechanism:** Enforce strict tabular formatting across all tables:
  * Amount data cells must use `text-right font-mono tabular-nums`.
  * Column headers (`<th>`) corresponding to amounts must be `text-right`.
  * Last digits of all currency figures align along the right margin.

#### Item 6: Baseline Alignment of Disbursement Date & Time under Direct Benefit Payout Desk
* **Root Cause:** In `tab-content-claims`, the Payment Method dropdown container lacks the vertical height of the Disbursement Date & Time container due to an internal `SL Time (Asia/Colombo)` badge and a helper subtext, producing an uneven baseline.
* **Mechanism:** Normalize container heights by placing the timezone indicator beside the section heading and equalizing input label containers.

#### Item 7: Currency Prefix Alignment under Monthly Dues Settings
* **Root Cause:** In `duesSettingsForm`, the "Rs." prefix icon uses `pl-3.5` with input padding `pl-12`, differing from the standard `pl-3` and `pl-10` used elsewhere in `admin.html`.
* **Mechanism:** Standardize currency input wrappers across all settings forms using uniform `pl-3` prefix positioning and `pl-10` input padding.

---

### Pillar 2: RBAC Deletions, Approvals & Immutable Audit Logging

#### Item 3: Admin Member Deletion & Archival (Dual-Mode Safety Guard)
* **Root Cause & Ledger Safety Invariant:** A physical SQL `DELETE FROM members` will violate foreign key constraints if the member already has records in `payments`, `member_dues`, `benefit_claims`, or `treasury_transactions`. Cascading deletions would permanently destroy statutory accounting records and audit trails.
* **Dual-Mode Mechanism:**
  1. **Strict Hard Delete:** Allowed exclusively for member profiles with zero transaction history (zero payments, zero dues, zero claims, e.g. duplicate or unapproved registrations).
  2. **Guarded Soft Archival:** For members with existing financial or grant history, enforce soft archival (`is_approved = false`, `role = 'archived'`). This revokes login access and excludes them from active rosters while preserving all statutory audit and ledger records.
  3. **Database Function & Trigger:** Implement `delete_or_archive_member(p_member_id, p_admin_id, p_reason)` which checks transaction counts before determining the operation, logging all actions to `audit_logs`.

#### Item 4: Treasurer Receipt Voiding with Automatic Ledger Reversals
* **Root Cause & Double-Entry Invariant:** When an erroneous receipt or payment is recorded, executing a physical `DELETE FROM payments` leaves the Society Treasury cash balance inflated and breaks `payment_dues_reconciliation` records.
* **Accounting Void Mechanism:**
  1. No physical `DELETE` on payments.
  2. Set `payments.status = 'voided'` with a mandatory `void_reason` input captured from the Treasurer.
  3. Database function `void_payment_receipt(p_payment_id, p_reason, p_voided_by)` atomically:
     * Un-settles reconciled `member_dues` (reverting `status` from `settled` back to `pending`).
     * Removes the reconciliation mapping from `payment_dues_reconciliation`.
     * Records a compensating `outflow` transaction in `treasury_transactions` referencing `VOID-[id]`, decrementing `treasury_accounts.current_balance`.
     * Logs an immutable entry in `audit_logs` (`action = 'RECEIPT_VOIDED'`).

---

### Pillar 3: Dues Logic, Dynamic Titles & Next-Month Auto-Selection

#### Item 10: Dynamic "So Far Paid Accordingly" Contribution Tracking
* **Root Cause:** Card 2 on `dashboard.html` is statically labeled "Current Month Due / මෙම මස දායක මුදල", which is misleading when members track annual cumulative payments or pay in advance.
* **Mechanism:** Convert Card 2 into a dynamic tracker displaying the member's verified contributions for the current fiscal calendar year (or cumulative verified payments):
  * Sinhala: "මෙතෙක් ගෙවා ඇති මුදල" (Cumulative Paid)
  * English: "Contributions Paid to Date"

#### Item 11: Dynamic Pending Dues vs. Advance Balance (+/- Values)
* **Root Cause:** Card 1 displays outstanding dues as an absolute positive figure, omitting prepaid future months.
* **Mechanism:**
  * Calculate net financial balance: Total overdue arrears vs advance prepaid contributions.
  * **Overdue Arrears:** Display negative in rose red (`-Rs. 500.00`), title: "Outstanding Arrears / ගෙවීමට ඇති හිඟ මුදල්", badge: "Arrears / හිඟ මුදල්".
  * **Advance Prepaid:** Display positive in emerald green (`+Rs. 600.00`), title: "Advance Prepaid Balance / අත්තිකාරම් ශේෂය", badge: "Advance Paid / අත්තිකාරම් ගෙවීම්".
  * **Zero Balance:** Display `Rs. 0.00` in slate, title: "Dues Settled / හිඟ මුදල් නැත", badge: "All Settled / සම්පූර්ණයෙන්ම ගෙවා ඇත".

#### Item 12: Payment Modal Earliest Unpaid Month Auto-Detection (FIFO Order Fix)
* **Root Cause:** In `js/page-dashboard.js`, `getMemberDues` orders records by `billing_month DESC`. When `populatePaymentMonths` filters for `status === "pending"`, the array is populated newest-month-first. Consequently, a member with 3 unpaid months has the *latest* month pre-selected rather than the *earliest*.
* **Mechanism:** Sort `pendingMonths.sort((a, b) => a.billing_month.localeCompare(b.billing_month))` chronologically ascending. Auto-select the earliest unpaid month as `paymentMonthSelect.value`. If all prior months are settled, default to the current month; if current month is settled, default to the next upcoming month (Advance).

#### Item 14: Statutory Formula Audit against Association Constitution
* **Constitutional Verification Points:**
  * **Cutoff Rule:** Dues for the current month become overdue at 23:59:59 on the final calendar day (30th/31st). Defaulters roster dynamically queries `member_dues WHERE status = 'pending' AND billing_month < CURRENT_DATE`.
  * **Admission Fee:** Fixed one-time charge (default Rs. 500/=) enforced for non-legacy members prior to first benefit grant eligibility.
  * **Monthly Contribution Rate:** Default Rs. 300/= (or dynamic rate in `system_settings`), credited to Bank of Ceylon operating account.
  * **FIFO Allocation:** Payments extinguish oldest pending dues chronologically.
  * **Asset Segregation:** Cash in Hand, Bank of Ceylon Savings, and Fixed Deposits remain strictly segregated; ledger balances equal the sum of historical transaction entries.

---

### Pillar 4: Onboarding, Locked Dashboard Preview & Internal Inquiries

#### Item 8: Admin Notification / Messaging Dispatch & Member Header Bell Icon
* **Mechanism:**
  * **Database Table:** Create `public.notifications` table (`id`, `recipient_id` [NULL for broadcast], `title_en`, `title_si`, `message_en`, `message_si`, `priority`, `is_read`, `created_at`).
  * **Admin Console:** Add an Announcement / Notification Dispatch panel under Admin CMS with recipient selection (Broadcast vs Specific Member).
  * **Member Header:** Add an active notification bell icon (`notifications`) to `dashboard.html` header with a red unread badge counter (`#notificationUnreadBadge`).
  * **Modal:** Clicking the bell opens a popover or modal listing notifications with "Mark All as Read" capabilities.

#### Item 13: Document Attachment Upload for Welfare Benefit Claims
* **Mechanism:**
  * **Storage Pipeline:** Leverage Cloudflare R2 presigned upload pipeline in `js/storage.js` to upload claim proof documents (death certificates, medical invoices) under `claims/{yearMonth}/{memberId}_{uuid}.{ext}`.
  * **Edge Function Auth:** Extend `get-slip-url` to verify authorization against `benefit_claims.document_key = slipKey`.
  * **Schema:** Add `document_key VARCHAR(500)` to `public.benefit_claims`.
  * **UI:** Add camera capture and file picker drop area to `#claimForm` in `dashboard.html`. Add "View Proof Document" button in Admin Benefit Grants desk.

#### Item 16: Read-Only Locked Dashboard Preview for Unapproved Users
* **Mechanism:**
  * For pending Google OAuth sign-ins redirected to `dashboard.html`, render a strictly isolated locked preview:
    * Row-Level Security remains airtight. Display zero-state skeleton metrics (`Rs. 0.00` across all cards).
    * Non-dismissible explanatory banner: "Dashboard will become active once Secretary approves your account / ලේකම්වරයා විසින් ඔබගේ සාමාජිකත්වය අනුමත කළ පසු මෙම පුවරුව සක්‍රිය වනු ඇත."
    * Disable all functional mutation buttons (Make a Payment, Apply for Benefit, slip drop areas, etc.).
    * Keep strictly three actions enabled: Sign Out, download Constitution PDF (`constitution_si.pdf` / `constitution_en.pdf`), and the in-app Contact Admin form.

#### Item 17: In-App Internal Inquiry Form (Replacing `mailto:` Links)
* **Root Cause:** In `js/ui.js`, `openContactModal()` currently executes `window.location.href = mailto:...`, which fails on mobile devices or computers without configured mail clients.
* **Mechanism:**
  * **Database Table:** Create `public.admin_inquiries` (`id`, `sender_id`, `sender_name`, `sender_email`, `sender_epf`, `subject`, `message`, `status` ['pending', 'resolved'], `created_at`).
  * **Frontend:** Update `openContactModal()` to persist inquiries directly to Supabase via `api.js`.
  * **Admin Review:** Expose submitted inquiries inside Admin > Secretary Console or a dedicated Inquiries drawer for review and resolution.

---

### Pillar 5: Print Engine, App Installation & History Pagination

#### Item 9: Prominent "Install App" Button on Dashboard
* **Mechanism:**
  * Add a prominent "Install App" button in `dashboard.html` top app bar / banner.
  * Intercept `beforeinstallprompt` event and bind click event to trigger the native prompt.
  * For iOS Safari users, display device-tailored popup instructions ("Tap Share -> Add to Home Screen").
  * Hide button automatically when application is running in `standalone` mode.

#### Item 15: CSS-Isolated Receipt Voucher Printing
* **Root Cause:** In `js/receipt.js`, `window.print()` triggers printing of the entire host window, capturing page headers, navigation bars, and background elements.
* **Mechanism:**
  * Refactor print handlers to spawn a hidden `<iframe>` or dedicated print window.
  * Inject *only* the `#printableReceipt` HTML along with isolated `@page { margin: 12mm; }` styling.
  * Invoke `print()` on the isolated frame/window and remove it upon completion.

#### Item 18: Pagination of Payment Slips & Benefit Claim Submissions History
* **Root Cause:** In `dashboard.html`, both payment history (`#paymentsTableBody`) and benefit claims render unbounded lists, degrading DOM performance over time.
* **Mechanism:**
  * Implement client-side slicing: initial render displays the last 5 records.
  * Add a "Load More (+25)" button below the table (`#btnLoadMorePayments`).
  * Clicking "Load More" appends the next batch of 25 records until all historical records are rendered.

---

## Goals vs. Non-Goals

### In-Scope Goals
* Add action button `#btnDownloadCashVoucher` in Admin Direct Cash Intake Desk header.
* Refactor Admin Receipts & Vouchers toolbar into a compact flexbox layout.
* Standardize right-alignment (`text-right font-mono tabular-nums`) across all numerical and currency tables.
* Align Disbursement Date & Time / SL Time baseline under Direct Benefit Payout Desk.
* Standardize currency input padding ("Rs.") under Settings.
* Enable Admin member deletion with dual-mode pre-condition checks (hard delete for 0 records, archival for linked records).
* Implement Treasurer receipt voiding with automatic FIFO dues un-settling and treasury balance compensation.
* Implement dynamic "So Far Paid Accordingly / Cumulative Paid" card on Dashboard.
* Implement dynamic positive/negative display for pending dues vs. advance prepaid balances.
* Implement auto-detection and chronological FIFO pre-selection of earliest unpaid month in payment upload modal.
* Audit and verify financial and treasury balance formulas against association constitution rules.
* Implement Admin notifications dispatch and member header bell icon with unread badge.
* Add Cloudflare R2 document attachment uploads for welfare benefit claims.
* Implement read-only locked preview on `dashboard.html` for unapproved registrations.
* Replace `mailto:` links with an in-app administrative inquiries database table and triage drawer.
* Add a prominent PWA "Install App" button to `dashboard.html`.
* Implement CSS-isolated iframe printing for digital receipts and grant vouchers.
* Paginate member payment and claim history (5 initial records + "Load More (+25)").

### Out-of-Scope Non-Goals
* Physical SQL deletion of verified payment rows (violates double-entry accounting integrity).
* Hard-deleting members with historical payment or claims data (violates statutory audit integrity).
* External SMS gateway integrations (remains in-app notifications and email dispatch).
* Direct bank API integrations (society operates via verified deposit slips, cash desk, and LankaQR).

---

## Alternatives Weighed

* **Physical Payment Deletion vs. Void / Reversal Transaction:**
  * *Rejected Physical Deletion:* Deleting a payment row destroys the reconciliation link to `member_dues` and leaves `treasury_transactions` out of balance with physical funds.
  * *Adopted Reversal / Voiding:* Payment status updates to `voided`, trigger automatically un-settles reconciled dues, records a treasury reversal outflow, and logs the action to `audit_logs`.
* **Hard Deletion vs. Guarded Member Deactivation:**
  * *Rejected Unconditional Hard Deletion:* Foreign key constraints prevent deleting members with transaction history; cascading deletes would wipe statutory accounting history.
  * *Adopted Guarded Approach:* Allow hard delete *only* for unlinked draft/duplicate profiles; require archival (`is_active = false`, `role = 'archived'`) for members with financial history.
* **Direct Window Print vs. Isolated iframe Voucher Printing:**
  * *Rejected Direct Window Print:* Calling `window.print()` in the main window leaks modal backdrops, scrollbars, and browser header artifacts into the output.
  * *Adopted Isolated iframe Printing:* Spawns a dedicated hidden iframe populated strictly with voucher markup and CSS print rules.
* **`mailto:` Client Link vs. In-App Database Inquiries:**
  * *Rejected `mailto:`:* Fails on devices without configured desktop or mobile email apps.
  * *Adopted In-App Inquiries Table:* Persists messages directly in `admin_inquiries` for administrative triage.

---

## Key Decisions & Staging for Next Steps

1. **Database Schema Enhancements:**
   * Create `admin_inquiries` table with RLS policies for member submissions and staff review.
   * Create `notifications` table with RLS policies for broadcast and member-specific delivery.
   * Add `document_key VARCHAR(500)` to `benefit_claims` for R2 document attachments.
   * Add `void_payment_receipt(payment_id, reason, voided_by)` PostgreSQL function and `voided` enum handling.
   * Add `delete_or_archive_member(member_id, admin_id, reason)` PostgreSQL function.
2. **Backend & Storage Integration:**
   * Extend `js/storage.js` and `get-slip-url` Edge Function to support claim proof document uploads.
   * Implement void receipt trigger logic in `js/api.js`.
3. **Frontend Implementation:**
   * Update `admin.html` (Toolbar compacting, cash desk download button, right-alignments, baseline fixes, inquiries/notifications console).
   * Update `dashboard.html` (Dynamic contribution card, +/- dues calculation, earliest unpaid month auto-select, claim file upload, locked preview guard, install button, history pagination).
   * Update `js/receipt.js` (CSS-isolated iframe print engine).
4. **Constitution Rule Verification:**
   * Validate month-end cutoff rules, admission fee defaults, and FIFO allocation logic across all endpoints.
