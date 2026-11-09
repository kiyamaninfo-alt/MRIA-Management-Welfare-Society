import { requireAuth, signOut } from "./auth.js";
import {
  calculateMemberBalance,
  getMemberDues,
  getMemberPayments,
  getMemberClaims,
  getBenefitTypes,
  getAnnouncements,
  getSystemSetting,
  getTreasuryBalances,
  submitPayment,
  submitBenefitClaim,
  getNotifications,
  markNotificationAsRead,
} from "./api.js";
import { uploadBankSlip, uploadStorageFile, getSignedSlipUrl } from "./storage.js";
import { renderReceiptHtml } from "./receipt.js";
import { initLanguage, t, getLanguage } from "./i18n.js";
import {
  showToast,
  openModal,
  closeModal,
  setupModalDismissers,
  initOfflineDetection,
  formatCurrency,
  formatDate,
  openContactModal,
  openDuesBreakdownModal,
  downloadConstitutionPdf,
} from "./ui.js";

let currentMember = null;
let currentDues = [];
let currentPayments = [];
let currentClaims = [];
let currentBalanceInfo = {};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();
  initOfflineDetection();
  setupModalDismissers();

  // 1. Authenticate user without throwing hard unauthorized redirect for pending applicants
  const authState = await requireAuth({ requireApproved: false });
  if (!authState) return;

  const { user, member, isApproved } = authState;
  currentMember = member;

  // 2. Render user identity in header
  renderUserIdentity(member || { full_name: user?.user_metadata?.full_name, email: user?.email, role: "member" });

  // 3. Check approval status for Locked Dashboard Preview mode (Item 16)
  if (!isApproved || !member?.is_approved) {
    const banner = document.getElementById("lockedDashboardBanner");
    if (banner) banner.classList.remove("hidden");
    const notifs = document.getElementById("dashboardNotificationCenter");
    if (notifs) notifs.classList.add("hidden");

    // Disable all mutation buttons
    document.querySelectorAll(".mutation-btn").forEach((btn) => {
      btn.disabled = true;
      btn.classList.add("opacity-50", "cursor-not-allowed");
      btn.title = "Awaiting account approval by Secretary";
    });

    // Zero-state skeleton metrics
    const duesDisplay = document.getElementById("outstandingDuesDisplay");
    const monthAmountEl = document.getElementById("currentMonthAmountDisplay");
    const claimedEl = document.getElementById("benefitsClaimedDisplay");
    if (duesDisplay) duesDisplay.textContent = "Rs. 0.00";
    if (monthAmountEl) monthAmountEl.textContent = "Rs. 0.00";
    if (claimedEl) claimedEl.textContent = "Rs. 0.00";

    const duesBody = document.getElementById("duesTableBody");
    const payBody = document.getElementById("paymentsTableBody");
    const claimsBody = document.getElementById("claimsTableBody");
    if (duesBody) duesBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-on-surface-variant">Membership pending verification.</td></tr>';
    if (payBody) payBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">Membership pending verification.</td></tr>';
    if (claimsBody) claimsBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">Membership pending verification.</td></tr>';

    setupInstallAppButton();
    return;
  }

  // 4. Setup PWA install button (Item 9)
  setupInstallAppButton();

  // 5. Load all dashboard metrics and datasets
  await refreshDashboardData();

  // 6. Attach event listeners
  setupActionListeners();
});

