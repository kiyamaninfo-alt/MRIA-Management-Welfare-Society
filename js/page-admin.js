import { requireAuth, signOut } from "./auth.js";
import {
  getPendingPayments,
  verifyPayment,
  rejectPayment,
  recordCashPayment,
  getDefaultersRoster,
  getAllMembers,
  updateMemberRole,
  updateMemberProfile,
  createMember,
  getAllBenefitClaims,
  reviewBenefitClaim,
  disburseBenefitClaim,
  getTreasuryBalances,
  recordTreasuryTransaction,
  getTreasuryStatement,
  getAuditLogs,
  getSystemSetting,
  updateSystemSetting,
  getAllBenefitTypes,
  updateBenefitType,
  createBenefitType,
  deleteBenefitType,
} from "./api.js";
import { getSignedSlipUrl } from "./storage.js";
import { renderReceiptHtml } from "./receipt.js";
import { exportTreasuryStatementToCsv, printTreasuryStatementPdf, getAccountSummariesFromStatement } from "./treasury-export.js";
import { initLanguage, t, getLanguage } from "./i18n.js";
import {
  showToast,
  openModal,
  closeModal,
  setupModalDismissers,
  initOfflineDetection,
  formatCurrency,
  formatDate,
} from "./ui.js";

let currentStaff = null;
let allMembers = [];
let pendingPayments = [];
let currentStatementData = null;
let currentQrDataUrl = "/assets/default-bank-qr.svg";

// Role-based Module Permissions Matrix
const ROLE_TABS = {
  admin: ["slips", "cash", "treasury", "secretary", "claims", "defaulters", "cms", "audit"],
  manager: ["slips", "cash", "treasury", "secretary", "claims", "defaulters", "cms", "audit"],
  treasurer: ["treasury", "slips", "cash", "defaulters", "cms", "audit"],
  secretary: ["secretary", "claims", "defaulters", "cms"],
  committee_member: ["claims", "defaulters"],
};

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();
  initOfflineDetection();
  setupModalDismissers();

  const staffRoles = ["admin", "manager", "secretary", "treasurer", "committee_member"];
  const authState = await requireAuth({ requireApproved: true, allowedRoles: staffRoles });
  if (!authState) return;

  const { member } = authState;
  currentStaff = member;

  // Render staff header
  renderStaffHeader(member);

  // Filter tabs according to RBAC role
  applyRoleTabPermissions(member.role);

  // Initialize data
  await loadInitialData();

  // Setup form actions
  setupAdminForms();
});

function renderStaffHeader(member) {
  const nameEl = document.getElementById("staffNameDisplay");
  if (nameEl) nameEl.textContent = member.full_name || member.email;

  const roleEl = document.getElementById("staffRoleBadge");
  if (roleEl) roleEl.textContent = t(`role_${member.role}`) || member.role.toUpperCase();

  const epfEl = document.getElementById("staffEpfDisplay");
  if (epfEl) epfEl.textContent = `EPF: ${member.epf_number || "N/A"}`;

  document.querySelectorAll("[data-action='signout']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  });
}

function applyRoleTabPermissions(role) {
  const allowed = ROLE_TABS[role] || ["claims"];
  const tabButtons = document.querySelectorAll("#adminTabsNav .tab-button");

  let firstAllowedTab = null;

  tabButtons.forEach((btn) => {
    const tabKey = btn.id.replace("tab-btn-", "");
    if (allowed.includes(tabKey)) {
      btn.classList.remove("hidden");
      if (!firstAllowedTab) firstAllowedTab = tabKey;
    } else {
      btn.classList.add("hidden");
    }
  });

  // Switch to first allowed tab
  if (firstAllowedTab) {
    switchAdminTab(firstAllowedTab);
  }
}

export function switchAdminTab(targetTab) {
  const tabButtons = document.querySelectorAll("#adminTabsNav .tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    const tabKey = btn.id.replace("tab-btn-", "");
    if (tabKey === targetTab) {
      btn.classList.add("active-tab", "bg-sky-100", "text-primary");
      btn.classList.remove("text-on-surface-variant");
    } else {
      btn.classList.remove("active-tab", "bg-sky-100", "text-primary");
      btn.classList.add("text-on-surface-variant");
    }
  });

  tabContents.forEach((c) => {
    if (c.id === `tab-content-${targetTab}`) {
      c.classList.remove("hidden");
      c.classList.add("block");
    } else {
      c.classList.add("hidden");
      c.classList.remove("block");
    }
  });

  // Lazy-load data for active tab
  if (targetTab === "treasury") loadTreasuryData();
  if (targetTab === "secretary") loadSecretaryData();
  if (targetTab === "claims") loadClaimsData();
  if (targetTab === "defaulters") loadDefaultersData();
  if (targetTab === "cms") {
    loadBankSettings();
    loadDuesSettings();
    loadBenefitTypesSettings();
  }
  if (targetTab === "audit") loadAuditLogsData();
}
window.switchAdminTab = switchAdminTab;

async function loadInitialData() {
  allMembers = await getAllMembers();
  populateMemberDropdowns(allMembers);
  await loadSlipApprovalQueue();
  await loadTreasuryData();
}

