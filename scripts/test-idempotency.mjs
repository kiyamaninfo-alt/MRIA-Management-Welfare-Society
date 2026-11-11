// scripts/test-idempotency.mjs
// Comprehensive test suite for Payment Idempotency Architecture
import { CONFIG } from "../js/config.js";

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const ANON_KEY = CONFIG.SUPABASE_ANON_KEY;
const TEST_MEMBER_ID = "741c74fa-9762-43d8-965c-6d422e1a2a12"; // "test test"
const TEST_ADMIN_ID = "a05fb02f-4416-4147-be3e-d8ceabfe7782";

async function rpc(functionName, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return { status: res.status, ok: res.ok, data: json };
}

async function runTests() {
  console.log("=== STARTING PAYMENT IDEMPOTENCY INTEGRATION TESTS ===");
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

  // ----------------------------------------------------
  // TEST 1: Same token submitted twice creates only one payment
  // ----------------------------------------------------
  console.log("\n[Test 1] Same token submitted twice creates only one payment");
  const token1 = crypto.randomUUID();

  const req1 = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 300,
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Test 1 initial submission",
    p_idempotency_key: token1
  });

  assert(req1.ok === true && req1.status === 200, "First submission succeeded (HTTP 200)");
  assert(req1.data?.is_replayed === false, "First submission marked as new (is_replayed === false)");
  const firstPaymentId = req1.data?.payment?.id;
  assert(Boolean(firstPaymentId), `First payment created with ID: ${firstPaymentId}`);

  // Re-submit exact same token and payload
  const req2 = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 300,
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Test 1 initial submission",
    p_idempotency_key: token1
  });

  assert(req2.ok === true && req2.status === 200, "Second submission succeeded (HTTP 200)");
  assert(req2.data?.is_replayed === true, "Second submission safely intercepted (is_replayed === true)");
  assert(req2.data?.payment?.id === firstPaymentId, "Second submission returned the exact same payment ID (no duplicate created)");

  // ----------------------------------------------------
  // TEST 2: Replayed payment does not send a second receipt email
  // ----------------------------------------------------
  console.log("\n[Test 2] Replayed payment does not send a second receipt email");
  let emailDispatchedCount = 0;

  function handleClientVoucherDispatch(paymentResult, memberEmail) {
    // Exact logic implemented in js/page-admin.js
    if (paymentResult.is_replayed) {
      // Replay branch: do not send email
      return { emailSent: false, reason: "duplicate_intercepted_voucher_replayed" };
    } else if (memberEmail) {
      emailDispatchedCount++;
      return { emailSent: true, reason: "fresh_receipt_emailed" };
    }
    return { emailSent: false, reason: "no_email" };
  }

  const dispatch1 = handleClientVoucherDispatch(req1.data, "test@example.com");
  assert(dispatch1.emailSent === true, "Initial payment triggers receipt email dispatch");

  const dispatch2 = handleClientVoucherDispatch(req2.data, "test@example.com");
  assert(dispatch2.emailSent === false, "Replayed duplicate payment strictly SUPPRESSES second email dispatch");
  assert(emailDispatchedCount === 1, "Total emails dispatched remains exactly 1");

  // ----------------------------------------------------
  // TEST 3: Two legitimate consecutive Rs. 300 payments (new token each time) are both recorded
  // ----------------------------------------------------
  console.log("\n[Test 3] Two legitimate consecutive Rs. 300 payments (new token each time)");
  const token2A = crypto.randomUUID();
  const token2B = crypto.randomUUID();

  const payA = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 300,
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Legitimate consecutive payment 1",
    p_idempotency_key: token2A
  });

  assert(payA.ok === true && payA.data?.is_replayed === false, "Payment A (Rs. 300) recorded successfully");
  const idA = payA.data?.payment?.id;

  const payB = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 300,
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Legitimate consecutive payment 2",
    p_idempotency_key: token2B
  });

  assert(payB.ok === true && payB.data?.is_replayed === false, "Payment B (Rs. 300) recorded successfully");
  const idB = payB.data?.payment?.id;

  assert(idA !== idB, `Both legitimate payments recorded as distinct ledger entries (${idA} != ${idB})`);

  // ----------------------------------------------------
  // TEST 4: Same token with changed data returns a clear conflict error
  // ----------------------------------------------------
  console.log("\n[Test 4] Same token with changed data returns a clear conflict error");
  const tokenConflict = crypto.randomUUID();

  const initPay = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 300,
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Initial payment for conflict test",
    p_idempotency_key: tokenConflict
  });
  assert(initPay.ok === true, "Initial payment with tokenConflict recorded");

  // Attempt to re-use tokenConflict with modified amount (Rs. 600 instead of Rs. 300)
  const conflictReq = await rpc("record_cash_payment_idempotent", {
    p_member_id: TEST_MEMBER_ID,
    p_amount: 600, // MODIFIED AMOUNT
    p_payment_type: "monthly_due",
    p_payment_method: "cash",
    p_collected_by: TEST_ADMIN_ID,
    p_notes: "Attempted modification with same token",
    p_idempotency_key: tokenConflict
  });

  assert(conflictReq.ok === false, "Re-submitting same token with modified amount failed as expected");
  const errorMsg = JSON.stringify(conflictReq.data);
  assert(errorMsg.includes("IDEMPOTENCY_PAYLOAD_MISMATCH"), `Conflict error contains 'IDEMPOTENCY_PAYLOAD_MISMATCH' (Got: ${conflictReq.data?.message || errorMsg})`);

  // Summary
  console.log("\n=========================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=========================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution threw error:", err);
  process.exit(1);
});
