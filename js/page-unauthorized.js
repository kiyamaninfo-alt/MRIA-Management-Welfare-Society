import { getCurrentSession, getMemberProfile, signOut } from "./auth.js";
import { initLanguage, t } from "./i18n.js";
import { submitRegistrationRequest } from "./api.js";
import { showToast, openContactModal } from "./ui.js";

document.addEventListener("DOMContentLoaded", async () => {
  initLanguage();

  const session = await getCurrentSession();
  if (!session || !session.user) {
    window.location.href = "/index.html";
    return;
  }

  const user = session.user;
  const member = (await getMemberProfile(user.id)) || (await getMemberProfile(user.email));

  // If user was already approved, redirect to dashboard
  if (member && member.is_approved) {
    window.location.href = "/dashboard.html";
    return;
  }

  // Display user's authenticated Google email
  const userEmailDisplay = document.getElementById("userEmailDisplay");
  if (userEmailDisplay) {
    userEmailDisplay.textContent = `Google Account: ${user.email}`;
  }

  // Prefill Full Name if available in user metadata
  const regFullName = document.getElementById("regFullName");
  if (regFullName && user.user_metadata?.full_name) {
    regFullName.value = user.user_metadata.full_name;
  }

  // Wire registration form
  const regForm = document.getElementById("registrationForm");
  const submitBtn = document.getElementById("submitRegBtn");
  const successNotice = document.getElementById("regSuccessNotice");

  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const fullName = document.getElementById("regFullName").value;
      const epfNumber = document.getElementById("regEpfNumber").value;
      const designation = document.getElementById("regDesignation").value;
      const phone = document.getElementById("regPhone").value;

      if (!epfNumber || !designation || !fullName) {
        showToast("Please fill in all required fields (Name, EPF, Designation).", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting Application...";
        }

        await submitRegistrationRequest({
          email: user.email,
          fullName,
          epfNumber,
          designation,
          phone,
        });

        regForm.classList.add("hidden");
        if (successNotice) {
          successNotice.classList.remove("hidden");
        }
        showToast(t("registration_submitted"), "success");
      } catch (err) {
        console.error("Registration error:", err);
        showToast(err.message || "Failed to submit registration request.", "error");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t("submit_registration");
        }
      }
    });
  }

  // Wire Sign Out button
  const signOutBtn = document.getElementById("signOutBtn") || document.querySelector("[data-action='signout']");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
});
