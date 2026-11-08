// UI Helpers, Toast Notifications, Offline Detection & Modal Management

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

export function formatCurrency(amount) {
  return `Rs. ${Number(amount || 0).toLocaleString("en-LK", {
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