function renderUserIdentity(member) {
  const nameEl = document.getElementById("memberFullNameDisplay");
  if (nameEl) nameEl.textContent = member.full_name || member.email;

  const epfEl = document.getElementById("memberEpfDisplay");
  if (epfEl) epfEl.textContent = member.epf_number || "Pending";

  const desigEl = document.getElementById("memberDesignationDisplay");
  if (desigEl) desigEl.textContent = member.designation || "Staff Member";

  // Check administrative roles for Admin Console visibility
  const staffRoles = ["admin", "manager", "secretary", "treasurer", "committee_member"];
  if (staffRoles.includes(member.role)) {
    const adminLink = document.getElementById("adminPortalLinkContainer");
    if (adminLink) adminLink.classList.remove("hidden");
  }

  // Wire Sign Out buttons
  document.querySelectorAll("[data-action='signout']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  });
}

async function refreshDashboardData() {
  if (!currentMember) return;

  try {
    // A. Announcements & Notification Center
    const announcements = await getAnnouncements();
    renderNotificationsCenter(announcements);

    // B. Bank Coordinates & QR Code
    const bankQrSetting = await getSystemSetting("bank_qr");
    if (bankQrSetting) {
      if (bankQrSetting.url) {
        const qrImg = document.getElementById("bankQrImg");
        if (qrImg) qrImg.src = bankQrSetting.url;
      }
      if (bankQrSetting.bank_name) {
        const bankNameEl = document.getElementById("displayBankName");
        if (bankNameEl) bankNameEl.textContent = bankQrSetting.bank_name;
      }
      if (bankQrSetting.branch) {
        const branchEl = document.getElementById("displayBankBranch");
        if (branchEl) branchEl.textContent = bankQrSetting.branch;
      }
      if (bankQrSetting.account_name) {
        const accNameEl = document.getElementById("displayAccountName");
        if (accNameEl) accNameEl.textContent = bankQrSetting.account_name;
      }
      if (bankQrSetting.account_number) {
        const accNumEl = document.getElementById("displayAccountNumber");
        if (accNumEl) accNumEl.textContent = bankQrSetting.account_number;
      }
      if (bankQrSetting.bank_name) {
        const badgeEl = document.getElementById("displayBankBadge");
        if (badgeEl) {
          const bankPrefix = bankQrSetting.bank_name.includes("Ceylon") ? "BOC" : bankQrSetting.bank_name.split(" ")[0];
          const branchPrefix = bankQrSetting.branch ? bankQrSetting.branch.split(" ")[0] : "";
          badgeEl.textContent = branchPrefix ? `${bankPrefix} ${branchPrefix}` : bankPrefix;
        }
      }
    }

    // C. Dues & Balance Info
    const dueSetting = await getSystemSetting("monthly_due_amount");
    if (dueSetting && dueSetting.amount) {
      window.mriaMonthlyDueSetting = Number(dueSetting.amount);
      const payInput = document.getElementById("paymentAmountInput");
      if (payInput && (!payInput.value || payInput.value === "500" || payInput.value === "300")) {
        payInput.value = window.mriaMonthlyDueSetting;
      }
    }

    currentDues = await getMemberDues(currentMember.id);
    currentPayments = await getMemberPayments(currentMember.id);
    currentBalanceInfo = await calculateMemberBalance(currentMember);
    renderMetrics(currentBalanceInfo, currentDues);
    renderDuesLedger(currentDues);
    renderPaymentHistory(currentPayments);

    // E. Welfare Benefit Claims
    const benefitTypes = await getBenefitTypes();
    populateBenefitTypesDropdown(benefitTypes);
    currentClaims = await getMemberClaims(currentMember.id);
    renderClaimsSummary(currentClaims);
    renderClaimsHistory(currentClaims);

    // F. Treasury Reserves & Segregated Assets Overview
    await loadTreasuryReserves();

    // G. Member 1-to-1 Notifications (Item 8)
    await loadNotifications();

  } catch (err) {
    console.error("Failed to refresh dashboard data:", err);
    showToast("Error loading financial ledger data.", "error");
  }
}

/**
 * Loads dynamic treasury balances if available from the database,
 * otherwise retains the default initial asset values.
 */
async function loadTreasuryReserves() {
  try {
    const balances = await getTreasuryBalances();
    if (balances && balances.length > 0) {
      let total = 0;
      let hasData = false;
      balances.forEach((b) => {
        const bal = Number(b.current_balance ?? b.balance ?? 0);
        total += bal;
        if (bal > 0) hasData = true;
      });

      if (hasData) {
        balances.forEach((b) => {
          const bal = Number(b.current_balance ?? b.balance ?? 0);
          if (b.account_id === "boc_savings") {
            const el = document.getElementById("dashboardBalBoc");
            if (el) el.textContent = formatCurrency(bal);
          }
          if (b.account_id === "cash_in_hand") {
            const el = document.getElementById("dashboardBalCash");
            if (el) el.textContent = formatCurrency(bal);
          }
          if (b.account_id === "fixed_deposits") {
            const el = document.getElementById("dashboardBalFd");
            if (el) el.textContent = formatCurrency(bal);
          }
        });
        const totalEl = document.getElementById("dashboardTreasuryTotal");
        if (totalEl) totalEl.textContent = formatCurrency(total);
      }
    }
  } catch (err) {
    console.debug("Treasury balances live fetch skipped / using defaults:", err);
  }
}

// ================= INSTALL PWA APP (Item 9) =================

function setupInstallAppButton() {
  const installBtn = document.getElementById("btnInstallApp");
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove("hidden");
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        installBtn.classList.add("hidden");
      }
      deferredPrompt = null;
    });
  }

  window.addEventListener("appinstalled", () => {
    if (installBtn) installBtn.classList.add("hidden");
  });
}

// ================= MEMBER NOTIFICATIONS & ALERTS (Item 8) =================

window.currentNotifications = [];

async function loadNotifications() {
  if (!currentMember?.id) return;
  try {
    const notifs = await getNotifications(currentMember.id);
    window.currentNotifications = notifs || [];
    const unread = (window.currentNotifications).filter((n) => !n.is_read).length;
    const badge = document.getElementById("notificationUnreadBadge");
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  } catch (err) {
    console.warn("Notifications load error:", err);
  }
}

