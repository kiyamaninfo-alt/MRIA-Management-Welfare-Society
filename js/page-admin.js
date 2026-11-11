import { requireAuth, signOut } from "./auth.js";
import {
  getMemberDues,
  calculateMemberBalance,
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
  recordDirectBenefitGrant,
  undoClaimDisbursement,
  getTreasuryBalances,
  recordTreasuryTransaction,
  getTreasuryStatement,
  getCashBookTransactions,
  getAuditLogs,
  getSystemSetting,
  updateSystemSetting,
  getAllBenefitTypes,
  updateBenefitType,
  createBenefitType,
  deleteBenefitType,
  sendReceiptEmail,
  logUserActivity,
  getPaymentReceipts,
  voidPaymentReceipt,
  deleteOrArchiveMember,
  sendNotification,
  sendBatchNotifications,
  getAdminInquiries,
  resolveAdminInquiry,
} from "./api.js";
import { getSignedSlipUrl } from "./storage.js";
import { renderReceiptHtml, renderGrantVoucherHtml, shareGrantVoucher, downloadGrantVoucherFile } from "./receipt.js";
import { exportTreasuryStatementToCsv, printTreasuryStatementPdf, getAccountSummariesFromStatement } from "./treasury-export.js";
import { initLanguage, t, getLanguage } from "./i18n.js";
import {
  showToast,
  openModal,
  closeModal,
  openDuesBreakdownModal,
  setupModalDismissers,
  initOfflineDetection,
  formatCurrency,
  formatDate,
} from "./ui.js";

let currentStaff = null;
let allMembers = [];
let allBenefitTypes = [];
let allClaimsList = [];
let pendingPayments = [];
let currentApprovingSlipPayment = null;
let currentStatementData = null;
let currentQrDataUrl = "/assets/default-bank-qr.svg";

// Role-based Module Permissions Matrix
const ROLE_TABS = {
  admin: ["slips", "cash", "treasury", "receipts", "secretary", "claims", "defaulters", "cms", "audit"],
  manager: ["slips", "cash", "treasury", "receipts", "secretary", "claims", "defaulters", "cms", "audit"],
  treasurer: ["treasury", "receipts", "slips", "cash", "claims", "defaulters", "cms", "audit"],
  secretary: ["secretary", "receipts", "claims", "defaulters", "cms"],
  committee_member: ["claims", "defaulters", "receipts"],
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
  if (targetTab === "receipts") {
    if (receiptsLoaded) renderReceiptsTable();
    else loadReceiptsData();
  }
  if (targetTab === "secretary") loadSecretaryData();
  if (targetTab === "claims") loadClaimsData();
  if (targetTab === "defaulters") loadDefaultersData();
  if (targetTab === "cms") {
    loadBankSettings();
    loadDuesSettings();
    loadAdmissionFeesSettings();
    loadBenefitTypesSettings();
    loadAdminInquiries();
    populateNotificationRecipients();
  }
  if (targetTab === "audit") loadAuditLogsData();
}
window.switchAdminTab = switchAdminTab;

async function loadInitialData() {
  allMembers = await getAllMembers();
  window.allMembers = allMembers;
  await Promise.all([loadDuesSettings(), loadAdmissionFeesSettings(), loadBenefitTypesSettings()]);
  populateMemberDropdowns(allMembers);
  populateNotificationRecipients();
  populateGrantBenefitTypes();
  await loadSlipApprovalQueue();
  await loadTreasuryData();
}

let configuredMonthlyDueAmount = 300;
let configuredAdmissionFeeAmount = 500;
let admissionFeesList = [];
let approvedMembersList = [];

function populateMemberDropdowns(members) {
  approvedMembersList = (members || []).filter((m) => m.is_approved);
  renderCashMemberOptions(approvedMembersList);
  updateCashMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
  renderGrantMemberOptions(approvedMembersList);
  updateGrantMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
}

function renderCashMemberOptions(members) {
  const cashSelect = document.getElementById("cashMemberSelect");
  if (!cashSelect) return;

  const currentVal = cashSelect.value;
  cashSelect.innerHTML = '<option value="" disabled selected>-- Select Member from list or search above --</option>';

  members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.full_name} (EPF: ${m.epf_number || "N/A"}) - ${m.designation || "Staff"}`;
    cashSelect.appendChild(opt);
  });

  if (currentVal && members.some((m) => m.id === currentVal)) {
    cashSelect.value = currentVal;
  }
}

function updateCashMemberMatchCount(matches, total) {
  const badge = document.getElementById("cashMemberMatchCount");
  if (!badge) return;
  if (matches === total) {
    badge.textContent = `${total} Members Available`;
  } else {
    badge.textContent = `${matches} of ${total} Matches`;
  }
}

export function selectCashMember(member) {
  const cashSelect = document.getElementById("cashMemberSelect");
  const searchInput = document.getElementById("cashMemberSearchInput");
  const resultsList = document.getElementById("cashMemberResultsList");
  const clearBtn = document.getElementById("cashMemberClearSearchBtn");
  const card = document.getElementById("cashSelectedMemberCard");

  if (!member) return;

  // 1. Ensure the option is in the select dropdown and select it
  if (cashSelect) {
    if (![...cashSelect.options].some((opt) => opt.value === member.id)) {
      renderCashMemberOptions(approvedMembersList);
    }
    cashSelect.value = member.id;
  }

  // 2. Set search input text
  if (searchInput) {
    searchInput.value = `${member.full_name} (EPF: ${member.epf_number || "N/A"})`;
  }
  if (clearBtn) clearBtn.classList.remove("hidden");

  // 3. Hide popover
  if (resultsList) resultsList.classList.add("hidden");

  // 4. Update and display selected member card
  if (card) {
    const nameEl = document.getElementById("cashSelectedMemberName");
    const epfEl = document.getElementById("cashSelectedMemberEpf");
    const desigEl = document.getElementById("cashSelectedMemberDesignation");
    const emailEl = document.getElementById("cashSelectedMemberEmail");
    const initialsEl = document.getElementById("cashSelectedMemberInitials");

    if (nameEl) nameEl.textContent = member.full_name || "-";
    if (epfEl) epfEl.textContent = `EPF: ${member.epf_number || "N/A"}`;
    if (desigEl) desigEl.textContent = member.designation || "Staff";
    if (emailEl) {
      if (member.email) {
        emailEl.innerHTML = `<span class="material-symbols-outlined text-[13px] text-emerald-600">mail</span><span class="text-slate-700">${escapeHtml(member.email)}</span>`;
      } else {
        emailEl.innerHTML = `<span class="material-symbols-outlined text-[13px] text-amber-600">mail_off</span><span class="text-amber-700 font-bold">No registered email on profile</span>`;
      }
    }
    if (initialsEl) {
      initialsEl.textContent = (member.full_name || "M").charAt(0).toUpperCase();
    }
    card.classList.remove("hidden");
  }

  // 5. Update live voucher preview
  updateLiveReceiptPreview();
}
window.selectCashMember = selectCashMember;

window.clearCashMemberSearch = function () {
  const searchInput = document.getElementById("cashMemberSearchInput");
  const clearBtn = document.getElementById("cashMemberClearSearchBtn");
  const resultsList = document.getElementById("cashMemberResultsList");

  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }
  if (clearBtn) clearBtn.classList.add("hidden");
  if (resultsList) resultsList.classList.add("hidden");

  renderCashMemberOptions(approvedMembersList);
  updateCashMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
  updateLiveReceiptPreview();
};

window.resetCashMemberSelection = function ({ preservePreview = false } = {}) {
  const cashSelect = document.getElementById("cashMemberSelect");
  const searchInput = document.getElementById("cashMemberSearchInput");
  const clearBtn = document.getElementById("cashMemberClearSearchBtn");
  const resultsList = document.getElementById("cashMemberResultsList");
  const card = document.getElementById("cashSelectedMemberCard");

  if (cashSelect) cashSelect.value = "";
  if (searchInput) {
    searchInput.value = "";
  }
  if (clearBtn) clearBtn.classList.add("hidden");
  if (resultsList) resultsList.classList.add("hidden");
  if (card) card.classList.add("hidden");

  renderCashMemberOptions(approvedMembersList);
  updateCashMemberMatchCount(approvedMembersList.length, approvedMembersList.length);

  const emailNotificationBanner = document.getElementById("receiptEmailNotificationBanner");
  if (emailNotificationBanner && !preservePreview) {
    emailNotificationBanner.innerHTML = "";
    emailNotificationBanner.className = "hidden";
  }

  if (!preservePreview) {
    updateLiveReceiptPreview();
  }
};

function setupCashMemberSearch() {
  const searchInput = document.getElementById("cashMemberSearchInput");
  const resultsList = document.getElementById("cashMemberResultsList");
  const clearBtn = document.getElementById("cashMemberClearSearchBtn");
  const cashSelect = document.getElementById("cashMemberSelect");

  if (!searchInput || !resultsList) return;

  function filterMembers(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      if (clearBtn) clearBtn.classList.add("hidden");
      renderCashMemberOptions(approvedMembersList);
      updateCashMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
      resultsList.classList.add("hidden");
      return;
    }

    if (clearBtn) clearBtn.classList.remove("hidden");

    const matches = approvedMembersList.filter((m) => {
      const name = (m.full_name || "").toLowerCase();
      const epf = (m.epf_number || "").toLowerCase();
      const desig = (m.designation || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      return name.includes(query) || epf.includes(query) || desig.includes(query) || email.includes(query);
    });

    renderCashMemberOptions(matches.length > 0 ? matches : approvedMembersList);
    updateCashMemberMatchCount(matches.length, approvedMembersList.length);

    // Populate search popover
    if (matches.length === 0) {
      resultsList.innerHTML = `
        <div class="p-3 text-center text-xs text-on-surface-variant font-medium">
          No members found matching "<span class="font-bold text-on-surface">${q}</span>"
        </div>
      `;
    } else {
      resultsList.innerHTML = matches.map((m) => {
        const initials = (m.full_name || "M").charAt(0).toUpperCase();
        return `
          <div class="p-2.5 hover:bg-sky-50 transition-colors cursor-pointer flex items-center justify-between gap-2" onclick="window.selectCashMember(window.allMembers.find(item => item.id === '${m.id}'))">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-full bg-sky-100 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                ${initials}
              </div>
              <div class="min-w-0">
                <div class="font-bold text-xs text-on-surface truncate">${m.full_name}</div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-[10px] text-primary font-bold bg-sky-50 px-1 rounded border border-sky-200">EPF: ${m.epf_number || "N/A"}</span>
                  <span class="truncate">${m.designation || "Staff"}</span>
                </div>
              </div>
            </div>
            <span class="material-symbols-outlined text-[16px] text-primary/70 shrink-0">check</span>
          </div>
        `;
      }).join("");
    }
    resultsList.classList.remove("hidden");
  }

  searchInput.addEventListener("input", (e) => {
    filterMembers(e.target.value);
  });

  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim().length > 0) {
      filterMembers(searchInput.value);
    }
  });

  // Close search popover when clicking outside
  document.addEventListener("click", (e) => {
    const group = document.getElementById("cashMemberSelectGroup");
    if (group && !group.contains(e.target)) {
      resultsList.classList.add("hidden");
    }
  });

  // Synchronize when user manually changes the select dropdown
  if (cashSelect) {
    cashSelect.addEventListener("change", () => {
      const memberId = cashSelect.value;
      const member = approvedMembersList.find((m) => m.id === memberId);
      if (member) {
        selectCashMember(member);
      }
    });
  }
}

// ================= BENEFIT GRANTS MEMBER SEARCH & SELECTION =================

export function renderGrantMemberOptions(members) {
  const grantSelect = document.getElementById("grantMemberSelect");
  if (!grantSelect) return;

  const currentVal = grantSelect.value;
  grantSelect.innerHTML = '<option value="" disabled selected>-- Select Member from list or search above --</option>';

  members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.full_name} (EPF: ${m.epf_number || "N/A"}) - ${m.designation || "Staff"}`;
    grantSelect.appendChild(opt);
  });

  if (currentVal && [...grantSelect.options].some((opt) => opt.value === currentVal)) {
    grantSelect.value = currentVal;
  }
}

export function updateGrantMemberMatchCount(matches, total) {
  const badge = document.getElementById("grantMemberMatchCount");
  if (!badge) return;
  if (matches === total) {
    badge.textContent = `${total} Members Available`;
  } else {
    badge.textContent = `${matches} of ${total} Matches`;
  }
}

export function selectGrantMember(member) {
  const grantSelect = document.getElementById("grantMemberSelect");
  const searchInput = document.getElementById("grantMemberSearchInput");
  const resultsList = document.getElementById("grantMemberResultsList");
  const clearBtn = document.getElementById("grantMemberClearSearchBtn");
  const card = document.getElementById("grantSelectedMemberCard");

  if (!member) return;

  if (grantSelect) {
    if (![...grantSelect.options].some((opt) => opt.value === member.id)) {
      renderGrantMemberOptions(approvedMembersList);
    }
    grantSelect.value = member.id;
  }

  if (searchInput) {
    searchInput.value = `${member.full_name} (EPF: ${member.epf_number || "N/A"})`;
  }
  if (clearBtn) clearBtn.classList.remove("hidden");
  if (resultsList) resultsList.classList.add("hidden");

  if (card) {
    const nameEl = document.getElementById("grantSelectedMemberName");
    const epfEl = document.getElementById("grantSelectedMemberEpf");
    const desigEl = document.getElementById("grantSelectedMemberDesignation");
    const emailEl = document.getElementById("grantSelectedMemberEmail");
    const initialsEl = document.getElementById("grantSelectedMemberInitials");

    if (nameEl) nameEl.textContent = member.full_name || "-";
    if (epfEl) epfEl.textContent = `EPF: ${member.epf_number || "N/A"}`;
    if (desigEl) desigEl.textContent = member.designation || "Staff";
    if (emailEl) {
      if (member.email) {
        emailEl.innerHTML = `<span class="material-symbols-outlined text-[13px] text-emerald-600">mail</span><span class="text-slate-700">${escapeHtml(member.email)}</span>`;
      } else {
        emailEl.innerHTML = `<span class="material-symbols-outlined text-[13px] text-amber-600">mail_off</span><span class="text-amber-700 font-bold">No registered email on profile</span>`;
      }
    }
    if (initialsEl) {
      initialsEl.textContent = (member.full_name || "M").charAt(0).toUpperCase();
    }
    card.classList.remove("hidden");
  }

  updateLiveGrantVoucherPreview();
}
window.selectGrantMember = selectGrantMember;

window.clearGrantMemberSearch = function () {
  const searchInput = document.getElementById("grantMemberSearchInput");
  const clearBtn = document.getElementById("grantMemberClearSearchBtn");
  const resultsList = document.getElementById("grantMemberResultsList");

  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }
  if (clearBtn) clearBtn.classList.add("hidden");
  if (resultsList) resultsList.classList.add("hidden");

  renderGrantMemberOptions(approvedMembersList);
  updateGrantMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
  updateLiveGrantVoucherPreview();
};

window.resetGrantMemberSelection = function ({ preservePreview = false } = {}) {
  const grantSelect = document.getElementById("grantMemberSelect");
  const searchInput = document.getElementById("grantMemberSearchInput");
  const clearBtn = document.getElementById("grantMemberClearSearchBtn");
  const resultsList = document.getElementById("grantMemberResultsList");
  const card = document.getElementById("grantSelectedMemberCard");

  if (grantSelect) grantSelect.value = "";
  if (searchInput) searchInput.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");
  if (resultsList) resultsList.classList.add("hidden");
  if (card) card.classList.add("hidden");

  renderGrantMemberOptions(approvedMembersList);
  updateGrantMemberMatchCount(approvedMembersList.length, approvedMembersList.length);

  const emailBanner = document.getElementById("grantEmailNotificationBanner");
  if (emailBanner && !preservePreview) {
    emailBanner.innerHTML = "";
    emailBanner.className = "hidden";
  }

  if (!preservePreview) {
    updateLiveGrantVoucherPreview();
  }
};

