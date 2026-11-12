// scripts/test-phase-4-waivers-ui-and-dossier.mjs
// Phase 4 Automated Verification Suite: Dedicated Fee Release Tab & Member 360 Dossier

import fs from "fs";
import path from "path";

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

async function authFetch(urlPath, method = "GET", body = null, token = null) {
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
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, opts);
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
  console.log("=== PHASE 4 VERIFICATION: FEE RELEASE TAB & MEMBER 360 DOSSIER ===\n");

  // 1. Inspect DOM Elements in admin.html
  console.log("1. Inspecting Admin Console DOM Markup in admin.html...");
  const adminHtml = fs.readFileSync(path.resolve("admin.html"), "utf8");

  // Navigation tab
  assert(adminHtml.includes('id="tab-btn-waivers"'), "Tab button #tab-btn-waivers present in #adminTabsNav");
  assert(adminHtml.includes("switchAdminTab('waivers')"), "Tab button calls switchAdminTab('waivers')");
  assert(adminHtml.includes('data-i18n="tab_waivers"'), "Tab button has data-i18n='tab_waivers' attribute");
  assert(adminHtml.includes('id="tabWaiversCountBadge"'), "Count badge #tabWaiversCountBadge present");

  // Main tab container
  assert(adminHtml.includes('id="tab-content-waivers"'), "Dedicated tab container #tab-content-waivers present");

  // Member 360 search
  assert(adminHtml.includes('id="waiverMemberSearchInput"'), "Member 360 search input #waiverMemberSearchInput present");
  assert(adminHtml.includes('id="waiverMemberSearchResults"'), "Autocomplete results container #waiverMemberSearchResults present");
  assert(adminHtml.includes('id="waiverClearMemberBtn"'), "Clear member button #waiverClearMemberBtn present");

  // Dossier container & KPIs
  assert(adminHtml.includes('id="waiverMemberDossierContainer"'), "Member 360 dossier container #waiverMemberDossierContainer present");
  assert(adminHtml.includes('id="dossierMemberName"'), "Member profile field #dossierMemberName present");
  assert(adminHtml.includes('id="dossierMemberEpf"'), "Member profile field #dossierMemberEpf present");
  assert(adminHtml.includes('id="dossierAdvanceBalance"'), "KPI #dossierAdvanceBalance present");
  assert(adminHtml.includes('id="dossierPendingArrears"'), "KPI #dossierPendingArrears present");
  assert(adminHtml.includes('id="dossierWaivedTotal"'), "KPI #dossierWaivedTotal present");
  assert(adminHtml.includes('id="dossierAdmissionStatusBadge"'), "KPI #dossierAdmissionStatusBadge present");

  // 4 Sections
  assert(adminHtml.includes('id="dossierMonthlyDuesTableBody"'), "Section 1 Monthly dues table body #dossierMonthlyDuesTableBody present");
  assert(adminHtml.includes('id="dossierPaymentsTableBody"'), "Section 2 Payment history table body #dossierPaymentsTableBody present");
  assert(adminHtml.includes('id="dossierClaimsTableBody"'), "Section 3 Benefit grants table body #dossierClaimsTableBody present");
  assert(adminHtml.includes('id="dossierMemberWaiversTableBody"'), "Section 4 Member waivers audit table body #dossierMemberWaiversTableBody present");

  // Association-wide Ledger
  assert(adminHtml.includes('id="waiverAssociationLedgerCard"'), "Association-wide ledger card #waiverAssociationLedgerCard present");
  assert(adminHtml.includes('id="waiverLedgerSearchInput"'), "Ledger search input #waiverLedgerSearchInput present");
  assert(adminHtml.includes('id="waiversLedgerTableBody"'), "Ledger table body #waiversLedgerTableBody present");
  assert(adminHtml.includes('id="waiverLedgerSummaryStats"'), "Ledger stats summary element #waiverLedgerSummaryStats present");

  // Modals
  assert(adminHtml.includes('id="recordWaiverModal"'), "Grant fee release modal #recordWaiverModal present");
  assert(adminHtml.includes('id="recordWaiverForm"'), "Record waiver form #recordWaiverForm present");
  assert(adminHtml.includes('id="recordWaiverReason"'), "Mandatory reason textarea #recordWaiverReason present");
  assert(adminHtml.includes('id="reverseWaiverModal"'), "Undo fee release modal #reverseWaiverModal present");
  assert(adminHtml.includes('id="reverseWaiverForm"'), "Reverse waiver form #reverseWaiverForm present");
  assert(adminHtml.includes('id="reverseWaiverReason"'), "Mandatory reversal reason textarea #reverseWaiverReason present");

  // 2. Inspect Translation Dictionary in js/i18n.js
  console.log("\n2. Inspecting Localization Dictionary in js/i18n.js...");
  const i18nJs = fs.readFileSync(path.resolve("js/i18n.js"), "utf8");
  assert(i18nJs.includes('tab_waivers: "Fee Release (Waivers)"'), "English translation for tab_waivers defined");
  assert(i18nJs.includes('tab_waivers: "ගෙවීම් නිදහස් කිරීම්"'), "Sinhala translation for tab_waivers defined");

  // 3. Authenticate Actors & Verify Operational Permissions
  console.log("\n3. Authenticating Test Accounts & Testing Operational Permissions...");
  const rootAuth = await signIn("krishaja@gmail.com", "RootTestPass123!");
  const rootToken = rootAuth.token;
  const rootMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${rootAuth.user.id}&select=*`, "GET", null, rootToken);
  const rootMember = rootMemberRes.data[0];
  assert(Boolean(rootMember?.id), `Root Admin authenticated: ${rootMember?.email}`);

  const samaAuth = await signIn("testmember_1794463534989@gmail.com", "Pass#1794463534989!Aa1");
  const samaToken = samaAuth.token;
  const samaMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${samaAuth.user.id}&select=*`, "GET", null, samaToken);
  const samaMember = samaMemberRes.data[0];
  assert(Boolean(samaMember?.id), `Officer 1 (Sama) authenticated: ${samaMember?.email}`);

  const kamalAuth = await signIn("testofficer_1794473511897@gmail.com", "OfficerPass123!");
  const kamalToken = kamalAuth.token;
  const kamalMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${kamalAuth.user.id}&select=*`, "GET", null, kamalToken);
  const kamalMember = kamalMemberRes.data[0];
  assert(Boolean(kamalMember?.id), `Officer 2 (Kamal) authenticated: ${kamalMember?.email}`);

  // Test that non-root officer without ability does not have waive_statutory_dues
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: [],
  }, rootToken);
  const samaAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, samaToken);
  assert(!samaAbilitiesRes.data?.includes("waive_statutory_dues"), "Sama without ability lacks waive_statutory_dues");

  // Root Admin grants waive_statutory_dues to Kamal
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: ["waive_statutory_dues"],
  }, rootToken);
  const kamalAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, kamalToken);
  assert(kamalAbilitiesRes.data?.includes("waive_statutory_dues"), "Kamal successfully assigned waive_statutory_dues");

  // 4. Verify Member 360 Dossier Data Endpoints for Sama
  console.log("\n4. Verifying Member 360 Dossier Data Endpoints...");
  
  // Dues
  const duesRes = await authFetch(`/rest/v1/member_dues?member_id=eq.${samaMember.id}&order=billing_month.desc`, "GET", null, rootToken);
  assert(duesRes.ok && Array.isArray(duesRes.data), `Retrieved member dues (${duesRes.data?.length} dues)`);

  // Payments
  const paymentsRes = await authFetch(`/rest/v1/payments?member_id=eq.${samaMember.id}&order=created_at.desc`, "GET", null, rootToken);
  assert(paymentsRes.ok && Array.isArray(paymentsRes.data), `Retrieved member payment history (${paymentsRes.data?.length} payments)`);

  // Claims
  const claimsRes = await authFetch(`/rest/v1/benefit_claims?member_id=eq.${samaMember.id}&select=*,benefit_types(title_en,title_si)&order=created_at.desc`, "GET", null, rootToken);
  assert(claimsRes.ok && Array.isArray(claimsRes.data), `Retrieved member welfare claims history (${claimsRes.data?.length} claims)`);

  // Waivers
  const waiversRes = await authFetch(`/rest/v1/dues_waivers?member_id=eq.${samaMember.id}&order=created_at.desc`, "GET", null, rootToken);
  assert(waiversRes.ok && Array.isArray(waiversRes.data), `Retrieved member waiver history (${waiversRes.data?.length} waivers)`);

  // All Association Waivers
  const allWaiversRes = await authFetch("/rest/v1/dues_waivers?order=created_at.desc", "GET", null, rootToken);
  assert(allWaiversRes.ok && Array.isArray(allWaiversRes.data), `Retrieved association-wide waivers ledger (${allWaiversRes.data?.length} total records)`);

  // 5. Test Live Fee Release Flow & Reversal (Member 360 Action)
  console.log("\n5. Testing Live Fee Release & Reversal Flow via Kamal...");
  const testMonth = "2026-09-01";
  
  // Clean up any existing due/waiver for testMonth
  await authFetch(`/rest/v1/dues_waivers?member_id=eq.${samaMember.id}&billing_month=eq.${testMonth}`, "DELETE", null, rootToken);
  await authFetch(`/rest/v1/member_dues?member_id=eq.${samaMember.id}&billing_month=eq.${testMonth}`, "DELETE", null, rootToken);

  // Create pending test due
  const dueInsert = await authFetch("/rest/v1/member_dues", "POST", {
    member_id: samaMember.id,
    billing_month: testMonth,
    amount: 300.00,
    status: "pending",
  }, rootToken);
  assert(dueInsert.ok, `Created pending monthly due for ${testMonth}`);
  const testDueId = dueInsert.data[0]?.id;

  // Kamal records waiver
  const waiverRecordRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: samaMember.id,
    p_waiver_type: "monthly_due",
    p_billing_month: testMonth,
    p_due_id: testDueId,
    p_waived_amount: 300.00,
    p_reason: "Executive committee hardship waiver for September 2026",
  }, kamalToken);
  assert(waiverRecordRes.ok && waiverRecordRes.data?.success === true, "Kamal recorded fee release successfully");
  const waiverId = waiverRecordRes.data?.waiver_id;

  // Verify due status is now 'waived'
  const checkDueW = await authFetch(`/rest/v1/member_dues?id=eq.${testDueId}`, "GET", null, rootToken);
  assert(checkDueW.data[0]?.status === "waived", "Due status transitioned to 'waived'");

  // Verify waived due is excluded from defaulters roster
  const defaultersRes = await authFetch(`/rest/v1/defaulters_roster?member_id=eq.${samaMember.id}&billing_month=eq.${testMonth}`, "GET", null, rootToken);
  assert(defaultersRes.data?.length === 0, "Waived due is strictly excluded from defaulters roster");

  // Kamal undoes waiver
  const reverseRes = await authFetch("/rest/v1/rpc/fn_reverse_dues_waiver", "POST", {
    p_waiver_id: waiverId,
    p_reversal_reason: "Member withdrew hardship request and requested standard contribution",
  }, kamalToken);
  assert(reverseRes.ok && reverseRes.data?.success === true, "Kamal reversed fee release successfully");

  // Verify due status returns to 'pending'
  const checkDueP = await authFetch(`/rest/v1/member_dues?id=eq.${testDueId}`, "GET", null, rootToken);
  assert(checkDueP.data[0]?.status === "pending", "Due status returned to 'pending'");

  // Verify due reappears in defaulters roster
  const defaultersRes2 = await authFetch(`/rest/v1/defaulters_roster?member_id=eq.${samaMember.id}&billing_month=eq.${testMonth}`, "GET", null, rootToken);
  assert(defaultersRes2.data?.length === 1, "Unpaid revived due reappears in defaulters roster");

  // Verify audit logs contain both actions with Kamal as actor
  const waiverAuditRes = await authFetch(`/rest/v1/audit_logs?entity_id=eq.${waiverId}&action=eq.WAIVE_STATUTORY_DUE`, "GET", null, rootToken);
  assert(waiverAuditRes.ok && waiverAuditRes.data?.length > 0, "Audit log captured WAIVE_STATUTORY_DUE");
  assert(waiverAuditRes.data[0]?.user_email === "testofficer_1794473511897@gmail.com", "Waiver audit log recorded Kamal as actor");

  const reverseAuditRes = await authFetch(`/rest/v1/audit_logs?entity_id=eq.${waiverId}&action=eq.REVERSE_STATUTORY_WAIVER`, "GET", null, rootToken);
  assert(reverseAuditRes.ok && reverseAuditRes.data?.length > 0, "Audit log captured REVERSE_STATUTORY_WAIVER");
  assert(reverseAuditRes.data[0]?.user_email === "testofficer_1794473511897@gmail.com", "Reversal audit log recorded Kamal as actor");

  // Cleanup
  await authFetch(`/rest/v1/dues_waivers?id=eq.${waiverId}`, "DELETE", null, rootToken);
  await authFetch(`/rest/v1/member_dues?id=eq.${testDueId}`, "DELETE", null, rootToken);
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: kamalMember.id,
    p_abilities: [],
  }, rootToken);

  console.log("\n=======================================================");
  console.log(`PHASE 4 VERIFICATION COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("=======================================================\n");

  if (failCount > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