window.openNotificationsModal = function () {
  const listEl = document.getElementById("notificationsListContainer");
  const notifs = window.currentNotifications || [];
  const isSi = getLanguage() === "si";

  if (!listEl) return;
  if (notifs.length === 0) {
    listEl.innerHTML = '<div class="py-8 text-center text-on-surface-variant text-xs">No notifications at this time.</div>';
  } else {
    listEl.innerHTML = notifs.map((n) => {
      const title = isSi ? (n.title_si || n.title_en) : (n.title_en || n.title_si);
      const msg = isSi ? (n.message_si || n.message_en) : (n.message_en || n.message_si);
      const isUrgent = n.priority === "urgent";

      return `
        <div class="py-3 px-2 flex items-start justify-between gap-3 ${n.is_read ? "opacity-75" : "bg-sky-50/40 rounded-xl p-2.5"}">
          <div class="space-y-1 min-w-0">
            <div class="flex items-center gap-2">
              ${isUrgent ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">URGENT</span>' : ''}
              <h5 class="font-bold text-xs text-on-surface truncate">${escapeHtml(title)}</h5>
              <span class="text-[10px] text-on-surface-variant font-mono">• ${formatDate(n.created_at)}</span>
            </div>
            <p class="text-xs text-on-surface-variant whitespace-pre-wrap leading-relaxed">${escapeHtml(msg)}</p>
          </div>
          ${!n.is_read ? `
            <button type="button" onclick="window.markNotifRead('${n.id}')" class="shrink-0 px-2.5 py-1 bg-white hover:bg-slate-100 border border-outline-variant rounded-lg text-[11px] font-bold text-primary shadow-xs cursor-pointer">
              Mark Read
            </button>
          ` : ''}
        </div>
      `;
    }).join("");
  }
  openModal("notificationsModal");
};

window.markNotifRead = async function (id) {
  try {
    await markNotificationAsRead(id);
    const n = (window.currentNotifications || []).find((item) => item.id === id);
    if (n) n.is_read = true;
    const badge = document.getElementById("notificationUnreadBadge");
    const unread = (window.currentNotifications || []).filter((item) => !item.is_read).length;
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
    window.openNotificationsModal();
  } catch (err) {
    showToast(err.message || "Failed to update notification.", "error");
  }
};

/**
 * Top 3 Dismissible Dashboard Notification Center
 */
