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

export async function signOut() {
  try {
    localStorage.removeItem("mria_cached_member");
  } catch (e) {
    console.warn("Could not clear cached member:", e);
  }
  await supabase.auth.signOut();
  window.location.href = "/index.html";
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

  // If approved member visited unauthorized.html, send them to dashboard
  if (isUnauthorizedPage && member.is_approved) {
    window.location.href = "/dashboard.html";
    return { user, member, isApproved: true };
  }

  // Check role authorization for protected pages (e.g. admin.html)
  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(member.role)) {
      alert("Access Denied: You do not have administrative privileges.");
      window.location.href = "/dashboard.html";
      return null;
    }
  }

  return { user, member, isApproved: true };
}

export const requireAuth = checkAuthAndWhitelist;
