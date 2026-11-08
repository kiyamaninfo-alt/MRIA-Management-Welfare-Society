import { requireAuth, signOut } from "./auth.js";
import {
  getPendingPayments,
  verifyPayment,
  rejectPayment,
  recordCashPayment,
  getDefaultersRoster,
  getAllMembers,
  updateMemberRole,
  createMember,
  publishAnnouncement,
  getSystemSetting,
} from "./api.js";
import { getSignedSlipUrl } from "./storage.js";
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

let currentStaffMember = null;
let allMembersList = [];
let pendingPaymentsList = [];

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();
  initOfflineDetection();
  setupModalDismissers();

  // 1. Authenticate with RBAC requirement
  const staffRoles = ["admin", "manager", "official", "treasurer"];
  const authState = await requireAuth({ requireApproved: true, allowedRoles: staffRoles });
  if (!authState) return;

  const { user, member } = authState;
  currentStaffMember = member;

  // 2. Render staff identity and badge
  renderStaffHeader(member);

  // 3. Setup Tab switching logic
  setupAdminTabs();

  // 4. Initial data loads
  await loadSlipApprovalQueue();
  await loadCashCollectionForm();
  await loadDefaultersRoster();
  await loadMemberOnboarding();

  // 5. Setup Action Listeners
  setupAdminActions();
});

function renderStaffHeader(member) {
  const staffName = document.getElementById("staffNameDisplay") || document.querySelector("[data-staff-name]");
  if (staffName) staffName.textContent = member.full_name || member.email;

  const roleBadge = document.getElementById("staffRoleBadge") || document.querySelector("[data-staff-role]");
  if (roleBadge) {
    roleBadge.textContent = t(`role_${member.role}`) || member.role.toUpperCase();
  }

  // Wire Sign Out
  document.querySelectorAll("[data-action='signout'], #signOutBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  });
}

export function switchTab(targetId) {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    const isTarget = btn.id === `tab-btn-${targetId}` || btn.id.replace("tab-btn-", "") === targetId;
    if (isTarget) {
      btn.classList.add("active-tab", "border-b-2", "border-primary", "text-primary", "font-semibold");
      btn.classList.remove("text-on-surface-variant");
    } else {
      btn.classList.remove("active-tab", "border-b-2", "border-primary", "text-primary", "font-semibold");
      btn.classList.add("text-on-surface-variant");
    }
  });

  tabContents.forEach((c) => {
    if (c.id === targetId) {
      c.classList.remove("hidden");
      c.classList.add("block");
    } else {
      c.classList.add("hidden");
      c.classList.remove("block");
    }
  });
}
window.switchTab = switchTab;

function setupAdminTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.id.replace("tab-btn-", "");
      switchTab(targetId);
    });
  });
}

// ================= 1. SLIP APPROVAL QUEUE =================

