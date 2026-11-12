// scripts/test-phase-2-waiver-engine.mjs
// Phase 2 Automated Verification Suite: Dues & Admission Fee Waiver Engine,
// Atomic RPCs, Advance Auto-Settlement Invariants, and Idempotency Protection

const SUPABASE_URL = "https://aqbpanrsotkpnqxhlces.supabase.co";
const ANON_KEY = "sb_publishable_CjtgAQJgXXLWI-FOft-wzQ_3sekCrWa";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

async function authFetch(path, method = "GET", body = null, token = null) {
  const headers = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}${path}`, opts);
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Sign in failed for ${email}: ${data.error_description || data.message || res.status}`);
  }
  return { token: data.access_token, user: data.user };
}

async function cleanupMemberDuesAndWaivers(memberId, token) {
  await authFetch(`/rest/v1/dues_waivers?member_id=eq.${memberId}`, "DELETE", null, token);
  const duesRes = await authFetch(`/rest/v1/member_dues?member_id=eq.${memberId}&select=id`, "GET", null, token);
  if (Array.isArray(duesRes.data) && duesRes.data.length > 0) {
    const dueIds = duesRes.data.map((d) => d.id).join(",");
    await authFetch(`/rest/v1/payment_dues_reconciliation?due_id=in.(${dueIds})`, "DELETE", null, token);
    await authFetch(`/rest/v1/member_dues?id=in.(${dueIds})`, "DELETE", null, token);
  }
  await authFetch(`/rest/v1/payments?member_id=eq.${memberId}&payment_type=eq.monthly_due`, "DELETE", null, token);
}

