import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config.js";

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
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
  await supabase.auth.signOut();
  window.location.href = "/index.html";
}

export async function getCurrentSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return null;
  return session;
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

export async function getMemberProfile(emailOrUserId) {
  // Try querying by user_id first
  let query = supabase.from("members").select("*");
  if (emailOrUserId.includes("@")) {
    query = query.eq("email", emailOrUserId);
  } else {
    query = query.eq("user_id", emailOrUserId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn("Failed to fetch member record:", error);
    return null;
  }
  return data;
}

/**
 * Validates session and whitelist approval status.
 * Redirects unapproved users to unauthorized.html and unauthorized roles away from admin.
 */
export async function requireAuth({ requireApproved = true, allowedRoles = null } = {}) {
  const session = await getCurrentSession();

  if (!session || !session.user) {
    // Not logged in -> redirect to landing
    if (!window.location.pathname.endsWith("index.html")) {
      window.location.href = "/index.html";
    }
    return null;
  }

  const user = session.user;
  const member = await getMemberProfile(user.id) || await getMemberProfile(user.email);

  // If on unauthorized.html, don't redirect in an infinite loop
  const isUnauthorizedPage = window.location.pathname.endsWith("unauthorized.html");

  if (!member || (requireApproved && !member.is_approved)) {
    if (!isUnauthorizedPage) {
      window.location.href = "/unauthorized.html";
    }
    return { user, member, isApproved: false };
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
