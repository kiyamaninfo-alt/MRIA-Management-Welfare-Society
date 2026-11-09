import { supabase } from "./auth.js";
import { CONFIG } from "./config.js";

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
 * Fetches active benefit types for member application.
 */
export async function getBenefitTypes() {
  const { data, error } = await supabase
    .from("benefit_types")
    .select("*")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    console.error("Error fetching benefit types:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches all benefit types (active & inactive) for administrative management.
 */
export async function getAllBenefitTypes() {
  const { data, error } = await supabase
    .from("benefit_types")
    .select("*")
    .order("code", { ascending: true });

  if (error) {
    console.error("Error fetching all benefit types:", error);
    return [];
  }
  return data || [];
}

/**
 * Updates a benefit type (e.g. max_amount, is_active status).
 */
export async function updateBenefitType(id, updates) {
  const { data, error } = await supabase
    .from("benefit_types")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Creates a new benefit type.
 */
export async function createBenefitType(payload) {
  const { data, error } = await supabase
    .from("benefit_types")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
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
 * Submits a welfare benefit claim and triggers async committee email notification.
 */
export async function submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes }) {
  // 1. Insert claim into DB
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

  // 2. Asynchronously notify committee members via Edge Function
  if (data && data.id) {
    try {
      const session = (await supabase.auth.getSession())?.data?.session;
      if (session?.access_token) {
        fetch(`${CONFIG.FUNCTIONS_URL}/send-claim-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ claimId: data.id }),
        }).catch((err) => {
          console.warn("[API] Asynchronous email dispatch notification failed silently:", err);
        });
      }
    } catch (e) {
      console.warn("[API] Error calling notification trigger:", e);
    }
  }

  return data;
}

/**
 * Self-registration submission for unlisted users on unauthorized page.
 */
export async function submitRegistrationRequest({ userId, email, fullName, epfNumber, designation, phone }) {
  let uid = userId;
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser();
    uid = user?.id;
  }

  const payload = {
    email: email.trim().toLowerCase(),
    full_name: fullName.trim(),
    epf_number: epfNumber.trim(),
    designation: designation.trim(),
    phone: phone && phone.trim() ? phone.trim() : "",
    role: "member",
    is_approved: false,
    is_legacy_member: false,
  };

  if (uid) {
    payload.user_id = uid;
  }

  const { data, error } = await supabase
    .from("members")
    .insert([payload])
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

/**
 * Updates a system setting.
 */
export async function updateSystemSetting(key, value, updatedBy = null) {
  const payload = {
    key,
    value,
    updated_at: new Date().toISOString(),
  };
  if (updatedBy) {
    payload.updated_by = updatedBy;
  }

  const { data, error } = await supabase
    .from("system_settings")
    .upsert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ================= ADMIN, SECRETARY & TREASURER APIS =================

/**
 * Fetches pending slip payments for treasurer/admin review.
 */
export async function getPendingPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("*, members:members!payments_member_id_fkey(full_name, email, phone, epf_number, designation)")
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
 * Fetches all members for admin & secretary management.
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
 * Updates a member's role or approval status (Admin only).
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
 * Secretary profile updates (CRUD on member demographic attributes).
 */
export async function updateMemberProfile(memberId, { fullName, epfNumber, designation, phone, nic, address }) {
  const updates = {};
  if (fullName !== undefined) updates.full_name = fullName.trim();
  if (epfNumber !== undefined) updates.epf_number = epfNumber.trim();
  if (designation !== undefined) updates.designation = designation.trim();
  if (phone !== undefined) updates.phone = phone ? phone.trim() : null;
  if (nic !== undefined) updates.nic = nic ? nic.trim() : null;
  if (address !== undefined) updates.address = address ? address.trim() : null;
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
 * Pre-registers a new member (Secretary / Admin).
 */
export async function createMember({
  email,
  fullName,
  epfNumber,
  designation,
  phone,
  nic,
  address,
  role = "member",
  isLegacy = false,
  isApproved = true,
}) {
  const { data, error } = await supabase
    .from("members")
    .insert([
      {
        email: email.trim().toLowerCase(),
        full_name: fullName.trim(),
        epf_number: epfNumber.trim(),
        designation: designation.trim(),
        phone: phone ? phone.trim() : null,
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
 * Fetches all welfare benefit claims for committee review.
 */
export async function getAllBenefitClaims() {
  const { data, error } = await supabase
    .from("benefit_claims")
    .select("*, members(full_name, email, epf_number, designation, phone), benefit_types(title_en, title_si)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching all benefit claims:", error);
    return [];
  }
  return data || [];
}

/**
 * Reviews (approves/rejects) a benefit claim.
 */
export async function reviewBenefitClaim(claimId, status, reviewerMemberId, notes = null) {
  const updates = {
    status,
    approved_by: reviewerMemberId,
    notes,
  };
  const { data, error } = await supabase
    .from("benefit_claims")
    .update(updates)
    .eq("id", claimId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Disburses a benefit claim (automatically records outflow in Treasury via trigger).
 */
export async function disburseBenefitClaim({ claimId, disbursedAmount, disbursedByMemberId, notes = null }) {
  const { data, error } = await supabase
    .from("benefit_claims")
    .update({
      status: "disbursed",
      disbursed_amount: Number(disbursedAmount),
      disbursed_by: disbursedByMemberId,
      disbursed_at: new Date().toISOString(),
      notes,
    })
    .eq("id", claimId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ================= SOCIETY TREASURY APIS =================

/**
 * Fetches current running balances across the 3 segregated asset accounts.
 */
export async function getTreasuryBalances() {
  const { data, error } = await supabase
    .from("treasury_account_balances")
    .select("*")
    .order("account_id", { ascending: true });

  if (error) {
    console.error("Error fetching treasury balances:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches recent treasury transactions ledger.
 */
export async function getTreasuryTransactions(limit = 100) {
  const { data, error } = await supabase
    .from("treasury_transactions")
    .select("*, members:recorded_by(full_name, email)")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching treasury transactions:", error);
    return [];
  }
  return data || [];
}

/**
 * Records an internal treasury transaction (inflow, outflow, or transfer).
 */
export async function recordTreasuryTransaction({
  transactionType, // 'inflow' | 'outflow' | 'transfer'
  sourceAccountId = null,
  destinationAccountId = null,
  accountId = null,
  amount,
  description,
  referenceNo = null,
  transactionDate = null,
  recordedByMemberId = null,
  performedByMemberId = null,
}) {
  let src = sourceAccountId;
  let dst = destinationAccountId;

  if (transactionType === "inflow") {
    dst = dst || accountId || "boc_savings";
    src = null;
  } else if (transactionType === "outflow") {
    src = src || accountId || "boc_savings";
    dst = null;
  } else if (transactionType === "transfer") {
    if (!src || !dst) {
      throw new Error("Transfer requires both source and destination accounts.");
    }
    if (src === dst) {
      throw new Error("Source and destination accounts must be different.");
    }
  }

  const dateVal = transactionDate ? transactionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const ref = referenceNo || `TX-${Date.now().toString().slice(-8)}`;
  const recorder = recordedByMemberId || performedByMemberId;

  if (!recorder) {
    throw new Error("Staff member ID is required to record transaction.");
  }

  const payload = {
    transaction_date: dateVal,
    transaction_type: transactionType,
    source_account_id: src,
    destination_account_id: dst,
    amount: Number(amount),
    reference_no: ref,
    description: (description || "Internal Treasury Transaction").trim(),
    recorded_by: recorder,
  };

  const { data, error } = await supabase
    .from("treasury_transactions")
    .insert([payload])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Calls PostgreSQL RPC to compute Opening, Period, and Closing Balances for statements.
 */
export async function getTreasuryStatement(startDate, endDate) {
  const { data, error } = await supabase.rpc("get_treasury_statement", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) throw error;
  return data;
}

/**
 * Fetches defaulters roster post-31st.
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
 * Fetches immutable audit logs (Admin only).
 */
export async function getAuditLogs(limit = 100) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching audit logs:", error);
    return [];
  }
  return data || [];
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
