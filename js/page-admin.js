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
} from "./api.js";
import { getSignedSlipUrl } from "./storage.js";
import { renderReceiptHtml } from "./receipt.js";
import { exportTreasuryStatementToCsv, printTreasuryStatementPdf } from "./treasury-export.js";
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

// Role-based Module Permissions Matrix
const ROLE_TABS = {
  admin: ["slips", "cash", "treasury", "secretary", "claims", "defaulters", "cms", "audit"],
  manager: ["slips", "cash", "treasury", "secretary", "claims", "defaulters"],
  treasurer: ["treasury", "slips", "cash", "defaulters"],
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
  if (targetTab === "audit") loadAuditLogsData();
}
window.switchAdminTab = switchAdminTab;

async function loadInitialData() {
  allMembers = await getAllMembers();
  populateMemberDropdowns(allMembers);
  await loadSlipApprovalQueue();
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
          <td class="py-2.5 px-3 font-medium capitalize">${(p.payment_type || "").replace(/_/g, " ")}</td>
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
}

// ================= TAB 3: SOCIETY TREASURY =================

async function loadTreasuryData() {
  try {
    const balances = await getTreasuryBalances();
    let total = 0;

    balances.forEach((b) => {
      const bal = Number(b.balance || 0);
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

    const summaries = currentStatementData.account_summaries || [];
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

// ================= TAB 8: AUDIT LOGS =================

async function loadAuditLogsData() {
  const tbody = document.getElementById("auditLogsBody");
  if (!tbody) return;

  try {
    const logs = await getAuditLogs();
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-on-surface-variant font-sans">No audit logs recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map((log) => `
      <tr class="hover:bg-sky-50/30 transition-colors text-[11px]">
        <td class="py-2.5 px-3 text-on-surface-variant">${new Date(log.created_at).toLocaleString()}</td>
        <td class="py-2.5 px-3 font-bold">${log.performed_by_email || log.performed_by || "SYSTEM"}</td>
        <td class="py-2.5 px-3 uppercase text-primary font-bold">${log.action}</td>
        <td class="py-2.5 px-3">${log.target_table || "-"}</td>
        <td class="py-2.5 px-3 max-w-xs truncate" title="${JSON.stringify(log.diff || {})}">${JSON.stringify(log.diff || {})}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Audit log error:", err);
  }
}
