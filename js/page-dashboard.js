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
import { initLanguage, t } from "./i18n.js";
import {
  showToast,
  openModal,
  closeModal,
  setupModalDismissers,
  initOfflineDetection,
  formatCurrency,
  formatDate,
} from "./ui.js";

let currentMember = null;
let currentBenefitTypes = [];

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();
  initOfflineDetection();
  setupModalDismissers();

  // 1. Authenticate and verify approved membership
  const authState = await requireAuth({ requireApproved: true });
  if (!authState) return;

  const { user, member } = authState;
  currentMember = member;

  // 2. Render user identity
  renderUserIdentity(member);

  // 3. Load all dashboard metrics and datasets
  await refreshDashboardData();

  // 4. Attach event listeners for Modals & Actions
  setupActionListeners();
});

function renderUserIdentity(member) {
  const nameDisplays = document.querySelectorAll("[data-member-name], #memberNameDisplay");
  nameDisplays.forEach((el) => (el.textContent = member.full_name || member.email));

  const roleDisplays = document.querySelectorAll("[data-member-role], #memberRoleDisplay");
  roleDisplays.forEach((el) => {
    el.textContent = t(`role_${member.role}`) || member.role.toUpperCase();
  });

  // If user has administrative privileges, display Admin link
  const staffRoles = ["admin", "manager", "official", "treasurer"];
  if (staffRoles.includes(member.role)) {
    const adminLinkContainer = document.getElementById("adminPortalLinkContainer");
    if (adminLinkContainer) {
      adminLinkContainer.classList.remove("hidden");
    } else {
      // Append an Admin Console button in the top navbar if not present
      const navRight = document.querySelector("header nav, nav .flex.items-center");
      if (navRight && !document.getElementById("adminConsoleBtn")) {
        const adminBtn = document.createElement("a");
        adminBtn.id = "adminConsoleBtn";
        adminBtn.href = "/admin.html";
        adminBtn.className = "flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors";
        adminBtn.innerHTML = `
          <span class="material-symbols-outlined text-[16px]">admin_panel_settings</span>
          <span>Admin Console</span>
        `;
        navRight.prepend(adminBtn);
      }
    }
  }

  // Wire Sign Out buttons
  document.querySelectorAll("[data-action='signout'], #signOutBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  });
}

async function refreshDashboardData() {
  if (!currentMember) return;

  try {
    // A. Announcements
    const announcements = await getAnnouncements();
    renderAnnouncements(announcements);

    // B. Bank QR Code
    const bankQrSetting = await getSystemSetting("bank_qr");
    if (bankQrSetting && bankQrSetting.url) {
      const qrImg = document.getElementById("bankQrImg");
      if (qrImg) qrImg.src = bankQrSetting.url;
    }

    // C. Financial Metrics & Dues Balance
    const balanceInfo = await calculateMemberBalance(currentMember);
    renderMetrics(balanceInfo);

    // D. Monthly Dues Ledger Table
    const dues = await getMemberDues(currentMember.id);
    renderDuesLedger(dues);

    // E. Payments & Slips List
    const payments = await getMemberPayments(currentMember.id);
    renderPaymentHistory(payments);

    // F. Welfare Benefit Claims & Modal options
    currentBenefitTypes = await getBenefitTypes();
    populateBenefitTypesDropdown(currentBenefitTypes);
    const claims = await getMemberClaims(currentMember.id);
    renderClaimsSummary(claims);

  } catch (err) {
    console.error("Failed to refresh dashboard data:", err);
    showToast("Error loading financial data.", "error");
  }
}

function renderAnnouncements(announcements) {
  const container = document.getElementById("announcementsBanner") || document.getElementById("announcementsContainer");
  if (!container) return;

  if (!announcements || announcements.length === 0) {
    container.classList.add("hidden");
    return;
  }

  const pinned = announcements.find((a) => a.is_pinned) || announcements[0];
  const lang = localStorage.getItem("mria_lang") || "en";
  const title = lang === "si" ? pinned.title_si : pinned.title_en;
  const content = lang === "si" ? pinned.content_si : pinned.content_en;

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="flex items-start gap-3 p-3 bg-sky-50/80 border border-sky-100 rounded-lg text-slate-800">
      <span class="material-symbols-outlined text-sky-600 mt-0.5 text-xl">campaign</span>
      <div class="flex-1 text-sm">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-slate-900">${title}</span>
          ${pinned.priority === "urgent" ? '<span class="px-1.5 py-0.2 text-[10px] font-bold bg-rose-100 text-rose-700 rounded">URGENT</span>' : ''}
        </div>
        <p class="text-slate-600 text-xs mt-0.5 leading-relaxed">${content}</p>
      </div>
    </div>
  `;
}

function renderMetrics(balanceInfo) {
  // 1. Outstanding Pending Dues
  const duesDisplay = document.querySelector("[data-metric='outstanding-dues'], #outstandingDuesDisplay");
  if (duesDisplay) {
    duesDisplay.textContent = formatCurrency(balanceInfo.totalPending);
    if (balanceInfo.totalPending > 0) {
      duesDisplay.classList.add("text-rose-600");
      duesDisplay.classList.remove("text-slate-900", "text-emerald-600");
    } else {
      duesDisplay.classList.add("text-emerald-600");
      duesDisplay.classList.remove("text-rose-600", "text-slate-900");
    }
  }

  // 2. Current Month Status
  const currentMonthStr = new Date().toISOString().slice(0, 7) + "-01";
  const currentMonthDue = balanceInfo.pendingDues.find((d) => d.billing_month === currentMonthStr);
  const monthStatusTag = document.querySelector("[data-metric='month-status'], #monthStatusTag");

  if (monthStatusTag) {
    if (!currentMonthDue) {
      monthStatusTag.innerHTML = `
        <span class="inline-flex items-center gap-1 text-emerald-600 font-medium">
          <span class="material-symbols-outlined text-sm">check_circle</span> Settled
        </span>
      `;
    } else {
      monthStatusTag.innerHTML = `
        <span class="inline-flex items-center gap-1 text-rose-600 font-medium">
          <span class="material-symbols-outlined text-sm">schedule</span> Due by 31st
        </span>
      `;
    }
  }
}

function renderClaimsSummary(claims) {
  const totalClaimed = claims
    .filter((c) => c.status === "disbursed" || c.status === "approved")
    .reduce((sum, c) => sum + Number(c.disbursed_amount || c.claim_amount || 0), 0);

  const display = document.querySelector("[data-metric='benefits-claimed'], #benefitsClaimedDisplay");
  if (display) {
    display.textContent = formatCurrency(totalClaimed);
  }
}

function renderDuesLedger(dues) {
  const tbody = document.getElementById("duesTableBody") || document.querySelector("#duesTable tbody");
  if (!tbody) return;

  if (dues.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="px-4 py-6 text-center text-xs text-slate-400">No monthly dues records found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = dues
    .map((due) => {
      const monthDate = new Date(due.billing_month);
      const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const isPaid = due.status === "paid";
      const statusBadge = isPaid
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Paid</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">Pending</span>';

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
          <td class="px-4 py-3 text-sm font-medium text-slate-800">${monthLabel}</td>
          <td class="px-4 py-3 text-sm font-mono text-slate-700">${formatCurrency(due.amount)}</td>
          <td class="px-4 py-3 text-sm">${statusBadge}</td>
          <td class="px-4 py-3 text-xs text-slate-400">${formatDate(due.updated_at || due.created_at)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPaymentHistory(payments) {
  const tbody = document.getElementById("paymentsTableBody") || document.querySelector("#paymentsTable tbody");
  if (!tbody) return;

  if (payments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-4 py-6 text-center text-xs text-slate-400">No payment slips or transactions recorded yet.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = payments
    .map((p) => {
      const statusMap = {
        pending_approval: '<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">Pending Approval</span>',
        verified: '<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Verified</span>',
        rejected: '<span class="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">Rejected</span>',
      };

      const typeLabels = {
        monthly_due: "Monthly Due",
        admission_fee: "Admission Fee",
        donation: "Donation",
      };

      const receiptBtn = p.status === "verified"
        ? `<button data-receipt-id="${p.id}" class="view-receipt-btn text-xs text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1">
             <span class="material-symbols-outlined text-sm">receipt_long</span> Receipt
           </button>`
        : '<span class="text-xs text-slate-400">-</span>';

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
          <td class="px-4 py-3 text-xs text-slate-500 font-mono">${formatDate(p.created_at)}</td>
          <td class="px-4 py-3 text-sm font-medium text-slate-800">${typeLabels[p.payment_type] || p.payment_type}</td>
          <td class="px-4 py-3 text-sm font-mono font-semibold text-slate-900">${formatCurrency(p.amount)}</td>
          <td class="px-4 py-3 text-sm">${statusMap[p.status] || p.status}</td>
          <td class="px-4 py-3 text-sm">${receiptBtn}</td>
        </tr>
      `;
    })
    .join("");

  // Attach receipt button click handlers
  document.querySelectorAll(".view-receipt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paymentId = btn.getAttribute("data-receipt-id");
      const payment = payments.find((item) => item.id === paymentId);
      if (payment) openReceiptModal(payment);
    });
  });
}

