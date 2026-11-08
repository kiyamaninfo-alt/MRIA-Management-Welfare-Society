import { supabase } from "./auth.js";

// ================= MEMBER DASHBOARD APIS =================

/**
 * Fetches dues for a given member.
 */
export async function getMemberDues(memberId) {
  const { data, error } = await supabase
    .from("member_dues")
    .select("*")
    .eq("member_id", memberId)
    .order("billing_month", { ascending: false });

  if (error) {
    console.error("Error fetching dues:", error);
    return [];
  }
  return data || [];
}

/**
 * Calculates total pending balance for a member.
 */
export async function calculateMemberBalance(member) {
  if (!member) return { totalPending: 0, pendingDues: [], admissionFeeDue: 0 };

  const dues = await getMemberDues(member.id);
  const pendingDues = dues.filter((d) => d.status === "pending");
  const duesTotal = pendingDues.reduce((sum, d) => sum + Number(d.amount), 0);

  let admissionFeeDue = 0;
  if (!member.is_legacy_member) {
    // Check if admission fee has already been paid
    const { data: admissionPayment } = await supabase
      .from("payments")
      .select("id, status")
      .eq("member_id", member.id)
      .eq("payment_type", "admission_fee")
      .eq("status", "verified")
      .maybeSingle();

    if (!admissionPayment) {
      admissionFeeDue = 1000.00;
    }
  }

  return {
    totalPending: duesTotal + admissionFeeDue,
    pendingDues,
    admissionFeeDue,
  };
}

/**
 * Fetches payment history for a given member.
 */
export async function getMemberPayments(memberId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching payments:", error);
    return [];
  }
  return data || [];
}

/**
 * Submits a new payment record (e.g., after bank slip upload).
 */
export async function submitPayment({
  memberId,
  amount,
  paymentType,
  paymentMethod = "bank_transfer",
  slipKey = null,
  notes = null,
}) {
  const { data, error } = await supabase
    .from("payments")
    .insert([
      {
        member_id: memberId,
        amount: Number(amount),
        payment_type: paymentType,
        payment_method: paymentMethod,
        slip_key: slipKey,
        status: "pending_approval",
        notes,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetches active benefit types.
 */
export async function getBenefitTypes() {
  const { data, error } = await supabase
    .from("benefit_types")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("Error fetching benefit types:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches claims made by a member.
 */
export async function getMemberClaims(memberId) {
  const { data, error } = await supabase
    .from("benefit_claims")
    .select("*, benefit_types(title_en, title_si)")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching member claims:", error);
    return [];
  }
  return data || [];
}

/**
 * Submits a welfare benefit claim.
 */
export async function submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes }) {
  const { data, error } = await supabase
    .from("benefit_claims")
    .insert([
      {
        member_id: memberId,
        benefit_type_id: benefitTypeId,
        claim_amount: Number(claimAmount),
        status: "submitted",
        notes,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetches announcements for the notice board.
 */
export async function getAnnouncements() {
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching announcements:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches system settings by key.
 */
export async function getSystemSetting(key) {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;
  return data.value;
}

// ================= ADMIN & TREASURER APIS =================

/**
 * Fetches pending slip payments for treasurer/admin review.
 */
export async function getPendingPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("*, members:members!payments_member_id_fkey(full_name, email, phone)")
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching pending payments:", error);
    return [];
  }
  return data || [];
}

/**
 * Approves a payment slip (triggers FIFO dues settlement in PostgreSQL).
 */
export async function verifyPayment(paymentId, verifierMemberId) {
  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "verified",
      verified_by: verifierMemberId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Rejects a payment slip.
 */
export async function rejectPayment(paymentId, verifierMemberId, reason) {
  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "rejected",
      verified_by: verifierMemberId,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", paymentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Logs a direct cash payment by Treasurer or Admin (immediately verified).
 */
export async function recordCashPayment({
  memberId,
  amount,
  paymentType = "monthly_due",
  collectedByMemberId,
  notes = null,
  paidAt = null,
}) {
  const transactionDate = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
  const { data, error } = await supabase
    .from("payments")
    .insert([
      {
        member_id: memberId,
        amount: Number(amount),
        payment_type: paymentType,
        payment_method: "cash",
        status: "verified",
        verified_by: collectedByMemberId,
        verified_at: transactionDate,
        created_at: transactionDate,
        notes,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetches the defaulters roster post-31st.
 */
export async function getDefaultersRoster() {
  const { data, error } = await supabase
    .from("defaulters_roster")
    .select("*")
    .order("billing_month", { ascending: true });

  if (error) {
    console.error("Error fetching defaulters:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches all members for admin onboarding & role management.
 */
export async function getAllMembers() {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching all members:", error);
    return [];
  }
  return data || [];
}

/**
 * Updates a member's role or approved status.
 */
export async function updateMemberRole(memberId, role, isApproved, isLegacyMember) {
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (isApproved !== undefined) updates.is_approved = isApproved;
  if (isLegacyMember !== undefined) updates.is_legacy_member = isLegacyMember;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("members")
    .update(updates)
    .eq("id", memberId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Pre-registers a new member.
 */
export async function createMember({
  email,
  fullName,
  phone,
  nic,
  address,
  role = "member",
  isLegacy = false,
  isApproved = false,
}) {
  const { data, error } = await supabase
    .from("members")
    .insert([
      {
        email: email.trim().toLowerCase(),
        full_name: fullName.trim(),
        phone: phone.trim(),
        nic: nic ? nic.trim() : null,
        address: address ? address.trim() : null,
        role,
        is_legacy_member: isLegacy,
        is_approved: isApproved,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Publishes a new announcement.
 */
export async function publishAnnouncement({
  titleEn,
  titleSi,
  contentEn,
  contentSi,
  priority = "normal",
  isPinned = false,
  createdByMemberId,
}) {
  const { data, error } = await supabase
    .from("announcements")
    .insert([
      {
        title_en: titleEn,
        title_si: titleSi,
        content_en: contentEn,
        content_si: contentSi,
        priority,
        is_pinned: isPinned,
        created_by: createdByMemberId,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}