function setupGrantMemberSearch() {
  const searchInput = document.getElementById("grantMemberSearchInput");
  const resultsList = document.getElementById("grantMemberResultsList");
  const clearBtn = document.getElementById("grantMemberClearSearchBtn");
  const grantSelect = document.getElementById("grantMemberSelect");

  if (!searchInput || !resultsList) return;

  function filterMembers(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      if (clearBtn) clearBtn.classList.add("hidden");
      renderGrantMemberOptions(approvedMembersList);
      updateGrantMemberMatchCount(approvedMembersList.length, approvedMembersList.length);
      resultsList.classList.add("hidden");
      return;
    }

    if (clearBtn) clearBtn.classList.remove("hidden");

    const matches = approvedMembersList.filter((m) => {
      const name = (m.full_name || "").toLowerCase();
      const epf = (m.epf_number || "").toLowerCase();
      const desig = (m.designation || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      return name.includes(query) || epf.includes(query) || desig.includes(query) || email.includes(query);
    });

    renderGrantMemberOptions(matches.length > 0 ? matches : approvedMembersList);
    updateGrantMemberMatchCount(matches.length, approvedMembersList.length);

    if (matches.length === 0) {
      resultsList.innerHTML = `
        <div class="p-3 text-center text-xs text-on-surface-variant font-medium">
          No members found matching "<span class="font-bold text-on-surface">${q}</span>"
        </div>
      `;
    } else {
      resultsList.innerHTML = matches.map((m) => {
        const initials = (m.full_name || "M").charAt(0).toUpperCase();
        return `
          <div class="p-2.5 hover:bg-sky-50 transition-colors cursor-pointer flex items-center justify-between gap-2" onclick="window.selectGrantMember(window.allMembers.find(item => item.id === '${m.id}'))">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-full bg-sky-100 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                ${initials}
              </div>
              <div class="min-w-0">
                <div class="font-bold text-xs text-on-surface truncate">${m.full_name}</div>
                <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-[10px] text-primary font-bold bg-sky-50 px-1 rounded border border-sky-200">EPF: ${m.epf_number || "N/A"}</span>
                  <span class="truncate">${m.designation || "Staff"}</span>
                </div>
              </div>
            </div>
            <span class="material-symbols-outlined text-[16px] text-primary/70 shrink-0">check</span>
          </div>
        `;
      }).join("");
    }
    resultsList.classList.remove("hidden");
  }

  searchInput.addEventListener("input", (e) => {
    filterMembers(e.target.value);
  });

  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim().length > 0) {
      filterMembers(searchInput.value);
    }
  });

  document.addEventListener("click", (e) => {
    const group = document.getElementById("grantMemberSelectGroup");
    if (group && !group.contains(e.target)) {
      resultsList.classList.add("hidden");
    }
  });

  if (grantSelect) {
    grantSelect.addEventListener("change", () => {
      const memberId = grantSelect.value;
      const member = approvedMembersList.find((m) => m.id === memberId);
      if (member) {
        selectGrantMember(member);
      }
    });
  }
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
          <td class="py-2.5 px-3 font-mono font-bold text-primary text-right tabular-nums">${formatCurrency(p.amount)}</td>
          <td class="py-2.5 px-3">${slipBtn}</td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-2">
              <button onclick="window.promptApproveSlip('${p.id}')" class="mutation-btn px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 text-xs inline-flex items-center gap-1 shadow-xs cursor-pointer">
                <span class="material-symbols-outlined text-[14px]">verified</span>
                <span>Approve &amp; Receipt</span>
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

window.promptApproveSlip = function (paymentId) {
  const payment = pendingPayments.find((p) => p.id === paymentId);
  if (!payment) {
    showToast("Selected payment slip not found in pending queue.", "error");
    return;
  }
  currentApprovingSlipPayment = payment;

  const m = payment.members || {};
  const memberName = m.full_name || m.email || "Member";
  const memberEpf = m.epf_number ? `EPF: ${m.epf_number}` : "EPF: N/A";
  const memberDesig = m.designation || "-";
  const verifierName = currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer";
  const categoryText = (payment.payment_type || "monthly_due").replace(/_/g, " ");

  // Populate inspection bar
  const nameEl = document.getElementById("approveSlipMemberName");
  const epfEl = document.getElementById("approveSlipMemberEpf");
  const catEl = document.getElementById("approveSlipCategory");
  const amountEl = document.getElementById("approveSlipAmount");
  const viewSlipBtn = document.getElementById("approveSlipQuickViewBtn");

  if (nameEl) nameEl.textContent = memberName;
  if (epfEl) epfEl.textContent = `${memberEpf} • ${memberDesig}`;
  if (catEl) catEl.textContent = categoryText;
  if (amountEl) amountEl.textContent = formatCurrency(payment.amount);

  if (viewSlipBtn) {
    if (payment.slip_key) {
      viewSlipBtn.style.display = "inline-flex";
      viewSlipBtn.onclick = () => window.viewSlip(payment.slip_key);
    } else {
      viewSlipBtn.style.display = "none";
    }
  }

  // Reset modal state
  const modalTitle = document.getElementById("approveSlipModalTitle");
  if (modalTitle) {
    modalTitle.textContent = "Approve Slip & Generate Official Receipt";
  }
  const banner = document.getElementById("approveSlipBanner");
  if (banner) {
    banner.className = "hidden";
    banner.innerHTML = "";
  }
  const actionBox = document.getElementById("approveSlipActionBox");
  if (actionBox) actionBox.classList.remove("hidden");
  const doneBox = document.getElementById("approveSlipDoneBox");
  if (doneBox) doneBox.classList.add("hidden");

  const btnConfirm = document.getElementById("btnExecuteApproveSlip");
  if (btnConfirm) {
    btnConfirm.disabled = false;
    btnConfirm.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>Confirm Approval &amp; Issue Receipt</span>';
  }

  // Render draft voucher preview
  const voucherContainer = document.getElementById("approveSlipVoucherContainer");
  if (voucherContainer) {
    const draftPayment = {
      ...payment,
      status: "draft",
      payment_method: payment.payment_method || "slip",
      paid_at: payment.paid_at || payment.created_at || new Date().toISOString(),
    };
    const displayName = m.full_name ? `${m.full_name} (${m.epf_number ? `EPF: ${m.epf_number}` : "Member"})` : (m.email || "Member");
    voucherContainer.innerHTML = renderReceiptHtml(draftPayment, displayName, verifierName, true);
  }

  openModal("approveSlipModal");
};

window.executeApproveSlip = async function () {
  if (!currentApprovingSlipPayment) {
    showToast("No payment selected for approval.", "error");
    return;
  }

  const payment = currentApprovingSlipPayment;
  const btn = document.getElementById("btnExecuteApproveSlip");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span><span>Verifying &amp; Reconciling...</span>';
  }

  try {
    const verifiedPayment = await verifyPayment(payment.id, currentStaff?.id || null);
    const m = payment.members || {};
    const memberName = m.full_name || m.email || "Member";
    const memberEmail = m.email || null;
    const memberEpf = m.epf_number || "";
    const verifierName = currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer";

    const officialPayment = {
      ...payment,
      ...(verifiedPayment || {}),
      status: "verified",
      payment_method: verifiedPayment?.payment_method || payment.payment_method || "slip",
      verified_by: currentStaff?.id || null,
      verified_at: verifiedPayment?.verified_at || new Date().toISOString(),
    };

    const receiptNumber = officialPayment.id
      ? `MRIA-REC-${officialPayment.id.slice(0, 8).toUpperCase()}`
      : "MRIA-REC";

    // Switch voucher view to Official Issued Receipt
    const voucherContainer = document.getElementById("approveSlipVoucherContainer");
    if (voucherContainer) {
      const displayName = m.full_name ? `${m.full_name} (${m.epf_number ? `EPF: ${m.epf_number}` : "Member"})` : (m.email || "Member");
      voucherContainer.innerHTML = renderReceiptHtml(officialPayment, displayName, verifierName, false);
    }

    // Update modal title
    const modalTitle = document.getElementById("approveSlipModalTitle");
    if (modalTitle) {
      modalTitle.textContent = `Official Receipt Issued: ${receiptNumber}`;
    }

    // Hide pre-confirm actions, show done box
    const actionBox = document.getElementById("approveSlipActionBox");
    if (actionBox) actionBox.classList.add("hidden");
    const doneBox = document.getElementById("approveSlipDoneBox");
    if (doneBox) doneBox.classList.remove("hidden");

    // Handle email dispatch & HTML banner
    const banner = document.getElementById("approveSlipBanner");
    const amount = Number(officialPayment.amount || 0);
    const category = officialPayment.payment_type || "monthly_due";
    const method = officialPayment.payment_method || "slip";
    const paidAt = officialPayment.paid_at || officialPayment.created_at || new Date().toISOString();

    if (memberEmail) {
      try {
        await sendReceiptEmail({
          paymentId: officialPayment.id,
          recipientEmail: memberEmail,
          recipientName: memberName,
          recipientEpf: memberEpf,
          receiptNumber,
          amount,
          paymentType: category,
          paymentMethod: method,
          paidAt,
          notes: officialPayment.notes || "Bank Deposit Slip Approved",
          collectedByName: verifierName,
        });

        logUserActivity({
          action: "SLIP_RECEIPT_EMAILED",
          entityType: "PAYMENT",
          entityId: officialPayment.id,
          details: {
            receiptNumber,
            amount,
            paymentMethod: method,
            memberId: officialPayment.member_id,
            recipientEmail: memberEmail,
          },
          actorEmail: currentStaff?.email || null,
          actorName: currentStaff?.full_name || null,
          epfNumber: currentStaff?.epf_number || null,
        }).catch(() => {});

        if (banner) {
          banner.className = "block";
          banner.innerHTML = `
            <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
              <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">check_circle</span>
              <div class="space-y-1">
                <div class="font-bold flex items-center gap-1.5 text-emerald-900">
                  <span>Official Receipt Issued</span>
                  <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-200/60 font-semibold text-emerald-800">ඩිජිටල් රිසිට්පත නිකුත් කරන ලදී</span>
                </div>
                <p class="text-[11px] text-emerald-800 leading-relaxed">
                  Receipt <strong>${receiptNumber}</strong> (Rs. ${amount.toLocaleString()} /=) recorded in official ledger. Digital voucher is ready below for download or print.
                </p>
              </div>
            </div>
          `;
        }

        showToast("Bank slip approved! Digital voucher ready below.", "success");
      } catch (emailErr) {
        console.error("Receipt email error:", emailErr);
        if (banner) {
          banner.className = "block";
          banner.innerHTML = `
            <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
              <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">check_circle</span>
              <div class="space-y-1">
                <div class="font-bold text-emerald-900">Official Receipt Issued</div>
                <p class="text-[11px] text-emerald-800 leading-relaxed">
                  Receipt <strong>${receiptNumber}</strong> recorded and reconciled in ledger. Digital voucher is ready below.
                </p>
              </div>
            </div>
          `;
        }
        showToast("Bank slip approved! Digital voucher ready.", "success");
      }
    } else {
      // Member has no registered email
      logUserActivity({
        action: "SLIP_RECEIPT_ISSUED_NO_EMAIL",
        entityType: "PAYMENT",
        entityId: officialPayment.id,
        details: {
          receiptNumber,
          amount,
          paymentMethod: method,
          memberId: officialPayment.member_id,
          memberName,
          notice: "No registered email on member profile",
        },
        actorEmail: currentStaff?.email || null,
        actorName: currentStaff?.full_name || null,
        epfNumber: currentStaff?.epf_number || null,
      }).catch(() => {});

      if (banner) {
        banner.className = "block";
        banner.innerHTML = `
          <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
            <span class="material-symbols-outlined text-amber-600 text-[20px] shrink-0 mt-0.5">mail_off</span>
            <div class="space-y-1">
              <div class="font-bold flex items-center gap-1.5 text-amber-900">
                <span>No Registered Email Address</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-200/60 font-semibold text-amber-800">ලියාපදිංචි විද්‍යුත් තැපෑලක් නොමැත</span>
              </div>
              <p class="text-[11px] text-amber-800 leading-relaxed">
                Member <strong>${escapeHtml(memberName)}</strong>${memberEpf ? ` (EPF: ${escapeHtml(memberEpf)})` : ""} does not have an email address registered in the system. The official receipt voucher <strong>${receiptNumber}</strong> was recorded in the database, but could not be sent by email. You can download or print the official voucher below, or share it via WhatsApp.
              </p>
            </div>
          </div>
        `;
      }
      showToast(`Bank slip approved! (Note: No registered email address on file for ${memberName})`, "warning");
    }

    // Sync relevant locations:
    // 1. Receipts Register
    if (receiptsLoaded) {
      const joinedReceipt = {
        ...officialPayment,
        members: m,
        verified_by_staff: currentStaff,
      };
      if (!allLoadedReceipts.some((r) => r.id === joinedReceipt.id)) {
        allLoadedReceipts.unshift(joinedReceipt);
        receiptsTotalCount += 1;
      }
      if (typeof renderReceiptsTable === "function") {
        renderReceiptsTable();
      }
    }

    // 2. Queue table & badge, and 3. Treasury balances & ledger
    await Promise.all([
      loadSlipApprovalQueue(),
      loadTreasuryData(),
    ]);

    // 4. Defaulters roster if open
    const defaultersTab = document.getElementById("tab-content-defaulters");
    if (defaultersTab && !defaultersTab.classList.contains("hidden")) {
      loadDefaultersData().catch(() => {});
    }
  } catch (err) {
    console.error("executeApproveSlip failed:", err);
    showToast(err.message || "Approval failed.", "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>Confirm Approval &amp; Issue Receipt</span>';
    }
  }
};

window.approveSlip = window.promptApproveSlip;

window.rejectSlipPrompt = async function (paymentId) {
  const reason = prompt("Enter reason for rejection:");
  if (reason === null) return;
  try {
    await rejectPayment(paymentId, currentStaff?.id || null, reason || "Incorrect amount or unverified slip");
    showToast("Payment slip rejected.", "info");
    await loadSlipApprovalQueue();
  } catch (err) {
    showToast(err.message || "Rejection failed.", "error");
  }
};

// ================= TAB 2: CASH DESK =================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSriLankaDateTimeLocal() {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function setCashDateToToday() {
  const dateInput = document.getElementById("cashDateInput");
  if (dateInput) {
    dateInput.value = getSriLankaDateTimeLocal();
  }
}

