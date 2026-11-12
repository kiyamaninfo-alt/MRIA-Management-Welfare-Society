// scripts/test-phase-a-treasury.mjs
// Phase A Automated Verification:
// Verifies get_public_treasury_summary with brand-new test user,
// confirms zero transaction row leakage, and checks metric cards invariant.

import { CONFIG } from "../js/config.js";
import fs from "fs";

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const ANON_KEY = CONFIG.SUPABASE_ANON_KEY;

async function authFetch(endpoint, method = "GET", body = null, token = ANON_KEY) {
  const headers = {
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ok: res.ok, data: json };
}

async function runTest() {
  console.log("=== PHASE A VERIFICATION: TREASURY SUMMARY FOR NEW MEMBERS ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Authenticate as the brand-new member
  const testEmail = "testmember_1794463534989@gmail.com";
  const testPassword = "Pass#1794463534989!Aa1";

  console.log(`\n1. Authenticating as newly registered member: ${testEmail}...`);
  const loginRes = await authFetch("/auth/v1/token?grant_type=password", "POST", {
    email: testEmail,
    password: testPassword,
  });

  assert(loginRes.ok && Boolean(loginRes.data?.access_token), "Successfully authenticated brand-new test member");
  const accessToken = loginRes.data?.access_token;

  // 2. Call get_public_treasury_summary() RPC as the new member
  console.log("\n2. Calling get_public_treasury_summary() RPC as new member session...");
  const rpcRes = await authFetch("/rest/v1/rpc/get_public_treasury_summary", "POST", {}, accessToken);

  assert(rpcRes.ok, `RPC executed with status ${rpcRes.status}`);
  const summary = rpcRes.data;
  console.log("  RPC Output:\n", JSON.stringify(summary, null, 2));

  assert(summary !== null && typeof summary === "object", "Summary returned a valid JSON object");
  assert(Number(summary.total_liquid_assets) === 19000, `Total Liquid Assets is exactly Rs. 19,000.00 (got: ${summary.total_liquid_assets})`);
  assert(Array.isArray(summary.accounts), "Accounts array is present");
  assert(summary.accounts.length === 3, `Exactly 3 segregated accounts returned (got: ${summary.accounts.length})`);

  const boc = summary.accounts.find((a) => a.account_id === "boc_savings");
  const cash = summary.accounts.find((a) => a.account_id === "cash_in_hand");
  const fd = summary.accounts.find((a) => a.account_id === "fixed_deposits");

  assert(boc && Number(boc.current_balance) === 107100, `BOC Savings matches admin view at Rs. 107,100.00 (got: ${boc?.current_balance})`);
  assert(cash && Number(cash.current_balance) === -88100, `Cash in Hand matches admin view at Rs. -88,100.00 (got: ${cash?.current_balance})`);
  assert(fd && Number(fd.current_balance) === 0, `Fixed Deposits matches admin view at Rs. 0.00 (got: ${fd?.current_balance})`);

  // 3. Verify Security Isolation & RLS
  console.log("\n3. Testing Security Isolation (Verifying zero raw transaction leakage)...");
  const txRes = await authFetch("/rest/v1/treasury_transactions?select=*", "GET", null, accessToken);
  assert(
    !txRes.ok || !txRes.data || txRes.data.length === 0,
    `New member cannot read raw transaction rows from treasury_transactions table (got ${Array.isArray(txRes.data) ? txRes.data.length : 0} rows)`
  );

  // 4. Invariant Checks on Top Dashboard Cards & Hardcoded Fallback Removal
  console.log("\n4. Verifying Dashboard Metric Cards Invariant & Fallback Cleanup...");
  const dashboardHtml = fs.readFileSync("./dashboard.html", "utf-8");
  assert(dashboardHtml.includes('id="outstandingDuesDisplay"'), "Outstanding/Advance Dues metric card is intact in dashboard.html");
  assert(dashboardHtml.includes('id="currentMonthAmountDisplay"'), "Contributions Paid to Date metric card is intact in dashboard.html");
  assert(dashboardHtml.includes('id="benefitsClaimedDisplay"'), "Total Welfare Benefits Claimed metric card is intact in dashboard.html");
  assert(!dashboardHtml.includes('Rs. 2,100.00'), "Hardcoded fake Rs. 2,100.00 has been completely removed from HTML");

  const pageDashboardJs = fs.readFileSync("./js/page-dashboard.js", "utf-8");
  assert(pageDashboardJs.includes("getPublicTreasurySummary"), "js/page-dashboard.js invokes getPublicTreasurySummary()");
  assert(pageDashboardJs.includes("Unavailable"), "js/page-dashboard.js displays 'Unavailable' on failure instead of mock amounts");

  console.log(`\n======================================================`);
  console.log(`PHASE A VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runTest().catch((err) => {
  console.error("Unhandled test execution error:", err);
  process.exit(1);
});
