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
  if (!member) {
    return {
      totalPending: 0,
      priorArrears: 0,
      advanceBalance: 0,
      netStanding: 0,
      pendingDues: [],
      admissionFeeDue: 0,
      ytdContributions: 0,
      ytdPaid: 0,
      totalPaid: 0,
      totalDuesPaid: 0,
      cumulativePaid: 0,
      lastPaymentDate: null,
      isArrears: false,
      isAdvance: false,
      isSettled: true,
    };
  }

  const dues = await getMemberDues(member.id);
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  // 1. Month-End Cutoff Rule:
  // Arrears strictly prior to current month (< currentMonthStr)
  const priorPendingDues = dues.filter(
    (d) => d.status === "pending" && d.billing_month < currentMonthStr
  );
  const currentMonthDue = dues.find(
    (d) => d.status === "pending" && d.billing_month === currentMonthStr
  );

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
      const setting = await getSystemSetting("admission_fee_amount");
      admissionFeeDue = setting?.amount != null ? Number(setting.amount) : 500.00;
    }
  }

  // 2. Fetch all verified payments for this member
  const { data: verifiedPayments, error: paymentsErr } = await supabase
    .from("payments")
    .select("amount, payment_type, created_at, verified_at")
    .eq("member_id", member.id)
    .eq("status", "verified")
    .order("created_at", { ascending: false });

  if (paymentsErr) {
    console.error("Error fetching verified payments in calculateMemberBalance:", paymentsErr);
  }

  const paymentsList = verifiedPayments || [];

  // YTD contributions in the current calendar year
  const currentYear = now.getFullYear();
  const ytdContributions = paymentsList
    .filter((p) => {
      const d = new Date(p.verified_at || p.created_at);
      return d.getFullYear() === currentYear;
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Cumulative dues payments vs total billed dues up to current month
  const totalDuesPaid = paymentsList
    .filter((p) => p.payment_type === "monthly_due")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalVerifiedPaid = paymentsList.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const duesSetting = await getSystemSetting("monthly_due_amount");
  const monthlyRate = duesSetting?.amount != null ? Number(duesSetting.amount) : 300.00;

  const totalBilledUpToNow = dues.filter((d) => d.billing_month <= currentMonthStr).length * monthlyRate;
  const advanceBalance = Math.max(0, totalDuesPaid - totalBilledUpToNow);

  const priorArrears = priorPendingDues.reduce((sum, d) => sum + Number(d.amount), 0) + admissionFeeDue;
  const netStanding = advanceBalance > 0 ? advanceBalance : -priorArrears;

  return {
    totalPending: priorArrears + (currentMonthDue ? Number(currentMonthDue.amount) : 0),
    priorArrears,
    advanceBalance,
    admissionFeeDue,
    ytdContributions,
    ytdPaid: ytdContributions,
    totalPaid: totalVerifiedPaid,
    totalDuesPaid,
    cumulativePaid: totalDuesPaid,
    lastPaymentDate: paymentsList.length > 0 ? (paymentsList[0].verified_at || paymentsList[0].created_at) : null,
    pendingDues: dues.filter((d) => d.status === "pending"),
    netStanding,
    isArrears: netStanding < 0,
    isAdvance: netStanding > 0,
    isSettled: netStanding === 0,
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
 * Deletes a benefit type if no claims reference it.
 */
export async function deleteBenefitType(id) {
  // 1. Check if any benefit claims reference this program
  const { count, error: countErr } = await supabase
    .from("benefit_claims")
    .select("id", { count: "exact", head: true })
    .eq("benefit_type_id", id);

  if (!countErr && count && count > 0) {
    throw new Error(
      `Cannot permanently delete this benefit program because ${count} member claim(s) reference it. Please deactivate/pause the facility instead.`
    );
  }

  // 2. Perform deletion
  const { error } = await supabase
    .from("benefit_types")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "Cannot delete this program because existing claims reference it. Please pause/deactivate it instead."
      );
    }
    throw error;
  }
  return true;
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
export async function submitBenefitClaim({ memberId, benefitTypeId, claimAmount, notes, documentKey = null }) {
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
        document_key: documentKey,
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
 * Logs a direct cash payment by Treasurer or Admin (immediately verified) with token idempotency.
 * Atomic RPC guarantees duplicate submission prevention, safe voucher replay, and email protection.
 */
export async function recordCashPayment({
  memberId,
  amount,
  paymentType = "monthly_due",
  paymentMethod = "cash",
  collectedByMemberId,
  notes = null,
  paidAt = null,
  idempotencyKey = null,
}) {
  const transactionDate = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
  const token = idempotencyKey || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null);

  const { data, error } = await supabase.rpc("record_cash_payment_idempotent", {
    p_member_id: memberId,
    p_amount: Number(amount),
    p_payment_type: paymentType,
    p_payment_method: paymentMethod || "cash",
    p_collected_by: collectedByMemberId,
    p_notes: notes,
    p_paid_at: transactionDate,
    p_idempotency_key: token,
  });

  if (error) throw error;
  
  // RPC returns { payment: {...}, is_replayed: boolean }
  return {
    ...data.payment,
    is_replayed: Boolean(data.is_replayed),
  };
}

/**
 * Automatically dispatches official digital payment voucher to member's registered email.
 */
export async function sendReceiptEmail({
  paymentId,
  claimId,
  isGrant = false,
  recipientEmail,
  recipientName,
  recipientEpf,
  receiptNumber,
  amount,
  paymentType,
  paymentMethod = "cash",
  paidAt,
  notes,
  collectedByName,
}) {
  if (!recipientEmail) {
    return { success: false, noEmail: true, message: "No registered email address found." };
  }

  try {
    const session = (await supabase.auth.getSession())?.data?.session;
    const response = await fetch(`${CONFIG.FUNCTIONS_URL}/send-receipt-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        paymentId,
        claimId,
        isGrant,
        voucherType: isGrant ? "grant" : "receipt",
        recipientEmail,
        recipientName,
        recipientEpf,
        receiptNumber,
        amount,
        paymentType,
        paymentMethod,
        paidAt,
        notes,
        collectedByName,
      }),
    });

    const result = await response.json().catch(() => ({ success: true, simulated: true }));
    return result;
  } catch (err) {
    console.warn("[API] Asynchronous receipt email dispatch notice:", err);
    return { success: false, error: err.message };
  }
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
    .select("*, members:members!benefit_claims_member_id_fkey(full_name, email, epf_number, designation, phone), benefit_types(title_en, title_si)")
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

/**
 * Safely undoes a welfare benefit claim disbursement within the 30-day window.
 * Reverts the claim status to 'approved', clears disbursement fields, records
 * a compensating Treasury inflow reversal, and logs an immutable audit entry.
 */
export async function undoClaimDisbursement(claimId, reason, undoneByMemberId) {
  const { data, error } = await supabase.rpc("undo_claim_disbursement", {
    p_claim_id: claimId,
    p_reason: reason,
    p_undone_by: undoneByMemberId,
  });

  if (error) {
    console.error("Error undoing claim disbursement:", error);
    throw error;
  }
  return data;
}

/**
 * Records a direct welfare benefit grant disbursement.
 * If claimId is provided, updates that existing claim to 'disbursed'.
 * If claimId is not provided, inserts a new claim record with status = 'disbursed'.
 * Also synchronizes the treasury transaction outflow to the specified source account.
 */
export async function recordDirectBenefitGrant({
  claimId = null,
  memberId,
  benefitTypeId,
  amount,
  paymentMethod = "cash",
  disbursedByMemberId,
  disbursedAt = null,
  notes = null,
}) {
  const formattedDisbursedAt = disbursedAt || new Date().toISOString();
  let claim;

  if (claimId) {
    const { data, error } = await supabase
      .from("benefit_claims")
      .update({
        status: "disbursed",
        disbursed_amount: Number(amount),
        payment_method: paymentMethod || "cash",
        disbursed_by: disbursedByMemberId,
        disbursed_at: formattedDisbursedAt,
        notes,
      })
      .eq("id", claimId)
      .select("*, members:members!benefit_claims_member_id_fkey(id, full_name, epf_number, email, designation), benefit_types(id, code, title_en, title_si, max_amount)")
      .single();

    if (error) throw error;
    claim = data;
  } else {
    const { data, error } = await supabase
      .from("benefit_claims")
      .insert([
        {
          member_id: memberId,
          benefit_type_id: benefitTypeId,
          claim_amount: Number(amount),
          disbursed_amount: Number(amount),
          payment_method: paymentMethod || "cash",
          status: "disbursed",
          approved_by: disbursedByMemberId,
          disbursed_by: disbursedByMemberId,
          disbursed_at: formattedDisbursedAt,
          notes,
        },
      ])
      .select("*, members:members!benefit_claims_member_id_fkey(id, full_name, epf_number, email, designation), benefit_types(id, code, title_en, title_si, max_amount)")
      .single();

    if (error) throw error;
    claim = data;
  }

  // Ensure treasury transaction source account, description, and transaction date match
  if (claim?.id) {
    try {
      const sourceAccountId = paymentMethod === "cash" ? "cash_in_hand" : "boc_savings";
      const methodLabel = paymentMethod === "cash" ? "Direct Cash Float" : paymentMethod === "qr_payment" ? "LankaQR Scan" : "Bank Transfer";
      const txUpdates = {
        source_account_id: sourceAccountId,
        description: `Disbursed Welfare Aid Grant (${methodLabel})`,
      };
      if (formattedDisbursedAt) {
        txUpdates.transaction_date = formattedDisbursedAt.split("T")[0];
      }
      await supabase
        .from("treasury_transactions")
        .update(txUpdates)
        .eq("claim_id", claim.id);
    } catch (txErr) {
      console.warn("Notice updating treasury transaction source account:", txErr);
    }
  }

  return claim;
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
 * Fetches paginated Cash Book transactions with IN, OUT, and running balance.
 */
export async function getCashBookTransactions({ limit = 10, offset = 0, accountId = null } = {}) {
  const { data, error } = await supabase.rpc("get_cash_book_transactions", {
    p_limit: limit,
    p_offset: offset,
    p_account_id: accountId || null,
  });

  if (error) {
    console.error("Error fetching cash book transactions:", error);
    throw error;
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
 * Records an immutable audit log entry via database RPC.
 * Uneditable and tamper-proof; cannot be modified or deleted.
 */
export async function logUserActivity({
  action,
  entityType = "USER_EVENT",
  entityId = "",
  details = {},
  actorEmail = null,
  actorName = null,
  epfNumber = null,
}) {
  try {
    const { data, error } = await supabase.rpc("log_user_activity", {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: String(entityId || ""),
      p_details: details,
      p_actor_email: actorEmail,
      p_actor_name: actorName,
      p_epf_number: epfNumber,
    });

    if (error) {
      console.warn("Audit logging notice:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("Audit logging non-fatal exception:", err);
    return null;
  }
}

/**
 * Fetches immutable audit logs (first 25 items by default, loaded on demand).
 */
export async function getAuditLogs(limit = 25) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("Retrying audit logs fetch with created_at fallback:", error.message);
    const fallback = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!fallback.error) return fallback.data || [];
    console.error("Error fetching audit logs:", error);
    return [];
  }
  return data || [];
}

/**
 * Fetches verified payment receipts with pagination and joined member & staff details.
 */
export async function getPaymentReceipts({
  limit = 25,
  offset = 0,
  status = "verified",
  category = "all",
  paymentMethod = "all",
} = {}) {
  let query = supabase
    .from("payments")
    .select(
      "*, members:members!payments_member_id_fkey(id, full_name, email, phone, epf_number, designation), verified_by_staff:members!payments_verified_by_fkey(id, full_name, epf_number)",
      { count: "exact" }
    );

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (category && category !== "all") {
    query = query.eq("payment_type", category);
  }

  if (paymentMethod && paymentMethod !== "all") {
    query = query.eq("payment_method", paymentMethod);
  }

  query = query.order("created_at", { ascending: false });

  if (limit) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, count, error } = await query;
  if (error) {
    console.error("Error fetching payment receipts:", error);
    throw error;
  }

  return { receipts: data || [], totalCount: count || 0 };
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

/**
 * Voids a verified payment receipt and records a compensating ledger outflow.
 */
export async function voidPaymentReceipt(paymentId, reason, voidedBy) {
  const { data, error } = await supabase.rpc("void_payment_receipt", {
    p_payment_id: paymentId,
    p_reason: reason,
    p_voided_by: voidedBy,
  });

  if (error) {
    console.error("Error voiding payment receipt:", error);
    throw error;
  }
  return data;
}

/**
 * Dual-mode member deletion or soft archival based on transaction history.
 */
export async function deleteOrArchiveMember(memberId, adminId, reason = "Administrative clean up") {
  const { data, error } = await supabase.rpc("delete_or_archive_member", {
    p_member_id: memberId,
    p_admin_id: adminId,
    p_reason: reason,
  });

  if (error) {
    console.error("Error deleting or archiving member:", error);
    throw error;
  }
  return data;
}

/**
 * Fetches 1-to-1 notifications for a given member.
 */
export async function getNotifications(memberId) {
  if (!memberId) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Notice loading notifications:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Marks a notification as read.
 */
export async function markNotificationAsRead(notificationId) {
  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Sends a 1-to-1 notification to a member (Admin/Staff).
 */
export async function sendNotification({ recipientId, titleEn, titleSi, messageEn, messageSi, priority = "normal" }) {
  const { data, error } = await supabase
    .from("notifications")
    .insert([
      {
        recipient_id: recipientId,
        title_en: titleEn,
        title_si: titleSi,
        message_en: messageEn,
        message_si: messageSi,
        priority,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Sends notifications to multiple members in a single batch insert.
 */
export async function sendBatchNotifications(notificationsArray) {
  if (!notificationsArray || notificationsArray.length === 0) return [];
  const { data, error } = await supabase
    .from("notifications")
    .insert(notificationsArray)
    .select();

  if (error) throw error;
  return data || [];
}

/**
 * Submits an in-app inquiry to the administration.
 */
export async function submitInquiry({ senderId = null, senderName, senderEmail, senderPhone = null, senderEpf = null, subject, message }) {
  const { data, error } = await supabase
    .from("admin_inquiries")
    .insert([
      {
        sender_id: senderId,
        sender_name: senderName,
        sender_email: senderEmail,
        sender_phone: senderPhone,
        sender_epf: senderEpf,
        subject,
        message,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetches all admin inquiries for administrative triage.
 */
export async function getAdminInquiries() {
  const { data, error } = await supabase
    .from("admin_inquiries")
    .select("*, members:members!admin_inquiries_sender_id_fkey(full_name, epf_number, email, phone)")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Notice loading admin inquiries with join:", error.message);
    const fallback = await supabase
      .from("admin_inquiries")
      .select("*")
      .order("created_at", { ascending: false });
    return fallback.data || [];
  }
  return data || [];
}

/**
 * Resolves an admin inquiry.
 */
export async function resolveAdminInquiry(inquiryId, notes, resolvedBy) {
  const { data, error } = await supabase
    .from("admin_inquiries")
    .update({
      status: "resolved",
      resolution_notes: notes,
      resolved_by: resolvedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inquiryId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