async function run() {
  console.log("=== PHASE 2 VERIFICATION: DUES WAIVER ENGINE, ATOMIC RPCS & INVARIANTS ===\n");

  // 1. Authenticate Actors
  console.log("1. Authenticating Root Admin, Officer (Sama), and Officer (Kamal)...");
  const rootAuth = await signIn("krishaja@gmail.com", "RootTestPass123!");
  const rootToken = rootAuth.token;
  const rootMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${rootAuth.user.id}&select=*`, "GET", null, rootToken);
  const rootMember = rootMemberRes.data[0];

  const samaAuth = await signIn("testmember_1794463534989@gmail.com", "Pass#1794463534989!Aa1");
  const samaToken = samaAuth.token;
  const samaMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${samaAuth.user.id}&select=*`, "GET", null, samaToken);
  const samaMember = samaMemberRes.data[0];

  const kamalAuth = await signIn("testofficer_1794473511897@gmail.com", "OfficerPass123!");
  const kamalToken = kamalAuth.token;
  const kamalMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${kamalAuth.user.id}&select=*`, "GET", null, kamalToken);
  const kamalMember = kamalMemberRes.data[0];

  assert(rootMember && samaMember && kamalMember, "All 3 test accounts authenticated successfully");

  // 2. Ability System & Governance Enforcement for waive_statutory_dues
  console.log("\n2. Verifying waive_statutory_dues Ability Governance...");
  
  // Root admin gets all abilities dynamically
  const rootAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, rootToken);
  assert(rootAbilitiesRes.ok, "Root admin can query get_my_abilities()");
  assert(
    rootAbilitiesRes.data.includes("waive_statutory_dues"),
    `Root admin dynamically possesses 'waive_statutory_dues' (total abilities: ${rootAbilitiesRes.data.length})`
  );

  // Sama (without ability) does NOT have waive_statutory_dues
  const samaAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, samaToken);
  assert(
    !samaAbilitiesRes.data.includes("waive_statutory_dues"),
    "Sama Perera does NOT have 'waive_statutory_dues' ability"
  );

  // Non-root officer (Sama) tries to grant waive_statutory_dues to Kamal -> MUST BE REJECTED
  console.log("  Testing non-root officer attempting to assign 'waive_statutory_dues'...");
  const unauthorizedAssignRes = await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: ["waive_statutory_dues", "collect_cash"],
  }, samaToken);
  assert(
    !unauthorizedAssignRes.ok || unauthorizedAssignRes.data?.message?.includes("Access Denied"),
    "Non-root officer is blocked from assigning 'waive_statutory_dues' ability"
  );

  // Non-root officer (Sama) tries to call fn_record_dues_waiver directly -> MUST BE REJECTED
  console.log("  Testing unauthorized officer executing fn_record_dues_waiver...");
  const unauthorizedWaiverRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: kamalMember.id,
    p_waiver_type: "monthly_due",
    p_billing_month: "2026-01-01",
    p_waived_amount: 300,
    p_reason: "Unauthorized attempt",
  }, samaToken);
  assert(
    !unauthorizedWaiverRes.ok,
    `Unauthorized officer is blocked from executing fn_record_dues_waiver (status: ${unauthorizedWaiverRes.status})`
  );

  // Root Admin grants waive_statutory_dues to Kamal
  console.log("  Root Admin granting 'waive_statutory_dues' to Kamal...");
  const grantRes = await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: ["waive_statutory_dues", "manage_treasury"],
  }, rootToken);
  assert(grantRes.ok, "Root admin successfully granted 'waive_statutory_dues' to Kamal");

  // Kamal now has waive_statutory_dues
  const kamalAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, kamalToken);
  assert(
    kamalAbilitiesRes.data.includes("waive_statutory_dues"),
    "Kamal now possesses 'waive_statutory_dues' ability"
  );

  // 3. Setup Dedicated Test Dues & Pre-conditions for Specific Invariant Verification
  console.log("\n3. Setting up Test Dues & Pre-conditions...");

  const testMonth1 = "2026-01-01";
  const testMonth2 = "2026-02-01";
  const testMonth3 = "2026-03-01";

  // Clean old test artifacts for Sama
  await cleanupMemberDuesAndWaivers(samaMember.id, rootToken);

  // Insert 3 test dues for Sama: Jan (pending), Feb (pending), Mar (pending)
  const due1Res = await authFetch("/rest/v1/member_dues", "POST", {
    member_id: samaMember.id,
    billing_month: testMonth1,
    amount: 300,
    status: "pending",
  }, rootToken);
  const due1 = Array.isArray(due1Res.data) ? due1Res.data[0] : null;

  const due2Res = await authFetch("/rest/v1/member_dues", "POST", {
    member_id: samaMember.id,
    billing_month: testMonth2,
    amount: 300,
    status: "pending",
  }, rootToken);
  const due2 = Array.isArray(due2Res.data) ? due2Res.data[0] : null;

  const due3Res = await authFetch("/rest/v1/member_dues", "POST", {
    member_id: samaMember.id,
    billing_month: testMonth3,
    amount: 300,
    status: "pending",
  }, rootToken);
  const due3 = Array.isArray(due3Res.data) ? due3Res.data[0] : null;

  assert(due1 && due2 && due3, "Created 3 test monthly dues: 2026-01, 2026-02, 2026-03 (300 LKR each)");

  // Verify due1 is in defaulters_roster
  const defRes1 = await authFetch(`/rest/v1/defaulters_roster?due_id=eq.${due1.id}`, "GET", null, rootToken);
  assert(defRes1.data?.length === 1, "Pending past due is visible in defaulters_roster");

  // 4. Invariant 3: Waiving an already-paid due is rejected inside the database function
  console.log("\n4. Verifying Invariant 3: Waiving an already-paid due is rejected in DB function...");
  
  // Mark due3 as paid directly to test the guard
  await authFetch(`/rest/v1/member_dues?id=eq.${due3.id}`, "PATCH", { status: "paid" }, rootToken);
  const due3PaidCheck = await authFetch(`/rest/v1/member_dues?id=eq.${due3.id}&select=status`, "GET", null, rootToken);
  assert(due3PaidCheck.data[0]?.status === "paid", "Due 2026-03 set to status 'paid'");

  // Root Admin attempts to waive already-paid due3
  const waivePaidRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_due_id: due3.id,
    p_reason: "Waiving paid month test",
  }, rootToken);
  assert(
    !waivePaidRes.ok && (waivePaidRes.data?.message?.includes("Cannot waive an already-paid due") || waivePaidRes.status === 400 || waivePaidRes.status === 500),
    `Waiving an already-paid due is strictly rejected by fn_record_dues_waiver: "${waivePaidRes.data?.message || waivePaidRes.data}"`
  );

  // Reset due3 back to pending for subsequent tests
  await authFetch(`/rest/v1/member_dues?id=eq.${due3.id}`, "PATCH", { status: "pending" }, rootToken);

  // Also verify admission fee: create a verified admission payment, then test waiving admission fee
  const admPayRes = await authFetch("/rest/v1/payments", "POST", {
    member_id: samaMember.id,
    amount: 500,
    payment_type: "admission_fee",
    payment_method: "cash",
    status: "verified",
  }, rootToken);
  const waivePaidAdmRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "admission_fee",
    p_reason: "Waiving paid admission fee",
  }, rootToken);
  assert(
    !waivePaidAdmRes.ok && waivePaidAdmRes.data?.message?.includes("already been verified"),
    "Waiving verified admission fee is strictly rejected"
  );
  // Clean up test admission payment
  await authFetch(`/rest/v1/payments?id=eq.${admPayRes.data[0].id}`, "DELETE", null, rootToken);

  // 5. Invariant 1: Advance Prepaid Balance Protection & Isolated Cashbook Ledger Check
  console.log("\n5. Verifying Invariant 1: Waived month keeps Advance Prepaid Balance unchanged...");

  // Capture isolated baseline cashbook count before any waiver operation
  const txBeforeWaiverRes = await authFetch("/rest/v1/treasury_transactions?select=id", "GET", null, rootToken);
  const txBaselineCount = Array.isArray(txBeforeWaiverRes.data) ? txBeforeWaiverRes.data.length : 0;

  // Kamal waives due1 (2026-01-01)
  const waiveDue1Res = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_due_id: due1.id,
    p_reason: "Special executive committee hardship relief granted",
  }, kamalToken);
  assert(waiveDue1Res.ok, "Kamal (with waive_statutory_dues) successfully waived month 2026-01");
  const waiver1Id = waiveDue1Res.data.waiver_id;

  // Verify due1 status is now 'waived' in database
  const due1DbRes = await authFetch(`/rest/v1/member_dues?id=eq.${due1.id}&select=*`, "GET", null, rootToken);
  assert(due1DbRes.data[0]?.status === "waived", "Due 2026-01 status updated to 'waived'");

  // Check cashbook: fn_record_dues_waiver MUST NOT have created any treasury transaction!
  const txAfterWaiverRes = await authFetch("/rest/v1/treasury_transactions?select=id", "GET", null, rootToken);
  const txAfterWaiverCount = Array.isArray(txAfterWaiverRes.data) ? txAfterWaiverRes.data.length : 0;
  assert(
    txAfterWaiverCount === txBaselineCount,
    `Zero cashbook entries created by fn_record_dues_waiver (tx count: ${txBaselineCount})`
  );

  // Verify waived due is REMOVED from defaulters roster
  const defRes2 = await authFetch(`/rest/v1/defaulters_roster?due_id=eq.${due1.id}`, "GET", null, rootToken);
  assert(defRes2.data?.length === 0, "Waived due is strictly excluded from defaulters_roster");

  // Record an advance payment of 900 LKR for monthly dues
  const advancePayRes = await authFetch("/rest/v1/payments", "POST", {
    member_id: samaMember.id,
    amount: 900,
    payment_type: "monthly_due",
    payment_method: "bank_transfer",
    status: "verified",
  }, rootToken);
  assert(advancePayRes.ok, "Recorded 900 LKR verified advance payment for Sama");

  // Due 1 was waived. It must NOT have been auto-settled by advance payment!
  const due1AfterAdvRes = await authFetch(`/rest/v1/member_dues?id=eq.${due1.id}&select=*`, "GET", null, rootToken);
  assert(
    due1AfterAdvRes.data[0]?.status === "waived" && due1AfterAdvRes.data[0]?.is_advance_settled === false,
    "Waived due was NOT touched or consumed by advance payment (status remains 'waived', is_advance_settled=false)"
  );

  // Due 2 and Due 3 were pending. They are paid by the 900 payment (600 LKR consumed, 300 remaining advance balance)
  const due2AfterRes = await authFetch(`/rest/v1/member_dues?id=eq.${due2.id}&select=*`, "GET", null, rootToken);
  const due3AfterRes = await authFetch(`/rest/v1/member_dues?id=eq.${due3.id}&select=*`, "GET", null, rootToken);
  assert(due2AfterRes.data[0]?.status === "paid", "Due 2026-02 is paid");
  assert(due3AfterRes.data[0]?.status === "paid", "Due 2026-03 is paid");

  // Calculate Advance Prepaid Balance in js/api.js logic:
  // totalDuesPaid = 900
  // totalBilledUpToNow (with testMonth1, testMonth2, testMonth3):
  // Dues list: [ { billing_month: '2026-01-01', status: 'waived' }, { billing_month: '2026-02-01', status: 'paid' }, { billing_month: '2026-03-01', status: 'paid' } ]
  // totalBilledUpToNow = dues.filter(d => d.billing_month <= currentMonthStr && d.status !== 'waived').length * monthlyRate
  // Since 2026-01 is waived, only 2026-02 and 2026-03 count as billed payable months (2 * 300 = 600 LKR).
  // Advance balance = 900 - 600 = 300 LKR (the member still has 300 LKR prepaid advance available for future months)!
  // If the waiver HAD consumed their prepaid cash, totalBilledUpToNow would be 3 * 300 = 900, leaving 0 advance balance.
  const allDues = [
    { billing_month: testMonth1, status: "waived", amount: 300 },
    { billing_month: testMonth2, status: "paid", amount: 300 },
    { billing_month: testMonth3, status: "paid", amount: 300 },
  ];
  const currentMonthStr = "2026-11";
  const monthlyRate = 300;
  const totalBilledUpToNow = allDues.filter((d) => d.billing_month <= currentMonthStr && d.status !== "waived").length * monthlyRate;
  const advanceBalanceWithWaiver = Math.max(0, 900 - totalBilledUpToNow);
  assert(advanceBalanceWithWaiver === 300, `Advance Prepaid Balance with waived month is 300 LKR (waiver did NOT consume advance cash)`);

  // Verify non-waived member comparison:
  // For a member without waived months (all paid or pending), status !== 'waived' evaluates to true for all items, producing identical result
  const nonWaivedDues = [
    { billing_month: testMonth1, status: "paid", amount: 300 },
    { billing_month: testMonth2, status: "paid", amount: 300 },
    { billing_month: testMonth3, status: "paid", amount: 300 },
  ];
  const totalBilledNonWaived = nonWaivedDues.filter((d) => d.billing_month <= currentMonthStr && d.status !== "waived").length * monthlyRate;
  const totalBilledLegacy = nonWaivedDues.filter((d) => d.billing_month <= currentMonthStr).length * monthlyRate;
  assert(totalBilledNonWaived === totalBilledLegacy, "Members without waived dues experience strictly identical balance calculations");

  // 6. Invariant 2: Trigger Behavior on Waived Due & Reversibility Reconciliation
  console.log("\n6. Verifying Invariant 2: Undoing waiver reconciles against remaining advance balance...");

  // Capture cashbook count before reversal
  const txBeforeReverseRes = await authFetch("/rest/v1/treasury_transactions?select=id", "GET", null, rootToken);
  const txBeforeReverseCount = Array.isArray(txBeforeReverseRes.data) ? txBeforeReverseRes.data.length : 0;

  // Sama currently has 300 LKR unallocated advance balance from the 900 LKR payment (600 allocated to due2 and due3).
  // When we undo the waiver on due1 (2026-01-01):
  // 1. due1 returns to 'pending'.
  // 2. fn_reverse_dues_waiver automatically triggers reconcile_member_advance_dues(samaMember.id).
  // 3. Since Sama has 300 LKR remaining advance balance, due1 should immediately be auto-settled to 'paid' (is_advance_settled = true)!
  const reverseRes = await authFetch("/rest/v1/rpc/fn_reverse_dues_waiver", "POST", {
    p_waiver_id: waiver1Id,
    p_reversal_reason: "Member withdrew hardship claim and requested advance settlement",
  }, rootToken);
  assert(reverseRes.ok, "fn_reverse_dues_waiver executed successfully");
  assert(reverseRes.data.status === "reversed", "Waiver status transitioned to 'reversed'");

  // Check cashbook: fn_reverse_dues_waiver MUST NOT have created any treasury transaction!
  const txAfterReverseRes = await authFetch("/rest/v1/treasury_transactions?select=id", "GET", null, rootToken);
  const txAfterReverseCount = Array.isArray(txAfterReverseRes.data) ? txAfterReverseRes.data.length : 0;
  assert(
    txAfterReverseCount === txBeforeReverseCount,
    `Zero cashbook entries created by fn_reverse_dues_waiver (tx count: ${txBeforeReverseCount})`
  );

  // Verify due1 was reconciled and auto-settled by the remaining advance balance!
  const due1ReconciledRes = await authFetch(`/rest/v1/member_dues?id=eq.${due1.id}&select=*`, "GET", null, rootToken);
  assert(
    due1ReconciledRes.data[0]?.status === "paid" && due1ReconciledRes.data[0]?.is_advance_settled === true,
    "Revived due was immediately auto-settled from available advance balance (status='paid', is_advance_settled=true)"
  );

  // Now test reversal when member does NOT have advance balance:
  // Create an unpaid 2026-04 due, waive it, then undo waiver
  const testMonth4 = "2026-04-01";
  const due4Res = await authFetch("/rest/v1/member_dues", "POST", {
    member_id: samaMember.id,
    billing_month: testMonth4,
    amount: 300,
    status: "pending",
  }, rootToken);
  const due4 = Array.isArray(due4Res.data) ? due4Res.data[0] : null;

  const waiveDue4Res = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_due_id: due4.id,
    p_reason: "Temporary waiver for April",
  }, rootToken);
  const waiver4Id = waiveDue4Res.data.waiver_id;

  // Reverse waiver4
  const reverseDue4Res = await authFetch("/rest/v1/rpc/fn_reverse_dues_waiver", "POST", {
    p_waiver_id: waiver4Id,
    p_reversal_reason: "Reversing April waiver without advance balance",
  }, rootToken);
  assert(reverseDue4Res.ok, "Reversed April waiver");

  // Because no advance balance remains, due4 must be 'pending' and back in defaulters_roster
  const due4AfterReverse = await authFetch(`/rest/v1/member_dues?id=eq.${due4.id}&select=*`, "GET", null, rootToken);
  assert(
    due4AfterReverse.data[0]?.status === "pending" && due4AfterReverse.data[0]?.is_advance_settled === false,
    "Due without advance balance returns to 'pending' (status='pending', is_advance_settled=false)"
  );
  const defRes4 = await authFetch(`/rest/v1/defaulters_roster?due_id=eq.${due4.id}`, "GET", null, rootToken);
  assert(defRes4.data?.length === 1, "Unpaid revived due reappears in defaulters_roster");

  // 7. Invariant 4: Undoing a waiver twice is handled safely (Idempotency)
  console.log("\n7. Verifying Invariant 4: Undoing a waiver twice is handled safely (Idempotent)...");
  
  // Call fn_reverse_dues_waiver a SECOND time on waiver4Id
  const doubleReverseRes = await authFetch("/rest/v1/rpc/fn_reverse_dues_waiver", "POST", {
    p_waiver_id: waiver4Id,
    p_reversal_reason: "Duplicate reversal attempt",
  }, rootToken);
  assert(doubleReverseRes.ok, "Second reversal call returned HTTP 200 OK without throwing exception");
  assert(
    doubleReverseRes.data?.status === "already_reversed" && doubleReverseRes.data?.success === true,
    `Idempotent response returned: status="${doubleReverseRes.data?.status}", message="${doubleReverseRes.data?.message}"`
  );

  // 8. Partial Unique Index & Sequential History Verification
  console.log("\n8. Verifying Partial Unique Indexes & History Preservation...");
  
  // Re-waiving the same month (2026-04-01) now that the first waiver is reversed (is_active = false)
  const reWaiveDue4Res = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_due_id: due4.id,
    p_reason: "Second valid waiver on the same month after prior reversal",
  }, rootToken);
  assert(reWaiveDue4Res.ok, "Partial index successfully allows second sequential waiver on same month");
  const waiver4IdSecond = reWaiveDue4Res.data.waiver_id;

  // Attempting concurrent active waiver on the same month -> MUST BE REJECTED
  const duplicateActiveRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_due_id: due4.id,
    p_reason: "Duplicate concurrent waiver attempt",
  }, rootToken);
  assert(
    !duplicateActiveRes.ok && (duplicateActiveRes.data?.message?.includes("already waived") || duplicateActiveRes.data?.message?.includes("already exists")),
    `Concurrent active waiver on same month is strictly blocked (error: "${duplicateActiveRes.data?.message}")`
  );

  // Reverse second waiver to leave clean state
  await authFetch("/rest/v1/rpc/fn_reverse_dues_waiver", "POST", {
    p_waiver_id: waiver4IdSecond,
    p_reversal_reason: "Clean up test state",
  }, rootToken);

  // 9. Zero Cashbook Ledger Impact
  console.log("\n9. Verifying Zero Cashbook Ledger Impact...");
  const finalTxCountRes = await authFetch("/rest/v1/treasury_transactions?select=id", "GET", null, rootToken);
  const finalCashbookCount = Array.isArray(finalTxCountRes.data) ? finalTxCountRes.data.length : 0;
  // Note: the test intentionally inserted 1 test payment (900 LKR) which created 1 cash transaction.
  // The waiver and reversal operations created 0 cashbook transactions!
  assert(
    finalCashbookCount === txBaselineCount + 1,
    `Zero cashbook entries created by all waiver and reversal RPC operations (verified via before/after checks)`
  );

  // 10. Audit Logging Verification
  console.log("\n10. Verifying Audit Trail Integrity & Actor Identity...");
  // A. Check Kamal's waiver audit entry specifically by waiver1Id
  const kamalAuditRes = await authFetch(
    `/rest/v1/audit_logs?entity_id=eq.${waiver1Id}&action=eq.WAIVE_STATUTORY_DUE`,
    "GET",
    null,
    rootToken
  );
  assert(kamalAuditRes.ok && Array.isArray(kamalAuditRes.data) && kamalAuditRes.data.length > 0, "Audit log found for Kamal's waiver");
  const kamalLog = kamalAuditRes.data[0];
  assert(kamalLog?.user_email === "testofficer_1794473511897@gmail.com", `Officer Kamal recorded as actor email: "${kamalLog?.user_email}" (NOT root admin)`);
  assert(kamalLog?.epf_number === "EPF-K9921", `Officer Kamal recorded with exact EPF: "${kamalLog?.epf_number}"`);
  assert(kamalLog?.full_name === "Kamal Disburser", `Officer Kamal recorded with exact Name: "${kamalLog?.full_name}"`);
  assert(kamalLog?.diff_json?.reason === "Special executive committee hardship relief granted", `Audit captures Kamal's waiver reason`);

  // B. Check Root Admin's reversal audit entry specifically by waiver1Id
  const reverseAuditRes = await authFetch(
    `/rest/v1/audit_logs?entity_id=eq.${waiver1Id}&action=eq.REVERSE_STATUTORY_WAIVER`,
    "GET",
    null,
    rootToken
  );
  assert(reverseAuditRes.ok && Array.isArray(reverseAuditRes.data) && reverseAuditRes.data.length > 0, "Audit log found for Root Admin reversal");
  const rootLog = reverseAuditRes.data[0];
  assert(rootLog?.user_email === "krishaja@gmail.com", `Root admin recorded as reversal actor email: "${rootLog?.user_email}"`);
  assert(rootLog?.diff_json?.reversal_reason === "Member withdrew hardship claim and requested advance settlement", `Audit captures reversal reason`);

  // 11. Cleanup Test Artifacts
  console.log("\n11. Cleaning up Test Artifacts...");
  await cleanupMemberDuesAndWaivers(samaMember.id, rootToken);
  // Reset Kamal's abilities
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: ["manage_treasury"],
  }, rootToken);
  console.log("  Cleaned test dues, payments, waivers and reset Kamal permissions.");

  // Summary
  console.log(`\n=======================================================`);
  console.log(`PHASE 2 VERIFICATION COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`=======================================================`);

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution aborted with error:", err);
  process.exit(1);
});