function openReceiptModal(payment) {
  const container = document.getElementById("receiptModalContent") || document.querySelector("#receiptModal .modal-body");
  if (container) {
    const memberName = currentMember ? (currentMember.full_name || currentMember.email) : "Association Member";
    container.innerHTML = renderReceiptHtml(payment, memberName);
  }
  openModal("receiptModal");
}

if (typeof window !== "undefined") {
  window.openReceiptModal = function (param1, amount, recRef, date) {
    if (typeof param1 === "object" && param1 !== null) {
      return openReceiptModal(param1);
    }
    const mockPayment = {
      id: (recRef || "REC000").replace(/[^a-zA-Z0-9]/g, ""),
      amount: parseFloat((amount || "1000").replace(/,/g, "")) || 1000,
      payment_type: "monthly_due",
      payment_method: "bank_transfer",
      status: "verified",
      paid_at: date || new Date().toISOString(),
    };
    openReceiptModal(mockPayment);
  };
}

function populateBenefitTypesDropdown(benefitTypes) {
  const select = document.getElementById("benefitTypeSelect") || document.querySelector("#claimForm select[name='benefit_type']");
  if (!select) return;

  const lang = localStorage.getItem("mria_lang") || "en";
  select.innerHTML = '<option value="" disabled selected>-- Select Welfare Benefit --</option>';

  benefitTypes.forEach((b) => {
    const title = lang === "si" ? b.title_si : b.title_en;
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = `${title} (Max: ${formatCurrency(b.max_amount)})`;
    select.appendChild(opt);
  });
}