function populateMemberDropdowns(members) {
  const cashSelect = document.getElementById("cashMemberSelect");
  if (!cashSelect) return;

  cashSelect.innerHTML = '<option value="" disabled selected>-- Select Member --</option>';
  members.filter((m) => m.is_approved).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.full_name} (EPF: ${m.epf_number || "N/A"}) - ${m.designation || "Staff"}`;
    cashSelect.appendChild(opt);
  });
}

// ================= TAB 1: SLIPS APPROVAL =================

async function loadSlipApprovalQueue() {
  const tbody = document.getElementById("slipApprovalQueueBody");
  const badge = document.getElementById("tabSlipsCount");

  try {
    pendingPayments = await getPendingPayments();
    if (badge) badge.textContent = pendingPayments.length;

    if (!tbody) return;

    if (pendingPayments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-on-surface-variant">No bank slips awaiting verification at this time.</td></tr>`;
      return;
    }

    tbody.innerHTML = pendingPayments.map((p) => {
      const m = p.members || {};
      const memberName = m.full_name || m.email || "Unknown Member";
      const memberEpf = m.epf_number || "N/A";
      const memberDesig = m.designation || "-";
      const hasSlip = Boolean(p.slip_key);

      const slipBtn = hasSlip
        ? `<button onclick="window.viewSlip('${p.slip_key}')" class="inline-flex items-center gap-1 text-primary hover:underline font-bold">
             <span class="material-symbols-outlined text-[15px]">visibility</span>
             <span>View Slip</span>
           </button>`
        : `<span class="text-on-surface-variant font-mono">No File</span>`;

      return `
        <tr class="hover:bg-sky-50/30 transition-colors">
          <td class="py-2.5 px-3 font-mono">${formatDate(p.created_at)}</td>
          <td class="py-2.5 px-3">
            <div class="font-bold text-on-surface">${memberName}</div>
            <div class="text-[11px] text-on-surface-variant">EPF: ${memberEpf} • ${memberDesig}</div>
          </td>
          <td class="py-2.5 px-3">
            <div class="font-medium text-on-surface capitalize">${(p.payment_type || "").replace(/_/g, " ")}</div>
            ${p.payment_method ? `<div class="text-[10px] text-sky-700 font-mono capitalize">${p.payment_method.replace(/_/g, " ")}</div>` : ""}
            ${p.notes ? `<div class="text-[11px] text-on-surface-variant italic max-w-[200px] truncate" title="${p.notes}">${p.notes}</div>` : ""}
          </td>
          <td class="py-2.5 px-3 font-mono font-bold text-primary">${formatCurrency(p.amount)}</td>
          <td class="py-2.5 px-3">${slipBtn}</td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-2">
              <button onclick="window.approveSlip('${p.id}')" class="mutation-btn px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 text-xs">
                Approve (FIFO)
              </button>
              <button onclick="window.rejectSlipPrompt('${p.id}')" class="mutation-btn px-2.5 py-1 border border-rose-300 text-rose-700 rounded-lg font-bold hover:bg-rose-50 text-xs">
                Reject
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Failed to load slip queue:", err);
  }
}

window.viewSlip = async function (slipKey) {
  try {
    const signedUrl = await getSignedSlipUrl(slipKey);
    const container = document.getElementById("slipViewerContent");
    if (signedUrl && container) {
      if (slipKey.toLowerCase().endsWith(".pdf")) {
        container.innerHTML = `<iframe src="${signedUrl}" class="w-full h-[500px] rounded-xl border border-outline-variant"></iframe>`;
      } else {
        container.innerHTML = `<img src="${signedUrl}" alt="Bank Slip" class="max-h-[500px] mx-auto rounded-xl shadow-sm object-contain" />`;
      }
      openModal("viewSlipModal");
    }
  } catch (err) {
    showToast(err.message || "Failed to load slip image.", "error");
  }
};

window.approveSlip = async function (paymentId) {
  if (!confirm("Are you sure you want to approve this deposit slip? Dues will be reconciled via FIFO.")) return;
  try {
    await verifyPayment(paymentId, currentStaff.id);
    showToast("Bank slip approved and reconciled successfully!", "success");
    await loadSlipApprovalQueue();
    await loadTreasuryData();
  } catch (err) {
    showToast(err.message || "Approval failed.", "error");
  }
};

window.rejectSlipPrompt = async function (paymentId) {
  const reason = prompt("Enter reason for rejection:");
  if (reason === null) return;
  try {
    await rejectPayment(paymentId, currentStaff.id, reason || "Incorrect amount or unverified slip");
    showToast("Payment slip rejected.", "info");
    await loadSlipApprovalQueue();
  } catch (err) {
    showToast(err.message || "Rejection failed.", "error");
  }
};

// ================= TAB 2: CASH DESK =================

function setupAdminForms() {
  const cashForm = document.getElementById("cashCollectionForm");
  if (cashForm) {
    cashForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const memberId = document.getElementById("cashMemberSelect").value;
      const amount = Number(document.getElementById("cashAmountInput").value);
      const category = document.getElementById("cashCategorySelect").value;
      const notes = document.getElementById("cashNotesInput").value;
      const dateVal = document.getElementById("cashDateInput").value;

      if (!memberId || !amount) {
        showToast("Please select a member and valid amount.", "warning");
        return;
      }

      try {
        const payment = await recordCashPayment({
          memberId,
          amount,
          paymentType: category,
          collectedByMemberId: currentStaff.id,
          notes,
          paidAt: dateVal || null,
        });

        const selectedMember = allMembers.find((m) => m.id === memberId);
        const memberName = selectedMember ? selectedMember.full_name : "Member";

        const previewContainer = document.getElementById("cashReceiptPreview");
        if (previewContainer) {
          previewContainer.innerHTML = renderReceiptHtml(payment, memberName, currentStaff.full_name);
        }

        showToast("Cash payment recorded! Official voucher generated.", "success");
        cashForm.reset();
        await loadTreasuryData();
      } catch (err) {
        showToast(err.message || "Failed to record cash payment.", "error");
      }
    });
  }

  // Internal Treasury Transaction Form
  const txForm = document.getElementById("treasuryTxForm");
  if (txForm) {
    txForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const accountId = document.getElementById("txAccountSelect").value;
      const txType = document.getElementById("txTypeSelect").value;
      const amount = Number(document.getElementById("txAmountInput").value);
      const desc = document.getElementById("txDescInput").value;

      if (!amount || amount <= 0) {
        showToast("Enter a valid amount.", "warning");
        return;
      }

      try {
        await recordTreasuryTransaction({
          accountId,
          transactionType: txType,
          category: "manual_adjustment",
          amount,
          description: desc,
          performedByMemberId: currentStaff.id,
        });

        showToast("Treasury transaction committed successfully!", "success");
        txForm.reset();
        await loadTreasuryData();
      } catch (err) {
        showToast(err.message || "Transaction recording failed.", "error");
      }
    });
  }

  // Statement triggers
  const btnFetchStmt = document.getElementById("btnFetchStatement");
  if (btnFetchStmt) {
    btnFetchStmt.addEventListener("click", () => fetchTreasuryStatement());
  }

  const btnExportCsv = document.getElementById("btnExportCsv");
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => {
      const sDate = document.getElementById("stmtStartDate").value;
      const eDate = document.getElementById("stmtEndDate").value;
      if (!currentStatementData) {
        showToast("Please fetch statement data first.", "warning");
        return;
      }
      exportTreasuryStatementToCsv(currentStatementData, sDate, eDate);
      showToast("CSV statement exported successfully!", "success");
    });
  }

  const btnPrintPdf = document.getElementById("btnPrintPdf");
  if (btnPrintPdf) {
    btnPrintPdf.addEventListener("click", () => {
      const sDate = document.getElementById("stmtStartDate").value;
      const eDate = document.getElementById("stmtEndDate").value;
      if (!currentStatementData) {
        showToast("Please fetch statement data first.", "warning");
        return;
      }
      printTreasuryStatementPdf(currentStatementData, sDate, eDate);
    });
  }

  // Secretary Add Member Form
  const addMemberForm = document.getElementById("addMemberForm");
  if (addMemberForm) {
    addMemberForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("addMemberEmail").value;
      const fullName = document.getElementById("addMemberFullName").value;
      const epfNumber = document.getElementById("addMemberEpf").value;
      const designation = document.getElementById("addMemberDesignation").value;
      const role = document.getElementById("addMemberRole").value;
      const phone = document.getElementById("addMemberPhone").value;

      try {
        await createMember({
          email,
          fullName,
          epfNumber,
          designation,
          phone,
          role,
          isApproved: true,
        });

        showToast("Member pre-registered successfully!", "success");
        closeModal("addMemberModal");
        addMemberForm.reset();
        await loadSecretaryData();
      } catch (err) {
        showToast(err.message || "Failed to create member.", "error");
      }
    });
  }

  // Secretary Edit Profile Form
  const editMemberForm = document.getElementById("editMemberForm");
  if (editMemberForm) {
    editMemberForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const memberId = document.getElementById("editMemberId").value;
      const fullName = document.getElementById("editMemberFullName").value;
      const epfNumber = document.getElementById("editMemberEpf").value;
      const designation = document.getElementById("editMemberDesignation").value;
      const phone = document.getElementById("editMemberPhone").value;
      const nic = document.getElementById("editMemberNic").value;

      try {
        await updateMemberProfile(memberId, {
          fullName,
          epfNumber,
          designation,
          phone,
          nic,
        });

        showToast("Member profile updated successfully!", "success");
        closeModal("editMemberModal");
        await loadSecretaryData();
      } catch (err) {
        showToast(err.message || "Update profile failed.", "error");
      }
    });
  }

  // Bank Coordinates & QR Code Form
  setupBankSettingsHandlers();
  setupDuesSettingsHandlers();
  setupBenefitModalsHandlers();
}

// ================= TAB 3: SOCIETY TREASURY =================

async function loadTreasuryData() {
  try {
    const balances = await getTreasuryBalances();
    let total = 0;

    balances.forEach((b) => {
      const bal = Number(b.current_balance ?? b.balance ?? 0);
      total += bal;
      if (b.account_id === "boc_savings") {
        const el = document.getElementById("balBocSavings");
        if (el) el.textContent = formatCurrency(bal);
      }
      if (b.account_id === "cash_in_hand") {
        const el = document.getElementById("balCashInHand");
        if (el) el.textContent = formatCurrency(bal);
      }
      if (b.account_id === "fixed_deposits") {
        const el = document.getElementById("balFixedDeposits");
        if (el) el.textContent = formatCurrency(bal);
      }
    });

    const totalEl = document.getElementById("treasuryTotalFunds");
    if (totalEl) totalEl.textContent = formatCurrency(total);

    // Default dates if empty
    const sInput = document.getElementById("stmtStartDate");
    const eInput = document.getElementById("stmtEndDate");
    if (sInput && !sInput.value) {
      const now = new Date();
      sInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }
    if (eInput && !eInput.value) {
      eInput.value = new Date().toISOString().slice(0, 10);
    }
  } catch (err) {
    console.error("Failed to load treasury balances:", err);
  }
}

window.setStatementPeriod = function (type) {
  const now = new Date();
  const sInput = document.getElementById("stmtStartDate");
  const eInput = document.getElementById("stmtEndDate");

  if (type === "monthly") {
    sInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    eInput.value = now.toISOString().slice(0, 10);
  } else if (type === "yearly") {
    sInput.value = `${now.getFullYear()}-01-01`;
    eInput.value = now.toISOString().slice(0, 10);
  }
  fetchTreasuryStatement();
};

async function fetchTreasuryStatement() {
  const sDate = document.getElementById("stmtStartDate").value;
  const eDate = document.getElementById("stmtEndDate").value;
  const tbody = document.getElementById("statementSummariesBody");

  if (!sDate || !eDate) {
    showToast("Please choose both start and end dates.", "warning");
    return;
  }

  try {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center font-sans text-on-surface-variant">Computing balances across accounts...</td></tr>`;
    currentStatementData = await getTreasuryStatement(sDate, eDate);

    const summaries = getAccountSummariesFromStatement(currentStatementData);
    if (summaries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center font-sans text-on-surface-variant">No records found for selected period.</td></tr>`;
      return;
    }

    tbody.innerHTML = summaries.map((s) => `
      <tr class="hover:bg-sky-50/30 transition-colors">
        <td class="py-2.5 px-3 font-sans font-bold text-on-surface">${s.account_name || s.account_id}</td>
        <td class="py-2.5 px-3 text-right">${formatCurrency(s.opening_balance)}</td>
        <td class="py-2.5 px-3 text-right text-emerald-700 font-bold">+${formatCurrency(s.period_inflow)}</td>
        <td class="py-2.5 px-3 text-right text-rose-700 font-bold">-${formatCurrency(s.period_outflow)}</td>
        <td class="py-2.5 px-3 text-right font-bold text-primary">${formatCurrency(s.closing_balance)}</td>
      </tr>
    `).join("");

    showToast("Treasury statement generated successfully!", "success");
  } catch (err) {
    console.error("Statement fetch error:", err);
    showToast(err.message || "Failed to fetch statement.", "error");
  }
}

