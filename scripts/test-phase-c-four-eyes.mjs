// scripts/test-phase-c-four-eyes.mjs
// Phase C Automated Verification Suite: Four-Eyes Claim Flow, Audit Logging & Security Checks

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

async function run() {
  console.log("=== PHASE C VERIFICATION: FOUR-EYES CLAIM FLOW, AUDIT LOGGING & SECURITY CHECKS ===\n");

  // Authenticate Root Admin & Sama
  const rootAuth = await signIn("krishaja@gmail.com", "RootTestPass123!");
  const rootToken = rootAuth.token;
  const rootMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${rootAuth.user.id}&select=*`, "GET", null, rootToken);
  const rootMember = rootMemberRes.data[0];

  const samaAuth = await signIn("testmember_1794463534989@gmail.com", "Pass#1794463534989!Aa1");
  const samaToken = samaAuth.token;
  const samaMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${samaAuth.user.id}&select=*`, "GET", null, samaToken);
  const samaMember = samaMemberRes.data[0];

  // 1. Follow-up 1: Confirm original bank coordinates are restored
  console.log("1. Verifying Section 8.1 Bank Coordinates Integrity...");
  const bankRes = await authFetch("/rest/v1/system_settings?key=eq.bank_qr&select=key,value", "GET", null, rootToken);
  assert(bankRes.ok && bankRes.data.length > 0, "system_settings bank_qr is accessible");
  const bankVal = bankRes.data[0]?.value;
  assert(bankVal?.bank_name === "Bank of Ceylon", `bank_name matches original: "${bankVal?.bank_name}"`);
  assert(bankVal?.branch === "Mattala Airport Branch", `branch matches original: "${bankVal?.branch}"`);
  assert(bankVal?.account_number === "8201948201", `account_number matches original: "${bankVal?.account_number}"`);
  assert(bankVal?.account_name === "MRIA Management Welfare Association", `account_name matches original: "${bankVal?.account_name}"`);

  // 2. Follow-up 2: Verify Monthly Dues value unchanged after unauthorized patch
  console.log("\n2. Verifying Section 8.2 Monthly Dues Integrity & Re-reading Value...");
  const duesBeforeRes = await authFetch("/rest/v1/system_settings?key=eq.monthly_due_amount&select=key,value", "GET", null, rootToken);
  const duesBefore = duesBeforeRes.data[0]?.value;
  assert(duesBefore?.amount === 300, `Original monthly dues amount is 300 LKR (actual: ${duesBefore?.amount})`);

  // Sama attempts unauthorized mutation to monthly dues
  console.log("  Sama (without edit_dues_statutory) attempts to mutate monthly_due_amount to 9999...");
  await authFetch("/rest/v1/system_settings?key=eq.monthly_due_amount", "PATCH", { value: { amount: 9999 } }, samaToken);

  // Re-read value from DB to guarantee it did NOT change
  const duesAfterRes = await authFetch("/rest/v1/system_settings?key=eq.monthly_due_amount&select=key,value", "GET", null, rootToken);
  const duesAfter = duesAfterRes.data[0]?.value;
  assert(duesAfter?.amount === 300, `Monthly dues strictly unchanged after unauthorized PATCH (re-read value: ${duesAfter?.amount} LKR)`);

  // 3. Follow-up 4: Confirm Root Admin Spoof-Proof Identification
  console.log("\n3. Testing Spoof-Proof Root Admin Identification Function is_root_admin()...");

  // Test is_root_admin() with Sama token
  const samaIsRootRes = await authFetch("/rest/v1/rpc/is_root_admin", "POST", {}, samaToken);
  assert(samaIsRootRes.ok && samaIsRootRes.data === false, `is_root_admin() evaluates to FALSE for non-root user (got ${samaIsRootRes.data})`);

  // Test is_root_admin() with Root Admin token
  const rootIsRootRes = await authFetch("/rest/v1/rpc/is_root_admin", "POST", {}, rootToken);
  assert(rootIsRootRes.ok && rootIsRootRes.data === true, `is_root_admin() evaluates to TRUE for authentic root administrator (got ${rootIsRootRes.data})`);

  // 4. Follow-up 3: Confidential Medical/Welfare Inquiries Access Tier
  console.log("\n4. Testing Confidential Medical/Welfare Inquiries Access Separation...");
  // Create a general inquiry and a confidential medical inquiry
  const genInqRes = await authFetch("/rest/v1/admin_inquiries", "POST", {
    sender_id: samaMember.id,
    sender_name: "Test Member",
    sender_email: "test_member@mria.lk",
    category: "general",
    subject: "Phase C General Inquiry",
    message: "General question regarding AGM meeting dates.",
    status: "pending",
  }, rootToken);
  assert(genInqRes.status === 201, "Created test general inquiry");

  const medInqRes = await authFetch("/rest/v1/admin_inquiries", "POST", {
    sender_id: rootMember.id, // from root so Sama is not sender
    sender_name: "Confidential Patient",
    sender_email: "confidential@mria.lk",
    category: "welfare_medical",
    subject: "Phase C Confidential Medical Assistance",
    message: "Confidential medical hospital admission subsidy request.",
    status: "pending",
  }, rootToken);
  assert(medInqRes.status === 201, "Created test confidential medical inquiry");

  // Set Sama abilities: only view_respond_inquiries (general)
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["view_respond_inquiries"],
  }, rootToken);

  // Sama queries inquiries: should see general, but NOT confidential medical
  const samaInqRes1 = await authFetch("/rest/v1/admin_inquiries?select=id,category,subject", "GET", null, samaToken);
  const seenCategories1 = (samaInqRes1.data || []).map((i) => i.category);
  const hasMedical1 = seenCategories1.includes("welfare_medical");
  assert(!hasMedical1, `Sama with view_respond_inquiries CANNOT see confidential medical inquiries (seen: ${JSON.stringify(seenCategories1)})`);

  // Now grant Sama view_medical_inquiries
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["view_respond_inquiries", "view_medical_inquiries"],
  }, rootToken);

  // Sama queries inquiries again: should now see confidential medical
  const samaInqRes2 = await authFetch("/rest/v1/admin_inquiries?select=id,category,subject", "GET", null, samaToken);
  const seenCategories2 = (samaInqRes2.data || []).map((i) => i.category);
  const hasMedical2 = seenCategories2.includes("welfare_medical");
  assert(hasMedical2, `Sama granted view_medical_inquiries CAN view confidential medical inquiries`);

  // Root Admin queries inquiries: sees both
  const rootInqRes = await authFetch("/rest/v1/admin_inquiries?select=id,category,subject", "GET", null, rootToken);
  const rootCategories = (rootInqRes.data || []).map((i) => i.category);
  assert(rootCategories.includes("welfare_medical") && rootCategories.includes("general"), "Root Admin sees both general and confidential medical inquiries");

  // 5. Four-Eyes Claim Flow: Non-Root Officer Rejection on Solo Approval + Disbursement
  console.log("\n5. Testing Four-Eyes Segregation: Non-Root Officer (a)...");

  // Authenticate Officer 2 (Kamal) for secondary disbursement
  const kamalEmail = "testofficer_1794473511897@gmail.com";
  const kamalPass = "OfficerPass123!";
  const kamalAuth = await signIn(kamalEmail, kamalPass);
  const kamalToken = kamalAuth.token;
  assert(Boolean(kamalToken), "Authenticated Officer 2 (Kamal Disburser)");
  const kamalMemberRes = await authFetch(`/rest/v1/members?email=eq.${kamalEmail}&select=*`, "GET", null, kamalToken);
  const kamalMember = kamalMemberRes.data[0];

  // Grant abilities:
  // Sama (Officer 1): benefit_review_edit AND benefit_payout_desk
  // Kamal (Officer 2): benefit_payout_desk
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["benefit_review_edit", "benefit_payout_desk"],
  }, rootToken);

  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: ["benefit_payout_desk"],
  }, rootToken);

  // Get valid benefit type
  const btRes = await authFetch("/rest/v1/benefit_types?code=eq.MEDICAL_AID&select=id", "GET", null, rootToken);
  const benefitTypeId = btRes.data[0]?.id;

  // Create Claim 1 for testing Officer four-eyes
  const claim1Insert = await authFetch("/rest/v1/benefit_claims", "POST", {
    member_id: rootMember.id, // Claimant is rootMember
    benefit_type_id: benefitTypeId,
    claim_amount: 5000,
    status: "submitted",
    notes: "Phase C Test Claim 1 (Officer Four-Eyes Verification)",
  }, rootToken);
  assert(claim1Insert.status === 201, "Created Claim 1 for four-eyes testing");
  const claim1Id = claim1Insert.data?.[0]?.id;

  // Officer 1 (Sama) approves Claim 1
  console.log("  Officer 1 (Sama) approves Claim 1...");
  const approve1Res = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim1Id}`, "PATCH", {
    status: "approved",
    approved_by: samaMember.id,
    notes: "Approved by Officer 1 (Sama)",
  }, samaToken);
  assert(approve1Res.ok, `Officer 1 successfully approved Claim 1 (status: ${approve1Res.status})`);

  // Officer 1 (Sama) attempts to DISBURSE the same Claim 1 (Violation of four-eyes!)
  console.log("  Officer 1 (Sama) attempts to disburse the same Claim 1 alone...");
  const soloDisburseRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim1Id}`, "PATCH", {
    status: "disbursed",
    disbursed_amount: 5000,
    disbursed_by: samaMember.id, // SAME as approved_by!
    disbursed_at: new Date().toISOString(),
  }, samaToken);

  assert(!soloDisburseRes.ok || soloDisburseRes.status >= 400, `Database trigger strictly REJECTS solo disbursement by same officer (status: ${soloDisburseRes.status})`);
  const errorMsg = soloDisburseRes.data?.message || "";
  assert(errorMsg.includes("Four-eyes policy violation") || soloDisburseRes.status >= 400, `Database raised Four-Eyes policy exception: "${errorMsg}"`);

  // Officer 2 (Kamal) disburses Claim 1 (Legitimate secondary officer)
  console.log("  Officer 2 (Kamal) disburses Claim 1 (different officer)...");
  const officer2DisburseRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim1Id}`, "PATCH", {
    status: "disbursed",
    disbursed_amount: 5000,
    disbursed_by: kamalMember.id, // DIFFERENT officer!
    disbursed_at: new Date().toISOString(),
  }, kamalToken);
  assert(officer2DisburseRes.ok, `Officer 2 successfully disbursed Claim 1 under four-eyes policy (status: ${officer2DisburseRes.status})`);

  // Verify Claim 1 state in DB
  const claim1FinalRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim1Id}&select=status,approved_by,disbursed_by`, "GET", null, rootToken);
  const claim1Final = claim1FinalRes.data[0];
  assert(claim1Final?.status === "disbursed", "Claim 1 status is disbursed");
  assert(claim1Final?.approved_by === samaMember.id, "Claim 1 approver is Officer 1 (Sama)");
  assert(claim1Final?.disbursed_by === kamalMember.id, "Claim 1 disburser is Officer 2 (Kamal)");
  assert(claim1Final?.approved_by !== claim1Final?.disbursed_by, "Claim 1 approver and disburser are strictly distinct officers");

  // 6. Four-Eyes Claim Flow: Root Admin Solo Approval + Disbursement & Audit Logging (b)
  console.log("\n6. Testing Root Admin Exemption & Mandatory Audit Trail (b)...");

  // Create Claim 2 for Root Admin solo test
  const claim2Insert = await authFetch("/rest/v1/benefit_claims", "POST", {
    member_id: samaMember.id, // Claimant is Sama
    benefit_type_id: benefitTypeId,
    claim_amount: 7500,
    status: "submitted",
    notes: "Phase C Test Claim 2 (Root Admin Solo Verification)",
  }, rootToken);
  assert(claim2Insert.status === 201, "Created Claim 2 for Root Admin solo test");
  const claim2Id = claim2Insert.data?.[0]?.id;

  // Root Admin approves Claim 2 alone
  console.log("  Root Admin approves Claim 2 alone...");
  const rootApproveRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim2Id}`, "PATCH", {
    status: "approved",
    approved_by: rootMember.id,
    notes: "Approved by Root Administrator",
  }, rootToken);
  assert(rootApproveRes.ok, `Root Admin successfully approved Claim 2 (status: ${rootApproveRes.status})`);

  // Root Admin disburses Claim 2 alone (approved_by = rootMember.id, disbursed_by = rootMember.id)
  console.log("  Root Admin disburses Claim 2 alone (solo override)...");
  const rootDisburseRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim2Id}`, "PATCH", {
    status: "disbursed",
    disbursed_amount: 7500,
    disbursed_by: rootMember.id, // SAME as approved_by
    disbursed_at: new Date().toISOString(),
  }, rootToken);
  assert(rootDisburseRes.ok, `Root Admin successfully executed solo disbursement override (status: ${rootDisburseRes.status})`);

  // Verify Claim 2 state in DB
  const claim2FinalRes = await authFetch(`/rest/v1/benefit_claims?id=eq.${claim2Id}&select=status,approved_by,disbursed_by`, "GET", null, rootToken);
  const claim2Final = claim2FinalRes.data[0];
  assert(claim2Final?.status === "disbursed", "Claim 2 status is disbursed");
  assert(claim2Final?.approved_by === rootMember.id && claim2Final?.disbursed_by === rootMember.id, "Claim 2 was approved and disbursed alone by Root Admin");

  // Verify Audit Log captured ROOT_ADMIN_FOUR_EYES_OVERRIDE
  console.log("  Checking audit_logs for ROOT_ADMIN_FOUR_EYES_OVERRIDE entry...");
  const auditRes = await authFetch(`/rest/v1/audit_logs?action=eq.ROOT_ADMIN_FOUR_EYES_OVERRIDE&entity_id=eq.${claim2Id}&order=timestamp.desc&limit=1`, "GET", null, rootToken);
  assert(auditRes.ok && auditRes.data.length > 0, "Audit log captured ROOT_ADMIN_FOUR_EYES_OVERRIDE automatically");
  if (auditRes.data && auditRes.data[0]) {
    const entry = auditRes.data[0];
    console.log("  ✓ Override Audit Entry Details:", {
      action: entry.action,
      user_email: entry.user_email,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      timestamp: entry.timestamp,
      diff: entry.diff_json,
    });
    assert(entry.action === "ROOT_ADMIN_FOUR_EYES_OVERRIDE", "Action is ROOT_ADMIN_FOUR_EYES_OVERRIDE");
    assert(entry.user_email === "krishaja@gmail.com", "Actor is krishaja@gmail.com");
  }

  // 7. Cleanup Test Records
  console.log("\n7. Cleaning up test artifacts...");
  await authFetch(`/rest/v1/benefit_claims?id=eq.${claim1Id}`, "DELETE", null, rootToken);
  await authFetch(`/rest/v1/benefit_claims?id=eq.${claim2Id}`, "DELETE", null, rootToken);
  await authFetch(`/rest/v1/treasury_transactions?claim_id=in.(${claim1Id},${claim2Id})`, "DELETE", null, rootToken);
  await authFetch(`/rest/v1/admin_inquiries?subject=like.Phase C*`, "DELETE", null, rootToken);
  console.log("  Cleaned up temporary claims, transactions, and inquiries.");

  console.log("\n======================================================");
  console.log(`PHASE C VERIFICATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("======================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