export function updateLiveReceiptPreview(isCommitted = false, payment = null) {
  const previewContainer = document.getElementById("cashReceiptPreview");
  const statusBadge = document.getElementById("receiptPreviewStatusBadge");
  const dlBtn = document.getElementById("btnDownloadCashVoucher");
  if (!previewContainer) return;

  if (isCommitted && payment) {
    if (dlBtn) dlBtn.classList.remove("hidden");
    if (statusBadge) {
      statusBadge.textContent = "Official Issued Receipt";
      statusBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200";
    }
    const memberId = payment.member_id;
    const selectedMember = allMembers.find((m) => m.id === memberId);
    const memberName = selectedMember ? `${selectedMember.full_name} (${selectedMember.epf_number || "EPF: N/A"})` : "Member";
    previewContainer.innerHTML = renderReceiptHtml(payment, memberName, currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer", false);
    return;
  }

  if (dlBtn) dlBtn.classList.add("hidden");

  // Live draft preview
  if (statusBadge) {
    statusBadge.textContent = "Live Draft Preview";
    statusBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200";
  }

  const memberId = document.getElementById("cashMemberSelect")?.value;
  const selectedMember = allMembers.find((m) => m.id === memberId);
  const memberName = selectedMember ? `${selectedMember.full_name} (${selectedMember.epf_number || "EPF: N/A"})` : "";
  const amount = Number(document.getElementById("cashAmountInput")?.value) || 0;
  const category = document.getElementById("cashCategorySelect")?.value || "monthly_due";
  const method = document.getElementById("cashMethodSelect")?.value || "cash";
  const dateVal = document.getElementById("cashDateInput")?.value || getSriLankaDateTimeLocal();
  const formattedDateVal = dateVal
    ? (dateVal.includes("+") || dateVal.includes("Z") ? dateVal : (dateVal.includes("T") ? `${dateVal}:00+05:30` : `${dateVal}T00:00:00+05:30`))
    : new Date().toISOString();
  const notes = document.getElementById("cashNotesInput")?.value || "";

  const draftPayment = {
    id: "DRAFT-PREVIEW",
    member_id: memberId,
    amount,
    payment_type: category,
    payment_method: method,
    status: "draft",
    paid_at: formattedDateVal,
    created_at: formattedDateVal,
    notes,
  };

  previewContainer.innerHTML = renderReceiptHtml(
    draftPayment,
    memberName,
    currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer",
    true
  );
}
window.updateLiveReceiptPreview = updateLiveReceiptPreview;

export function renderCashAdmissionFeeOptions() {
  const group = document.getElementById("cashAdmissionFeeTierGroup");
  const select = document.getElementById("cashAdmissionFeeSelect");
  const descText = document.getElementById("cashAdmissionFeeDescText");
  const amountInput = document.getElementById("cashAmountInput");
  const notesInput = document.getElementById("cashNotesInput");
  if (!group || !select) return;

  const activeFees = (admissionFeesList && admissionFeesList.length > 0)
    ? admissionFeesList.filter((f) => f.is_active)
    : [];

  const listToRender = activeFees.length > 0 ? activeFees : (admissionFeesList || [
    {
      id: "adm_standard",
      code: "STANDARD_ADMISSION",
      title_en: "Standard New Member Admission Fee",
      title_si: "නව සාමාජික ඇතුල්වීමේ ගාස්තුව",
      amount: configuredAdmissionFeeAmount || 500,
      is_active: true,
      description: "Standard statutory admission fee configured in Content & Settings",
    },
  ]);

  select.innerHTML = listToRender.map((f) => {
    return `<option value="${f.id}" data-amount="${f.amount}" data-title="${escapeHtml(f.title_en)}" data-desc="${escapeHtml(f.description || '')}">
      ${escapeHtml(f.title_en)} ${f.title_si ? `(${escapeHtml(f.title_si)})` : ""} — Rs. ${Number(f.amount).toLocaleString()}/=
    </option>`;
  }).join("");

  group.classList.remove("hidden");

  // Pick first/active fee
  const selectedOpt = select.options[select.selectedIndex];
  if (selectedOpt) {
    const amt = Number(selectedOpt.getAttribute("data-amount")) || configuredAdmissionFeeAmount || 500;
    const title = selectedOpt.getAttribute("data-title") || "Admission Fee";
    const desc = selectedOpt.getAttribute("data-desc") || "";

    if (amountInput) amountInput.value = amt;
    if (notesInput && (!notesInput.value || notesInput.value === "Monthly dues contribution" || notesInput.value.includes("Admission") || notesInput.value.includes("ඇතුල්වීම"))) {
      notesInput.value = title;
    }
    if (descText) {
      descText.textContent = desc ? `${desc} (Rate: Rs. ${amt.toLocaleString()}/=)` : `Content & Settings Configured Rate: Rs. ${amt.toLocaleString()}/=`;
    }
  }

  updateLiveReceiptPreview();
}
window.renderCashAdmissionFeeOptions = renderCashAdmissionFeeOptions;

function setupAdminForms() {
  setupCashMemberSearch();

  let currentCashIdempotencyKey = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
  const refreshCashIdempotencyKey = () => {
    currentCashIdempotencyKey = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
    return currentCashIdempotencyKey;
  };
  window.resetCashCollectionForm = function () {
    const cashForm = document.getElementById("cashCollectionForm");
    if (cashForm) cashForm.reset();
    const methodSelect = document.getElementById("cashMethodSelect");
    if (methodSelect) methodSelect.value = "cash";
    setCashDateToToday();
    const amountInput = document.getElementById("cashAmountInput");
    const categorySelect = document.getElementById("cashCategorySelect");
    if (amountInput) {
      if (categorySelect?.value === "monthly_due") {
        amountInput.value = configuredMonthlyDueAmount;
      } else if (categorySelect?.value === "admission_fee") {
        amountInput.value = configuredAdmissionFeeAmount;
      }
    }
    window.resetCashMemberSelection({ preservePreview: false });
    refreshCashIdempotencyKey();
    showToast("Cash desk reset. New transaction token generated.", "info");
  };

  const cashForm = document.getElementById("cashCollectionForm");
  const categorySelect = document.getElementById("cashCategorySelect");
  const amountInput = document.getElementById("cashAmountInput");
  const dateInput = document.getElementById("cashDateInput");
  const notesInput = document.getElementById("cashNotesInput");
  const methodSelect = document.getElementById("cashMethodSelect");
  const admissionFeeSelect = document.getElementById("cashAdmissionFeeSelect");

  // Automatically default collection date to today in Sri Lanka time
  setCashDateToToday();

  // If default category is monthly_due or admission_fee, set default configured amount
  if (categorySelect && amountInput) {
    if (categorySelect.value === "monthly_due") {
      amountInput.value = configuredMonthlyDueAmount;
    } else if (categorySelect.value === "admission_fee") {
      renderCashAdmissionFeeOptions();
    }
  }

  // When payment category changes, retrieve data from Content & Settings
  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      const tierGroup = document.getElementById("cashAdmissionFeeTierGroup");
      if (categorySelect.value === "admission_fee") {
        renderCashAdmissionFeeOptions();
      } else {
        if (tierGroup) tierGroup.classList.add("hidden");
        if (categorySelect.value === "monthly_due") {
          if (amountInput) amountInput.value = configuredMonthlyDueAmount;
          if (notesInput && (!notesInput.value || notesInput.value.includes("Admission") || notesInput.value.includes("ඇතුල්වීම"))) {
            notesInput.value = "Monthly dues contribution";
          }
        }
      }
      updateLiveReceiptPreview();
    });
  }

  // When selected admission fee tier changes from Content & Settings schedule
  if (admissionFeeSelect) {
    admissionFeeSelect.addEventListener("change", () => {
      const selectedOpt = admissionFeeSelect.options[admissionFeeSelect.selectedIndex];
      if (selectedOpt) {
        const amt = Number(selectedOpt.getAttribute("data-amount")) || configuredAdmissionFeeAmount || 500;
        const title = selectedOpt.getAttribute("data-title") || "Admission Fee";
        const desc = selectedOpt.getAttribute("data-desc") || "";
        const descText = document.getElementById("cashAdmissionFeeDescText");

        if (amountInput) amountInput.value = amt;
        if (notesInput) notesInput.value = title;
        if (descText) {
          descText.textContent = desc ? `${desc} (Rate: Rs. ${amt.toLocaleString()}/=)` : `Content & Settings Configured Rate: Rs. ${amt.toLocaleString()}/=`;
        }
        updateLiveReceiptPreview();
      }
    });
  }

  if (amountInput) {
    amountInput.addEventListener("input", () => {
      updateLiveReceiptPreview();
    });
  }

  if (dateInput) {
    dateInput.addEventListener("change", () => {
      updateLiveReceiptPreview();
    });
  }

  if (notesInput) {
    notesInput.addEventListener("input", () => {
      updateLiveReceiptPreview();
    });
  }

  if (methodSelect) {
    methodSelect.addEventListener("change", () => {
      updateLiveReceiptPreview();
    });
  }

  // Render initial live preview
  updateLiveReceiptPreview();

  if (cashForm) {
    cashForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const memberId = document.getElementById("cashMemberSelect").value;
      const amount = Number(document.getElementById("cashAmountInput").value);
      const category = document.getElementById("cashCategorySelect").value;
      const method = document.getElementById("cashMethodSelect")?.value || "cash";
      const notes = document.getElementById("cashNotesInput").value;
      const dateVal = document.getElementById("cashDateInput").value;
      const issueBtn = document.getElementById("issueReceiptBtn");
      const banner = document.getElementById("receiptEmailNotificationBanner");

      if (!memberId || !amount) {
        showToast("Please select a member and valid amount.", "warning");
        return;
      }

      const selectedMember = allMembers.find((m) => m.id === memberId);
      const memberEmail = (selectedMember?.email || "").trim();
      const memberName = selectedMember ? selectedMember.full_name : "Member";
      const memberEpf = selectedMember?.epf_number || "";

      // Ensure timestamp preserves Sri Lanka Time offset (+05:30)
      const formattedPaidAt = dateVal
        ? (dateVal.includes("+") || dateVal.includes("Z") ? dateVal : `${dateVal}:00+05:30`)
        : new Date().toISOString();

      try {
        if (issueBtn) {
          issueBtn.disabled = true;
          issueBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span><span>Processing Payment &amp; Voucher...</span>';
        }

        const payment = await recordCashPayment({
          memberId,
          amount,
          paymentType: category,
          paymentMethod: method,
          collectedByMemberId: currentStaff?.id || null,
          notes,
          paidAt: formattedPaidAt,
          idempotencyKey: currentCashIdempotencyKey,
        });

        // Unconditionally refresh form token after settled transaction so subsequent payments get fresh token
        refreshCashIdempotencyKey();

        const receiptNumber = payment?.id ? `MRIA-REC-${payment.id.slice(0, 8).toUpperCase()}` : "MRIA-REC";

        if (receiptsLoaded && payment && !payment.is_replayed) {
          const joinedReceipt = {
            ...payment,
            members: selectedMember,
            verified_by_staff: currentStaff,
          };
          allLoadedReceipts.unshift(joinedReceipt);
          receiptsTotalCount += 1;
        }

        // Update live voucher preview to official issued state
        updateLiveReceiptPreview(true, payment);

        if (payment.is_replayed) {
          // INTERCEPTED DUPLICATE: Replay official voucher without duplicate email or activity logs
          if (banner) {
            banner.className = "mt-4 block";
            banner.innerHTML = `
              <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
                <span class="material-symbols-outlined text-amber-600 text-[20px] shrink-0 mt-0.5">verified</span>
                <div class="space-y-1">
                  <div class="font-bold flex items-center gap-1.5 text-amber-900">
                    <span>Payment Already Recorded (Duplicate Intercepted)</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-200/60 font-semibold text-amber-800">දැනටමත් සටහන් කර ඇත</span>
                  </div>
                  <p class="text-[11px] text-amber-800 leading-relaxed">
                    This cash payment was already recorded under Receipt <strong>${receiptNumber}</strong> (Rs. ${Number(amount).toLocaleString()} /=). Official digital voucher reloaded below without creating a duplicate entry or sending a duplicate email.
                  </p>
                </div>
              </div>
            `;
          }
          showToast("Payment already recorded! Official voucher reloaded.", "info");
        } else if (memberEmail) {
          // Handle Automated Email Dispatch & HTML Message for fresh payments
          try {
            await sendReceiptEmail({
              paymentId: payment.id,
              recipientEmail: memberEmail,
              recipientName: memberName,
              recipientEpf: memberEpf,
              receiptNumber,
              amount,
              paymentType: category,
              paymentMethod: method,
              paidAt: formattedPaidAt,
              notes,
              collectedByName: currentStaff?.full_name || "Treasurer",
            });

            logUserActivity({
              action: "CASH_RECEIPT_EMAILED",
              entityType: "PAYMENT",
              entityId: payment.id,
              details: {
                receiptNumber,
                amount,
                paymentMethod: method,
                recipientEmail: memberEmail,
                memberId,
                paymentType: category,
              },
              actorEmail: currentStaff?.email || null,
              actorName: currentStaff?.full_name || null,
              epfNumber: currentStaff?.epf_number || null,
            }).catch(() => {});

            if (banner) {
              banner.className = "mt-4 block";
              banner.innerHTML = `
                <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
                  <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">check_circle</span>
                  <div class="space-y-1">
                    <div class="font-bold flex items-center gap-1.5 text-emerald-900">
                      <span>Official Receipt Issued</span>
                      <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-200/60 font-semibold text-emerald-800">ඩිජිටල් රිසිට්පත නිකුත් කරන ලදී</span>
                    </div>
                    <p class="text-[11px] text-emerald-800 leading-relaxed">
                      Receipt <strong>${receiptNumber}</strong> (Rs. ${amount.toLocaleString()} /=) recorded in official ledger. Digital voucher is ready below for download or print.
                    </p>
                  </div>
                </div>
              `;
            }

            showToast("Cash payment recorded! Digital voucher ready below.", "success");
          } catch (emailErr) {
            console.error("Receipt email error:", emailErr);
            if (banner) {
              banner.className = "mt-4 block";
              banner.innerHTML = `
                <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
                  <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">check_circle</span>
                  <div class="space-y-1">
                    <div class="font-bold text-emerald-900">Official Receipt Issued</div>
                    <p class="text-[11px] text-emerald-800 leading-relaxed">
                      Receipt <strong>${receiptNumber}</strong> recorded. Email dispatch to <strong>${escapeHtml(memberEmail)}</strong> was triggered. Digital voucher is ready below.
                    </p>
                  </div>
                </div>
              `;
            }
            showToast("Cash payment recorded! Digital voucher ready below.", "success");
          }
        } else {
          // NO email registered on member profile -> display HTML message as specified
          logUserActivity({
            action: "CASH_RECEIPT_ISSUED_NO_EMAIL",
            entityType: "PAYMENT",
            entityId: payment.id,
            details: {
              receiptNumber,
              amount,
              paymentMethod: method,
              memberId,
              memberName,
              paymentType: category,
              notice: "No registered email on member profile",
            },
            actorEmail: currentStaff?.email || null,
            actorName: currentStaff?.full_name || null,
            epfNumber: currentStaff?.epf_number || null,
          }).catch(() => {});

          if (banner) {
            banner.className = "mt-4 block";
            banner.innerHTML = `
              <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
                <span class="material-symbols-outlined text-amber-600 text-[20px] shrink-0 mt-0.5">mail_off</span>
                <div class="space-y-1">
                  <div class="font-bold flex items-center gap-1.5 text-amber-900">
                    <span>No Registered Email Address</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-200/60 font-semibold text-amber-800">ලියාපදිංචි විද්‍යුත් තැපෑලක් නොමැත</span>
                  </div>
                  <p class="text-[11px] text-amber-800 leading-relaxed">
                    Member <strong>${escapeHtml(memberName)}</strong>${memberEpf ? ` (EPF: ${escapeHtml(memberEpf)})` : ""} does not have an email address registered in the system. The official receipt voucher <strong>${receiptNumber}</strong> was recorded in the database, but could not be sent by email. You can download or print the official voucher below, or share it via WhatsApp.
                  </p>
                </div>
              </div>
            `;
          }

          showToast(`Payment recorded! (Note: No registered email address on file for ${memberName})`, "warning");
        }

        cashForm.reset();
        if (methodSelect) {
          methodSelect.value = "cash";
        }
        setCashDateToToday();
        if (amountInput) {
          if (categorySelect?.value === "monthly_due") {
            amountInput.value = configuredMonthlyDueAmount;
          } else if (categorySelect?.value === "admission_fee") {
            amountInput.value = configuredAdmissionFeeAmount;
          }
        }
        window.resetCashMemberSelection({ preservePreview: true });
        await loadTreasuryData();
      } catch (err) {
        if (err.message && err.message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) {
          showToast("Transaction Conflict: Form token was already used with conflicting payment data. Resetting form token.", "error");
          refreshCashIdempotencyKey();
        } else {
          showToast(err.message || "Failed to record cash payment.", "error");
        }
      } finally {
        if (issueBtn) {
          issueBtn.disabled = false;
          issueBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">verified</span><span>Issue Cash Receipt &amp; Settle Dues</span>';
        }
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
  setupAdmissionFeeModalsHandlers();
  setupBenefitModalsHandlers();
  setupReceiptsSearchAndFilters();
  setupGrantDeskForm();
  setupVoidReceiptHandler();
  setupUndoClaimHandler();
  setupInquiriesHandlers();
  setupNotificationHandlers();
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

    // Load initial 10 Cash Book transactions
    await loadCashBookTransactions({ reset: true });
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

// ================= CASH BOOK LEDGER (මුදල් පොත) =================

let cashBookOffset = 0;
const CASH_BOOK_PAGE_SIZE = 10;
let cashBookSelectedAccount = "";
let cashBookTotalCount = 0;
let cashBookTransactionsList = [];
let cashBookIsLoading = false;

async function loadCashBookTransactions({ reset = false } = {}) {
  const tbody = document.getElementById("cashBookTableBody");
  const countBadge = document.getElementById("cashBookCountBadge");
  const statusText = document.getElementById("cashBookStatusText");
  const nextBtn = document.getElementById("btnLoadNextCashBook");
  const refreshBtn = document.getElementById("btnRefreshCashBook");

  if (!tbody) return;

  if (reset) {
    cashBookOffset = 0;
    cashBookTransactionsList = [];
    cashBookTotalCount = 0;
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-on-surface-variant font-medium">
          <div class="inline-flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px] animate-spin text-primary">sync</span>
            <span>Fetching cash book transactions...</span>
          </div>
        </td>
      </tr>
    `;
  }

  try {
    cashBookIsLoading = true;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Loading...</span>';
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    const rows = await getCashBookTransactions({
      limit: CASH_BOOK_PAGE_SIZE,
      offset: cashBookOffset,
      accountId: cashBookSelectedAccount,
    });

    if (reset) {
      cashBookTransactionsList = rows;
    } else {
      cashBookTransactionsList = [...cashBookTransactionsList, ...rows];
    }

    cashBookTotalCount = Number(rows[0]?.total_count || cashBookTransactionsList.length || 0);

    renderCashBookRows();

    if (countBadge) {
      countBadge.textContent = `Showing ${cashBookTransactionsList.length} of ${cashBookTotalCount}`;
    }

    if (statusText) {
      statusText.textContent = `Showing ${cashBookTransactionsList.length} of ${cashBookTotalCount} transactions recorded in the cash book.`;
    }

    if (nextBtn) {
      if (cashBookTransactionsList.length >= cashBookTotalCount || rows.length === 0) {
        nextBtn.disabled = true;
        nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>All transactions loaded (සියල්ල පෙන්වා ඇත)</span>';
      } else {
        nextBtn.disabled = false;
        nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">expand_more</span><span>Load Next 10 Transactions (තවත් 10ක් පෙන්වන්න)</span>';
      }
    }
  } catch (err) {
    console.error("Cash Book error:", err);
    if (tbody && reset) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-rose-600 font-bold">Failed to load cash book: ${err.message || err}</td></tr>`;
    }
    if (statusText) statusText.textContent = `Error: ${err.message || err}`;
  } finally {
    cashBookIsLoading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function renderCashBookRows() {
  const tbody = document.getElementById("cashBookTableBody");
  if (!tbody) return;

  if (cashBookTransactionsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-on-surface-variant font-medium">
          <div class="max-w-sm mx-auto space-y-2">
            <span class="material-symbols-outlined text-3xl text-on-surface-variant/60">receipt_long</span>
            <div class="text-sm font-bold text-on-surface">No Transactions Found</div>
            <p class="text-xs text-on-surface-variant">No cash book transactions match the selected account filter.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = cashBookTransactionsList.map((tx) => {
    const dateStr = tx.created_at || tx.transaction_date;
    const formattedDate = dateStr
      ? new Date(dateStr).toLocaleString("en-GB", {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "-";

    // Account badge formatting
    const destAcc = tx.destination_account_id;
    const srcAcc = tx.source_account_id;
    let accBadge = "";

    const formatAccountPill = (accId) => {
      if (accId === "boc_savings") {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200"><span class="material-symbols-outlined text-[13px]">account_balance</span>Bank Savings</span>`;
      } else if (accId === "cash_in_hand") {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200"><span class="material-symbols-outlined text-[13px]">payments</span>Cash in Hand</span>`;
      } else if (accId === "fixed_deposits") {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200"><span class="material-symbols-outlined text-[13px]">lock_clock</span>Fixed Deposits</span>`;
      }
      return `<span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100">${accId || "General"}</span>`;
    };

    if (tx.transaction_type === "transfer" && srcAcc && destAcc) {
      accBadge = `<div class="flex items-center gap-1 flex-wrap">${formatAccountPill(srcAcc)} <span class="material-symbols-outlined text-[12px] text-on-surface-variant">arrow_forward</span> ${formatAccountPill(destAcc)}</div>`;
    } else {
      accBadge = formatAccountPill(destAcc || srcAcc);
    }

    const refPill = tx.reference_no
      ? `<span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-100 text-on-surface font-semibold">${tx.reference_no}</span>`
      : "";

    const memberInfo = tx.member_name && tx.member_name !== "MRIA Welfare Fund"
      ? `<div class="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
           <span class="material-symbols-outlined text-[12px]">person</span>
           <span>${tx.member_name}</span>
           ${tx.member_epf && tx.member_epf !== "N/A" ? `<span class="font-mono text-[10px] text-primary">(${tx.member_epf})</span>` : ""}
         </div>`
      : "";

    const inflowNum = Number(tx.inflow || 0);
    const outflowNum = Number(tx.outflow || 0);
    const runningBalNum = Number(tx.running_balance || 0);

    const inCol = inflowNum > 0
      ? `<span class="font-mono font-bold text-emerald-700">+${formatCurrency(inflowNum)}</span>`
      : `<span class="text-on-surface-variant/40">-</span>`;

    const outCol = outflowNum > 0
      ? `<span class="font-mono font-bold text-rose-700">-${formatCurrency(outflowNum)}</span>`
      : `<span class="text-on-surface-variant/40">-</span>`;

    return `
      <tr class="hover:bg-surface/60 transition-colors text-xs font-sans">
        <td class="py-3 px-3 whitespace-nowrap text-on-surface-variant font-mono text-[11px]">
          ${formattedDate}
        </td>
        <td class="py-3 px-3">
          ${accBadge}
        </td>
        <td class="py-3 px-3">
          <div class="font-bold text-on-surface text-xs flex items-center gap-1.5 flex-wrap">
            <span>${tx.description || "-"}</span>
            ${refPill}
          </div>
          ${memberInfo}
        </td>
        <td class="py-3 px-3 text-right">
          ${inCol}
        </td>
        <td class="py-3 px-3 text-right">
          ${outCol}
        </td>
        <td class="py-3 px-3 text-right">
          <span class="font-mono font-extrabold text-on-surface text-xs">${formatCurrency(runningBalNum)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

window.loadNextCashBookTransactions = function () {
  if (cashBookIsLoading) return;
  cashBookOffset += CASH_BOOK_PAGE_SIZE;
  loadCashBookTransactions({ reset: false });
};

window.reloadCashBook = function () {
  loadCashBookTransactions({ reset: true });
};

window.filterCashBookAccount = function (accountId) {
  cashBookSelectedAccount = accountId;
  loadCashBookTransactions({ reset: true });
};

// ================= TAB: OFFICIAL RECEIPTS & VOUCHERS REGISTER =================

let allLoadedReceipts = [];
let receiptsTotalCount = 0;
let receiptsLoaded = false;
let receiptsSortField = "date"; // 'date' | 'name' | 'receipt_num' | 'amount' | 'category' | 'method'
let receiptsSortAsc = false;
let receiptsSearchQuery = "";
let receiptsFilterCategory = "all";
let receiptsFilterMethod = "all";
let receiptsFilterStatus = "verified";
let receiptsIsLoading = false;
const RECEIPTS_PAGE_SIZE = 25;

async function loadReceiptsData(force = false) {
  const tbody = document.getElementById("receiptsTableBody");
  const countBadge = document.getElementById("receiptsCountBadge");
  const refreshBtn = document.getElementById("btnRefreshReceipts");
  const tabBadge = document.getElementById("tabReceiptsCountBadge");

  if (!tbody) return;
  if (receiptsIsLoading) return;

  try {
    receiptsIsLoading = true;
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Loading Receipts...</span>';
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-on-surface-variant font-medium">
          <div class="inline-flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px] animate-spin text-primary">sync</span>
            <span>Fetching official payment receipts from database...</span>
          </div>
        </td>
      </tr>
    `;

    const result = await getPaymentReceipts({
      limit: RECEIPTS_PAGE_SIZE,
      offset: 0,
      status: "all",
      category: receiptsFilterCategory,
      paymentMethod: receiptsFilterMethod,
    });

    allLoadedReceipts = result.receipts || [];
    receiptsTotalCount = Number(result.totalCount || allLoadedReceipts.length);
    receiptsLoaded = true;

    if (countBadge) {
      countBadge.textContent = `Showing ${allLoadedReceipts.length} of ${receiptsTotalCount}`;
    }
    if (tabBadge) {
      tabBadge.textContent = receiptsTotalCount;
      tabBadge.classList.remove("hidden");
    }

    renderReceiptsTable();
  } catch (err) {
    console.error("Failed to load payment receipts:", err);
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-rose-600 font-bold">Failed to load receipts: ${err.message || err}</td></tr>`;
  } finally {
    receiptsIsLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">refresh</span><span>Load / Refresh Receipts</span>';
    }
  }
}
window.loadReceiptsData = loadReceiptsData;

async function loadNextReceiptsPage() {
  const nextBtn = document.getElementById("btnLoadMoreReceipts");
  if (receiptsIsLoading || !receiptsLoaded) return;

  const offset = allLoadedReceipts.length;
  if (offset >= receiptsTotalCount) {
    showToast("All receipts have already been loaded.", "info");
    return;
  }

  try {
    receiptsIsLoading = true;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Loading next 25...</span>';
    }

    const result = await getPaymentReceipts({
      limit: RECEIPTS_PAGE_SIZE,
      offset,
      status: "all",
      category: receiptsFilterCategory,
      paymentMethod: receiptsFilterMethod,
    });

    const newRows = result.receipts || [];
    allLoadedReceipts = allLoadedReceipts.concat(newRows);
    receiptsTotalCount = Number(result.totalCount || allLoadedReceipts.length);

    renderReceiptsTable();
    showToast(`Loaded ${newRows.length} more receipts (${allLoadedReceipts.length} of ${receiptsTotalCount})`, "info");
  } catch (err) {
    console.error("Failed to load next receipts page:", err);
    showToast("Failed to load next receipts: " + (err.message || err), "error");
  } finally {
    receiptsIsLoading = false;
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">expand_more</span><span>Load Next 25 Receipts</span>';
    }
  }
}
window.loadNextReceiptsPage = loadNextReceiptsPage;

function renderReceiptsTable() {
  const tbody = document.getElementById("receiptsTableBody");
  const countBadge = document.getElementById("receiptsCountBadge");
  const paginationBar = document.getElementById("receiptsPaginationBar");
  const paginationInfo = document.getElementById("receiptsPaginationInfo");
  const nextBtn = document.getElementById("btnLoadMoreReceipts");
  if (!tbody) return;

  if (!receiptsLoaded) return;

  const query = receiptsSearchQuery.trim().toLowerCase();
  let list = allLoadedReceipts.slice();

  // 1. Filter by Search Query
  if (query) {
    list = list.filter((r) => {
      const member = r.members || {};
      const fullName = (member.full_name || "").toLowerCase();
      const epf = (member.epf_number || "").toLowerCase();
      const desig = (member.designation || "").toLowerCase();
      const rawId = (r.id || "").toLowerCase();
      const recNumber = `mria-rec-${rawId.slice(0, 8)}`.toLowerCase();
      const notes = (r.notes || "").toLowerCase();
      const amount = String(r.amount || "");
      const cat = (r.payment_type || "").toLowerCase();
      const meth = (r.payment_method || "").toLowerCase();

      return (
        fullName.includes(query) ||
        epf.includes(query) ||
        desig.includes(query) ||
        recNumber.includes(query) ||
        rawId.includes(query) ||
        notes.includes(query) ||
        amount.includes(query) ||
        cat.includes(query) ||
        meth.includes(query)
      );
    });
  }

  // 2. Filter by Category
  if (receiptsFilterCategory && receiptsFilterCategory !== "all") {
    list = list.filter((r) => r.payment_type === receiptsFilterCategory);
  }

  // 3. Filter by Payment Method
  if (receiptsFilterMethod && receiptsFilterMethod !== "all") {
    list = list.filter((r) => r.payment_method === receiptsFilterMethod);
  }

  // 3b. Filter by Status (Verified vs Voided)
  const statusFilter = document.getElementById("receiptsStatusFilter")?.value || document.getElementById("receiptsFilterStatus")?.value || receiptsFilterStatus || "all";
  if (statusFilter && statusFilter !== "all") {
    list = list.filter((r) => r.status === statusFilter);
  }

  // 4. Sort
  list.sort((a, b) => {
    let comp = 0;
    if (receiptsSortField === "date") {
      const dateA = new Date(a.paid_at || a.verified_at || a.created_at || 0).getTime();
      const dateB = new Date(b.paid_at || b.verified_at || b.created_at || 0).getTime();
      comp = dateA - dateB;
    } else if (receiptsSortField === "name") {
      const nameA = (a.members?.full_name || "").toLowerCase();
      const nameB = (b.members?.full_name || "").toLowerCase();
      comp = nameA.localeCompare(nameB);
    } else if (receiptsSortField === "receipt_num") {
      const recA = (a.id || "").toLowerCase();
      const recB = (b.id || "").toLowerCase();
      comp = recA.localeCompare(recB);
    } else if (receiptsSortField === "amount") {
      comp = Number(a.amount || 0) - Number(b.amount || 0);
    } else if (receiptsSortField === "category") {
      const catA = (a.payment_type || "").toLowerCase();
      const catB = (b.payment_type || "").toLowerCase();
      comp = catA.localeCompare(catB);
    } else if (receiptsSortField === "method") {
      const methA = (a.payment_method || "").toLowerCase();
      const methB = (b.payment_method || "").toLowerCase();
      comp = methA.localeCompare(methB);
    }
    return receiptsSortAsc ? comp : -comp;
  });

  // 5. Update Sort Column Header Icons
  const sortFields = ["receipt_num", "name", "amount", "date", "category", "method"];
  sortFields.forEach((field) => {
    const iconEl = document.getElementById(`sortIcon_${field}`);
    if (iconEl) {
      if (receiptsSortField === field) {
        iconEl.textContent = receiptsSortAsc ? "arrow_upward" : "arrow_downward";
        iconEl.className = "material-symbols-outlined text-[14px] text-primary opacity-100 font-bold";
      } else {
        iconEl.textContent = "unfold_more";
        iconEl.className = "material-symbols-outlined text-[14px] opacity-40 font-normal";
      }
    }
  });

  // Update Sort dropdown & direction button
  const sortSelect = document.getElementById("receiptsSortSelect");
  if (sortSelect) sortSelect.value = receiptsSortField;
  const sortDirIcon = document.getElementById("receiptsSortDirIcon");
  if (sortDirIcon) {
    sortDirIcon.textContent = receiptsSortAsc ? "arrow_upward" : "arrow_downward";
  }

  // 6. Render Table Content
  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-on-surface-variant font-medium">
          <div class="max-w-sm mx-auto space-y-2">
            <span class="material-symbols-outlined text-3xl text-on-surface-variant/60">search_off</span>
            <div class="font-bold text-sm text-on-surface">No Receipts Found</div>
            <p class="text-xs text-on-surface-variant">
              No payment receipts match your search and filter criteria.
            </p>
          </div>
        </td>
      </tr>
    `;
  } else {
    const categoryInfo = {
      monthly_due: { en: "Monthly Due", si: "මාසික දායක", color: "bg-sky-50 text-sky-800 border-sky-200" },
      admission_fee: { en: "Admission Fee", si: "ඇතුල්වීමේ ගාස්තුව", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
      donation: { en: "Donation / Aid", si: "ආධාර මුදල්", color: "bg-purple-50 text-purple-800 border-purple-200" },
    };

    const methodInfo = {
      cash: { name: "Direct Cash", icon: "payments", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
      bank_transfer: { name: "Bank Transfer", icon: "account_balance", color: "text-sky-700 bg-sky-50 border-sky-200" },
      qr_payment: { name: "LankaQR", icon: "qr_code_scanner", color: "text-amber-800 bg-amber-50 border-amber-200" },
      slip: { name: "Deposit Slip", icon: "receipt", color: "text-slate-700 bg-slate-100 border-slate-200" },
    };

    tbody.innerHTML = list.map((r) => {
      const recNum = r.id ? `MRIA-REC-${r.id.slice(0, 8).toUpperCase()}` : "MRIA-REC";
      const m = r.members || {};
      const memberName = m.full_name || "Member";
      const memberEpf = m.epf_number || "N/A";
      const memberDesig = m.designation || "Staff";

      const rawDate = r.paid_at || r.verified_at || r.created_at;
      const formattedDate = rawDate
        ? new Date(rawDate).toLocaleString("en-GB", {
            timeZone: "Asia/Colombo",
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "-";

      const catMeta = categoryInfo[r.payment_type] || { en: r.payment_type, si: "", color: "bg-slate-100 text-slate-700 border-slate-200" };
      const methMeta = methodInfo[r.payment_method] || { name: r.payment_method, icon: "payments", color: "text-slate-700 bg-slate-100 border-slate-200" };

      const amountVal = Number(r.amount || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      return `
        <tr class="hover:bg-surface/50 transition-colors" data-receipt-id="${r.id}">
          <td class="py-3 px-3 whitespace-nowrap">
            <span class="font-mono font-bold text-primary text-xs px-2 py-0.5 rounded-lg bg-sky-50 border border-sky-200">
              ${recNum}
            </span>
          </td>
          <td class="py-3 px-3">
            <div class="min-w-0">
              <div class="font-bold text-on-surface text-xs truncate">${escapeHtml(memberName)}</div>
              <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5 flex-wrap mt-0.5">
                <span class="font-mono text-[10px] text-primary font-bold bg-sky-50 px-1 rounded border border-sky-200">EPF: ${escapeHtml(memberEpf)}</span>
                <span class="truncate">${escapeHtml(memberDesig)}</span>
              </div>
            </div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap text-right">
            <div class="font-extrabold text-xs sm:text-sm font-mono tabular-nums ${r.status === 'voided' ? 'line-through text-rose-500' : 'text-emerald-700'}">
              Rs. ${amountVal}
            </div>
            ${r.status === 'voided' ? '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 mt-0.5">VOIDED</span>' : ''}
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <div class="text-xs text-on-surface font-medium">${formattedDate}</div>
            <div class="text-[10px] text-on-surface-variant">Sri Lanka Time</div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${catMeta.color}">
              ${catMeta.en}
            </span>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${methMeta.color}">
              <span class="material-symbols-outlined text-[13px]">${methMeta.icon}</span>
              <span>${methMeta.name}</span>
            </span>
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="inline-flex items-center gap-1.5 justify-end">
              <button 
                type="button" 
                onclick="window.viewReceiptVoucher('${r.id}')" 
                class="px-2.5 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded-xl shadow-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="View, Print, or Download Official Voucher"
              >
                <span class="material-symbols-outlined text-[15px]">visibility</span>
                <span>View Voucher</span>
              </button>
              ${r.status === 'verified' ? `
              <button 
                type="button" 
                onclick="window.promptVoidReceipt('${r.id}')" 
                class="px-2 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 text-xs font-bold rounded-xl shadow-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Void Payment Receipt"
              >
                <span class="material-symbols-outlined text-[15px]">cancel</span>
                <span>Void</span>
              </button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // 7. Update Footer & Pagination Controls
  if (countBadge) {
    countBadge.textContent = `Showing ${list.length} of ${receiptsTotalCount}`;
  }
  if (paginationBar) {
    paginationBar.classList.remove("hidden");
  }
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${list.length} of ${receiptsTotalCount} receipts (${allLoadedReceipts.length} loaded from database).`;
  }
  if (nextBtn) {
    if (allLoadedReceipts.length >= receiptsTotalCount || allLoadedReceipts.length === 0) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>All Receipts Loaded</span>';
      nextBtn.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      nextBtn.disabled = false;
      nextBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">expand_more</span><span>Load Next 25 Receipts</span>';
      nextBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  }
}
window.renderReceiptsTable = renderReceiptsTable;

window.changeReceiptsSort = function (field) {
  if (receiptsSortField === field) {
    receiptsSortAsc = !receiptsSortAsc;
  } else {
    receiptsSortField = field;
    receiptsSortAsc = (field === "name" || field === "receipt_num");
  }
  renderReceiptsTable();
};

window.toggleReceiptsSortDirection = function () {
  receiptsSortAsc = !receiptsSortAsc;
  renderReceiptsTable();
};

window.filterReceiptsCategory = function (cat) {
  receiptsFilterCategory = cat;
  if (receiptsLoaded) {
    renderReceiptsTable();
  }
};

window.filterReceiptsMethod = function (method) {
  receiptsFilterMethod = method;
  if (receiptsLoaded) {
    renderReceiptsTable();
  }
};

window.filterReceiptsStatus = function (status) {
  receiptsFilterStatus = status;
  if (receiptsLoaded) {
    renderReceiptsTable();
  }
};

window.clearReceiptsSearch = function () {
  const input = document.getElementById("receiptsSearchInput");
  const clearBtn = document.getElementById("receiptsClearSearchBtn");
  if (input) input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");
  receiptsSearchQuery = "";
  renderReceiptsTable();
};

function setupReceiptsSearchAndFilters() {
  const input = document.getElementById("receiptsSearchInput");
  const clearBtn = document.getElementById("receiptsClearSearchBtn");
  if (!input) return;

  let timer;
  input.addEventListener("input", () => {
    receiptsSearchQuery = input.value;
    if (clearBtn) {
      if (receiptsSearchQuery.trim()) {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderReceiptsTable();
    }, 150);
  });
}

window.viewReceiptVoucher = function (id) {
  const r = allLoadedReceipts.find((item) => item.id === id);
  if (!r) {
    showToast("Receipt details not found.", "warning");
    return;
  }

  const modal = document.getElementById("viewReceiptModal");
  const modalContent = document.getElementById("viewReceiptModalContent");
  const modalTitle = document.getElementById("viewReceiptModalTitle");
  if (!modal || !modalContent) return;

  const m = r.members || {};
  const memberName = m.full_name ? `${m.full_name} (${m.epf_number ? `EPF: ${m.epf_number}` : "Staff"})` : "Member";
  const verifierName = r.verified_by_staff?.full_name || currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer";
  const recNum = r.id ? `MRIA-REC-${r.id.slice(0, 8).toUpperCase()}` : "MRIA-REC";

  if (modalTitle) {
    modalTitle.textContent = `Official Receipt Voucher: ${recNum}`;
  }

  modalContent.innerHTML = renderReceiptHtml(r, memberName, verifierName, false);
  openModal("viewReceiptModal");
};

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
            ${m.is_archived ? `
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600 border border-slate-300 font-bold">
                Archived
              </span>
            ` : `
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ${statusClass}">
                ${isApproved ? "Approved" : "Pending Review"}
              </span>
            `}
          </td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-1.5 justify-end">
              ${approveAction}
              <button type="button" onclick="window.viewMemberDuesLedger('${m.id}', '${(m.full_name || '').replace(/'/g, "\\'")}')" class="px-2.5 py-1 border border-teal-300 text-teal-800 bg-teal-50/50 rounded-lg text-xs font-semibold hover:bg-teal-100 flex items-center gap-1 cursor-pointer" title="Inspect Monthly Dues Ledger">
                <span class="material-symbols-outlined text-[13px]">receipt_long</span>
                <span>Dues</span>
              </button>
              <button onclick="window.openEditMemberModal('${m.id}')" class="px-2.5 py-1 border border-outline-variant rounded-lg text-xs font-semibold hover:border-primary">
                Edit
              </button>
              <button type="button" onclick="window.promptDeleteMember('${m.id}')" class="px-2 py-1 border border-rose-300 text-rose-700 rounded-lg text-xs font-bold hover:bg-rose-50 flex items-center gap-1 cursor-pointer" title="Delete or Archive Member">
                <span class="material-symbols-outlined text-[13px]">delete</span>
                <span>Delete</span>
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

window.viewMemberDuesLedger = async function (memberId, memberName) {
  try {
    const dues = await getMemberDues(memberId);
    const member = (allMembers || []).find((m) => m.id === memberId);
    const balance = await calculateMemberBalance(member);
    openDuesBreakdownModal(dues, balance, memberName || member?.full_name);
  } catch (err) {
    console.error("Failed to load member dues:", err);
    showToast("Failed to load dues ledger.", "error");
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

window.promptDeleteMember = async function (memberId) {
  const m = allMembers.find((item) => item.id === memberId);
  if (!m) return;
  const confirmed = confirm(
    `Are you sure you want to delete or archive member ${m.full_name} (${m.epf_number || "EPF: N/A"})?\n\n- If this member has zero financial history, their record will be permanently deleted.\n- If this member has payment or grant history, they will be securely archived to preserve statutory accounting audits.`
  );
  if (!confirmed) return;

  try {
    const res = await deleteOrArchiveMember(memberId);
    showToast(res.message || "Member record processed successfully.", "success");
    await loadSecretaryData();
  } catch (err) {
    showToast(err.message || "Operation failed.", "error");
  }
};

// ================= TAB 5: WELFARE CLAIMS & BENEFIT GRANTS =================

export function populateGrantBenefitTypes() {
  const select = document.getElementById("grantBenefitTypeSelect");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="" disabled selected>-- Select Benefit Facility --</option>';

  const rawList = (allBenefitTypes && allBenefitTypes.length > 0)
    ? allBenefitTypes
    : [
        {
          id: "benefit-death",
          code: "DEATH_AID",
          title_en: "Death Donation (Bereavement Aid)",
          title_si: "මරණාධාර සුබසාධන ප්‍රතිලාභය",
          description_en: "Statutory bereavement welfare donation to deceased member family or member.",
          max_amount: 20000,
          is_active: true,
        },
      ];

  // ONLY show active welfare programs in the payout desk as configured in Content & Settings
  const activeList = rawList.filter((b) => b.is_active === true || b.is_active === 1 || b.is_active === "true");

  if (activeList.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No active benefit facilities available in settings</option>';
    return;
  }

  activeList.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.dataset.amount = b.max_amount;
    opt.dataset.titleEn = b.title_en;
    opt.dataset.titleSi = b.title_si || "";
    opt.dataset.descEn = b.description_en || "";
    opt.dataset.isActive = "1";
    opt.textContent = `${b.title_en} ${b.title_si ? `(${b.title_si})` : ""} — Limit: Rs. ${Number(b.max_amount).toLocaleString()}/=`;
    select.appendChild(opt);
  });

  // Select first active or match previous
  if (currentVal && activeList.some((opt) => opt.id === currentVal)) {
    select.value = currentVal;
  } else if (activeList.length > 0) {
    select.value = activeList[0].id;
  }

  updateGrantBenefitInfoCard();
  updateLiveGrantVoucherPreview();
}
window.populateGrantBenefitTypes = populateGrantBenefitTypes;

export function updateGrantBenefitInfoCard() {
  const select = document.getElementById("grantBenefitTypeSelect");
  const amountInput = document.getElementById("grantAmountInput");
  const limitTag = document.getElementById("grantConfiguredLimitTag");
  const infoTitle = document.getElementById("grantInfoTitle");
  const infoMax = document.getElementById("grantInfoMaxAmount");
  const infoDesc = document.getElementById("grantInfoDescription");
  const notesInput = document.getElementById("grantNotesInput");

  if (!select) return;
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.dataset.amount) return;

  const maxAmount = Number(opt.dataset.amount) || 0;
  const titleEn = opt.dataset.titleEn || "Benefit Program";
  const descEn = opt.dataset.descEn || "Configured welfare assistance grant facility.";

  if (limitTag) limitTag.textContent = `Limit: Rs. ${maxAmount.toLocaleString()}/=`;
  if (infoTitle) infoTitle.textContent = titleEn;
  if (infoMax) infoMax.textContent = `Max: Rs. ${maxAmount.toLocaleString()}/=`;
  if (infoDesc) infoDesc.textContent = descEn;

  if (amountInput) {
    amountInput.value = maxAmount;
  }

  if (notesInput && (!notesInput.value || notesInput.value.includes("grant") || notesInput.value.includes("ආධාර") || notesInput.value.includes("Disbursement"))) {
    notesInput.value = `${titleEn} grant disbursement to member`;
  }
}

function setGrantDateToToday() {
  const dateInput = document.getElementById("grantDateInput");
  if (dateInput) {
    dateInput.value = getSriLankaDateTimeLocal();
  }
}

export function updateLiveGrantVoucherPreview(isCommitted = false, claimData = null) {
  const previewContainer = document.getElementById("grantVoucherPreview");
  const statusBadge = document.getElementById("grantVoucherStatusBadge");
  if (!previewContainer) return;

  const method = document.getElementById("grantMethodSelect")?.value || document.getElementById("grantSourceAccountSelect")?.value || "cash";

  if (isCommitted && claimData) {
    if (statusBadge) {
      statusBadge.textContent = "Official Issued Grant Voucher";
      statusBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200";
    }
    const memberId = claimData.member_id;
    const selectedMember = allMembers.find((m) => m.id === memberId) || claimData.members;
    const memberName = selectedMember ? `${selectedMember.full_name} (${selectedMember.epf_number ? `EPF: ${selectedMember.epf_number}` : "Staff"})` : "Beneficiary Member";
    
    const bt = claimData.benefit_types || (allBenefitTypes || []).find((b) => b.id === claimData.benefit_type_id) || {};

    const grantObj = {
      id: claimData.id,
      amount: claimData.disbursed_amount || claimData.claim_amount,
      benefit_title_en: bt.title_en || "Welfare Benefit Grant",
      benefit_title_si: bt.title_si || "",
      payment_method: claimData.payment_method || method,
      source_account_id: (claimData.payment_method === "cash" || method === "cash") ? "cash_in_hand" : "boc_savings",
      disbursed_at: claimData.disbursed_at || claimData.created_at,
      notes: claimData.notes,
      status: "disbursed",
    };

    previewContainer.innerHTML = renderGrantVoucherHtml(grantObj, memberName, currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer", false);
    return;
  }

  // Live draft preview
  if (statusBadge) {
    statusBadge.textContent = "Live Draft Preview";
    statusBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200";
  }

  const memberId = document.getElementById("grantMemberSelect")?.value;
  const selectedMember = allMembers.find((m) => m.id === memberId);
  const memberName = selectedMember ? `${selectedMember.full_name} (${selectedMember.epf_number ? `EPF: ${selectedMember.epf_number}` : "Staff"})` : "";
  const benefitTypeId = document.getElementById("grantBenefitTypeSelect")?.value;
  const selectedBenefit = (allBenefitTypes || []).find((b) => b.id === benefitTypeId);
  const amount = Number(document.getElementById("grantAmountInput")?.value) || 0;
  const dateVal = document.getElementById("grantDateInput")?.value || getSriLankaDateTimeLocal();
  const formattedDateVal = dateVal
    ? (dateVal.includes("+") || dateVal.includes("Z") ? dateVal : (dateVal.includes("T") ? `${dateVal}:00+05:30` : `${dateVal}T00:00:00+05:30`))
    : new Date().toISOString();
  const notes = document.getElementById("grantNotesInput")?.value || "";

  const draftGrant = {
    id: "DRAFT-PREVIEW",
    amount,
    benefit_title_en: selectedBenefit?.title_en || "Welfare Aid Grant",
    benefit_title_si: selectedBenefit?.title_si || "",
    payment_method: method,
    source_account_id: method === "cash" ? "cash_in_hand" : "boc_savings",
    disbursed_at: formattedDateVal,
    notes,
    status: "draft",
  };

  previewContainer.innerHTML = renderGrantVoucherHtml(
    draftGrant,
    memberName,
    currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer",
    true
  );
}
window.updateLiveGrantVoucherPreview = updateLiveGrantVoucherPreview;

window.toggleGrantDesk = function () {
  const section = document.getElementById("grantPayoutDeskSection");
  if (!section) return;

  if (section.classList.contains("hidden")) {
    section.classList.remove("hidden");
    section.scrollIntoView({ behavior: "smooth" });
  } else {
    section.scrollIntoView({ behavior: "smooth" });
  }
};

window.loadClaimIntoPayoutDesk = function (claimId) {
  const claim = (allClaimsList || []).find((c) => c.id === claimId);
  if (!claim) {
    showToast("Claim details not found.", "warning");
    return;
  }

  const section = document.getElementById("grantPayoutDeskSection");
  if (section && section.classList.contains("hidden")) {
    section.classList.remove("hidden");
  }

  const claimIdInput = document.getElementById("grantClaimIdInput");
  const linkedAlert = document.getElementById("grantLinkedClaimAlert");
  const linkedRef = document.getElementById("grantLinkedClaimRef");
  const linkedDetails = document.getElementById("grantLinkedClaimDetails");
  const benefitSelect = document.getElementById("grantBenefitTypeSelect");
  const amountInput = document.getElementById("grantAmountInput");
  const notesInput = document.getElementById("grantNotesInput");

  if (claimIdInput) claimIdInput.value = claim.id;

  if (linkedAlert) {
    linkedAlert.classList.remove("hidden");
    if (linkedRef) linkedRef.textContent = `CLM-${claim.id.slice(0, 8).toUpperCase()}`;
    const m = claim.members || {};
    const bt = claim.benefit_types || {};
    if (linkedDetails) {
      linkedDetails.textContent = `Disbursing ${bt.title_en || "welfare grant"} for ${m.full_name || "Member"} (EPF: ${m.epf_number || "N/A"})`;
    }
  }

  // Select member
  const member = allMembers.find((m) => m.id === claim.member_id) || claim.members;
  if (member) {
    selectGrantMember(member);
  }

  // Select benefit type
  if (benefitSelect && claim.benefit_type_id) {
    benefitSelect.value = claim.benefit_type_id;
    updateGrantBenefitInfoCard();
  }

  // Set amount
  if (amountInput) {
    amountInput.value = claim.claim_amount;
    delete amountInput.dataset.autoFilled;
  }

  // Set notes
  if (notesInput) {
    const btTitle = claim.benefit_types?.title_en || "Welfare grant";
    notesInput.value = claim.notes || `Disbursement for ${btTitle} (CLM-${claim.id.slice(0, 8).toUpperCase()})`;
  }

  // Set payment method if previously saved
  const methodSelect = document.getElementById("grantMethodSelect") || document.getElementById("grantSourceAccountSelect");
  if (methodSelect && claim.payment_method) {
    methodSelect.value = claim.payment_method;
  }

  if (section) {
    section.scrollIntoView({ behavior: "smooth" });
  }

  updateLiveGrantVoucherPreview();
  showToast(`Loaded Claim CLM-${claim.id.slice(0, 8).toUpperCase()} into Payout Desk. Review and confirm below.`, "info");
};

window.unlinkClaimFromGrantDesk = function () {
  const claimIdInput = document.getElementById("grantClaimIdInput");
  const linkedAlert = document.getElementById("grantLinkedClaimAlert");
  if (claimIdInput) claimIdInput.value = "";
  if (linkedAlert) linkedAlert.classList.add("hidden");
  updateLiveGrantVoucherPreview();
};

window.resetGrantDisbursementForm = function () {
  const form = document.getElementById("grantDisbursementForm");
  if (form) form.reset();
  window.unlinkClaimFromGrantDesk();
  window.resetGrantMemberSelection({ preservePreview: true });
  setGrantDateToToday();
  populateGrantBenefitTypes();
  const banner = document.getElementById("grantEmailNotificationBanner");
  if (banner) {
    banner.className = "hidden";
    banner.innerHTML = "";
  }
};

let pendingGrantPayout = null;

window.executeConfirmGrantDisbursement = async function () {
  if (!pendingGrantPayout) return;
  const {
    claimId,
    memberId,
    benefitTypeId,
    amount,
    method,
    formattedDisbursedAt,
    notes,
    memberName,
    memberEpf,
    memberEmail,
    benefitTitle,
    selectedBenefit,
  } = pendingGrantPayout;

  const btn = document.getElementById("btnExecuteConfirmGrant");
  const modalContainer = document.getElementById("confirmGrantVoucherContainer");
  const modalBanner = document.getElementById("confirmGrantBanner");
  const actionBox = document.getElementById("confirmGrantActionBox");
  const doneBox = document.getElementById("confirmGrantDoneBox");
  const deskBanner = document.getElementById("grantEmailNotificationBanner");

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Disbursing &amp; Generating Voucher...</span>';
    }

    const disbursedClaim = await recordDirectBenefitGrant({
      claimId,
      memberId,
      benefitTypeId,
      amount,
      paymentMethod: method,
      disbursedByMemberId: currentStaff?.id || null,
      disbursedAt: formattedDisbursedAt,
      notes,
    });

    const voucherNumber = disbursedClaim?.id ? `MRIA-GRNT-${disbursedClaim.id.slice(0, 8).toUpperCase()}` : "MRIA-GRNT";

    // Format grant object for rendered voucher
    const grantObj = {
      id: disbursedClaim?.id || "ISSUED",
      amount: disbursedClaim?.disbursed_amount || amount,
      benefit_title_en: benefitTitle,
      benefit_title_si: selectedBenefit?.title_si || "",
      payment_method: method,
      source_account_id: method === "cash" ? "cash_in_hand" : "boc_savings",
      disbursed_at: formattedDisbursedAt,
      notes,
      status: "disbursed",
      voucher_type: "benefit_grant",
      is_grant: true,
    };

    // Render official issued voucher in confirmation modal
    if (modalContainer) {
      modalContainer.innerHTML = renderGrantVoucherHtml(
        grantObj,
        `${memberName}${memberEpf ? ` (EPF: ${memberEpf})` : ""}`,
        currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer",
        false
      );
    }

    // Also update live voucher preview on desk
    updateLiveGrantVoucherPreview(true, disbursedClaim);

    // Handle email dispatch & banners
    if (memberEmail) {
      try {
        await sendReceiptEmail({
          claimId: disbursedClaim.id,
          isGrant: true,
          recipientEmail: memberEmail,
          recipientName: memberName,
          recipientEpf: memberEpf,
          receiptNumber: voucherNumber,
          amount,
          paymentType: `Welfare Grant: ${benefitTitle}`,
          paymentMethod: method,
          paidAt: formattedDisbursedAt,
          notes,
          collectedByName: currentStaff?.full_name || "Treasurer",
        });

        logUserActivity({
          action: "BENEFIT_GRANT_EMAILED",
          entityType: "BENEFIT_CLAIM",
          entityId: disbursedClaim.id,
          details: {
            voucherNumber,
            amount,
            paymentMethod: method,
            recipientEmail: memberEmail,
            memberId,
            benefitTypeId,
            benefitTitle,
          },
          actorEmail: currentStaff?.email || null,
          actorName: currentStaff?.full_name || null,
          epfNumber: currentStaff?.epf_number || null,
        }).catch(() => {});

        const emailSuccessHtml = `
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
            <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">mark_email_read</span>
            <div class="space-y-1">
              <div class="font-bold flex items-center gap-1.5 text-emerald-900">
                <span>Official Grant Voucher Emailed Automatically</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-200/60 font-semibold text-emerald-800">වවුචරය සාර්ථකව ඊමේල් කරන ලදී</span>
              </div>
              <p class="text-[11px] text-emerald-800 leading-relaxed">
                An official digital voucher copy for <strong>${voucherNumber}</strong> (Rs. ${amount.toLocaleString()} /=) has been automatically dispatched to member's registered email: <strong>${escapeHtml(memberEmail)}</strong>.
              </p>
            </div>
          </div>
        `;
        if (modalBanner) {
          modalBanner.className = "block";
          modalBanner.innerHTML = emailSuccessHtml;
        }
        if (deskBanner) {
          deskBanner.className = "mt-4 block";
          deskBanner.innerHTML = emailSuccessHtml;
        }

        showToast(`Benefit grant disbursed! Official voucher emailed to ${memberEmail}`, "success");
      } catch (emailErr) {
        console.error("Grant email dispatch error:", emailErr);
        const emailFallbackHtml = `
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 shadow-xs">
            <span class="material-symbols-outlined text-emerald-600 text-[20px] shrink-0 mt-0.5">check_circle</span>
            <div class="space-y-1">
              <div class="font-bold text-emerald-900">Official Grant Voucher Issued</div>
              <p class="text-[11px] text-emerald-800 leading-relaxed">
                Grant voucher <strong>${voucherNumber}</strong> recorded in treasury ledger. Digital voucher is ready for download or printing below.
              </p>
            </div>
          </div>
        `;
        if (modalBanner) {
          modalBanner.className = "block";
          modalBanner.innerHTML = emailFallbackHtml;
        }
        if (deskBanner) {
          deskBanner.className = "mt-4 block";
          deskBanner.innerHTML = emailFallbackHtml;
        }
        showToast("Benefit grant disbursed! Digital voucher ready.", "success");
      }
    } else {
      // No registered email
      logUserActivity({
        action: "BENEFIT_GRANT_ISSUED_NO_EMAIL",
        entityType: "BENEFIT_CLAIM",
        entityId: disbursedClaim.id,
        details: {
          voucherNumber,
          amount,
          paymentMethod: method,
          memberId,
          memberName,
          benefitTitle,
          notice: "No registered email on member profile",
        },
        actorEmail: currentStaff?.email || null,
        actorName: currentStaff?.full_name || null,
        epfNumber: currentStaff?.epf_number || null,
      }).catch(() => {});

      const noEmailHtml = `
        <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
          <span class="material-symbols-outlined text-amber-600 text-[20px] shrink-0 mt-0.5">mail_off</span>
          <div class="space-y-1">
            <div class="font-bold flex items-center gap-1.5 text-amber-900">
              <span>No Registered Email Address</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-200/60 font-semibold text-amber-800">ලියාපදිංචි විද්‍යුත් තැපෑලක් නොමැත</span>
            </div>
            <p class="text-[11px] text-amber-800 leading-relaxed">
              Member <strong>${escapeHtml(memberName)}</strong>${memberEpf ? ` (EPF: ${escapeHtml(memberEpf)})` : ""} does not have an email address registered in the system. The official grant voucher <strong>${voucherNumber}</strong> was recorded in the database and treasury outflow. You can download or print the official voucher below, or share it via WhatsApp.
            </p>
          </div>
        </div>
      `;
      if (modalBanner) {
        modalBanner.className = "block";
        modalBanner.innerHTML = noEmailHtml;
      }
      if (deskBanner) {
        deskBanner.className = "mt-4 block";
        deskBanner.innerHTML = noEmailHtml;
      }
      showToast(`Grant disbursed! (No email registered on file for ${memberName})`, "warning");
    }

    // Switch action boxes
    if (actionBox) actionBox.classList.add("hidden");
    if (doneBox) doneBox.classList.remove("hidden");

    // Refresh background data
    await Promise.all([loadClaimsData(), loadTreasuryData()]);
  } catch (err) {
    showToast(err.message || "Failed to disburse benefit grant.", "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">verified</span><span>Confirm &amp; Disburse Grant</span>';
    }
  }
};

window.finishGrantDisbursementModal = function () {
  closeModal("confirmGrantModal");
  window.resetGrantDisbursementForm();
  pendingGrantPayout = null;
};

function setupGrantDeskForm() {
  setupGrantMemberSearch();
  setGrantDateToToday();
  populateGrantBenefitTypes();

  const form = document.getElementById("grantDisbursementForm");
  const benefitSelect = document.getElementById("grantBenefitTypeSelect");
  const amountInput = document.getElementById("grantAmountInput");
  const methodSelect = document.getElementById("grantMethodSelect") || document.getElementById("grantSourceAccountSelect");
  const dateInput = document.getElementById("grantDateInput");
  const notesInput = document.getElementById("grantNotesInput");

  if (benefitSelect) {
    benefitSelect.addEventListener("change", () => {
      updateGrantBenefitInfoCard();
      updateLiveGrantVoucherPreview();
    });
  }

  if (amountInput) {
    amountInput.addEventListener("input", () => {
      delete amountInput.dataset.autoFilled;
      updateLiveGrantVoucherPreview();
    });
  }

  if (methodSelect) {
    methodSelect.addEventListener("change", () => {
      updateLiveGrantVoucherPreview();
    });
  }

  if (dateInput) {
    dateInput.addEventListener("change", () => {
      updateLiveGrantVoucherPreview();
    });
  }

  if (notesInput) {
    notesInput.addEventListener("input", () => {
      updateLiveGrantVoucherPreview();
    });
  }

  // Initial preview render
  updateLiveGrantVoucherPreview();

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const memberId = document.getElementById("grantMemberSelect")?.value;
      const benefitTypeId = document.getElementById("grantBenefitTypeSelect")?.value;
      const amount = Number(document.getElementById("grantAmountInput")?.value);
      const method = document.getElementById("grantMethodSelect")?.value || document.getElementById("grantSourceAccountSelect")?.value || "cash";
      const dateVal = document.getElementById("grantDateInput")?.value;
      const notes = document.getElementById("grantNotesInput")?.value || "";
      const claimId = document.getElementById("grantClaimIdInput")?.value || null;

      if (!memberId) {
        showToast("Please select a beneficiary member.", "warning");
        return;
      }
      if (!benefitTypeId) {
        showToast("Please select a benefit facility.", "warning");
        return;
      }
      if (!amount || amount <= 0) {
        showToast("Please specify a valid grant amount.", "warning");
        return;
      }

      const selectedMember = allMembers.find((m) => m.id === memberId);
      const memberEmail = (selectedMember?.email || "").trim();
      const memberName = selectedMember ? selectedMember.full_name : "Beneficiary";
      const memberEpf = selectedMember?.epf_number || "";
      const selectedBenefit = (allBenefitTypes || []).find((b) => b.id === benefitTypeId);
      const benefitTitle = selectedBenefit?.title_en || "Welfare Grant";

      const formattedDisbursedAt = dateVal
        ? (dateVal.includes("+") || dateVal.includes("Z") ? dateVal : `${dateVal}:00+05:30`)
        : new Date().toISOString();

      // Store pending grant payload
      pendingGrantPayout = {
        claimId,
        memberId,
        benefitTypeId,
        amount,
        method,
        dateVal,
        formattedDisbursedAt,
        notes,
        selectedMember,
        selectedBenefit,
        memberName,
        memberEpf,
        memberEmail,
        benefitTitle,
      };

      // Populate confirmation modal fields
      const nameEl = document.getElementById("confirmGrantMemberName");
      const epfEl = document.getElementById("confirmGrantMemberEpf");
      const progEl = document.getElementById("confirmGrantProgram");
      const amtEl = document.getElementById("confirmGrantAmount");
      const modalContainer = document.getElementById("confirmGrantVoucherContainer");
      const modalBanner = document.getElementById("confirmGrantBanner");
      const actionBox = document.getElementById("confirmGrantActionBox");
      const doneBox = document.getElementById("confirmGrantDoneBox");
      const btn = document.getElementById("btnExecuteConfirmGrant");

      if (nameEl) nameEl.textContent = memberName;
      if (epfEl) epfEl.textContent = memberEpf ? `EPF: ${memberEpf}` : "Staff";
      if (progEl) progEl.textContent = benefitTitle;
      if (amtEl) amtEl.textContent = formatCurrency(amount);

      // Render Draft Voucher Preview in Confirmation Modal
      if (modalContainer) {
        const draftGrant = {
          id: "DRAFT-PREVIEW",
          amount,
          benefit_title_en: benefitTitle,
          benefit_title_si: selectedBenefit?.title_si || "",
          payment_method: method,
          source_account_id: method === "cash" ? "cash_in_hand" : "boc_savings",
          disbursed_at: formattedDisbursedAt,
          notes,
          status: "draft",
        };
        modalContainer.innerHTML = renderGrantVoucherHtml(
          draftGrant,
          `${memberName}${memberEpf ? ` (EPF: ${memberEpf})` : ""}`,
          currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer",
          true
        );
      }

      // Reset modal UI state
      if (modalBanner) {
        modalBanner.className = "hidden";
        modalBanner.innerHTML = "";
      }
      if (actionBox) actionBox.classList.remove("hidden");
      if (doneBox) doneBox.classList.add("hidden");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">verified</span><span>Confirm &amp; Disburse Grant</span>';
      }

      openModal("confirmGrantModal");
    });
  }
}

