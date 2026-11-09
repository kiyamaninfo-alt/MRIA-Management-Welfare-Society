import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: CONFIG.auth || {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: (name, acquireTimeout, fn) => fn(),
  },
});

export async function signInWithGoogle() {
  const redirectOrigin = window.location.origin;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${redirectOrigin}/dashboard.html`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    console.error("Google sign-in error:", error);
    throw error;
  }
  return data;
}

export async function logAuthActivity(action, member = null, extra = {}) {
  try {
    await supabase.rpc("log_user_activity", {
      p_action: action,
      p_entity_type: "AUTH",
      p_entity_id: member?.id || "",
      p_details: extra,
      p_actor_email: member?.email || null,
      p_actor_name: member?.full_name || null,
      p_epf_number: member?.epf_number || null,
    });
  } catch (err) {
    console.debug("Auth audit logging notice:", err);
  }
}

export async function signOut() {
  try {
    const cachedStr = localStorage.getItem("mria_cached_member");
    const member = cachedStr ? JSON.parse(cachedStr) : null;
    await logAuthActivity("USER_LOGOUT", member, {
      page: window.location.pathname,
      logout_time: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("Could not log logout event:", e);
  }

  try {
    localStorage.removeItem("mria_cached_member");
    sessionStorage.clear();
    // Clear Supabase auth keys from localStorage
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("sb-") || key.includes("supabase.auth.token"))) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("Could not clear cached member / storage:", e);
  }

  try {
    // Add a 1500ms safety timeout so signOut never hangs if offline or blocked
    await Promise.race([
      supabase.auth.signOut(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch (err) {
    console.warn("Error during supabase.auth.signOut:", err);
  } finally {
    window.location.href = "/index.html";
  }
}

if (typeof window !== "undefined") {
  window.signOut = signOut;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='signout'], #signOutBtn, button[title='Sign Out'], [data-signout]");
    if (btn) {
      e.preventDefault();
      await signOut();
    }
  });
}

export async function getCurrentSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) return null;
    return session;
  } catch (err) {
    console.warn("Failed to get current session:", err);
    return null;
  }
}

export async function getCurrentUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) return null;
    return user;
  } catch (err) {
    console.warn("Failed to get current user:", err);
    return null;
  }
}

export async function getMemberProfile(emailOrUserId) {
  // If offline, retrieve cached member immediately
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    try {
      const cached = localStorage.getItem("mria_cached_member");
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      console.warn("Failed to parse cached member:", e);
      return null;
    }
  }

  // Try querying by user_id or email
  let query = supabase.from("members").select("*");
  if (emailOrUserId.includes("@")) {
    query = query.eq("email", emailOrUserId);
  } else {
    query = query.eq("user_id", emailOrUserId);
  }

  try {
    const { data, error } = await query.maybeSingle();
    if (error) {
      console.warn("Failed to fetch member record from network:", error);
      const cached = localStorage.getItem("mria_cached_member");
      return cached ? JSON.parse(cached) : null;
    }

    if (data && data.is_approved) {
      try {
        localStorage.setItem("mria_cached_member", JSON.stringify(data));
      } catch (e) {
        console.warn("Failed to cache member profile:", e);
      }
    }
    return data;
  } catch (err) {
    console.warn("Exception fetching member record:", err);
    try {
      const cached = localStorage.getItem("mria_cached_member");
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  }
}

/**
 * Validates session and whitelist approval status.
 * Handles offline gracefully by using cached profile and avoiding unauthorized redirects when offline.
 */
export async function checkAuthAndWhitelist({ requireApproved = true, allowedRoles = null } = {}) {
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  // OFFLINE HANDLING: Never redirect to unauthorized.html when offline
  if (isOffline) {
    try {
      const cachedStr = localStorage.getItem("mria_cached_member");
      if (cachedStr) {
        const member = JSON.parse(cachedStr);
        if (member && (!requireApproved || member.is_approved)) {
          if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(member.role)) {
            alert("Access Denied: You do not have administrative privileges.");
            window.location.href = "/dashboard.html";
            return null;
          }
          return {
            user: { id: member.user_id, email: member.email },
            member,
            isApproved: true,
            isOffline: true,
          };
        }
      }
    } catch (e) {
      console.warn("Failed to parse cached member in offline mode:", e);
    }
    // Do not redirect to unauthorized.html when offline
    return null;
  }

  // ONLINE HANDLING
  const session = await getCurrentSession();

  if (!session || !session.user) {
    // Not logged in -> redirect to landing
    if (!window.location.pathname.endsWith("index.html") && !window.location.pathname.endsWith("/")) {
      window.location.href = "/index.html";
    }
    return null;
  }

  const user = session.user;
  const member = (await getMemberProfile(user.id)) || (await getMemberProfile(user.email));

  const isUnauthorizedPage = window.location.pathname.endsWith("unauthorized.html");

  if (!member || (requireApproved && !member.is_approved)) {
    if (!isUnauthorizedPage) {
      window.location.href = "/unauthorized.html";
    }
    return { user, member, isApproved: false };
  }

  // Cache verified approved member record
  try {
    localStorage.setItem("mria_cached_member", JSON.stringify(member));
  } catch (e) {
    console.warn("Failed to cache member profile:", e);
  }

  // Record uneditable login event once per browser tab session
  const sessionLogKey = `mria_session_logged_${user.id}`;
  if (!sessionStorage.getItem(sessionLogKey)) {
    sessionStorage.setItem(sessionLogKey, "true");
    logAuthActivity("USER_LOGIN", member, {
      page: window.location.pathname,
      role: member?.role || "unapproved",
      login_time: new Date().toISOString(),
      user_agent: navigator.userAgent,
    });
  }

  // If approved member visited unauthorized.html, send them to dashboard
  if (isUnauthorizedPage && member.is_approved) {
    window.location.href = "/dashboard.html";
    return { user, member, isApproved: Boolean(member?.is_approved) };
  }

  // Check role authorization for protected pages (e.g. admin.html)
  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(member.role)) {
      alert("Access Denied: You do not have administrative privileges.");
      window.location.href = "/dashboard.html";
      return null;
    }
  }

  return { user, member, isApproved: Boolean(member?.is_approved) };
}

export const requireAuth = checkAuthAndWhitelist;
