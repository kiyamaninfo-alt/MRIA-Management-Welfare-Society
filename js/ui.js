// UI Helpers, Toast Notifications, Offline Detection, Modals & Interactive Ledgers
import { t, getLanguage } from "./i18n.js";
import { CONFIG } from "./config.js";
import { supabase } from "./auth.js";

export function showToast(message, type = "info") {
  let toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    toastContainer.className = "fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  const bgColors = {
    info: "bg-slate-900 text-white",
    success: "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white",
    warning: "bg-amber-600 text-white",
  };

  toast.className = `px-4 py-3 rounded shadow-lg text-sm flex items-center justify-between gap-3 transition-all transform duration-200 translate-y-2 opacity-0 ${bgColors[type] || bgColors.info}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="opacity-75 hover:opacity-100 font-bold">&times;</button>
  `;

  toast.querySelector("button").onclick = () => toast.remove();

  toastContainer.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  }, 10);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function openModal(modalId) {
  if (modalId === "duesBreakdownModal" && !document.getElementById("duesBreakdownModal")) {
    if (typeof window !== "undefined" && typeof window.openCurrentDuesBreakdown === "function") {
      window.openCurrentDuesBreakdown();
      return;
    }
  }

  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

export function setupModalDismissers() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-close-modal");
      closeModal(modalId);
    });
  });
}

/**
 * Interactive In-App Contact Administration Modal submitting to admin_inquiries table
 */
export function openContactModal(userEmail = "", userName = "") {
  let modal = document.getElementById("contactAdminModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "contactAdminModal";
    modal.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl border border-outline-variant relative">
        <button id="closeContactModalBtn" type="button" class="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface cursor-pointer">
          <span class="material-symbols-outlined">close</span>
        </button>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <span class="material-symbols-outlined">support_agent</span>
          </div>
          <div>
            <h3 class="font-bold text-title text-on-surface" data-i18n="contact_modal_title">Contact Administration</h3>
            <p class="text-caption text-on-surface-variant">In-App Internal Inquiry Desk</p>
          </div>
        </div>
        <p class="text-caption text-on-surface-variant mb-4" data-i18n="contact_recipient_info">
          Direct your inquiries or support requests to the MRIA Welfare Executive Committee.
        </p>
        <form id="contactAdminForm" class="space-y-3">
          <div>
            <label class="block text-caption font-medium text-on-surface mb-1" data-i18n="full_name">Your Name</label>
            <input type="text" id="contactSenderName" class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm" required />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="block text-caption font-medium text-on-surface mb-1" data-i18n="email_address">Email</label>
              <input type="email" id="contactSenderEmail" class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm" required />
            </div>
            <div>
              <label class="block text-caption font-medium text-on-surface mb-1">Phone (දුරකථන)</label>
              <input type="tel" id="contactSenderPhone" placeholder="07XXXXXXXX" class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm" />
            </div>
          </div>
          <div>
            <label class="block text-caption font-medium text-on-surface mb-1">Inquiry Category (ප්‍රවර්ගය)</label>
            <select id="contactCategory" class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm font-medium">
              <option value="general">General Administration Inquiry (සාමාන්‍ය විමසීමක්)</option>
              <option value="welfare_medical">Welfare / Medical Aid Inquiry - Confidential (රහසිගත වෛද්‍ය/සුබසාධන විමසීමක්)</option>
            </select>
          </div>
          <div>
            <label class="block text-caption font-medium text-on-surface mb-1" data-i18n="contact_subject">Subject</label>
            <input type="text" id="contactSubject" placeholder="Inquiry topic..." class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm" required />
          </div>
          <div>
            <label class="block text-caption font-medium text-on-surface mb-1" data-i18n="contact_message">Message</label>
            <textarea id="contactMessage" rows="4" placeholder="Type your message here..." class="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-on-surface text-body text-sm" required></textarea>
          </div>
          <button id="submitContactInquiryBtn" type="submit" class="w-full py-2.5 px-4 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs">
            <span class="material-symbols-outlined text-[18px]">send</span>
            <span data-i18n="send_inquiry">Send Inquiry</span>
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("#closeContactModalBtn")?.addEventListener("click", () => {
      closeModal("contactAdminModal");
    });

    modal.querySelector("#contactAdminForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const senderName = document.getElementById("contactSenderName")?.value.trim() || "";
      const senderEmail = document.getElementById("contactSenderEmail")?.value.trim() || "";
      const senderPhone = document.getElementById("contactSenderPhone")?.value.trim() || null;
      const subjectText = document.getElementById("contactSubject")?.value.trim() || "";
      const messageText = document.getElementById("contactMessage")?.value.trim() || "";
      const btn = document.getElementById("submitContactInquiryBtn");

      if (!senderName || !senderEmail || !subjectText || !messageText) {
        showToast("Please fill in all required fields.", "warning");
        return;
      }

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span><span>Submitting...</span>`;
        }

        // Fetch current active member or user if available
        let senderId = null;
        let senderEpf = null;
        const cachedStr = localStorage.getItem("mria_cached_member");
        if (cachedStr) {
          try {
            const m = JSON.parse(cachedStr);
            senderId = m.id;
            senderEpf = m.epf_number;
          } catch (_) {}
        }

        const categoryVal = document.getElementById("contactCategory")?.value || "general";

        const { error } = await supabase.from("admin_inquiries").insert([
          {
            sender_id: senderId,
            sender_name: senderName,
            sender_email: senderEmail,
            sender_phone: senderPhone,
            sender_epf: senderEpf,
            category: categoryVal,
            subject: subjectText,
            message: messageText,
            status: "pending",
          },
        ]);

        if (error) throw error;

        // Log user activity
        try {
          await supabase.rpc("log_user_activity", {
            p_action: "CONTACT_ADMIN_INQUIRY",
            p_entity_type: "INQUIRY",
            p_entity_id: senderEmail,
            p_details: {
              subject: subjectText,
              message_preview: messageText.slice(0, 300),
              sender_phone: senderPhone,
            },
            p_actor_email: senderEmail,
            p_actor_name: senderName,
          });
        } catch (_) {}

        showToast(t("inquiry_submitted") || "Your inquiry has been submitted directly to administration.", "success");
        closeModal("contactAdminModal");
        document.getElementById("contactAdminForm").reset();
      } catch (err) {
        console.error("Failed to submit inquiry:", err);
        showToast(err.message || "Failed to submit inquiry.", "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">send</span><span>Send Inquiry</span>`;
        }
      }
    });
  }

  // Prefill if available
  if (userName) document.getElementById("contactSenderName").value = userName;
  if (userEmail) document.getElementById("contactSenderEmail").value = userEmail;

  openModal("contactAdminModal");
}