function renderNotificationsCenter(announcements) {
  const container = document.getElementById("dashboardNotificationCenter");
  if (!container) return;

  let dismissed = [];
  try {
    dismissed = JSON.parse(localStorage.getItem("mria_dismissed_announcements") || "[]");
  } catch (e) {
    dismissed = [];
  }

  const items = [];

  // 1. Pending dues alert if balance > 0
  if (currentBalanceInfo.totalPending > 0 && !dismissed.includes("alert_dues_overdue")) {
    items.push({
      id: "alert_dues_overdue",
      isAlert: true,
      title: t("outstanding_dues"),
      content: t("alert_dues_overdue") + ` (${formatCurrency(currentBalanceInfo.totalPending)})`,
      priority: "urgent",
    });
  }

  // 2. Announcements
  const isSi = getLanguage() === "si";
  for (const ann of announcements) {
    if (!dismissed.includes(ann.id)) {
      items.push({
        id: ann.id,
        isAlert: false,
        title: isSi ? ann.title_si : ann.title_en,
        content: isSi ? ann.content_si : ann.content_en,
        priority: ann.priority || "normal",
      });
    }
  }

  // Slice top 3
  const top3 = items.slice(0, 3);

  if (top3.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = top3.map((item) => `
    <div id="notify-${item.id}" class="flex items-start justify-between gap-3 p-3.5 bg-white border ${item.priority === "urgent" ? "border-rose-200 bg-rose-50/40" : "border-sky-200 bg-sky-50/40"} rounded-xl shadow-sm">
      <div class="flex items-start gap-2.5">
        <span class="material-symbols-outlined text-[20px] ${item.priority === "urgent" ? "text-rose-600" : "text-sky-600"} mt-0.5">
          ${item.priority === "urgent" ? "warning" : "campaign"}
        </span>
        <div class="text-xs">
          <div class="font-bold text-on-surface flex items-center gap-2">
            <span>${item.title}</span>
            ${item.priority === "urgent" ? '<span class="px-1.5 py-0.2 text-[9px] font-bold bg-rose-100 text-rose-800 rounded">URGENT</span>' : ''}
          </div>
          <p class="text-on-surface-variant mt-0.5 leading-relaxed">${item.content}</p>
        </div>
      </div>
      <button onclick="dismissNotification('${item.id}')" class="text-on-surface-variant hover:text-on-surface p-1 text-xs font-semibold" title="${t("dismiss")}">
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  `).join("");
}

export function dismissNotification(id) {
  try {
    let dismissed = JSON.parse(localStorage.getItem("mria_dismissed_announcements") || "[]");
    if (!dismissed.includes(id)) {
      dismissed.push(id);
      localStorage.setItem("mria_dismissed_announcements", JSON.stringify(dismissed));
    }
    const el = document.getElementById(`notify-${id}`);
    if (el) el.remove();
  } catch (e) {
    console.warn("Dismiss save error:", e);
  }
}
window.dismissNotification = dismissNotification;

function renderMetrics(balanceInfo, dues) {
  // Card 1: Net Dues / Overdue Arrears / Advance Balance (Item 11)
  const duesDisplay = document.getElementById("outstandingDuesDisplay");
  const duesLabel = document.getElementById("outstandingDuesLabel");
  const duesBadge = document.getElementById("duesBadge");

  const netStanding = Number(balanceInfo.netStanding || 0);

  if (duesDisplay) {
    if (netStanding < 0) {
      if (duesLabel) duesLabel.textContent = t("overdue_arrears") || "Overdue Arrears";
      duesDisplay.textContent = formatCurrency(netStanding, { showSign: true });
      duesDisplay.classList.add("text-rose-600");
      duesDisplay.classList.remove("text-emerald-600", "text-on-surface");
      if (duesBadge) {
        duesBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-700";
        duesBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">warning</span><span>${t("pending")}</span>`;
      }
    } else if (netStanding > 0) {
      if (duesLabel) duesLabel.textContent = t("advance_balance") || "Advance Balance";
      duesDisplay.textContent = formatCurrency(netStanding, { showSign: true });
      duesDisplay.classList.add("text-emerald-600");
      duesDisplay.classList.remove("text-rose-600", "text-on-surface");
      if (duesBadge) {
        duesBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700";
        duesBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">savings</span><span>${t("advance_balance")}</span>`;
      }
    } else {
      if (duesLabel) duesLabel.textContent = t("outstanding_dues") || "Outstanding Dues";
      duesDisplay.textContent = formatCurrency(0);
      duesDisplay.classList.remove("text-rose-600", "text-emerald-600");
      duesDisplay.classList.add("text-on-surface");
      if (duesBadge) {
        duesBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700";
        duesBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">check_circle</span><span>${t("paid")}</span>`;
      }
    }
  }

  // Card 2: Cumulative Contributions Paid to Date (Item 10)
  const monthDueLabel = document.getElementById("currentMonthDueLabel");
  const monthAmountEl = document.getElementById("currentMonthAmountDisplay");
  const monthStatusBadge = document.getElementById("currentMonthStatusBadge");
  const lastPaymentDateDisplay = document.getElementById("lastPaymentDateDisplay");

  if (monthDueLabel) {
    monthDueLabel.textContent = t("cumulative_contributions") || "Contributions Paid to Date";
  }

  const ytdPaid = Number(
    balanceInfo.totalDuesPaid ??
    balanceInfo.totalPaid ??
    balanceInfo.ytdContributions ??
    balanceInfo.ytdPaid ??
    0
  );
  if (monthAmountEl) {
    monthAmountEl.textContent = formatCurrency(ytdPaid);
  }

  const latestPayment = (currentPayments && currentPayments.length > 0) ? currentPayments[0] : null;
  const lastPaymentTimestamp = latestPayment?.paid_at || latestPayment?.verified_at || latestPayment?.created_at || balanceInfo.lastPaymentDate;

  if (lastPaymentDateDisplay) {
    if (lastPaymentTimestamp) {
      lastPaymentDateDisplay.textContent = `Last: ${formatDate(lastPaymentTimestamp)}`;
    } else {
      lastPaymentDateDisplay.textContent = "Last: None";
    }
  }

  if (monthStatusBadge) {
    monthStatusBadge.className = "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700";
    monthStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">verified</span><span>Cumulative</span>`;
  }
}

function renderClaimsSummary(claims) {
  const totalClaimed = claims
    .filter((c) => c.status === "disbursed" || c.status === "approved")
    .reduce((sum, c) => sum + Number(c.disbursed_amount || c.claim_amount || 0), 0);

  const display = document.getElementById("benefitsClaimedDisplay");
  if (display) {
    display.textContent = formatCurrency(totalClaimed);
  }

  const lastClaimDateDisplay = document.getElementById("lastClaimDateDisplay");
  if (lastClaimDateDisplay && claims.length > 0) {
    lastClaimDateDisplay.textContent = `Last: ${formatDate(claims[0].created_at)}`;
  }
}

function renderDuesLedger(dues) {
  const tbody = document.getElementById("duesTableBody");
  if (!tbody) return;

  if (dues.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-on-surface-variant">${t("no_records")}</td></tr>`;
    return;
  }

  tbody.innerHTML = dues.map((due) => {
    const isPaid = due.status === "paid";
    return `
      <tr class="hover:bg-sky-50/30 transition-colors">
        <td class="py-2.5 px-3 font-semibold text-on-surface">${due.billing_month}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-right tabular-nums">${formatCurrency(due.amount)}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isPaid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}">
            <span class="material-symbols-outlined text-[13px]">${isPaid ? "check_circle" : "schedule"}</span>
            ${isPaid ? t("paid") : t("pending")}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right text-on-surface-variant font-mono">${formatDate(due.updated_at || due.created_at)}</td>
      </tr>
    `;
  }).join("");
}

let paymentsRenderLimit = 5;

function renderPaymentHistory(payments) {
  const tbody = document.getElementById("paymentsTableBody");
  const countEl = document.getElementById("paymentsCountDisplay");
  const loadMoreBtn = document.getElementById("btnLoadMorePayments");
  if (!tbody) return;

  if (!payments || payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">${t("no_records")}</td></tr>`;
    if (countEl) countEl.textContent = "Showing 0 transactions";
    if (loadMoreBtn) loadMoreBtn.classList.add("hidden");
    return;
  }

  const visibleList = payments.slice(0, paymentsRenderLimit);

  if (countEl) {
    countEl.textContent = `Showing ${visibleList.length} of ${payments.length} transactions`;
  }

  if (loadMoreBtn) {
    if (visibleList.length < payments.length) {
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.onclick = () => {
        paymentsRenderLimit += 25;
        renderPaymentHistory(payments);
      };
    } else {
      loadMoreBtn.classList.add("hidden");
    }
  }

  tbody.innerHTML = visibleList.map((p) => {
    const isVerified = p.status === "verified";
    const isVoided = p.status === "voided";
    const statusClass = isVerified
      ? "bg-emerald-50 text-emerald-700"
      : p.status === "rejected"
      ? "bg-rose-50 text-rose-700"
      : isVoided
      ? "bg-rose-50 text-rose-800"
      : "bg-amber-50 text-amber-700";

    const voucherAction = isVerified
      ? `<button onclick="window.viewReceipt('${p.id}')" class="inline-flex items-center gap-1 text-primary hover:underline font-bold">
           <span class="material-symbols-outlined text-[15px]">receipt_long</span>
           <span>${t("view_receipt")}</span>
         </button>`
      : `<span class="text-on-surface-variant text-[11px]">-</span>`;

    return `
      <tr class="hover:bg-sky-50/30 transition-colors">
        <td class="py-2.5 px-3 font-mono">${formatDate(p.created_at)}</td>
        <td class="py-2.5 px-3">
          <div class="font-medium text-on-surface capitalize">${escapeHtml((p.payment_type || "").replace(/_/g, " "))}</div>
          ${p.payment_method ? `<div class="text-[10px] text-on-surface-variant font-mono capitalize">${escapeHtml(p.payment_method.replace(/_/g, " "))}</div>` : ""}
          ${p.notes ? `<div class="text-[10px] text-primary italic max-w-xs truncate" title="${escapeHtml(p.notes)}">${escapeHtml(p.notes)}</div>` : ""}
        </td>
        <td class="py-2.5 px-3 font-mono font-bold text-right tabular-nums ${isVoided ? "line-through text-rose-600" : ""}">${formatCurrency(p.amount)}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass}">
            ${t(`status_${p.status}`) || p.status.toUpperCase()}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right">${voucherAction}</td>
      </tr>
    `;
  }).join("");
}

let claimsRenderLimit = 5;

function renderClaimsHistory(claims) {
  const tbody = document.getElementById("claimsTableBody");
  const countEl = document.getElementById("claimsCountDisplay");
  const loadMoreBtn = document.getElementById("btnLoadMoreClaims");
  if (!tbody) return;

  if (!claims || claims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">No welfare claims submitted yet.</td></tr>';
    if (countEl) countEl.textContent = "Showing 0 applications";
    if (loadMoreBtn) loadMoreBtn.classList.add("hidden");
    return;
  }

  const visibleList = claims.slice(0, claimsRenderLimit);

  if (countEl) {
    countEl.textContent = `Showing ${visibleList.length} of ${claims.length} applications`;
  }

  if (loadMoreBtn) {
    if (visibleList.length < claims.length) {
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.onclick = () => {
        claimsRenderLimit += 25;
        renderClaimsHistory(claims);
      };
    } else {
      loadMoreBtn.classList.add("hidden");
    }
  }

  tbody.innerHTML = visibleList.map((c) => {
    const bt = c.benefit_types || {};
    const title = getLanguage() === "si" ? (bt.title_si || bt.title_en) : (bt.title_en || "Welfare Aid");
    const isDisbursed = c.status === "disbursed";
    const isApproved = c.status === "approved";
    const statusClass = isDisbursed
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : isApproved
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : c.status === "rejected"
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : "bg-sky-50 text-sky-800 border-sky-200";

    const proofAction = c.document_key
      ? `<button onclick="window.viewProofModal('${c.document_key}')" class="inline-flex items-center gap-1 text-primary hover:underline font-bold text-xs cursor-pointer">
           <span class="material-symbols-outlined text-[15px]">attachment</span>
           <span>Proof</span>
         </button>`
      : `<span class="text-on-surface-variant text-[11px]">-</span>`;

    return `
      <tr class="hover:bg-sky-50/30 transition-colors">
        <td class="py-2.5 px-3 font-mono">${formatDate(c.created_at)}</td>
        <td class="py-2.5 px-3">
          <div class="font-medium text-on-surface">${escapeHtml(title)}</div>
          ${c.notes ? `<div class="text-[10px] text-on-surface-variant italic truncate max-w-xs" title="${escapeHtml(c.notes)}">${escapeHtml(c.notes)}</div>` : ""}
        </td>
        <td class="py-2.5 px-3 font-mono font-bold text-right tabular-nums text-primary">${formatCurrency(c.claim_amount)}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusClass}">
            ${c.status.toUpperCase()}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right">${proofAction}</td>
      </tr>
    `;
  }).join("");
}

window.viewProofModal = async function (key) {
  try {
    const signedUrl = await getSignedSlipUrl(key);
    if (signedUrl) {
      window.open(signedUrl, "_blank");
    }
  } catch (err) {
    showToast(err.message || "Failed to load proof document.", "error");
  }
};

window.viewReceipt = function (paymentId) {
  const p = currentPayments.find((item) => item.id === paymentId);
  if (!p) return;
  const container = document.getElementById("receiptModalContent");
  if (container) {
    container.innerHTML = renderReceiptHtml(p, currentMember?.full_name);
    openModal("receiptModal");
  }
};

function populateBenefitTypesDropdown(types) {
  const select = document.getElementById("benefitTypeSelect");
  if (!select) return;

  const isSi = getLanguage() === "si";
  select.innerHTML = '<option value="" disabled selected>-- Select Benefit --</option>';

  types.forEach((b) => {
    const title = isSi ? b.title_si : b.title_en;
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.dataset.maxAmount = b.max_amount;
    opt.textContent = `${title} (Max: ${formatCurrency(b.max_amount)})`;
    select.appendChild(opt);
  });

  // If only one benefit is active (e.g. Death Donation 20,000/=), auto-select it and populate the amount input
  if (types.length === 1) {
    select.value = types[0].id;
    const amountInput = document.getElementById("claimAmountInput");
    if (amountInput) {
      amountInput.value = types[0].max_amount;
      amountInput.max = types[0].max_amount;
    }
  }
}

function populatePaymentMonths() {
  const select = document.getElementById("paymentMonthSelect");
  if (!select) return;
  select.innerHTML = "";

  const pendingMonths = (currentDues || []).filter((d) => d.status === "pending");
  // Sort ascending so earliest unpaid month is first (FIFO, Item 12)
  pendingMonths.sort((a, b) => a.billing_month.localeCompare(b.billing_month));

  if (pendingMonths.length > 0) {
    pendingMonths.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.billing_month;
      opt.textContent = `${d.billing_month.slice(0, 7)} (Unpaid Dues: ${formatCurrency(d.amount)})`;
      select.appendChild(opt);
    });
    // Auto-select earliest unpaid month
    select.value = pendingMonths[0].billing_month;
  }

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (!pendingMonths.some((d) => d.billing_month === currentMonthStr)) {
    const opt = document.createElement("option");
    opt.value = currentMonthStr;
    opt.textContent = `${currentMonthStr.slice(0, 7)} (Current Month)`;
    select.appendChild(opt);
    if (pendingMonths.length === 0) {
      select.value = currentMonthStr;
    }
  }

  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  const nextOpt = document.createElement("option");
  nextOpt.value = nextMonthStr;
  nextOpt.textContent = `${nextMonthStr.slice(0, 7)} (Advance Contribution)`;
  select.appendChild(nextOpt);
}