async function loadClaimsData() {
  const tbody = document.getElementById("benefitClaimsQueueBody");
  if (!tbody) return;

  try {
    const claims = await getAllBenefitClaims();
    allClaimsList = claims || [];
    window.allClaimsList = allClaimsList;

    if (allClaimsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-on-surface-variant">No welfare claims submitted yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = allClaimsList.map((c) => {
      const m = c.members || {};
      const bt = c.benefit_types || {};
      const applicantName = m.full_name || m.email || "Member";
      const applicantEpf = m.epf_number || "N/A";
      const benefitTitle = bt.title_en || "Welfare Grant";

      const proofBtn = c.document_key ? `
        <button type="button" onclick="window.viewSlip('${c.document_key}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-on-surface font-semibold text-xs hover:bg-surface-variant shadow-xs cursor-pointer" title="View attached document proof">
          <span class="material-symbols-outlined text-[14px]">attachment</span>
          <span>Proof</span>
        </button>` : "";

      let actions = "";
      if (c.status === "submitted") {
        actions = `
          <button onclick="window.reviewClaim('${c.id}', 'approved')" class="mutation-btn px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">Approve</button>
          <button onclick="window.reviewClaim('${c.id}', 'rejected')" class="mutation-btn px-2.5 py-1 border border-rose-300 text-rose-700 rounded-lg text-xs font-bold hover:bg-rose-50">Reject</button>
          <button onclick="window.loadClaimIntoPayoutDesk('${c.id}')" class="mutation-btn px-2.5 py-1 bg-sky-800 text-white rounded-lg text-xs font-bold hover:bg-sky-900 flex items-center gap-1 shadow-sm" title="Load into Direct Benefit Payout Desk">
            <span class="material-symbols-outlined text-[13px]">payments</span>
            <span>Disburse</span>
          </button>
        `;
      } else if (c.status === "approved") {
        actions = `
          <button onclick="window.loadClaimIntoPayoutDesk('${c.id}')" class="mutation-btn px-2.5 py-1 bg-sky-800 text-white rounded-lg text-xs font-bold hover:bg-sky-900 flex items-center gap-1 shadow-sm" title="Load into Direct Benefit Payout Desk">
            <span class="material-symbols-outlined text-[13px]">payments</span>
            <span>Disburse Grant</span>
          </button>
        `;
      } else if (c.status === "disbursed") {
        const disbursedTime = new Date(c.disbursed_at || c.created_at).getTime();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const isWithin30Days = !isNaN(disbursedTime) && (Date.now() - disbursedTime <= thirtyDaysMs);

        const undoBtn = isWithin30Days ? `
          <button type="button" onclick="window.openUndoClaimModal('${c.id}')" class="mutation-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 font-bold text-xs hover:bg-rose-100 shadow-xs cursor-pointer" title="Undo benefit payout within 30 days">
            <span class="material-symbols-outlined text-[13px]">undo</span>
            <span>Undo</span>
          </button>
        ` : "";

        actions = `
          <button onclick="window.viewGrantVoucher('${c.id}')" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-sky-300 bg-sky-50 text-primary font-bold text-xs hover:bg-sky-100 shadow-xs cursor-pointer" title="View official disbursement voucher">
            <span class="material-symbols-outlined text-[14px]">receipt_long</span>
            <span>View Voucher</span>
          </button>
          ${undoBtn}
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
          <td class="py-2.5 px-3 font-mono font-bold text-primary text-right tabular-nums">${formatCurrency(c.claim_amount)}</td>
          <td class="py-2.5 px-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.status === "disbursed" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : (c.status === "approved" ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-sky-50 text-sky-800 border border-sky-200")}">
              ${c.status.toUpperCase()}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right">
            <div class="inline-flex items-center gap-1.5 justify-end">${proofBtn} ${actions}</div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Claims data error:", err);
  }
}

window.viewGrantVoucher = function (claimId) {
  const claim = (allClaimsList || []).find((c) => c.id === claimId);
  if (!claim) {
    showToast("Claim record not found.", "warning");
    return;
  }

  const modal = document.getElementById("viewReceiptModal");
  const modalContent = document.getElementById("viewReceiptModalContent");
  const modalTitle = document.getElementById("viewReceiptModalTitle");
  if (!modal || !modalContent) return;

  const m = claim.members || {};
  const bt = claim.benefit_types || {};
  const memberName = m.full_name ? `${m.full_name} (${m.epf_number ? `EPF: ${m.epf_number}` : "Staff"})` : "Member";
  const verifierName = currentStaff?.full_name || "භාණ්ඩාගාරික / Treasurer";
  const voucherNum = `MRIA-GRNT-${claim.id.slice(0, 8).toUpperCase()}`;

  if (modalTitle) {
    modalTitle.textContent = `Official Grant Voucher: ${voucherNum}`;
  }

  const grantData = {
    id: claim.id,
    amount: claim.disbursed_amount || claim.claim_amount,
    benefit_title_en: bt.title_en || "Welfare Grant",
    benefit_title_si: bt.title_si || "",
    payment_method: claim.payment_method || "cash",
    source_account_id: claim.payment_method === "cash" ? "cash_in_hand" : "boc_savings",
    disbursed_at: claim.disbursed_at || claim.created_at,
    notes: claim.notes || "Welfare benefit payout",
    status: "disbursed",
    voucher_type: "benefit_grant",
    is_grant: true,
  };

  modalContent.innerHTML = renderGrantVoucherHtml(grantData, memberName, verifierName, false);
  openModal("viewReceiptModal");
};

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

window.disburseClaim = function (claimId, amount) {
  window.loadClaimIntoPayoutDesk(claimId);
};

window.openUndoClaimModal = function (claimId) {
  const claim = (allClaimsList || []).find((c) => c.id === claimId);
  if (!claim) {
    showToast("Claim record not found.", "warning");
    return;
  }

  const m = claim.members || {};
  const bt = claim.benefit_types || {};
  const voucherNum = `MRIA-GRNT-${claim.id.slice(0, 8).toUpperCase()}`;
  const memberName = m.full_name ? `${m.full_name} (${m.epf_number ? `EPF: ${m.epf_number}` : "Staff"})` : "Member";
  const amountVal = formatCurrency(claim.disbursed_amount || claim.claim_amount);
  const benefitTitle = bt.title_en || "Welfare Grant";
  const dateVal = formatDate(claim.disbursed_at || claim.created_at);

  const idInput = document.getElementById("undoClaimId");
  const numSpan = document.getElementById("undoClaimVoucherNumber");
  const memSpan = document.getElementById("undoClaimMemberName");
  const progSpan = document.getElementById("undoClaimBenefitTitle");
  const amtSpan = document.getElementById("undoClaimAmount");
  const dateSpan = document.getElementById("undoClaimDate");
  const reasonInput = document.getElementById("undoClaimReason");

  if (idInput) idInput.value = claim.id;
  if (numSpan) numSpan.textContent = voucherNum;
  if (memSpan) memSpan.textContent = memberName;
  if (progSpan) progSpan.textContent = benefitTitle;
  if (amtSpan) amtSpan.textContent = amountVal;
  if (dateSpan) dateSpan.textContent = dateVal;
  if (reasonInput) reasonInput.value = "";

  openModal("undoClaimModal");
};

function setupUndoClaimHandler() {
  const form = document.getElementById("undoClaimForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const claimId = document.getElementById("undoClaimId")?.value;
    const reason = document.getElementById("undoClaimReason")?.value?.trim();
    const submitBtn = document.getElementById("btnExecuteUndoClaim");

    if (!claimId) {
      showToast("Invalid claim selected.", "warning");
      return;
    }

    if (!reason || reason.length < 5) {
      showToast("Please provide an official justification of at least 5 characters.", "warning");
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Reversing Disbursement...</span>';
      }

      await undoClaimDisbursement(claimId, reason, currentStaff?.id || null);
      showToast("Benefit grant disbursement undone. Claim reverted to approved and funds credited back to Treasury.", "success");
      closeModal("undoClaimModal");

      await Promise.all([loadClaimsData(), loadTreasuryData()]);
    } catch (err) {
      console.error("Undo disbursement error:", err);
      showToast(err.message || "Failed to undo benefit grant disbursement.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">undo</span><span>Confirm &amp; Reverse Disbursement</span>';
      }
    }
  });
}

window.loadClaimsData = loadClaimsData;

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
        <td class="py-2.5 px-3 font-mono font-bold text-rose-700 text-right tabular-nums">${formatCurrency(d.amount)}</td>
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
      bank_name: "Association Bank Account",
      branch: "Mattala Branch",
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
      showToast("Reset to default LankaQR image. Click Save to apply.", "info");
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
    if (dueSetting?.amount != null) {
      configuredMonthlyDueAmount = Number(dueSetting.amount);
    }
    const input = document.getElementById("settingMonthlyDueAmount");
    if (input) {
      input.value = configuredMonthlyDueAmount;
    }
    const categorySelect = document.getElementById("cashCategorySelect");
    const amountInput = document.getElementById("cashAmountInput");
    if (categorySelect && amountInput && categorySelect.value === "monthly_due") {
      amountInput.value = configuredMonthlyDueAmount;
      updateLiveReceiptPreview();
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

      configuredMonthlyDueAmount = amount;
      const categorySelect = document.getElementById("cashCategorySelect");
      const amountInput = document.getElementById("cashAmountInput");
      if (categorySelect && amountInput && categorySelect.value === "monthly_due") {
        amountInput.value = configuredMonthlyDueAmount;
        updateLiveReceiptPreview();
      }

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

// ================= ADMISSION FEES SCHEDULE SETTINGS =================

async function loadAdmissionFeesSettings() {
  const tbody = document.getElementById("admissionFeesTableBody");
  try {
    const rawList = await getSystemSetting("admission_fees_list");
    if (Array.isArray(rawList) && rawList.length > 0) {
      admissionFeesList = rawList;
    } else {
      const singleSetting = await getSystemSetting("admission_fee_amount");
      const defaultAmount = singleSetting?.amount != null ? Number(singleSetting.amount) : 500;
      admissionFeesList = [
        {
          id: "adm_standard",
          code: "STANDARD_ADMISSION",
          title_en: "Standard New Member Admission Fee",
          title_si: "නව සාමාජික ඇතුල්වීමේ ගාස්තුව",
          amount: defaultAmount,
          is_active: true,
          description: "Standard one-time statutory admission fee for non-legacy staff joining the association",
        },
      ];
      if (currentStaff?.id) {
        updateSystemSetting("admission_fees_list", admissionFeesList, currentStaff.id).catch(() => {});
      }
    }

    const activeFee = admissionFeesList.find((f) => f.is_active && f.code === "STANDARD_ADMISSION")
      || admissionFeesList.find((f) => f.is_active)
      || admissionFeesList[0];
    if (activeFee && activeFee.amount != null) {
      configuredAdmissionFeeAmount = Number(activeFee.amount);
    }

    const categorySelect = document.getElementById("cashCategorySelect");
    if (categorySelect && categorySelect.value === "admission_fee") {
      renderCashAdmissionFeeOptions();
    }

    renderAdmissionFeesTable();
  } catch (err) {
    console.error("Failed to load admission fees:", err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-rose-600 font-bold">Error loading admission fees schedule.</td></tr>';
    }
  }
}
window.loadAdmissionFeesSettings = loadAdmissionFeesSettings;

function renderAdmissionFeesTable() {
  const tbody = document.getElementById("admissionFeesTableBody");
  if (!tbody) return;

  if (!admissionFeesList || admissionFeesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-on-surface-variant">No admission fee categories found. Click "Add Admission Fee" above to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = admissionFeesList.map((f) => {
    const statusBadge = f.is_active
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
           <span class="material-symbols-outlined text-[14px]">check_circle</span>
           <span>Active Fee</span>
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
           <span class="material-symbols-outlined text-[14px]">pause_circle</span>
           <span>Inactive / Paused</span>
         </span>`;

    return `
      <tr class="hover:bg-surface/50 transition-colors" data-fee-id="${f.id}">
        <td class="py-3 px-3">
          <div class="flex items-start gap-2.5">
            <span class="material-symbols-outlined text-primary text-[22px] mt-0.5">assignment_ind</span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-on-surface text-xs sm:text-sm">${f.title_en}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-50 text-primary border border-sky-200">${f.code}</span>
              </div>
              <div class="text-[11px] text-primary font-medium mt-0.5">${f.title_si || ""}</div>
              ${f.description ? `<div class="text-[10px] text-on-surface-variant mt-0.5 leading-relaxed">${f.description}</div>` : ""}
            </div>
          </div>
        </td>
        <td class="py-3 px-3 whitespace-nowrap">
          <div class="flex flex-col gap-1.5 items-start">
            ${statusBadge}
            <button type="button" onclick="toggleAdmissionFeeActive('${f.id}', ${!f.is_active})" class="text-[11px] font-bold underline ${f.is_active ? 'text-amber-700 hover:text-amber-800' : 'text-emerald-700 hover:text-emerald-800'} transition-colors cursor-pointer">
              ${f.is_active ? "Pause Fee" : "Activate Fee"}
            </button>
          </div>
        </td>
        <td class="py-3 px-3 whitespace-nowrap">
          <div class="flex items-center gap-1.5 max-w-[190px]">
            <span class="text-xs font-bold text-on-surface-variant">Rs.</span>
            <input type="number" id="admissionFeeAmount_${f.id}" value="${Number(f.amount || 0)}" min="50" step="50" class="w-full px-2.5 py-1.5 rounded-lg border border-outline-variant bg-surface text-xs font-bold text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" />
            <button type="button" onclick="saveAdmissionFeeRow('${f.id}')" id="saveAdmissionFeeBtn_${f.id}" title="Quick Save Fee" class="p-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover shadow-sm inline-flex items-center justify-center transition-colors cursor-pointer shrink-0">
              <span class="material-symbols-outlined text-[15px]">save</span>
            </button>
          </div>
        </td>
        <td class="py-3 px-3 text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button type="button" onclick="openEditAdmissionFeeModal('${f.id}')" title="Edit Full Fee Details" class="px-2.5 py-1.5 bg-white border border-outline-variant text-on-surface text-xs font-bold rounded-xl hover:border-primary hover:text-primary transition-colors shadow-sm inline-flex items-center gap-1 cursor-pointer">
              <span class="material-symbols-outlined text-[15px] text-primary">edit</span>
              <span>Edit</span>
            </button>
            <button type="button" onclick="removeAdmissionFeeItem('${f.id}')" title="Remove Fee Item" class="px-2.5 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl hover:bg-rose-100 transition-colors shadow-sm inline-flex items-center gap-1 cursor-pointer">
              <span class="material-symbols-outlined text-[15px]">delete</span>
              <span>Remove</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function saveAdmissionFeesState() {
  await updateSystemSetting("admission_fees_list", admissionFeesList, currentStaff?.id || null);

  const activeFee = admissionFeesList.find((f) => f.is_active && f.code === "STANDARD_ADMISSION")
    || admissionFeesList.find((f) => f.is_active)
    || admissionFeesList[0];
  if (activeFee && activeFee.amount != null) {
    configuredAdmissionFeeAmount = Number(activeFee.amount);
    await updateSystemSetting("admission_fee_amount", { amount: configuredAdmissionFeeAmount, currency: "LKR" }, currentStaff?.id || null);
  }

  const categorySelect = document.getElementById("cashCategorySelect");
  if (categorySelect && categorySelect.value === "admission_fee") {
    renderCashAdmissionFeeOptions();
  }

  renderAdmissionFeesTable();
}

window.openAddAdmissionFeeModal = function () {
  const form = document.getElementById("addAdmissionFeeForm");
  if (form) form.reset();
  const amountInput = document.getElementById("addAdmissionFeeAmount");
  if (amountInput) amountInput.value = "500";
  const activeCheck = document.getElementById("addAdmissionFeeIsActive");
  if (activeCheck) activeCheck.checked = true;
  openModal("addAdmissionFeeModal");
};

window.openEditAdmissionFeeModal = function (id) {
  const fee = admissionFeesList.find((f) => f.id === id);
  if (!fee) {
    showToast("Admission fee schedule not found.", "warning");
    return;
  }

  const idInput = document.getElementById("editAdmissionFeeId");
  const codeBadge = document.getElementById("editAdmissionFeeCodeBadge");
  const statusBadge = document.getElementById("editAdmissionFeeStatusBadge");
  const titleEn = document.getElementById("editAdmissionFeeTitleEn");
  const titleSi = document.getElementById("editAdmissionFeeTitleSi");
  const amount = document.getElementById("editAdmissionFeeAmount");
  const desc = document.getElementById("editAdmissionFeeDesc");
  const isActive = document.getElementById("editAdmissionFeeIsActive");

  if (idInput) idInput.value = fee.id;
  if (codeBadge) codeBadge.textContent = fee.code;
  if (titleEn) titleEn.value = fee.title_en || "";
  if (titleSi) titleSi.value = fee.title_si || "";
  if (amount) amount.value = Number(fee.amount || 500);
  if (desc) desc.value = fee.description || "";
  if (isActive) isActive.checked = Boolean(fee.is_active);

  if (statusBadge) {
    statusBadge.innerHTML = fee.is_active
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Paused</span>';
  }

  openModal("editAdmissionFeeModal");
};

window.saveAdmissionFeeRow = async function (id) {
  const input = document.getElementById(`admissionFeeAmount_${id}`);
  const btn = document.getElementById(`saveAdmissionFeeBtn_${id}`);
  if (!input) return;

  const newAmount = Number(input.value);
  if (!newAmount || newAmount <= 0) {
    showToast("Please enter a valid admission fee amount.", "warning");
    return;
  }

  const fee = admissionFeesList.find((f) => f.id === id);
  if (!fee) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">refresh</span>';
    }

    fee.amount = newAmount;
    await saveAdmissionFeesState();
    showToast(`Admission fee for "${fee.title_en}" updated to Rs. ${newAmount.toLocaleString()} /=`, "success");
  } catch (err) {
    console.error("Failed to update admission fee:", err);
    showToast(err.message || "Failed to update admission fee.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-[15px]">save</span>';
    }
  }
};

window.toggleAdmissionFeeActive = async function (id, newStatus) {
  const fee = admissionFeesList.find((f) => f.id === id);
  if (!fee) return;

  try {
    fee.is_active = newStatus;
    await saveAdmissionFeesState();
    showToast(`Admission fee "${fee.title_en}" ${newStatus ? "activated" : "paused"} successfully.`, "success");
  } catch (err) {
    console.error("Failed to toggle admission fee status:", err);
    showToast(err.message || "Failed to update admission fee status.", "error");
  }
};

window.removeAdmissionFeeItem = async function (id) {
  const fee = admissionFeesList.find((f) => f.id === id);
  if (!fee) return;

  if (admissionFeesList.length <= 1) {
    const confirmLast = window.confirm(
      `"${fee.title_en}" is currently the only admission fee configured.\n\nAre you sure you want to remove it? (You can also pause it instead).`
    );
    if (!confirmLast) return;
  } else {
    const confirmed = window.confirm(`Are you sure you want to remove admission fee item "${fee.title_en}"?`);
    if (!confirmed) return;
  }

  try {
    admissionFeesList = admissionFeesList.filter((f) => f.id !== id);
    await saveAdmissionFeesState();
    showToast(`Admission fee "${fee.title_en}" removed successfully.`, "success");
  } catch (err) {
    console.error("Failed to remove admission fee:", err);
    showToast(err.message || "Failed to remove admission fee.", "error");
  }
};

function setupAdmissionFeeModalsHandlers() {
  const addForm = document.getElementById("addAdmissionFeeForm");
  if (addForm) {
    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById("addAdmissionFeeCode");
      const titleEnInput = document.getElementById("addAdmissionFeeTitleEn");
      const titleSiInput = document.getElementById("addAdmissionFeeTitleSi");
      const amountInput = document.getElementById("addAdmissionFeeAmount");
      const descInput = document.getElementById("addAdmissionFeeDesc");
      const isActiveInput = document.getElementById("addAdmissionFeeIsActive");
      const submitBtn = document.getElementById("submitAddAdmissionFeeBtn");

      const code = (codeInput?.value || "").trim().toUpperCase().replace(/\s+/g, "_");
      const title_en = (titleEnInput?.value || "").trim();
      const title_si = (titleSiInput?.value || "").trim();
      const amount = Number(amountInput?.value);
      const description = (descInput?.value || "").trim() || "";
      const is_active = Boolean(isActiveInput?.checked);

      if (!code || !title_en || !title_si || !amount || amount <= 0) {
        showToast("Please provide all required fields with a valid amount.", "warning");
        return;
      }

      if (admissionFeesList.some((f) => f.code === code)) {
        showToast(`Fee code "${code}" already exists. Please choose a unique code.`, "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Creating...</span>';
        }

        const newFee = {
          id: "adm_" + Date.now(),
          code,
          title_en,
          title_si,
          amount,
          is_active,
          description,
        };

        admissionFeesList.push(newFee);
        await saveAdmissionFeesState();
        showToast(`Admission fee "${title_en}" created successfully!`, "success");
        closeModal("addAdmissionFeeModal");
        addForm.reset();
      } catch (err) {
        console.error("Failed to add admission fee:", err);
        showToast(err.message || "Failed to create admission fee.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>Create Fee Item</span>';
        }
      }
    });
  }

  const editForm = document.getElementById("editAdmissionFeeForm");
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("editAdmissionFeeId")?.value;
      const titleEn = document.getElementById("editAdmissionFeeTitleEn")?.value.trim();
      const titleSi = document.getElementById("editAdmissionFeeTitleSi")?.value.trim();
      const amount = Number(document.getElementById("editAdmissionFeeAmount")?.value);
      const desc = document.getElementById("editAdmissionFeeDesc")?.value.trim() || "";
      const isActive = Boolean(document.getElementById("editAdmissionFeeIsActive")?.checked);
      const submitBtn = document.getElementById("submitEditAdmissionFeeBtn");

      if (!id || !titleEn || !titleSi || !amount || amount <= 0) {
        showToast("Please provide all required fields with a valid amount.", "warning");
        return;
      }

      const fee = admissionFeesList.find((f) => f.id === id);
      if (!fee) return;

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Saving...</span>';
        }

        fee.title_en = titleEn;
        fee.title_si = titleSi;
        fee.amount = amount;
        fee.description = desc;
        fee.is_active = isActive;

        await saveAdmissionFeesState();
        showToast(`Admission fee "${titleEn}" updated successfully!`, "success");
        closeModal("editAdmissionFeeModal");
      } catch (err) {
        console.error("Failed to update admission fee:", err);
        showToast(err.message || "Failed to update admission fee.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">save</span><span>Save Changes</span>';
        }
      }
    });
  }
}

// ================= WELFARE BENEFITS & FACILITIES SETTINGS =================

async function loadBenefitTypesSettings() {
  const tbody = document.getElementById("benefitTypesTableBody");

  try {
    allBenefitTypes = await getAllBenefitTypes();
    populateGrantBenefitTypes();

    if (!tbody) return;
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

// ================= VOID PAYMENT RECEIPT WORKFLOW =================

window.promptVoidReceipt = function (paymentId) {
  const payment = allLoadedReceipts.find((r) => r.id === paymentId);
  if (!payment) {
    showToast("Payment receipt not found in loaded records.", "error");
    return;
  }
  const recNum = payment.id ? `MRIA-REC-${payment.id.slice(0, 8).toUpperCase()}` : "MRIA-REC";
  const memberName = payment.members?.full_name || "Member";
  const amountVal = formatCurrency(payment.amount);

  const idInput = document.getElementById("voidPaymentId");
  const numSpan = document.getElementById("voidReceiptNumber");
  const memSpan = document.getElementById("voidReceiptMember");
  const amtSpan = document.getElementById("voidReceiptAmount");
  const reasonInput = document.getElementById("voidReceiptReason");

  if (idInput) idInput.value = payment.id;
  if (numSpan) numSpan.textContent = recNum;
  if (memSpan) memSpan.textContent = memberName;
  if (amtSpan) amtSpan.textContent = amountVal;
  if (reasonInput) reasonInput.value = "";

  openModal("voidReceiptModal");
};

function setupVoidReceiptHandler() {
  const form = document.getElementById("voidReceiptForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const paymentId = document.getElementById("voidPaymentId")?.value;
    const reason = document.getElementById("voidReceiptReason")?.value?.trim();

    if (!paymentId || !reason || reason.length < 5) {
      showToast("Please provide a valid cancellation reason (min 5 characters).", "warning");
      return;
    }

    const btn = document.getElementById("btnExecuteVoidReceipt");
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Voiding Receipt...</span>';
      }

      await voidPaymentReceipt(paymentId, reason);
      showToast("Payment receipt voided and ledger reversed successfully.", "success");
      closeModal("voidReceiptModal");

      // Update in-memory receipt row
      const target = allLoadedReceipts.find((r) => r.id === paymentId);
      if (target) {
        target.status = "voided";
        target.notes = (target.notes ? target.notes + " " : "") + `[VOIDED: ${reason}]`;
      }
      renderReceiptsTable();
      await loadTreasuryData();
    } catch (err) {
      console.error("Void receipt error:", err);
      showToast(err.message || "Failed to void payment receipt.", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete_forever</span><span>Confirm &amp; Void Receipt</span>';
      }
    }
  });
}

// ================= MEMBER INQUIRIES & HELP DESK =================

let allAdminInquiries = [];
window.allAdminInquiries = allAdminInquiries;

async function loadAdminInquiries() {
  const tbody = document.getElementById("adminInquiriesBody");
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-on-surface-variant">Loading member inquiries...</td></tr>';
    allAdminInquiries = await getAdminInquiries();
    window.allAdminInquiries = allAdminInquiries;
    renderAdminInquiriesTable();
  } catch (err) {
    console.error("Inquiries load error:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-600 font-semibold">${err.message || "Failed to load inquiries."}</td></tr>`;
  }
}
window.loadAdminInquiries = loadAdminInquiries;

function renderAdminInquiriesTable() {
  const tbody = document.getElementById("adminInquiriesBody");
  const filterVal = document.getElementById("inquiriesFilterSelect")?.value || "pending";
  if (!tbody) return;

  let list = (allAdminInquiries || []).slice();
  if (filterVal && filterVal !== "all") {
    list = list.filter((iq) => iq.status === filterVal);
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-on-surface-variant">No member inquiries matching filter.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((iq) => {
    const m = iq.members || {};
    const senderName = m.full_name || m.email || "Member";
    const senderEpf = m.epf_number || "N/A";
    const senderPhone = iq.sender_phone || m.phone || "-";
    const isResolved = iq.status === "resolved";

    return `
      <tr class="hover:bg-sky-50/30 transition-colors">
        <td class="py-2.5 px-3 font-mono">${formatDate(iq.created_at)}</td>
        <td class="py-2.5 px-3">
          <div class="font-bold text-on-surface">${escapeHtml(senderName)}</div>
          <div class="text-[11px] text-on-surface-variant">EPF: ${escapeHtml(senderEpf)} • Tel: ${escapeHtml(senderPhone)}</div>
        </td>
        <td class="py-2.5 px-3">
          <div class="font-semibold text-on-surface text-xs">${escapeHtml(iq.subject)}</div>
          <div class="text-[11px] text-on-surface-variant truncate max-w-xs">${escapeHtml(iq.message)}</div>
        </td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${isResolved ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}">
            ${iq.status.toUpperCase()}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right">
          <button type="button" onclick="window.openResolveInquiryModal('${iq.id}')" class="px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary-hover shadow-xs cursor-pointer inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-[14px]">visibility</span>
            <span>${isResolved ? "View" : "Review &amp; Resolve"}</span>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.filterAdminInquiries = function () {
  renderAdminInquiriesTable();
};

window.openResolveInquiryModal = function (inquiryId) {
  const iq = (allAdminInquiries || []).find((item) => item.id === inquiryId);
  if (!iq) return;

  const m = iq.members || {};
  const idInput = document.getElementById("resolveInquiryId");
  const nameEl = document.getElementById("inquirySenderName");
  const dateEl = document.getElementById("inquiryDate");
  const epfEl = document.getElementById("inquirySenderEpf");
  const emailEl = document.getElementById("inquirySenderEmail");
  const phoneLink = document.getElementById("inquirySenderPhoneLink");
  const subjEl = document.getElementById("inquirySubject");
  const msgEl = document.getElementById("inquiryMessageBody");
  const notesInput = document.getElementById("inquiryResolutionNotes");
  const resolveBtn = document.getElementById("btnExecuteResolveInquiry");

  if (idInput) idInput.value = iq.id;
  if (nameEl) nameEl.textContent = m.full_name || "Member";
  if (dateEl) dateEl.textContent = formatDate(iq.created_at);
  if (epfEl) epfEl.textContent = m.epf_number || "N/A";
  if (emailEl) emailEl.textContent = m.email || "-";

  const phoneNum = iq.sender_phone || m.phone || "-";
  if (phoneLink) {
    phoneLink.textContent = phoneNum;
    phoneLink.href = phoneNum !== "-" ? `tel:${phoneNum}` : "#";
  }

  if (subjEl) subjEl.textContent = iq.subject || "-";
  if (msgEl) msgEl.textContent = iq.message || "-";

  if (notesInput) {
    notesInput.value = iq.resolution_notes || "";
    notesInput.disabled = iq.status === "resolved";
  }

  if (resolveBtn) {
    resolveBtn.style.display = iq.status === "resolved" ? "none" : "inline-flex";
  }

  openModal("inquiryResolveModal");
};

function setupInquiriesHandlers() {
  const resolveBtn = document.getElementById("btnExecuteResolveInquiry");
  if (!resolveBtn) return;

  resolveBtn.addEventListener("click", async () => {
    const inquiryId = document.getElementById("resolveInquiryId")?.value;
    const notes = document.getElementById("inquiryResolutionNotes")?.value?.trim() || "Resolved by administrator";

    if (!inquiryId) return;

    try {
      resolveBtn.disabled = true;
      resolveBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Resolving...</span>';
      await resolveAdminInquiry(inquiryId, notes);
      showToast("Member inquiry marked as resolved.", "success");
      closeModal("inquiryResolveModal");
      await loadAdminInquiries();
    } catch (err) {
      console.error("Resolve inquiry error:", err);
      showToast(err.message || "Failed to resolve inquiry.", "error");
    } finally {
      resolveBtn.disabled = false;
      resolveBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check_circle</span><span>Mark as Resolved</span>';
    }
  });
}

// ================= MEMBER NOTIFICATIONS DISPATCH =================

export function populateNotificationRecipients() {
  const select = document.getElementById("notifRecipientSelect");
  if (!select || !allMembers) return;

  const approvedMembers = allMembers.filter((m) => m.is_approved && !m.is_archived);
  select.innerHTML =
    '<option value="" disabled selected>-- Select Recipient Member --</option>' +
    approvedMembers
      .map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)} (EPF: ${m.epf_number || "N/A"})</option>`)
      .join("");
}

function setupNotificationHandlers() {
  const form = document.getElementById("dispatchNotificationForm");
  if (!form) return;

  const targetRadios = form.querySelectorAll('input[name="notifTargetMode"]');
  const recipientContainer = document.getElementById("notifRecipientContainer");
  const recipientSelect = document.getElementById("notifRecipientSelect");

  const syncTargetVisibility = () => {
    const selectedMode = form.querySelector('input[name="notifTargetMode"]:checked')?.value || "single";
    if (selectedMode === "single") {
      if (recipientContainer) recipientContainer.classList.remove("hidden");
      if (recipientSelect) {
        recipientSelect.disabled = false;
        recipientSelect.required = true;
      }
    } else {
      if (recipientContainer) recipientContainer.classList.add("hidden");
      if (recipientSelect) {
        recipientSelect.disabled = true;
        recipientSelect.required = false;
        recipientSelect.value = "";
      }
    }
  };

  targetRadios.forEach((radio) => {
    radio.addEventListener("change", syncTargetVisibility);
  });
  syncTargetVisibility();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const targetMode = form.querySelector('input[name="notifTargetMode"]:checked')?.value || "single";
    const recipientId = recipientSelect?.value;
    const titleEn = document.getElementById("notifTitleEn")?.value?.trim() || "";
    const titleSi = document.getElementById("notifTitleSi")?.value?.trim() || "";
    const messageEn = document.getElementById("notifMessageEn")?.value?.trim() || "";
    const messageSi = document.getElementById("notifMessageSi")?.value?.trim() || "";
    const priority = form.querySelector('input[name="notifPriority"]:checked')?.value || "normal";

    const finalTitleEn = titleEn || titleSi;
    const finalTitleSi = titleSi || titleEn;
    const finalMsgEn = messageEn || messageSi;
    const finalMsgSi = messageSi || messageEn;

    if (!finalTitleEn || !finalMsgEn) {
      showToast("Please provide a notification title and message.", "warning");
      return;
    }

    if (targetMode === "single" && !recipientId) {
      showToast("Please select a recipient member.", "warning");
      return;
    }

    const btn = document.getElementById("btnSendNotification");
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>Dispatching...</span>';
      }

      if (targetMode === "single") {
        await sendNotification({
          recipientId,
          titleEn: finalTitleEn,
          titleSi: finalTitleSi,
          messageEn: finalMsgEn,
          messageSi: finalMsgSi,
          priority,
        });
        showToast("Notification successfully dispatched to member.", "success");
      } else if (targetMode === "all") {
        const approvedMembers = (allMembers || []).filter((m) => m.is_approved && !m.is_archived);
        if (approvedMembers.length === 0) {
          showToast("No active members found to notify.", "warning");
          return;
        }
        const batch = approvedMembers.map((m) => ({
          recipient_id: m.id,
          title_en: finalTitleEn,
          title_si: finalTitleSi,
          message_en: finalMsgEn,
          message_si: finalMsgSi,
          priority,
        }));
        await sendBatchNotifications(batch);
        showToast(`Notification broadcasted to all ${batch.length} active members.`, "success");
      } else if (targetMode === "arrears") {
        const defaulters = await getDefaultersRoster();
        const uniqueMemberIds = [...new Set((defaulters || []).map((d) => d.member_id).filter(Boolean))];
        if (uniqueMemberIds.length === 0) {
          showToast("No members with pending arrears found.", "info");
          return;
        }
        const batch = uniqueMemberIds.map((mId) => ({
          recipient_id: mId,
          title_en: finalTitleEn,
          title_si: finalTitleSi,
          message_en: finalMsgEn,
          message_si: finalMsgSi,
          priority,
        }));
        await sendBatchNotifications(batch);
        showToast(`Notification sent to ${batch.length} members with arrears.`, "success");
      }

      form.reset();
      syncTargetVisibility();
    } catch (err) {
      console.error("Notification dispatch error:", err);
      showToast(err.message || "Failed to dispatch notification.", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">send</span><span>Send Notification</span>';
      }
    }
  });
}
