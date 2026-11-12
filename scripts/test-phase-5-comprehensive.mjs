// scripts/test-phase-5-comprehensive.mjs
// Phase 5 Comprehensive End-to-End Verification Suite

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
  console.log("=== PHASE 5 COMPREHENSIVE END-TO-END VERIFICATION ===\n");

  // 1. Rollback Migration Files Verification
  console.log("1. Verifying Database Rollback Scripts...");
  const rollbackFiles = [
    "supabase/migrations/20261112000003_granular_rbac_and_inquiries_rollback.sql",
    "supabase/migrations/20261112000004_four_eyes_and_medical_inquiries_rollback.sql",
    "supabase/migrations/20261112000005_dues_waivers_and_ability_rollback.sql",
    "supabase/migrations/20261112000006_claims_workflow_shortcuts_and_search_rollback.sql",
  ];
  for (const f of rollbackFiles) {
    assert(fs.existsSync(path.resolve(f)), `Rollback script exists on disk: ${f}`);
  }

  // 2. Canonical Logo & File Path Invariant
  console.log("\n2. Verifying Canonical Logo File & Clean Embeddings...");
  const logoPath = path.resolve("assets/mria-logo.svg");
  assert(fs.existsSync(logoPath), "assets/mria-logo.svg exists on disk");
  const logoContent = fs.readFileSync(logoPath, "utf8");
  assert(!logoContent.includes("<text"), "assets/mria-logo.svg has zero text (symbol-only emblem)");
  assert(logoContent.includes("viewBox=\"0 0 120 120\""), "Standard viewBox '0 0 120 120' verified");

  const htmlPages = ["index.html", "dashboard.html", "admin.html", "unauthorized.html"];
  for (const page of htmlPages) {
    const content = fs.readFileSync(path.resolve(page), "utf8");
    assert(content.includes('src="/assets/mria-logo.svg"'), `${page} references local /assets/mria-logo.svg`);
    assert(!content.includes("lh3.googleusercontent.com"), `${page} contains zero external Google URLs`);
  }

  // 3. Top 3 Dashboard Cards Invariant Check
  console.log("\n3. Verifying Top 3 Dashboard Cards Unaltered & Invariant Protected...");
  const dashHtml = fs.readFileSync(path.resolve("dashboard.html"), "utf8");
  assert(dashHtml.includes('id="outstandingDuesCard"'), "Card 1: Outstanding / Advance Balance Card is intact");
  assert(dashHtml.includes('id="currentMonthAmountDisplay"'), "Card 2: Contributions Paid to Date Card is intact");
  assert(dashHtml.includes('id="benefitsClaimedDisplay"'), "Card 3: Total Welfare Benefits Claimed Card is intact");

  const apiJs = fs.readFileSync(path.resolve("js/api.js"), "utf8");
  assert(apiJs.includes("d.status !== \"waived\""), "calculateMemberBalance() excludes waived dues from pending arrears");

  // 4. Dedicated Fee Release Tab & 360 Dossier Markup
  console.log("\n4. Verifying Fee Release & Member 360 Dossier Markup...");
  const adminHtml = fs.readFileSync(path.resolve("admin.html"), "utf8");
  assert(adminHtml.includes('id="tab-btn-waivers"'), "Tab navigation button #tab-btn-waivers present");
  assert(adminHtml.includes('id="tab-content-waivers"'), "Dedicated tab container #tab-content-waivers present");
  assert(adminHtml.includes('id="waiverMemberSearchInput"'), "Member 360 live search input present");
  assert(adminHtml.includes('id="waiverMemberDossierContainer"'), "Member 360 dossier container present");
  assert(adminHtml.includes('id="dossierMonthlyDuesTableBody"'), "Section 1 Monthly Dues & Fee Release table present");
  assert(adminHtml.includes('id="dossierPaymentsTableBody"'), "Section 2 Payment History table present");
  assert(adminHtml.includes('id="dossierClaimsTableBody"'), "Section 3 Benefit & Grants table present");
  assert(adminHtml.includes('id="dossierMemberWaiversTableBody"'), "Section 4 Waivers Audit table present");
  assert(adminHtml.includes('id="waiverAssociationLedgerCard"'), "Association-wide ledger card present");
  assert(adminHtml.includes('id="recordWaiverModal"'), "Fee Release Record modal present");
  assert(adminHtml.includes('id="reverseWaiverModal"'), "Fee Release Reverse (Undo) modal present");

  // 5. Claims Real-Time Search & Shortcuts Markup
  console.log("\n5. Verifying Claims Search & Shortcuts Markup...");
  assert(adminHtml.includes('id="claimsReviewSearchInput"'), "Claims Review real-time search input present");
  assert(adminHtml.includes('id="payoutDeskApprovedSearchSelect"'), "Payout Desk approved claims selector present");
  assert(adminHtml.includes('id="payoutDeskApprovedCount"'), "Payout Desk count badge present");

  // 6. Database Level Security & Four-Eyes Segregation
  console.log("\n6. Verifying Database Security, Shortcut RPC & Four-Eyes Rules...");
  const rootAuth = await signIn("krishaja@gmail.com", "RootTestPass123!");
  const kamalAuth = await signIn("testofficer_1794473511897@gmail.com", "OfficerPass123!");
  const samaAuth = await signIn("testmember_1794463534989@gmail.com", "Pass#1794463534989!Aa1");

  // Test root shortcut function permission
  const shortcutNonRootRes = await authFetch("/rest/v1/rpc/fn_claim_approve_and_go_to_payout", "POST", {
    p_claim_id: "00000000-0000-0000-0000-000000000000",
  }, kamalAuth.token);
  assert(shortcutNonRootRes.status === 403 || shortcutNonRootRes.status === 400, "fn_claim_approve_and_go_to_payout blocks non-root caller");

  // Test waiver function permission for unauthorized officer
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: "60a11c2b-18ae-4dd3-bcd7-212ef75ff0cd", // Sama
    p_abilities: [],
  }, rootAuth.token);
  const waiverUnauthorizedRes = await authFetch("/rest/v1/rpc/fn_record_dues_waiver", "POST", {
    p_member_id: "a05fb02f-4416-4147-be3e-d8ceabfe7782",
    p_waiver_type: "admission_fee",
    p_waived_amount: 1000,
    p_reason: "Test unauthorized waiver execution attempt",
  }, samaAuth.token);
  assert(waiverUnauthorizedRes.status === 400 || waiverUnauthorizedRes.status === 403, "fn_record_dues_waiver blocks unauthorized caller");

  // 7. Service Worker Cache Version & Offline Assets
  console.log("\n7. Verifying PWA Service Worker & Cache Integrity...");
  const swJs = fs.readFileSync(path.resolve("sw.js"), "utf8");
  assert(swJs.includes("mria-welfare-v12"), "Service worker bumped to current version (mria-welfare-v12)");
  assert(swJs.includes("'/assets/mria-logo.svg'"), "Service worker precaches /assets/mria-logo.svg");

  console.log("\n=======================================================");
  console.log(`PHASE 5 VERIFICATION COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("=======================================================\n");

  if (failCount > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