function openPaymentModal() {
  const now = new Date();
  const dateEl = document.getElementById("paymentAutoDate");
  const timeEl = document.getElementById("paymentAutoTime");
  const nameEl = document.getElementById("paymentAutoName");
  const epfEl = document.getElementById("paymentAutoEpf");

  if (dateEl) {
    dateEl.textContent = now.toISOString().slice(0, 10);
  }
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (nameEl) {
    nameEl.textContent = currentMember?.full_name || currentMember?.email || "Member";
    nameEl.title = nameEl.textContent;
  }
  if (epfEl) {
    epfEl.textContent = currentMember?.epf_number || "PENDING";
  }

  populatePaymentMonths();

  const categorySelect = document.getElementById("paymentCategorySelect");
  const monthContainer = document.getElementById("paymentMonthContainer");
  if (categorySelect) categorySelect.value = "monthly_due";
  if (monthContainer) monthContainer.classList.remove("hidden");

  const methodSelect = document.getElementById("paymentMethodSelect");
  const slipSection = document.getElementById("paymentSlipUploadSection");
  const cashInstruction = document.getElementById("paymentCashInstruction");
  if (methodSelect) methodSelect.value = "bank_transfer";
  if (slipSection) slipSection.classList.remove("hidden");
  if (cashInstruction) cashInstruction.classList.add("hidden");

  openModal("payment-modal");
}

