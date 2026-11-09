import { getCurrentSession, getMemberProfile, signOut } from "./auth.js";
import { initLanguage, t } from "./i18n.js";
import { submitRegistrationRequest, logUserActivity } from "./api.js";
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

  // Wire registration form elements
  const regForm = document.getElementById("registrationForm");
  const submitBtn = document.getElementById("submitRegBtn");
  const successNotice = document.getElementById("regSuccessNotice");

  // If user already applied and is pending approval, hide form and show pending message
  if (member && !member.is_approved) {
    if (regForm) regForm.classList.add("hidden");
    if (successNotice) {
      successNotice.classList.remove("hidden");
    }
  }

  // Prefill Full Name if available in user metadata
  const regFullName = document.getElementById("regFullName");
  if (regFullName && user.user_metadata?.full_name) {
    regFullName.value = user.user_metadata.full_name;
  }

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
          userId: user.id,
          email: user.email,
          fullName,
          epfNumber,
          designation,
          phone,
        });

        await logUserActivity({
          action: "MEMBER_REGISTRATION_REQUEST",
          entityType: "MEMBERS",
          entityId: user.email,
          actorEmail: user.email,
          actorName: fullName,
          epfNumber: epfNumber,
          details: {
            designation,
            phone,
            user_id: user.id,
            submitted_at: new Date().toISOString(),
          },
        });

        regForm.classList.add("hidden");
        if (successNotice) {
          successNotice.classList.remove("hidden");
        }
        showToast(t("registration_submitted"), "success");
      } catch (err) {
        console.error("Registration error:", err);
        let msg = err.message || "Failed to submit registration request.";
        if (err.code === "23505" || msg.includes("unique")) {
          msg = "This EPF Number or Email is already registered with an existing account.";
        }
        showToast(msg, "error");
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
