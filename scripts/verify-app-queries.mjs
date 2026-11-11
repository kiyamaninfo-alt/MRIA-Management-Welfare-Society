// scripts/verify-app-queries.mjs
// Verifies Member Dashboard and Treasurer Approval Queue queries with new indexes.
import { CONFIG } from "../js/config.js";

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const ANON_KEY = CONFIG.SUPABASE_ANON_KEY;
const TEST_MEMBER_ID = "741c74fa-9762-43d8-965c-6d422e1a2a12";

async function postgrest(path) {
  const start = performance.now();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "Accept": "application/json"
    }
  });
  const duration = (performance.now() - start).toFixed(1);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ok: res.ok, durationMs: duration, data: json };
}

async function run() {
  console.log("=== VERIFYING APPLICATION QUERIES POST-MIGRATION ===");
  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Member Dues (Dashboard dues breakdown)
  console.log("\n[1] Member Dues Query");
  const dues = await postgrest(`member_dues?member_id=eq.${TEST_MEMBER_ID}&select=*&order=billing_month.desc`);
  assert(dues.ok, `Member dues loaded (${dues.durationMs}ms, ${dues.data.length} records)`);

  // 2. Member Payments History (Dashboard payments feed)
  console.log("\n[2] Member Payments History Query");
  const payments = await postgrest(`payments?member_id=eq.${TEST_MEMBER_ID}&select=*&order=created_at.desc`);
  assert(payments.ok, `Member payments loaded (${payments.durationMs}ms, ${payments.data.length} records)`);

  // 3. Member Notifications (Dashboard bell drawer)
  console.log("\n[3] Member Notifications Query");
  const notifs = await postgrest(`notifications?recipient_id=eq.${TEST_MEMBER_ID}&select=*&order=created_at.desc`);
  assert(notifs.ok, `Member notifications loaded (${notifs.durationMs}ms, ${notifs.data.length} records)`);

  // 4. Member Claims (Dashboard claims feed)
  console.log("\n[4] Member Claims Query");
  const claims = await postgrest(`benefit_claims?member_id=eq.${TEST_MEMBER_ID}&select=*,benefit_types(*)&order=created_at.desc`);
  assert(claims.ok, `Member claims loaded (${claims.durationMs}ms, ${claims.data.length} records)`);

  // 5. Treasurer Approval Queue: Pending Slips (Matching getPendingPayments in js/api.js)
  console.log("\n[5] Treasurer Approval Queue: Pending Slips");
  const pendingSlips = await postgrest(`payments?status=eq.pending_approval&select=*,members:members!payments_member_id_fkey(full_name,email,epf_number)&order=created_at.desc`);
  assert(pendingSlips.ok, `Treasurer pending slip queue loaded (${pendingSlips.durationMs}ms, ${pendingSlips.data.length} pending slips)`);

  // 6. Treasurer Verified Receipts Feed (Matching getPaymentReceipts in js/api.js)
  console.log("\n[6] Treasurer Receipts Ledger Feed");
  const receipts = await postgrest(`payments?status=eq.verified&select=*,members:members!payments_member_id_fkey(id,full_name,epf_number)&order=created_at.desc&limit=20`);
  assert(receipts.ok, `Treasurer receipts ledger loaded (${receipts.durationMs}ms, ${receipts.data.length} receipts)`);

  // 7. Treasurer Treasury Cashbook Transactions (Matching getTreasuryTransactions in js/api.js)
  console.log("\n[7] Treasurer Treasury Cashbook Transactions");
  const treasury = await postgrest(`treasury_transactions?select=*&order=transaction_date.desc,created_at.desc&limit=25`);
  assert(treasury.ok, `Treasury transactions loaded (${treasury.durationMs}ms, ${treasury.data.length} transactions)`);

  // 8. Defaulters Roster SQL View
  console.log("\n[8] Defaulters Roster SQL View");
  const defaulters = await postgrest(`defaulters_roster?select=*&limit=20`);
  assert(defaulters.ok, `Defaulters roster loaded (${defaulters.durationMs}ms, ${defaulters.data.length} defaulters)`);

  console.log("\n=========================================");
  console.log(`QUERY VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=========================================");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