async function loadSlipApprovalQueue() {
  const container = document.getElementById("slipApprovalQueueBody") || document.querySelector("#slip-approval-queue tbody");
  const tabBadge = document.getElementById("tabSlipsCount");
  const pendingCount = document.getElementById("pendingSlipsCount");

  try {
    pendingPaymentsList = await getPendingPayments();

    if (tabBadge) tabBadge.textContent = pendingPaymentsList.length;
    if (pendingCount) pendingCount.textContent = pendingPaymentsList.length;

    if (!container) return;

    if (pendingPaymentsList.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-8 text-center text-xs text-slate-400">
            No bank slips awaiting verification at this time.
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = pendingPaymentsList
      .map((p) => {
        const memberInfo = p.members || {};
        const memberName = memberInfo.full_name || memberInfo.email || "Unknown Member";
        const memberContact = memberInfo.phone || memberInfo.email || "-";
        const paymentType = (p.payment_type || "monthly_due").replace(/_/g, " ").toUpperCase();
        const amount = Number(p.amount || 0);
        const hasSlip = Boolean(p.slip_key);

        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
            <td class="px-4 py-3 text-xs text-slate-500 font-mono">${formatDate(p.created_at || new Date())}</td>
            <td class="px-4 py-3 text-sm">
              <div class="font-semibold text-slate-900">${memberName}</div>
              <div class="text-xs text-slate-400 font-mono">${memberContact}</div>
            </td>
            <td class="px-4 py-3 text-sm font-medium text-slate-700">${paymentType}</td>
            <td class="px-4 py-3 text-sm font-mono font-bold text-slate-900">${formatCurrency(amount)}</td>
            <td class="px-4 py-3 text-sm">
              <button data-review-slip="${p.id}" ${!hasSlip ? 'disabled title="No slip uploaded"' : ''} class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold ${hasSlip ? 'bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'} transition-colors">
                <span class="material-symbols-outlined text-[15px]">visibility</span> ${hasSlip ? "Review Slip" : "No Slip"}
              </button>
            </td>
            <td class="px-4 py-3 text-sm">
              <div class="flex items-center gap-1.5">
                <button data-approve-slip="${p.id}" class="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                  Approve (FIFO)
                </button>
                <button data-reject-slip="${p.id}" class="px-2 py-1 rounded text-xs font-semibold bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 transition-colors">
                  Reject
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    // Wire Review, Approve, Reject buttons
    container.querySelectorAll("[data-review-slip]").forEach((btn) => {
      btn.addEventListener("click", () => reviewSlip(btn.getAttribute("data-review-slip")));
    });

    container.querySelectorAll("[data-approve-slip]").forEach((btn) => {
      btn.addEventListener("click", () => handleApproveSlip(btn.getAttribute("data-approve-slip")));
    });

    container.querySelectorAll("[data-reject-slip]").forEach((btn) => {
      btn.addEventListener("click", () => handleRejectSlip(btn.getAttribute("data-reject-slip")));
    });
  } catch (err) {
    console.error("Failed to load pending payments:", err);
  }
}

async function reviewSlip(paymentId) {
  const payment = pendingPaymentsList.find((p) => p.id === paymentId);
  if (!payment) return;

  const modalSlipImg = document.getElementById("modalSlipImg");
  const modalMember = document.getElementById("modalMember");
  const modalAmount = document.getElementById("modalAmount");
  const modalTime = document.getElementById("modalTime");

  const memberName = payment.members?.full_name || payment.members?.email || "Unknown Member";
  if (modalMember) modalMember.textContent = memberName;
  if (modalAmount) modalAmount.textContent = formatCurrency(payment.amount || 0);
  if (modalTime) modalTime.textContent = formatDate(payment.created_at || new Date());

  if (modalSlipImg) {
    modalSlipImg.src = "";
    if (!payment.slip_key) {
      modalSlipImg.alt = "Slip image not attached.";
    } else {
      modalSlipImg.alt = "Loading bank slip...";
      try {
        const signedUrl = await getSignedSlipUrl(payment.slip_key);
        if (signedUrl) {
          modalSlipImg.src = signedUrl;
        } else {
          modalSlipImg.alt = "Slip image not available.";
        }
      } catch (err) {
        console.error("Failed to get signed slip URL:", err);
        modalSlipImg.alt = "Error loading slip: " + err.message;
      }
    }
  }

  openModal("slipModal");
}

async function handleApproveSlip(paymentId) {
  if (!confirm("Are you sure you want to approve this payment slip? FIFO settlement will reconcile any pending monthly dues.")) {
    return;
  }

  try {
    await verifyPayment(paymentId, currentStaffMember.id);
    showToast("Payment slip approved! Dues reconciled via FIFO.", "success");
    closeModal("slipModal");
    await loadSlipApprovalQueue();
    await loadDefaultersRoster();
  } catch (err) {
    console.error("Payment approval error:", err);
    showToast(err.message || "Failed to approve slip.", "error");
  }
}

async function handleRejectSlip(paymentId) {
  const reason = prompt("Please provide a reason for rejection (e.g., Unclear image, mismatched amount):");
  if (!reason) return;

  try {
    await rejectPayment(paymentId, currentStaffMember.id, reason);
    showToast("Payment slip rejected.", "info");
    closeModal("slipModal");
    await loadSlipApprovalQueue();
  } catch (err) {
    console.error("Payment rejection error:", err);
    showToast(err.message || "Failed to reject slip.", "error");
  }
}

// ================= 2. DIRECT CASH COLLECTION =================

async function loadCashCollectionForm() {
  const memberSelect = document.getElementById("cashMemberSelect");
  const dateInput = document.getElementById("cashDateInput");
  const sysDateDisplay = document.getElementById("systemDateDisplay");

  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateInput && !dateInput.value) {
    dateInput.value = todayStr;
  }
  if (sysDateDisplay) {
    sysDateDisplay.textContent = `System Date: ${todayStr}`;
  }

  if (!memberSelect) return;

  allMembersList = await getAllMembers();
  memberSelect.innerHTML = '<option value="" disabled selected>-- Select Association Member --</option>';

  allMembersList
    .filter((m) => m.is_approved)
    .forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.full_name} (${m.phone || m.email})`;
      memberSelect.appendChild(opt);
    });

  updateCashPreview();
}

function updateCashPreview() {
  const memberSelect = document.getElementById("cashMemberSelect");
  const categorySelect = document.getElementById("cashCategorySelect");
  const amountInput = document.getElementById("cashAmountInput");
  const dateInput = document.getElementById("cashDateInput");
  const voucherRefInput = document.getElementById("voucherRefInput");
  const prevMember = document.getElementById("prevMember");
  const prevCategory = document.getElementById("prevCategory");
  const prevAmount = document.getElementById("prevAmount");
  const prevVoucherRef = document.getElementById("prevVoucherRef");
  const prevVoucherDate = document.getElementById("prevVoucherDate");

  if (prevVoucherRef) {
    if (voucherRefInput && voucherRefInput.value.trim()) {
      prevVoucherRef.textContent = voucherRefInput.value.trim();
    } else if (!prevVoucherRef.dataset.set) {
      prevVoucherRef.textContent = `MRIA-CSH-${Math.floor(1000 + Math.random() * 9000)}`;
      prevVoucherRef.dataset.set = "true";
    }
  }

  if (prevVoucherDate) {
    const dVal = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);
    prevVoucherDate.textContent = dVal;
  }

  if (memberSelect && prevMember) {
    const selOpt = memberSelect.options[memberSelect.selectedIndex];
    prevMember.textContent = selOpt ? selOpt.text : "-";
  }
  if (categorySelect && prevCategory) {
    prevCategory.textContent = categorySelect.options[categorySelect.selectedIndex]?.text || "-";
  }
  if (amountInput && prevAmount) {
    prevAmount.textContent = formatCurrency(amountInput.value);
  }
}
window.updateCashPreview = updateCashPreview;

// ================= 3. DEFAULTERS ROSTER (31ST RULE) =================

async function loadDefaultersRoster() {
  const tbody = document.getElementById("defaultersTableBody") || document.querySelector("#defaulters-table tbody");
  if (!tbody) return;

  try {
    const defaulters = await getDefaultersRoster();

    if (defaulters.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-8 text-center text-xs text-emerald-600 font-medium">
            <span class="material-symbols-outlined text-lg align-middle">verified</span>
            All active members have settled their dues! No defaulters found.
          </td>
        </tr>
      `;
      return;
    }

    // Group by member
    const grouped = {};
    defaulters.forEach((d) => {
      if (!grouped[d.member_id]) {
        grouped[d.member_id] = {
          name: d.full_name,
          phone: d.phone,
          email: d.email,
          duesCount: 0,
          totalAmount: 0,
        };
      }
      grouped[d.member_id].duesCount += 1;
      grouped[d.member_id].totalAmount += Number(d.amount);
    });

    tbody.innerHTML = Object.values(grouped)
      .map((m) => {
        const waMsg = encodeURIComponent(
          `ආයුබෝවන් ${m.name}, ඔබගේ MRIA සුබසාධක සංගමයේ මාසික දායක මුදල් ${m.duesCount} ක් සඳහා රු. ${m.totalAmount.toFixed(2)} හිඟ මුදලක් පවතී. කරුණාකර හැකි ඉක්මනින් පියවීමට කාරුණික වන්න.`
        );
        const waLink = `https://wa.me/94${m.phone.replace(/^0/, "")}?text=${waMsg}`;

        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
            <td class="px-4 py-3 text-sm font-semibold text-slate-900">${m.name}</td>
            <td class="px-4 py-3 text-xs text-slate-500 font-mono">${m.phone}</td>
            <td class="px-4 py-3 text-sm text-center">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                ${m.duesCount} Month(s)
              </span>
            </td>
            <td class="px-4 py-3 text-sm font-mono font-bold text-rose-600">${formatCurrency(m.totalAmount)}</td>
            <td class="px-4 py-3 text-sm">
              <a href="${waLink}" target="_blank" class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
                <span class="material-symbols-outlined text-[15px]">send</span> WhatsApp Reminder
              </a>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Defaulters load error:", err);
  }
}

// ================= 4. MEMBER ONBOARDING & RBAC =================

async function loadMemberOnboarding() {
  const tbody = document.getElementById("membersTableBody") || document.querySelector("#member-onboarding-table tbody");
  if (!tbody) return;

  try {
    allMembersList = await getAllMembers();

    tbody.innerHTML = allMembersList
      .map((m) => {
        const isSelf = m.id === currentStaffMember.id;
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
            <td class="px-4 py-3 text-sm">
              <div class="font-semibold text-slate-900">${m.full_name}</div>
              <div class="text-xs text-slate-400 font-mono">${m.email}</div>
            </td>
            <td class="px-4 py-3 text-xs text-slate-600 font-mono">${m.phone}</td>
            <td class="px-4 py-3 text-center">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.is_legacy_member ? "bg-sky-50 text-sky-700 border border-sky-200" : "bg-slate-50 text-slate-500 border border-slate-200"}">
                ${m.is_legacy_member ? "LEGACY" : "REGULAR"}
              </span>
            </td>
            <td class="px-4 py-3 text-center">
              <label class="inline-flex items-center cursor-pointer">
                <input type="checkbox" data-member-approved="${m.id}" ${m.is_approved ? "checked" : ""} ${isSelf ? "disabled" : ""} class="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4">
              </label>
            </td>
            <td class="px-4 py-3 text-sm">
              <select data-member-role="${m.id}" ${isSelf ? "disabled" : ""} class="h-8 px-2 text-xs border border-slate-200 rounded bg-white text-slate-800 focus:border-primary">
                <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
                <option value="treasurer" ${m.role === "treasurer" ? "selected" : ""}>Treasurer (භාණ්ඩාගාරික)</option>
                <option value="official" ${m.role === "official" ? "selected" : ""}>Official</option>
                <option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>
                <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
              </select>
            </td>
          </tr>
        `;
      })
      .join("");

    // Wire approval toggle
    tbody.querySelectorAll("[data-member-approved]").forEach((chk) => {
      chk.addEventListener("change", async () => {
        const memberId = chk.getAttribute("data-member-approved");
        try {
          await updateMemberRole(memberId, undefined, chk.checked, undefined);
          showToast(`Member approval updated to ${chk.checked ? "Approved" : "Pending"}.`, "success");
        } catch (err) {
          showToast(err.message || "Failed to update member.", "error");
          chk.checked = !chk.checked;
        }
      });
    });

    // Wire role dropdown change
    tbody.querySelectorAll("[data-member-role]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const memberId = sel.getAttribute("data-member-role");
        try {
          await updateMemberRole(memberId, sel.value, undefined, undefined);
          showToast(`Member role updated to ${sel.value}.`, "success");
        } catch (err) {
          showToast(err.message || "Failed to update role.", "error");
        }
      });
    });
  } catch (err) {
    console.error("Member onboarding load error:", err);
  }
}

// ================= SETUP ACTION LISTENERS =================

function setupAdminActions() {
  // Cash Collection Form Submit
  const cashForm = document.getElementById("cashForm");
  if (cashForm) {
    cashForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const memberSelect = document.getElementById("cashMemberSelect");
      const categorySelect = document.getElementById("cashCategorySelect");
      const amountInput = document.getElementById("cashAmountInput");
      const submitBtn = cashForm.querySelector("button[type='submit']");

      if (!memberSelect || !memberSelect.value) {
        showToast("Please select a member.", "warning");
        return;
      }

      const amount = Number(amountInput ? amountInput.value : 0);
      if (!amount || amount <= 0) {
        showToast("Please enter a valid amount.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Logging & Issuing Receipt...";
        }

        const dateInput = document.getElementById("cashDateInput");
        const paidAt = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);

        const payment = await recordCashPayment({
          memberId: memberSelect.value,
          amount,
          paymentType: categorySelect ? categorySelect.value : "monthly_due",
          collectedByMemberId: currentStaffMember.id,
          paidAt,
        });

        showToast("Cash payment recorded! Digital receipt generated.", "success");
        const selMember = allMembersList.find((m) => m.id === memberSelect.value);
        openReceiptModal(payment, selMember ? selMember.full_name : "Member");

        cashForm.reset();
        if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
        updateCashPreview();
        await loadDefaultersRoster();
      } catch (err) {
        console.error("Cash collection error:", err);
        showToast(err.message || "Failed to log cash payment.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Issue Instant Cash Receipt";
        }
      }
    });

    const inputs = [
      document.getElementById("cashMemberSelect"),
      document.getElementById("cashCategorySelect"),
      document.getElementById("cashAmountInput"),
      document.getElementById("cashDateInput"),
      document.getElementById("voucherRefInput"),
    ];
    inputs.forEach((inp) => {
      if (inp) {
        inp.addEventListener("input", updateCashPreview);
        inp.addEventListener("change", updateCashPreview);
      }
    });
  }

  // Add Member Modal & Form
  const onboardForm = document.getElementById("onboardForm");
  if (onboardForm) {
    onboardForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInp = document.getElementById("onboardName");
      const emailInp = document.getElementById("onboardEmail");
      const phoneInp = document.getElementById("onboardPhone");
      const nicInp = document.getElementById("onboardNic");
      const legacyChk = document.getElementById("legacyCheck");
      const roleSel = document.getElementById("onboardRole");

      try {
        await createMember({
          email: emailInp.value,
          fullName: nameInp.value,
          phone: phoneInp.value,
          nic: nicInp ? nicInp.value : null,
          role: roleSel ? roleSel.value : "member",
          isLegacy: legacyChk ? legacyChk.checked : false,
          isApproved: true,
        });

        showToast("New member successfully registered and approved!", "success");
        closeModal("onboardModal");
        onboardForm.reset();
        await loadMemberOnboarding();
        await loadCashCollectionForm();
      } catch (err) {
        showToast(err.message || "Failed to register member.", "error");
      }
    });
  }

  // Open Onboard Modal buttons
  document.querySelectorAll("[data-open-modal='onboardModal']").forEach((btn) => {
    btn.addEventListener("click", () => openModal("onboardModal"));
  });

  // Announcement Form Submit
  const announcementForm = document.getElementById("announcementForm");
  if (announcementForm) {
    announcementForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const titleEn = document.getElementById("annTitleEn")?.value;
      const titleSi = document.getElementById("annTitleSi")?.value;
      const contentEn = document.getElementById("annContentEn")?.value;
      const contentSi = document.getElementById("annContentSi")?.value;
      const isPinned = document.getElementById("pinPwa")?.checked || false;

      try {
        await publishAnnouncement({
          titleEn,
          titleSi,
          contentEn,
          contentSi,
          priority: "normal",
          isPinned,
          createdByMemberId: currentStaffMember.id,
        });
        showToast("Announcement published successfully!", "success");
        announcementForm.reset();
      } catch (err) {
        showToast(err.message || "Failed to publish announcement.", "error");
      }
    });
  }
}

function openReceiptModal(payment, memberName) {
  let modal = document.getElementById("receiptModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "receiptModal";
    modal.className = "fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4";
    modal.innerHTML = `
      <div class="relative w-full max-w-lg bg-white rounded-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <button onclick="document.getElementById('receiptModal').classList.add('hidden')" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-lg font-bold">&times;</button>
        <div id="receiptModalContent"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const content = document.getElementById("receiptModalContent");
  if (content) {
    content.innerHTML = renderReceiptHtml(payment, memberName, currentStaffMember.full_name);
  }
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}
