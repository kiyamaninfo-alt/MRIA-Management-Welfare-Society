import { signInWithGoogle, getCurrentSession, getMemberProfile } from "./auth.js";
import { initLanguage } from "./i18n.js";

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize bilingual translations
  initLanguage();

  // 2. Register Service Worker for PWA capabilities
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
      console.log("PWA Service Worker registered successfully.");
    } catch (err) {
      console.warn("ServiceWorker registration failed:", err);
    }
  }

  // 3. Check existing authentication session
  try {
    const session = await getCurrentSession();
    if (session && session.user) {
      const member = await getMemberProfile(session.user.id) || await getMemberProfile(session.user.email);
      if (member && member.is_approved) {
        window.location.href = "/dashboard.html";
        return;
      } else if (!member || !member.is_approved) {
        window.location.href = "/unauthorized.html";
        return;
      }
    }
  } catch (err) {
    console.warn("Session check error:", err);
  }

  // 4. Attach Google Sign-In handler
  const googleBtn = document.getElementById("googleSignInBtn");
  const authNotice = document.getElementById("authNotice");

  if (googleBtn) {
    googleBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (authNotice) {
        authNotice.classList.remove("hidden");
        authNotice.innerHTML = `
          <span class="material-symbols-outlined text-[18px] text-primary animate-spin" data-icon="sync">sync</span>
          <span class="text-on-surface">Connecting to Google OAuth...</span>
        `;
      }
      try {
        await signInWithGoogle();
      } catch (err) {
        if (authNotice) {
          authNotice.innerHTML = `
            <span class="material-symbols-outlined text-[18px] text-red-600" data-icon="error">error</span>
            <span class="text-red-600">${err.message || "Failed to sign in."}</span>
          `;
        }
      }
    });
  }

  // 5. PWA Install Prompt handling
  let deferredPrompt = null;
  const installBtn = document.getElementById("installAppBtn");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) {
      installBtn.classList.remove("hidden");
    }
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log("Install prompt outcome:", outcome);
        deferredPrompt = null;
      } else {
        alert("To install this PWA, tap your browser's share or menu icon and select 'Add to Home Screen'.");
      }
    });
  }
});