window.openPaymentModal = openPaymentModal;
window.openUploadSlipModal = openPaymentModal;

function setupActionListeners() {
  // Outstanding dues card click opens breakdown popup
  const duesCard = document.getElementById("outstandingDuesCard");
  if (duesCard) {
    duesCard.addEventListener("click", () => {
      openDuesBreakdownModal(currentDues, currentBalanceInfo);
    });
  }

  // Slip upload handlers: Camera vs File Browser vs Drag & Drop
  let selectedSlipFile = null;

  const cameraInput = document.getElementById("slipCameraInput");
  const fileInput = document.getElementById("slipFileInput");
  const btnCamera = document.getElementById("btnOpenSlipCamera");
  const btnBrowse = document.getElementById("btnBrowseSlipFile");
  const dropArea = document.getElementById("slipDropArea");
  const previewEmpty = document.getElementById("slipPreviewEmpty");
  const previewFilled = document.getElementById("slipPreviewFilled");
  const thumbnailImg = document.getElementById("slipThumbnail");
  const thumbnailName = document.getElementById("slipThumbnailName");
  const btnRemoveFile = document.getElementById("btnRemoveSlipFile");

  function handleSlipFileSelected(file) {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast("File size exceeds 5 MB. Please select or capture a smaller image.", "warning");
      return;
    }

    selectedSlipFile = file;

    if (previewEmpty) previewEmpty.classList.add("hidden");
    if (previewFilled) previewFilled.classList.remove("hidden");
    if (thumbnailName) {
      thumbnailName.textContent = `${file.name || "Captured Photo"} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    }

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (thumbnailImg) {
          thumbnailImg.src = e.target.result;
          thumbnailImg.classList.remove("hidden");
        }
      };
      reader.readAsDataURL(file);
    } else {
      if (thumbnailImg) {
        thumbnailImg.classList.add("hidden");
      }
    }
  }

  function resetSlipFile() {
    selectedSlipFile = null;
    if (cameraInput) cameraInput.value = "";
    if (fileInput) fileInput.value = "";
    if (previewEmpty) previewEmpty.classList.remove("hidden");
    if (previewFilled) previewFilled.classList.add("hidden");
    if (thumbnailImg) thumbnailImg.src = "";
    if (thumbnailName) thumbnailName.textContent = "";
  }

  if (btnCamera && cameraInput) {
    btnCamera.addEventListener("click", () => {
      cameraInput.click();
    });
  }

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener("click", () => {
      fileInput.click();
    });
  }

  if (dropArea) {
    dropArea.addEventListener("click", (e) => {
      if (e.target.closest("#btnRemoveSlipFile")) return;
      if (!selectedSlipFile && fileInput) {
        fileInput.click();
      }
    });

    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("bg-sky-100/70", "border-primary");
    });

    dropArea.addEventListener("dragleave", () => {
      dropArea.classList.remove("bg-sky-100/70", "border-primary");
    });

    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("bg-sky-100/70", "border-primary");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSlipFileSelected(e.dataTransfer.files[0]);
      }
    });
  }

  if (cameraInput) {
    cameraInput.addEventListener("change", () => {
      if (cameraInput.files && cameraInput.files[0]) {
        handleSlipFileSelected(cameraInput.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        handleSlipFileSelected(fileInput.files[0]);
      }
    });
  }

  if (btnRemoveFile) {
    btnRemoveFile.addEventListener("click", (e) => {
      e.stopPropagation();
      resetSlipFile();
    });
  }

  // Toggle dynamic month selection when payment category changes
  const paymentCategorySelect = document.getElementById("paymentCategorySelect");
  const paymentMonthContainer = document.getElementById("paymentMonthContainer");
  if (paymentCategorySelect && paymentMonthContainer) {
    paymentCategorySelect.addEventListener("change", () => {
      paymentMonthContainer.classList.toggle("hidden", paymentCategorySelect.value !== "monthly_due");
    });
  }

  // Toggle slip upload vs cash instruction when payment method changes
  const paymentMethodSelect = document.getElementById("paymentMethodSelect");
  const paymentSlipUploadSection = document.getElementById("paymentSlipUploadSection");
  const paymentCashInstruction = document.getElementById("paymentCashInstruction");
  if (paymentMethodSelect) {
    paymentMethodSelect.addEventListener("change", () => {
      const isCash = paymentMethodSelect.value === "cash";
      if (paymentSlipUploadSection) {
        paymentSlipUploadSection.classList.toggle("hidden", isCash);
      }
      if (paymentCashInstruction) {
        paymentCashInstruction.classList.toggle("hidden", !isCash);
      }
    });
  }

  // Payment form submission
  const paymentForm = document.getElementById("paymentForm");
  if (paymentForm) {
    paymentForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const category = document.getElementById("paymentCategorySelect")?.value || "monthly_due";
      const method = document.getElementById("paymentMethodSelect")?.value || "bank_transfer";
      const amount = Number(document.getElementById("paymentAmountInput")?.value);
      const selectedMonth = document.getElementById("paymentMonthSelect")?.value;
      const remarks = (document.getElementById("paymentRemarksInput")?.value || "").trim();

      if (!amount || amount <= 0) {
        showToast("Please enter a valid amount.", "warning");
        return;
      }

      // If bank_transfer or qr_payment, slip file is required
      if ((method === "bank_transfer" || method === "qr_payment") && !selectedSlipFile) {
        showToast("Please capture a photo with camera or choose a deposit slip file.", "warning");
        return;
      }

      const submitBtn = paymentForm.querySelector("button[type='submit']");
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting Payment...";
        }

        let slipKey = null;
        if (selectedSlipFile && (method === "bank_transfer" || method === "qr_payment")) {
          if (submitBtn) submitBtn.textContent = "Uploading Slip File...";
          slipKey = await uploadBankSlip(selectedSlipFile);
        }

        let formattedNotes = "";
        if (category === "monthly_due" && selectedMonth) {
          formattedNotes = `[Billing Month: ${selectedMonth.slice(0, 7)}]`;
        }
        if (remarks) {
          formattedNotes = formattedNotes ? `${formattedNotes} ${remarks}` : remarks;
        }

        await submitPayment({
          memberId: currentMember.id,
          amount,
          paymentType: category,
          paymentMethod: method,
          slipKey,
          notes: formattedNotes || null,
        });

        showToast(t("payment_submitted_success") || "Payment submitted successfully for verification!", "success");
        closeModal("payment-modal");
        paymentForm.reset();
        resetSlipFile();

        await refreshDashboardData();
      } catch (err) {
        console.error("Payment submission error:", err);
        showToast(err.message || "Failed to submit payment.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">check_circle</span>
            <span>${t("submit_slip") || "Submit Payment"}</span>
          `;
        }
      }
    });
  }

  // Claim form submission & proof upload controls (Item 13)
  let selectedClaimProofFile = null;
  const btnClaimCamera = document.getElementById("btnOpenClaimCamera");
  const btnClaimBrowse = document.getElementById("btnBrowseClaimFile");
  const claimCamInput = document.getElementById("claimCameraInput");
  const claimFileInput = document.getElementById("claimFileInput");
  const claimDropArea = document.getElementById("claimDropArea");
  const btnRemoveClaim = document.getElementById("btnRemoveClaimFile");

  function setClaimFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("Proof document must be under 5MB.", "warning");
      return;
    }
    selectedClaimProofFile = file;
    const emptyEl = document.getElementById("claimPreviewEmpty");
    const filledEl = document.getElementById("claimPreviewFilled");
    const nameEl = document.getElementById("claimFileName");
    if (nameEl) nameEl.textContent = file.name;
    if (emptyEl) emptyEl.classList.add("hidden");
    if (filledEl) filledEl.classList.remove("hidden");
  }

  function resetClaimProofFile() {
    selectedClaimProofFile = null;
    if (claimCamInput) claimCamInput.value = "";
    if (claimFileInput) claimFileInput.value = "";
    const emptyEl = document.getElementById("claimPreviewEmpty");
    const filledEl = document.getElementById("claimPreviewFilled");
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (filledEl) filledEl.classList.add("hidden");
  }

  if (btnClaimCamera && claimCamInput) {
    btnClaimCamera.addEventListener("click", () => claimCamInput.click());
    claimCamInput.addEventListener("change", (e) => setClaimFile(e.target.files[0]));
  }
  if (btnClaimBrowse && claimFileInput) {
    btnClaimBrowse.addEventListener("click", () => claimFileInput.click());
    claimFileInput.addEventListener("change", (e) => setClaimFile(e.target.files[0]));
  }
  if (btnRemoveClaim) {
    btnRemoveClaim.addEventListener("click", (e) => {
      e.stopPropagation();
      resetClaimProofFile();
    });
  }
  if (claimDropArea) {
    claimDropArea.addEventListener("click", () => {
      if (!selectedClaimProofFile && claimFileInput) claimFileInput.click();
    });
    claimDropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      claimDropArea.classList.add("bg-sky-100/60");
    });
    claimDropArea.addEventListener("dragleave", () => {
      claimDropArea.classList.remove("bg-sky-100/60");
    });
    claimDropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      claimDropArea.classList.remove("bg-sky-100/60");
      if (e.dataTransfer?.files?.[0]) {
        setClaimFile(e.dataTransfer.files[0]);
      }
    });
  }

  const claimForm = document.getElementById("claimForm");
  const benefitTypeSelect = document.getElementById("benefitTypeSelect");
  const claimAmountInput = document.getElementById("claimAmountInput");

  if (benefitTypeSelect && claimAmountInput) {
    benefitTypeSelect.addEventListener("change", () => {
      const selected = benefitTypeSelect.selectedOptions[0];
      if (selected && selected.dataset.maxAmount) {
        claimAmountInput.value = selected.dataset.maxAmount;
        claimAmountInput.max = selected.dataset.maxAmount;
      }
    });
  }

  if (claimForm) {
    claimForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const benefitTypeSelect = document.getElementById("benefitTypeSelect");
      const amountInput = document.getElementById("claimAmountInput");
      const notesInput = document.getElementById("claimNotesInput");

      if (!benefitTypeSelect.value) {
        showToast("Please select a welfare benefit category.", "warning");
        return;
      }

      const claimAmount = Number(amountInput.value);
      if (!claimAmount || claimAmount <= 0) {
        showToast("Please enter a valid claim amount.", "warning");
        return;
      }

      const submitBtn = claimForm.querySelector("button[type='submit']");
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting Application...";
        }

        let documentKey = null;
        if (selectedClaimProofFile) {
          if (submitBtn) submitBtn.textContent = "Uploading Proof Document...";
          documentKey = await uploadStorageFile(selectedClaimProofFile, "claims");
        }

        if (submitBtn) submitBtn.textContent = "Submitting Application...";
        await submitBenefitClaim({
          memberId: currentMember.id,
          benefitTypeId: benefitTypeSelect.value,
          claimAmount,
          notes: notesInput ? notesInput.value : null,
          documentKey,
        });

        showToast(t("claim_submitted_success"), "success");
        closeModal("claim-modal");
        claimForm.reset();
        resetClaimProofFile();

        await refreshDashboardData();
      } catch (err) {
        console.error("Claim submission error:", err);
        showToast(err.message || "Failed to submit claim.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t("submit_claim");
        }
      }
    });
  }
}