// ================= TAB 4: SECRETARY CONSOLE =================

async function loadSecretaryData() {
  const tbody = document.getElementById("memberDirectoryBody");
  const pendingBadge = document.getElementById("tabPendingMembersCount");

  try {
    allMembers = await getAllMembers();
    const pendingList = allMembers.filter((m) => !m.is_approved);
    if (pendingBadge) pendingBadge.textContent = pendingList.length;

    if (!tbody) return;

    tbody.innerHTML = allMembers.map((m) => {
      const isApproved = m.is_approved;
      const statusClass = isApproved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800 font-bold";

      const approveAction = !isApproved
        ? `<button onclick="window.approveMember('${m.id}')" class="mutation-btn px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary-hover shadow-sm">
             Verify &amp; Approve
           </button>`
        : "";

      return `
        <tr class="hover:bg-sky-50/30 transition-colors">
          <td class="py-2.5 px-3 font-mono font-bold text-primary">${m.epf_number || "PENDING"}</td>
          <td class="py-2.5 px-3 font-bold text-on-surface">${m.full_name}</td>
          <td class="py-2.5 px-3 text-on-surface-variant">${m.designation || "-"}</td>
          <td class="py-2.5 px-3">
            <div>${m.email}</div>
            <div class="text-[11px] text-on-surface-variant font-mono">${m.phone || "-"}</div>
          </td>
          <td class="py-2.5 px-3 uppercase font-semibold text-[11px] text-on-surface-variant">${m.role}</td>
          <td class="py-2.5 px-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ${statusClass}">
              ${isApproved ? "Approved" : "Pending Review"}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-2">
              ${approveAction}
              <button onclick="window.openEditMemberModal('${m.id}')" class="px-2.5 py-1 border border-outline-variant rounded-lg text-xs font-semibold hover:border-primary">
                Edit
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Secretary data error:", err);
  }
}

window.approveMember = async function (memberId) {
  try {
    await updateMemberRole(memberId, undefined, true);
    showToast("Member approved successfully!", "success");
    await loadSecretaryData();
  } catch (err) {
    showToast(err.message || "Approval failed.", "error");
  }
};

window.openEditMemberModal = function (memberId) {
  const m = allMembers.find((item) => item.id === memberId);
  if (!m) return;

  document.getElementById("editMemberId").value = m.id;
  document.getElementById("editMemberFullName").value = m.full_name || "";
  document.getElementById("editMemberEpf").value = m.epf_number || "";
  document.getElementById("editMemberDesignation").value = m.designation || "";
  document.getElementById("editMemberPhone").value = m.phone || "";
  document.getElementById("editMemberNic").value = m.nic || "";

  openModal("editMemberModal");
};

// ================= TAB 5: WELFARE CLAIMS =================

async function loadClaimsData() {
  const tbody = document.getElementById("benefitClaimsQueueBody");
  if (!tbody) return;

  try {
    const claims = await getAllBenefitClaims();
    if (claims.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-on-surface-variant">No welfare claims submitted yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = claims.map((c) => {
      const m = c.members || {};
      const bt = c.benefit_types || {};
      const applicantName = m.full_name || m.email || "Member";
      const applicantEpf = m.epf_number || "N/A";
      const benefitTitle = bt.title_en || "Welfare Grant";

      let actions = "";
      if (c.status === "submitted") {
        actions = `
          <button onclick="window.reviewClaim('${c.id}', 'approved')" class="mutation-btn px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">Approve</button>
          <button onclick="window.reviewClaim('${c.id}', 'rejected')" class="mutation-btn px-2.5 py-1 border border-rose-300 text-rose-700 rounded-lg text-xs font-bold hover:bg-rose-50">Reject</button>
        `;
      } else if (c.status === "approved") {
        actions = `
          <button onclick="window.disburseClaim('${c.id}', ${c.claim_amount})" class="mutation-btn px-2.5 py-1 bg-sky-800 text-white rounded-lg text-xs font-bold hover:bg-sky-900">
            Disburse Grant
          </button>
        `;
      } else {
        actions = `<span class="text-on-surface-variant text-xs capitalize">${c.status}</span>`;
      }

      return `
        <tr class="hover:bg-sky-50/30 transition-colors">
          <td class="py-2.5 px-3 font-mono">${formatDate(c.created_at)}</td>
          <td class="py-2.5 px-3">
            <div class="font-bold text-on-surface">${applicantName}</div>
            <div class="text-[11px] text-on-surface-variant">EPF: ${applicantEpf}</div>
          </td>
          <td class="py-2.5 px-3 font-medium">${benefitTitle}</td>
          <td class="py-2.5 px-3 font-mono font-bold text-primary">${formatCurrency(c.claim_amount)}</td>
          <td class="py-2.5 px-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.status === "disbursed" ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800"}">
              ${c.status.toUpperCase()}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-2">${actions}</div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Claims data error:", err);
  }
}