/**
 * Renders the interactive payment history popup detailing paid vs unpaid months.
 */
export function openDuesBreakdownModal(dues = [], memberBalance = {}, memberName = "") {
  let modal = document.getElementById("duesBreakdownModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "duesBreakdownModal";
    modal.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-surface rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-outline-variant relative">
        <div class="p-5 border-b border-outline-variant flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <span class="material-symbols-outlined">receipt_long</span>
            </div>
            <div>
              <h3 id="duesBreakdownTitleText" class="font-bold text-title text-on-surface" data-i18n="dues_breakdown_title">Monthly Contributions Breakdown</h3>
              <p class="text-caption text-on-surface-variant" data-i18n="click_for_history">Paid vs. Unpaid Ledger</p>
            </div>
          </div>
          <button id="closeDuesBreakdownBtn" class="text-on-surface-variant hover:text-on-surface">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div id="duesBreakdownContent" class="p-5 overflow-y-auto space-y-3">
          <!-- Dynamic ledger entries -->
        </div>

        <div class="p-4 border-t border-outline-variant bg-surface-variant/30 flex justify-between items-center">
          <span class="text-body font-semibold text-on-surface" data-i18n="outstanding_dues">Outstanding Dues</span>
          <span id="modalTotalOutstanding" class="text-title font-bold text-error">Rs. 0.00</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("#closeDuesBreakdownBtn")?.addEventListener("click", () => {
      closeModal("duesBreakdownModal");
    });
  }

  const titleEl = document.getElementById("duesBreakdownTitleText");
  if (titleEl && memberName) {
    titleEl.textContent = `${t("dues_breakdown_title") || "Monthly Contributions"} - ${memberName}`;
  }

  const container = document.getElementById("duesBreakdownContent");
  const totalEl = document.getElementById("modalTotalOutstanding");

  totalEl.textContent = formatCurrency(memberBalance.totalPending || 0);

  if (dues.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-on-surface-variant text-body" data-i18n="no_records">No records found.</div>`;
  } else {
    container.innerHTML = dues.map((d) => {
      const isPaid = d.status === "paid";
      const isPrepaid = isPaid && Boolean(d.is_advance_settled);
      return `
        <div class="flex items-center justify-between p-3 rounded-xl border ${
          isPrepaid
            ? "border-teal-200 bg-teal-50/50"
            : isPaid
              ? "border-emerald-200 bg-emerald-50/50"
              : "border-rose-200 bg-rose-50/50"
        }">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined ${
              isPrepaid ? "text-teal-600" : isPaid ? "text-emerald-600" : "text-rose-600"
            }">
              ${isPrepaid ? "task_alt" : isPaid ? "check_circle" : "pending"}
            </span>
            <div>
              <div class="font-semibold text-body text-on-surface">${d.billing_month}</div>
              <div class="text-caption text-on-surface-variant">${
                isPrepaid ? t("settled_from_advance") : (d.due_date ? `Due Date: ${d.due_date}` : "Due Date: 31st")
              }</div>
            </div>
          </div>
          <div class="text-right">
            <div class="font-bold text-body ${
              isPrepaid ? "text-teal-700" : isPaid ? "text-emerald-700" : "text-rose-700"
            }">${formatCurrency(d.amount)}</div>
            <span class="text-caption font-medium px-2 py-0.5 rounded-full ${
              isPrepaid
                ? "bg-teal-100 text-teal-800"
                : isPaid
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
            }">
              ${isPrepaid ? t("prepaid") : isPaid ? t("paid") : t("pending")}
            </span>
          </div>
        </div>
      `;
    }).join("");
  }

  openModal("duesBreakdownModal");
}