function setupActionListeners() {
  // Modal Triggers
  document.querySelectorAll("[data-open-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-open-modal");
      openModal(modalId);
    });
  });

  // Slip File Input preview
  const slipInput = document.getElementById("slipFileInput");
  const fileChosenLabel = document.getElementById("fileChosenLabel");
  if (slipInput && fileChosenLabel) {
    slipInput.addEventListener("change", () => {
      if (slipInput.files && slipInput.files[0]) {
        fileChosenLabel.textContent = `Selected: ${slipInput.files[0].name} (${(slipInput.files[0].size / 1024 / 1024).toFixed(2)} MB)`;
        fileChosenLabel.classList.add("text-sky-700");
      }
    });
  }

  // Slip Upload Form Submit
  const slipForm = document.getElementById("slipForm");
  if (slipForm) {
    slipForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!slipInput || !slipInput.files || !slipInput.files[0]) {
        showToast("Please choose a bank slip file to upload.", "warning");
        return;
      }

      const file = slipInput.files[0];
      const categorySelect = slipForm.querySelector("select[name='payment_category']") || document.getElementById("slipCategorySelect");
      const amountInput = slipForm.querySelector("input[name='amount']") || document.getElementById("slipAmountInput");
      const submitBtn = slipForm.querySelector("button[type='submit']");

      const paymentType = categorySelect ? categorySelect.value : "monthly_due";
      const amount = amountInput ? Number(amountInput.value) : 500;

      if (!amount || amount <= 0) {
        showToast("Please enter a valid payment amount.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Uploading & Submitting...";
        }

        // 1. Upload file binary via S3 presigned URL
        const slipKey = await uploadBankSlip(file);

        // 2. Insert payment record into database
        await submitPayment({
          memberId: currentMember.id,
          amount,
          paymentType,
          paymentMethod: "bank_transfer",
          slipKey,
        });

        showToast("Bank slip submitted successfully for treasurer verification!", "success");
        closeModal("slip-upload-modal");
        slipForm.reset();
        if (fileChosenLabel) fileChosenLabel.textContent = "Drag and drop deposit receipt here, or browse files";

        // Refresh data
        await refreshDashboardData();
      } catch (err) {
        console.error("Slip upload error:", err);
        showToast(err.message || "Failed to submit bank slip.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Payment Slip";
        }
      }
    });
  }

  // Welfare Claim Form Submit
  const claimForm = document.getElementById("claimForm");
  if (claimForm) {
    claimForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const select = claimForm.querySelector("select") || document.getElementById("benefitTypeSelect");
      const amountInput = claimForm.querySelector("input[type='number']") || document.getElementById("claimAmountInput");
      const notesInput = claimForm.querySelector("textarea") || document.getElementById("claimNotesInput");
      const submitBtn = claimForm.querySelector("button[type='submit']");

      if (!select || !select.value) {
        showToast("Please select a welfare benefit type.", "warning");
        return;
      }

      const claimAmount = Number(amountInput ? amountInput.value : 0);
      if (!claimAmount || claimAmount <= 0) {
        showToast("Please enter a valid claim amount.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting Application...";
        }

        await submitBenefitClaim({
          memberId: currentMember.id,
          benefitTypeId: select.value,
          claimAmount,
          notes: notesInput ? notesInput.value : null,
        });

        showToast("Welfare benefit application submitted successfully for review!", "success");
        closeModal("claim-modal");
        claimForm.reset();

        await refreshDashboardData();
      } catch (err) {
        console.error("Claim submit error:", err);
        showToast(err.message || "Failed to submit welfare claim.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Application";
        }
      }
    });
  }
}