window.reviewClaim = async function (claimId, status) {
  const notes = prompt(`Enter review notes for ${status}:`);
  if (notes === null) return;
  try {
    await reviewBenefitClaim(claimId, status, currentStaff.id, notes);
    showToast(`Claim marked as ${status}.`, "success");
    await loadClaimsData();
  } catch (err) {
    showToast(err.message || "Review action failed.", "error");
  }
};

window.disburseClaim = async function (claimId, amount) {
  if (!confirm(`Are you sure you want to disburse LKR ${amount}? This will automatically record an outflow in the Society Treasury.`)) return;
  try {
    await disburseBenefitClaim({
      claimId,
      disbursedAmount: amount,
      disbursedByMemberId: currentStaff.id,
      notes: "Disbursed via Treasury Management Console",
    });
    showToast("Grant disbursed and logged to Treasury successfully!", "success");
    await loadClaimsData();
    await loadTreasuryData();
  } catch (err) {
    showToast(err.message || "Disbursement failed.", "error");
  }
};

// ================= TAB 6: DEFAULTERS ROSTER =================

async function loadDefaultersData() {
  const tbody = document.getElementById("defaultersTableBody");
  if (!tbody) return;

  try {
    const defaulters = await getDefaultersRoster();
    if (defaulters.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-on-surface-variant">No members in default. All dues settled.</td></tr>`;
      return;
    }

    tbody.innerHTML = defaulters.map((d) => `
      <tr class="hover:bg-rose-50/30 transition-colors">
        <td class="py-2.5 px-3 font-mono font-bold text-rose-700">${d.epf_number || "N/A"}</td>
        <td class="py-2.5 px-3 font-semibold text-on-surface">${d.full_name}</td>
        <td class="py-2.5 px-3">${d.billing_month}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-rose-700">${formatCurrency(d.amount)}</td>
        <td class="py-2.5 px-3 font-mono">${formatDate(d.due_date)}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Defaulters load error:", err);
  }
}

// ================= TAB 8: AUDIT LOGS (ON-DEMAND & FIRST 25 ITEMS) =================

let auditLogsAlreadyLoaded = false;

async function loadAuditLogsData(force = false) {
  const tbody = document.getElementById("auditLogsBody");
  if (!tbody) return;

  // Only load when explicitly requested or needed
  if (!force && !auditLogsAlreadyLoaded) {
    return;
  }

  const refreshBtn = document.getElementById("btnRefreshAuditLogs");
  const countBadge = document.getElementById("auditCountBadge");

  try {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Loading...</span>';
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-12 text-center text-on-surface-variant font-medium">
          <div class="inline-flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px] animate-spin text-primary">sync</span>
            <span>Fetching latest 25 audit entries from database...</span>
          </div>
        </td>
      </tr>
    `;

    // Fetch ONLY the first 25 items
    const logs = await getAuditLogs(25);
    auditLogsAlreadyLoaded = true;

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-on-surface-variant font-medium">No audit logs recorded yet in the database.</td></tr>`;
      if (countBadge) countBadge.textContent = "0 Items";
      return;
    }

    if (countBadge) {
      countBadge.textContent = `Showing First ${logs.length} Items`;
    }

    tbody.innerHTML = logs.map((log) => {
      const dateStr = log.timestamp || log.created_at;
      const formattedDate = dateStr ? new Date(dateStr).toLocaleString("en-GB", {
        dateStyle: "short",
        timeStyle: "medium",
      }) : "-";

      const actorEmail = log.user_email || log.performed_by_email || log.performed_by || "SYSTEM";
      const actorName = log.full_name || actorEmail;
      const epf = log.epf_number ? `EPF: ${log.epf_number}` : "";

      const action = String(log.action || "UNKNOWN").toUpperCase();
      let actionClass = "bg-sky-50 text-sky-800 border-sky-200";
      if (action.includes("DELETE") || action.includes("REJECT") || action.includes("REMOVE")) {
        actionClass = "bg-rose-50 text-rose-800 border-rose-200";
      } else if (action.includes("CREATE") || action.includes("INSERT") || action.includes("VERIF") || action.includes("APPROV")) {
        actionClass = "bg-emerald-50 text-emerald-800 border-emerald-200";
      } else if (action.includes("UPDATE") || action.includes("EDIT")) {
        actionClass = "bg-amber-50 text-amber-800 border-amber-200";
      }

      const entity = log.entity_type || log.target_table || "-";
      const entityId = log.entity_id ? `<span class="text-[10px] font-mono text-on-surface-variant block truncate max-w-[120px]">${log.entity_id}</span>` : "";

      const diffObj = log.diff_json || log.diff || {};
      const diffStr = typeof diffObj === "object" ? JSON.stringify(diffObj, null, 1) : String(diffObj);

      return `
        <tr class="hover:bg-surface/60 transition-colors text-xs font-sans">
          <td class="py-3 px-3 whitespace-nowrap text-on-surface-variant font-mono text-[11px]">
            ${formattedDate}
          </td>
          <td class="py-3 px-3">
            <div class="font-bold text-on-surface text-xs">${actorName}</div>
            <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5 mt-0.5">
              <span>${actorEmail}</span>
              ${epf ? `<span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-100 font-semibold">${epf}</span>` : ""}
            </div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${actionClass}">
              ${action}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="font-mono font-bold text-primary text-[11px]">${entity}</span>
            ${entityId}
          </td>
          <td class="py-3 px-3 max-w-xs md:max-w-md">
            <pre class="text-[11px] font-mono bg-surface p-2 rounded-lg border border-outline-variant text-on-surface-variant overflow-x-auto max-h-20 leading-tight select-all">${diffStr}</pre>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Audit log error:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-rose-600 font-bold">Error loading audit logs: ${err.message || err}</td></tr>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">refresh</span><span>Load / Refresh Logs</span>';
    }
  }
}
window.loadAuditLogsData = loadAuditLogsData;

// ================= TAB 7: BANK COORDINATES & LANKAQR SETTINGS =================

export async function loadBankSettings() {
  try {
    const bankSetting = await getSystemSetting("bank_qr");
    const data = bankSetting || {
      bank_name: "Bank of Ceylon (BOC)",
      branch: "Mattala Airport Branch (742)",
      account_name: "MRIA Management Welfare Association",
      account_number: "8201948201",
      url: "/assets/default-bank-qr.svg",
    };

    const nameInput = document.getElementById("settingBankName");
    const branchInput = document.getElementById("settingBankBranch");
    const accNumInput = document.getElementById("settingAccountNumber");
    const accNameInput = document.getElementById("settingAccountName");
    const qrPreview = document.getElementById("adminBankQrPreview");

    if (nameInput) nameInput.value = data.bank_name || "";
    if (branchInput) branchInput.value = data.branch || "";
    if (accNumInput) accNumInput.value = data.account_number || "";
    if (accNameInput) accNameInput.value = data.account_name || "";

    currentQrDataUrl = data.url || "/assets/default-bank-qr.svg";
    if (qrPreview) qrPreview.src = currentQrDataUrl;

    const statusEl = document.getElementById("bankSettingsStatus");
    if (statusEl) {
      statusEl.textContent = "Current bank coordinates loaded.";
    }
  } catch (err) {
    console.error("Failed to load bank settings:", err);
    showToast("Could not load current bank coordinates.", "error");
  }
}
window.loadBankSettings = loadBankSettings;

function setupBankSettingsHandlers() {
  const fileInput = document.getElementById("adminQrFileInput");
  const qrPreview = document.getElementById("adminBankQrPreview");
  const resetBtn = document.getElementById("resetBankQrBtn");
  const form = document.getElementById("bankSettingsForm");
  const saveBtn = document.getElementById("saveBankSettingsBtn");
  const statusEl = document.getElementById("bankSettingsStatus");

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        showToast("Please upload a valid image (PNG, JPEG, SVG, WebP).", "warning");
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        showToast("QR image size must be under 2 MB.", "warning");
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        currentQrDataUrl = event.target.result;
        if (qrPreview) qrPreview.src = currentQrDataUrl;
        if (statusEl) {
          statusEl.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB) - click Save to apply.`;
        }
        showToast("New QR code selected. Click 'Save Bank Coordinates' to apply.", "info");
      };
      reader.readAsDataURL(file);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      currentQrDataUrl = "/assets/default-bank-qr.svg";
      if (qrPreview) qrPreview.src = currentQrDataUrl;
      if (fileInput) fileInput.value = "";
      if (statusEl) {
        statusEl.textContent = "Default QR code restored - click Save to apply.";
      }
      showToast("Reset to default BOC QR image. Click Save to apply.", "info");
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const bankName = document.getElementById("settingBankName")?.value.trim();
      const branch = document.getElementById("settingBankBranch")?.value.trim();
      const accountNumber = document.getElementById("settingAccountNumber")?.value.trim();
      const accountName = document.getElementById("settingAccountName")?.value.trim();

      if (!bankName || !branch || !accountNumber || !accountName) {
        showToast("Please fill in all bank coordinate fields.", "warning");
        return;
      }

      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">sync</span> Saving...';
        }

        const newSettings = {
          bank_name: bankName,
          branch,
          account_number: accountNumber,
          account_name: accountName,
          url: currentQrDataUrl,
        };

        await updateSystemSetting("bank_qr", newSettings, currentStaff?.id);

        if (statusEl) {
          statusEl.textContent = `Saved at ${new Date().toLocaleTimeString()} by ${currentStaff?.full_name || "Staff"}`;
        }
        showToast(t("bank_settings_saved") || "Bank coordinates & QR code saved successfully!", "success");
      } catch (err) {
        console.error("Failed to save bank settings:", err);
        showToast(err.message || "Failed to update bank coordinates.", "error");
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span> <span>Save Bank Coordinates</span>';
        }
      }
    });
  }
}

// ================= MONTHLY DUES CONTRIBUTION SETTINGS =================

async function loadDuesSettings() {
  try {
    const dueSetting = await getSystemSetting("monthly_due_amount");
    const input = document.getElementById("settingMonthlyDueAmount");
    if (input) {
      input.value = dueSetting?.amount != null ? dueSetting.amount : 300;
    }
  } catch (err) {
    console.error("Failed to load monthly dues setting:", err);
  }
}
window.loadDuesSettings = loadDuesSettings;

function setupDuesSettingsHandlers() {
  const form = document.getElementById("duesSettingsForm");
  const input = document.getElementById("settingMonthlyDueAmount");
  const saveBtn = document.getElementById("saveDuesSettingsBtn");
  const statusEl = document.getElementById("duesSettingsStatus");

  if (!form || !input) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Number(input.value);
    if (!amount || amount <= 0) {
      showToast("Please enter a valid monthly due amount.", "warning");
      return;
    }

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span><span>Saving...</span>';
      }
      if (statusEl) statusEl.textContent = "Updating monthly due in system settings...";

      await updateSystemSetting(
        "monthly_due_amount",
        { amount, currency: "LKR" },
        currentStaff?.id || null
      );

      showToast(`Default monthly dues successfully updated to Rs. ${amount.toLocaleString()} /=`, "success");
      if (statusEl) {
        statusEl.textContent = `Saved: Rs. ${amount.toLocaleString()} /= (${new Date().toLocaleTimeString()})`;
      }
    } catch (err) {
      console.error("Failed to update monthly dues:", err);
      showToast(err.message || "Failed to save monthly dues setting.", "error");
      if (statusEl) statusEl.textContent = "Error saving changes.";
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span><span>Save Monthly Dues</span>';
      }
    }
  });
}

// ================= WELFARE BENEFITS & FACILITIES SETTINGS =================

let allBenefitTypes = [];

async function loadBenefitTypesSettings() {
  const tbody = document.getElementById("benefitTypesTableBody");
  if (!tbody) return;

  try {
    allBenefitTypes = await getAllBenefitTypes();
    if (!allBenefitTypes || allBenefitTypes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-on-surface-variant">No welfare benefit programs configured. Click "Add Benefit Program" above to create one.</td></tr>';
      return;
    }

    tbody.innerHTML = allBenefitTypes.map((b) => {
      const isDeath = b.code === "DEATH_AID";
      const isMedical = b.code === "MEDICAL_AID";
      const isPension = b.code === "PENSION_PARTY";

      const icon = isDeath ? "volunteer_activism" : isMedical ? "medical_services" : isPension ? "celebration" : "loyalty";
      const statusBadge = b.is_active
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
             <span class="material-symbols-outlined text-[14px]">check_circle</span>
             <span>Active Facility</span>
           </span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
             <span class="material-symbols-outlined text-[14px]">pause_circle</span>
             <span>Currently Paused</span>
           </span>`;

      const helperText = isDeath 
        ? "Currently the only active donation program (Rs. 20,000/= default)."
        : isMedical 
        ? "Medical and hospitalization assistance (toggle active when facility is ready)."
        : isPension 
        ? "Retirement and farewell contribution (toggle active when facility is ready)."
        : (b.description_en || "");

      return `
        <tr class="hover:bg-surface/50 transition-colors" data-benefit-id="${b.id}">
          <td class="py-3 px-3">
            <div class="flex items-start gap-2.5">
              <span class="material-symbols-outlined text-primary text-[22px] mt-0.5">${icon}</span>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-on-surface text-xs sm:text-sm">${b.title_en}</span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-50 text-primary border border-sky-200">${b.code}</span>
                </div>
                <div class="text-[11px] text-primary font-medium mt-0.5">${b.title_si || ""}</div>
                <div class="text-[10px] text-on-surface-variant mt-0.5 leading-relaxed">${helperText}</div>
              </div>
            </div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <div class="flex flex-col gap-1.5 items-start">
              ${statusBadge}
              <button type="button" onclick="toggleBenefitActive('${b.id}', ${!b.is_active})" class="text-[11px] font-bold underline ${b.is_active ? 'text-amber-700 hover:text-amber-800' : 'text-emerald-700 hover:text-emerald-800'} transition-colors cursor-pointer">
                ${b.is_active ? "Pause Facility" : "Activate Facility"}
              </button>
            </div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <div class="flex items-center gap-1.5 max-w-[190px]">
              <span class="text-xs font-bold text-on-surface-variant">Rs.</span>
              <input type="number" id="benefitAmount_${b.id}" value="${Number(b.max_amount || 0)}" min="500" step="500" class="w-full px-2.5 py-1.5 rounded-lg border border-outline-variant bg-surface text-xs font-bold text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" />
              <button type="button" onclick="saveBenefitRow('${b.id}')" id="saveBenefitBtn_${b.id}" title="Quick Save Limit" class="p-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover shadow-sm inline-flex items-center justify-center transition-colors cursor-pointer shrink-0">
                <span class="material-symbols-outlined text-[15px]">save</span>
              </button>
            </div>
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="inline-flex items-center gap-1.5 justify-end">
              <button type="button" onclick="openEditBenefitModal('${b.id}')" title="Edit Full Program Details" class="px-2.5 py-1.5 bg-white border border-outline-variant text-on-surface text-xs font-bold rounded-xl hover:border-primary hover:text-primary transition-colors shadow-sm inline-flex items-center gap-1 cursor-pointer">
                <span class="material-symbols-outlined text-[15px] text-primary">edit</span>
                <span>Edit</span>
              </button>
              <button type="button" onclick="removeBenefitItem('${b.id}')" title="Delete Program" class="px-2.5 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl hover:bg-rose-100 transition-colors shadow-sm inline-flex items-center gap-1 cursor-pointer">
                <span class="material-symbols-outlined text-[15px]">delete</span>
                <span>Remove</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Failed to load benefit types in admin:", err);
    tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-rose-600 font-bold">Error loading benefit programs.</td></tr>';
  }
}
window.loadBenefitTypesSettings = loadBenefitTypesSettings;

window.openAddBenefitModal = function () {
  const form = document.getElementById("addBenefitForm");
  if (form) form.reset();
  const activeCheckbox = document.getElementById("addBenefitIsActive");
  if (activeCheckbox) activeCheckbox.checked = false;
  openModal("addBenefitModal");
};

window.openEditBenefitModal = function (id) {
  const benefit = allBenefitTypes.find((b) => b.id === id);
  if (!benefit) {
    showToast("Benefit program details not found.", "warning");
    return;
  }

  const idInput = document.getElementById("editBenefitId");
  const codeBadge = document.getElementById("editBenefitCodeBadge");
  const statusBadge = document.getElementById("editBenefitStatusBadge");
  const titleEn = document.getElementById("editBenefitTitleEn");
  const titleSi = document.getElementById("editBenefitTitleSi");
  const maxAmount = document.getElementById("editBenefitMaxAmount");
  const descEn = document.getElementById("editBenefitDescEn");
  const descSi = document.getElementById("editBenefitDescSi");
  const isActive = document.getElementById("editBenefitIsActive");

  if (idInput) idInput.value = benefit.id;
  if (codeBadge) codeBadge.textContent = benefit.code;
  if (titleEn) titleEn.value = benefit.title_en || "";
  if (titleSi) titleSi.value = benefit.title_si || "";
  if (maxAmount) maxAmount.value = Number(benefit.max_amount || 0);
  if (descEn) descEn.value = benefit.description_en || "";
  if (descSi) descSi.value = benefit.description_si || "";
  if (isActive) isActive.checked = Boolean(benefit.is_active);

  if (statusBadge) {
    statusBadge.innerHTML = benefit.is_active
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Paused</span>';
  }

  openModal("editBenefitModal");
};

function setupBenefitModalsHandlers() {
  // 1. Add Benefit Form
  const addForm = document.getElementById("addBenefitForm");
  if (addForm) {
    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById("addBenefitCode");
      const titleEnInput = document.getElementById("addBenefitTitleEn");
      const titleSiInput = document.getElementById("addBenefitTitleSi");
      const maxAmountInput = document.getElementById("addBenefitMaxAmount");
      const descEnInput = document.getElementById("addBenefitDescEn");
      const descSiInput = document.getElementById("addBenefitDescSi");
      const isActiveInput = document.getElementById("addBenefitIsActive");
      const submitBtn = document.getElementById("submitAddBenefitBtn");

      const code = codeInput?.value.trim().toUpperCase().replace(/\s+/g, "_");
      const title_en = titleEnInput?.value.trim();
      const title_si = titleSiInput?.value.trim();
      const max_amount = Number(maxAmountInput?.value);
      const description_en = descEnInput?.value.trim() || null;
      const description_si = descSiInput?.value.trim() || null;
      const is_active = Boolean(isActiveInput?.checked);

      if (!code || !title_en || !title_si || !max_amount || max_amount <= 0) {
        showToast("Please complete all required fields with a valid amount.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Creating...</span>';
        }

        await createBenefitType({
          code,
          title_en,
          title_si,
          description_en,
          description_si,
          max_amount,
          is_active,
        });

        showToast(`Welfare program "${title_en}" created successfully!`, "success");
        closeModal("addBenefitModal");
        addForm.reset();
        await loadBenefitTypesSettings();
      } catch (err) {
        console.error("Failed to create benefit type:", err);
        showToast(err.message || "Failed to create welfare benefit program.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>Create Program</span>';
        }
      }
    });
  }

  // 2. Edit Benefit Form
  const editForm = document.getElementById("editBenefitForm");
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("editBenefitId")?.value;
      const title_en = document.getElementById("editBenefitTitleEn")?.value.trim();
      const title_si = document.getElementById("editBenefitTitleSi")?.value.trim();
      const max_amount = Number(document.getElementById("editBenefitMaxAmount")?.value);
      const description_en = document.getElementById("editBenefitDescEn")?.value.trim() || null;
      const description_si = document.getElementById("editBenefitDescSi")?.value.trim() || null;
      const is_active = Boolean(document.getElementById("editBenefitIsActive")?.checked);
      const submitBtn = document.getElementById("submitEditBenefitBtn");

      if (!id || !title_en || !title_si || !max_amount || max_amount <= 0) {
        showToast("Please complete all required fields with a valid amount.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Saving...</span>';
        }

        await updateBenefitType(id, {
          title_en,
          title_si,
          description_en,
          description_si,
          max_amount,
          is_active,
        });

        showToast(`Welfare program "${title_en}" updated successfully!`, "success");
        closeModal("editBenefitModal");
        await loadBenefitTypesSettings();
      } catch (err) {
        console.error("Failed to update benefit type:", err);
        showToast(err.message || "Failed to update welfare benefit program.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">save</span><span>Save Changes</span>';
        }
      }
    });
  }
}

window.removeBenefitItem = async function (id) {
  const benefit = allBenefitTypes.find((b) => b.id === id);
  const name = benefit ? benefit.title_en : "this benefit program";

  const confirmed = window.confirm(
    `Are you sure you want to permanently remove "${name}"?\n\nIf members have existing applications under this facility, deletion will be blocked to preserve financial audit history. In that case, you can pause/deactivate it instead.`
  );
  if (!confirmed) return;

  try {
    await deleteBenefitType(id);
    showToast(`Welfare program "${name}" removed successfully.`, "success");
    await loadBenefitTypesSettings();
  } catch (err) {
    console.error("Failed to remove benefit item:", err);
    showToast(err.message || "Failed to delete welfare benefit program.", "error");
  }
};

window.toggleBenefitActive = async function (id, newStatus) {
  try {
    await updateBenefitType(id, { is_active: newStatus });
    showToast(`Welfare facility ${newStatus ? "activated" : "paused"} successfully.`, "success");
    await loadBenefitTypesSettings();
  } catch (err) {
    console.error("Failed to toggle facility status:", err);
    showToast(err.message || "Failed to change facility status.", "error");
  }
};

window.saveBenefitRow = async function (id) {
  const input = document.getElementById(`benefitAmount_${id}`);
  const btn = document.getElementById(`saveBenefitBtn_${id}`);
  if (!input) return;

  const maxAmount = Number(input.value);
  if (!maxAmount || maxAmount <= 0) {
    showToast("Please enter a valid grant amount.", "warning");
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">refresh</span>';
    }

    await updateBenefitType(id, { max_amount: maxAmount });
    showToast(`Benefit grant limit updated to Rs. ${maxAmount.toLocaleString()} /=`, "success");
    await loadBenefitTypesSettings();
  } catch (err) {
    console.error("Failed to update benefit row:", err);
    showToast(err.message || "Failed to update benefit limit.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[15px]">save</span>';
    }
  }
};
