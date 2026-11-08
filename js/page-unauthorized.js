import { getCurrentSession, getMemberProfile, signOut } from "./auth.js";
import { initLanguage } from "./i18n.js";
import { CONFIG } from "./config.js";

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();

  const session = await getCurrentSession();
  if (!session || !session.user) {
    window.location.href = "/index.html";
    return;
  }

  const user = session.user;
  const member = await getMemberProfile(user.id) || await getMemberProfile(user.email);

  // If user was already approved, redirect to dashboard
  if (member && member.is_approved) {
    window.location.href = "/dashboard.html";
    return;
  }

  // Display user's authenticated Google details
  const userEmailDisplay = document.querySelector("[data-user-email]") || document.getElementById("userEmailDisplay");
  if (userEmailDisplay) {
    userEmailDisplay.textContent = user.email;
  }

  // Set WhatsApp button link
  const waBtn = document.querySelector('a[href*="wa.me"]');
  if (waBtn) {
    waBtn.href = `${CONFIG.WHATSAPP_URL}?text=${encodeURIComponent(
      `Hello MRIA Welfare Administration, I have logged in with ${user.email} and request membership activation.`
    )}`;
  }

  // Wire Sign Out button
  const signOutBtn = document.querySelector("[data-action='signout']") || document.getElementById("signOutBtn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
});
