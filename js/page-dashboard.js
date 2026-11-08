import { requireAuth, signOut } from "./auth.js";
import {
  calculateMemberBalance,
  getMemberDues,
  getMemberPayments,
  getMemberClaims,
  getBenefitTypes,
  getAnnouncements,
  getSystemSetting,
  submitPayment,
  submitBenefitClaim,
} from "./api.js";
import { uploadBankSlip } from "./storage.js";
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

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();
  initOfflineDetection();
  setupModalDismissers();

  // 1. Authenticate and verify approved membership
  const authState = await requireAuth({ requireApproved: true });
  if (!authState) return;

  const { user, member } = authState;
  currentMember = member;

  // 2. Render user identity in header
  renderUserIdentity(member);

  // 3. Load all dashboard metrics and datasets
  await refreshDashboardData();

  // 4. Attach event listeners
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
    currentDues = await getMemberDues(currentMember.id);
    currentBalanceInfo = await calculateMemberBalance(currentMember);
    renderMetrics(currentBalanceInfo, currentDues);
    renderDuesLedger(currentDues);

    // D. Payment History
    currentPayments = await getMemberPayments(currentMember.id);
    renderPaymentHistory(currentPayments);

    // E. Welfare Benefit Claims
    const benefitTypes = await getBenefitTypes();
    populateBenefitTypesDropdown(benefitTypes);
    currentClaims = await getMemberClaims(currentMember.id);
    renderClaimsSummary(currentClaims);

  } catch (err) {
    console.error("Failed to refresh dashboard data:", err);
    showToast("Error loading financial ledger data.", "error");
  }
}

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
  // Outstanding Dues
  const duesDisplay = document.getElementById("outstandingDuesDisplay");
  const duesBadge = document.getElementById("duesBadge");

  if (duesDisplay) {
    duesDisplay.textContent = formatCurrency(balanceInfo.totalPending || 0);
    if (balanceInfo.totalPending > 0) {
      duesDisplay.classList.add("text-rose-600");
      duesDisplay.classList.remove("text-on-surface");
      if (duesBadge) {
        duesBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-700";
        duesBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">warning</span><span>${t("pending")}</span>`;
      }
    } else {
      duesDisplay.classList.remove("text-rose-600");
      duesDisplay.classList.add("text-on-surface");
      if (duesBadge) {
        duesBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700";
        duesBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">check_circle</span><span>${t("paid")}</span>`;
      }
    }
  }

  // Current Month Due Card
  const currentMonthDue = dues.find((d) => d.status === "pending");
  const monthStatusBadge = document.getElementById("currentMonthStatusBadge");
  const lastPaymentDateDisplay = document.getElementById("lastPaymentDateDisplay");

  if (currentPayments.length > 0) {
    const lastPayment = currentPayments[0];
    if (lastPaymentDateDisplay) {
      lastPaymentDateDisplay.textContent = `Last: ${formatDate(lastPayment.verified_at || lastPayment.created_at)}`;
    }
  }

  if (monthStatusBadge) {
    if (!currentMonthDue) {
      monthStatusBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700";
      monthStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">verified</span><span>${t("paid")}</span>`;
    } else {
      monthStatusBadge.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-700";
      monthStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[14px]">schedule</span><span>${t("pending")}</span>`;
    }
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
        <td class="py-2.5 px-3 font-mono font-bold">${formatCurrency(due.amount)}</td>
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

function renderPaymentHistory(payments) {
  const tbody = document.getElementById("paymentsTableBody");
  if (!tbody) return;

  if (payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">${t("no_records")}</td></tr>`;
    return;
  }

  tbody.innerHTML = payments.map((p) => {
    const isVerified = p.status === "verified";
    const statusClass = isVerified
      ? "bg-emerald-50 text-emerald-700"
      : p.status === "rejected"
      ? "bg-rose-50 text-rose-700"
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
        <td class="py-2.5 px-3 font-medium capitalize">${(p.payment_type || "").replace(/_/g, " ")}</td>
        <td class="py-2.5 px-3 font-mono font-bold">${formatCurrency(p.amount)}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass}">
            ${t(`status_${p.status}`) || p.status}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right">${voucherAction}</td>
      </tr>
    `;
  }).join("");
}

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
    opt.textContent = `${title} (Max: ${formatCurrency(b.max_amount)})`;
    select.appendChild(opt);
  });
}

function setupActionListeners() {
  // Outstanding dues card click opens breakdown popup
  const duesCard = document.getElementById("outstandingDuesCard");
  if (duesCard) {
    duesCard.addEventListener("click", () => {
      openDuesBreakdownModal(currentDues, currentBalanceInfo);
    });
  }

  // File chosen preview for slip upload
  const fileInput = document.getElementById("slipFileInput");
  const fileLabel = document.getElementById("fileChosenLabel");
  if (fileInput && fileLabel) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        fileLabel.textContent = `Selected: ${fileInput.files[0].name} (${(fileInput.files[0].size / 1024 / 1024).toFixed(2)} MB)`;
        fileLabel.classList.add("text-primary", "font-bold");
      }
    });
  }

  // Slip form submission
  const slipForm = document.getElementById("slipForm");
  if (slipForm) {
    slipForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        showToast("Please choose a bank slip file to upload.", "warning");
        return;
      }

      const file = fileInput.files[0];
      const category = document.getElementById("slipCategorySelect").value;
      const amount = Number(document.getElementById("slipAmountInput").value);

      if (!amount || amount <= 0) {
        showToast("Please enter a valid amount.", "warning");
        return;
      }

      const submitBtn = slipForm.querySelector("button[type='submit']");
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Uploading & Submitting...";
        }

        // Upload to Cloudflare R2
        const slipKey = await uploadBankSlip(file);

        // Record payment in Supabase
        await submitPayment({
          memberId: currentMember.id,
          amount,
          paymentType: category,
          paymentMethod: "bank_transfer",
          slipKey,
        });

        showToast("Bank slip uploaded successfully for treasurer verification!", "success");
        closeModal("slip-upload-modal");
        slipForm.reset();
        if (fileLabel) fileLabel.textContent = t("drop_file_here");

        await refreshDashboardData();
      } catch (err) {
        console.error("Slip submission error:", err);
        showToast(err.message || "Failed to submit bank slip.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t("submit_slip");
        }
      }
    });
  }

  // Claim form submission
  const claimForm = document.getElementById("claimForm");
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

        await submitBenefitClaim({
          memberId: currentMember.id,
          benefitTypeId: benefitTypeSelect.value,
          claimAmount,
          notes: notesInput ? notesInput.value : null,
        });

        showToast(t("claim_submitted_success"), "success");
        closeModal("claim-modal");
        claimForm.reset();

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