/**
 * Downloads the official Constitution PDF according to the active language toggle.
 */
export function downloadConstitutionPdf() {
  const lang = getLanguage();
  const pdfPath = lang === "si" ? "/assets/docs/constitution_si.pdf" : "/assets/docs/constitution_en.pdf";
  window.open(pdfPath, "_blank");
}

export function initOfflineDetection() {
  const offlineBanner = document.getElementById("offlineBanner");

  function updateStatus() {
    const isOffline = !navigator.onLine;
    if (offlineBanner) {
      if (isOffline) {
        offlineBanner.classList.remove("hidden");
      } else {
        offlineBanner.classList.add("hidden");
      }
    }

    // Disable write/submit buttons when offline
    document.querySelectorAll(".mutation-btn").forEach((btn) => {
      btn.disabled = isOffline;
      if (isOffline) {
        btn.classList.add("opacity-50", "cursor-not-allowed");
      } else {
        btn.classList.remove("opacity-50", "cursor-not-allowed");
      }
    });
  }

  window.addEventListener("online", () => {
    updateStatus();
    showToast("Internet connection restored.", "success");
  });

  window.addEventListener("offline", () => {
    updateStatus();
    showToast("You are now offline. Financial write mutations are paused.", "warning");
  });

  updateStatus();
}

export function formatCurrency(amount, { showSign = false } = {}) {
  const num = Number(amount || 0);
  const formatted = Math.abs(num).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (showSign) {
    if (num > 0) return `+Rs. ${formatted}`;
    if (num < 0) return `-Rs. ${formatted}`;
    return "Rs. 0.00";
  }

  return `Rs. ${num.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Explicit Global Scope Bindings for inline HTML event handlers
if (typeof window !== "undefined") {
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.openContactModal = openContactModal;
  window.openDuesBreakdownModal = openDuesBreakdownModal;
  window.downloadConstitutionPdf = downloadConstitutionPdf;
}
