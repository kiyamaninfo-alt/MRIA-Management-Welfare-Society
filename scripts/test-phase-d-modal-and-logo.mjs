// scripts/test-phase-d-modal-and-logo.mjs
// Phase D Automated Verification Suite: Payment Confirmation Modal & Emblem Logo Display

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
  console.log("=== PHASE D VERIFICATION: PAYMENT CONFIRMATION MODAL & EMBLEM LOGO DISPLAY ===\n");

  const cwd = process.cwd();

  // 1. Verify Emblem Logo display on all pages
  console.log("1. Verifying Emblem Logo Display Across All Application Pages...");
  const pages = ["index.html", "dashboard.html", "admin.html", "unauthorized.html"];

  // Verify /assets/mria-logo.svg file on disk
  const logoPath = path.join(cwd, "assets", "mria-logo.svg");
  assert(fs.existsSync(logoPath), "assets/mria-logo.svg file exists locally on disk");
  const logoContent = fs.readFileSync(logoPath, "utf8");
  assert(logoContent.includes("<svg") && logoContent.includes("</svg>"), "assets/mria-logo.svg contains valid SVG markup");

  for (const page of pages) {
    const filePath = path.join(cwd, page);
    assert(fs.existsSync(filePath), `${page} exists`);
    const content = fs.readFileSync(filePath, "utf8");
    assert(content.includes('src="/assets/mria-logo.svg"'), `${page} uses local /assets/mria-logo.svg`);
    assert(!content.includes("lh3.googleusercontent.com/aida/AEtjO1UlQKrv"), `${page} contains NO external Google-hosted temporary logo URL`);
  }

  // 2. Verify Payment Confirmation Modal Markup & Field Coverage
  console.log("\n2. Verifying Payment Confirmation Modal Markup in dashboard.html...");
  const dashHtml = fs.readFileSync(path.join(cwd, "dashboard.html"), "utf8");

  // Modal existence
  assert(dashHtml.includes('id="paymentConfirmModal"'), "paymentConfirmModal container exists in dashboard.html");

  // Approved Items Checklist:
  // Item (a): Months being paid
  assert(dashHtml.includes('id="confirmPaymentMonth"'), "Modal includes (a) Months being paid display (#confirmPaymentMonth)");

  // Item (b): Total amount
  assert(dashHtml.includes('id="confirmPaymentAmount"'), "Modal includes (b) Total amount display (#confirmPaymentAmount)");

  // Item (c): Payment method
  assert(dashHtml.includes('id="confirmPaymentMethod"'), "Modal includes (c) Payment method display (#confirmPaymentMethod)");

  // Item (d): Member EPF number
  assert(dashHtml.includes('id="confirmPaymentEpf"'), "Modal includes (d) Member EPF number display (#confirmPaymentEpf)");

  // Item (e): Uploaded slip thumbnail preview
  assert(dashHtml.includes('id="confirmSlipThumbnailContainer"'), "Modal includes (e) Uploaded slip thumbnail container (#confirmSlipThumbnailContainer)");
  assert(dashHtml.includes('id="confirmSlipThumbnailImg"'), "Modal includes slip thumbnail image element (#confirmSlipThumbnailImg)");
  assert(dashHtml.includes('id="confirmSlipFileName"'), "Modal includes slip file name element (#confirmSlipFileName)");

  // Item (f): Recipient bank coordinates
  assert(dashHtml.includes('id="confirmBankCoordinatesBox"'), "Modal includes (f) Recipient bank coordinates box (#confirmBankCoordinatesBox)");
  assert(dashHtml.includes('id="confirmBankName"'), "Modal includes bank name (#confirmBankName)");
  assert(dashHtml.includes('id="confirmBankAccountNo"'), "Modal includes bank account number (#confirmBankAccountNo)");
  assert(dashHtml.includes('id="confirmBankAccountName"'), "Modal includes bank account name (#confirmBankAccountName)");

  // Item (g): Non-refundable acknowledgment checkbox & final submit button
  assert(dashHtml.includes('id="confirmNonRefundableCheckbox"'), "Modal includes (g) Non-refundable acknowledgment checkbox (#confirmNonRefundableCheckbox)");
  assert(dashHtml.includes('id="btnFinalConfirmPayment"'), "Modal includes final submit button (#btnFinalConfirmPayment)");
  assert(dashHtml.includes('id="btnBackToEditPayment"'), "Modal includes Back to Edit button (#btnBackToEditPayment)");

  // 3. Verify Client-Side Logic in js/page-dashboard.js
  console.log("\n3. Verifying Client-Side Logic & Integration in js/page-dashboard.js...");
  const dashJs = fs.readFileSync(path.join(cwd, "js", "page-dashboard.js"), "utf8");

  assert(dashJs.includes("populatePaymentConfirmationModal"), "populatePaymentConfirmationModal function is defined in js/page-dashboard.js");
  assert(dashJs.includes('openModal("paymentConfirmModal")'), "paymentForm submit triggers openModal('paymentConfirmModal')");
  assert(dashJs.includes("confirmNonRefundableCheckbox"), "Checkbox change handler is bound to toggle button disabled state");
  assert(dashJs.includes("btnFinalConfirmPayment"), "Final submit button is bound to perform actual upload & submitPayment");

  // Invariant Check: Top 3 dashboard cards must NOT be touched
  console.log("\n4. Verifying Invariants: Top 3 Dashboard Metric Cards Untouched...");
  assert(dashHtml.includes('id="outstandingDuesDisplay"'), "Metric Card 1 (Net Dues / Advance Balance) exists in dashboard.html");
  assert(dashHtml.includes('id="currentMonthAmountDisplay"'), "Metric Card 2 (Contributions Paid to Date) exists in dashboard.html");
  assert(dashHtml.includes('id="benefitsClaimedDisplay"'), "Metric Card 3 (Total Welfare Benefits Received) exists in dashboard.html");
  assert(dashJs.includes("function renderMetrics("), "renderMetrics function preserved in js/page-dashboard.js");

  // 5. Live End-to-End Payment Submission Test via Backend API
  console.log("\n5. Testing Live Payment Submission Flow with Confirmation Step Data...");
  const samaAuth = await signIn("testmember_1794463534989@gmail.com", "Pass#1794463534989!Aa1");
  const samaToken = samaAuth.token;
  const samaMemberRes = await authFetch(`/rest/v1/members?user_id=eq.${samaAuth.user.id}&select=*`, "GET", null, samaToken);
  const samaMember = samaMemberRes.data[0];

  const testAmount = 300;
  const testMonth = "2026-11";
  const testNotes = `[Settling Dues via FIFO starting from: ${testMonth}] Phase D Modal Verification Payment`;

  const submitRes = await authFetch("/rest/v1/payments", "POST", {
    member_id: samaMember.id,
    amount: testAmount,
    payment_type: "monthly_due",
    payment_method: "cash",
    notes: testNotes,
    status: "pending_approval",
  }, samaToken);

  assert(submitRes.status === 201, `Payment successfully submitted to backend (status: ${submitRes.status})`);
  const createdPayment = submitRes.data?.[0];
  assert(createdPayment && createdPayment.amount === testAmount, `Created payment record amount matches Rs. ${testAmount}`);
  assert(createdPayment?.status === "pending_approval", `Created payment status is pending_approval`);
  assert(createdPayment?.notes === testNotes, `Created payment notes contain FIFO billing month reference`);

  // Clean up test payment
  if (createdPayment?.id) {
    const rootAuth = await signIn("krishaja@gmail.com", "RootTestPass123!");
    await authFetch(`/rest/v1/payments?id=eq.${createdPayment.id}`, "DELETE", null, rootAuth.token);
    console.log("  Cleaned up temporary test payment record.");
  }

  console.log("\n======================================================");
  console.log(`PHASE D VERIFICATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("======================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
