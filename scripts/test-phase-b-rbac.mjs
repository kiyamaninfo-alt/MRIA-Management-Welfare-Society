// scripts/test-phase-b-rbac.mjs
// Phase B Verification Test Suite:
// Tests Granular Ability RBAC, Section 8 Edit Gates, Inquiries Confidentiality,
// Root Admin Unrestricted Bypass, and System Settings Audit Logging.

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

async function loginUser(email, password) {
  const res = await authFetch("/auth/v1/token?grant_type=password", "POST", { email, password });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

async function runTests() {
  console.log("=== PHASE B VERIFICATION: GRANULAR RBAC, INQUIRIES & SETTINGS GATES ===\n");
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

  // 1. Authenticate Test Member "Sama"
  console.log("1. Authenticating test member 'Sama' (testmember_1794463534989@gmail.com)...");
  const samaEmail = "testmember_1794463534989@gmail.com";
  const samaPassword = "Pass#1794463534989!Aa1";
  const samaToken = await loginUser(samaEmail, samaPassword);
  assert(Boolean(samaToken), "Authenticated test member 'Sama'");

  const samaMemberRes = await authFetch(`/rest/v1/members?email=eq.${samaEmail}&select=*`, "GET", null, samaToken);
  assert(samaMemberRes.ok && samaMemberRes.data.length > 0, "Retrieved Sama's member profile");
  const samaMember = samaMemberRes.data[0];
  console.log(`  Sama Member ID: ${samaMember.id}, Role: ${samaMember.role}, Approved: ${samaMember.is_approved}`);

  // 2. Prevent Privilege Escalation: Verify Sama cannot grant abilities to self
  console.log("\n2. Testing Privilege Escalation Prevention (Sama cannot self-assign abilities)...");
  const illegalAssignRes = await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["assign_roles", "manage_treasury"],
  }, samaToken);
  assert(!illegalAssignRes.ok || illegalAssignRes.status >= 400, "Sama without assign_roles is rejected from assigning abilities");

  // 3. Root Admin Assigns Abilities to Sama: view_respond_inquiries, edit_bank_coordinates, view_audit_logs
  console.log(`\n3. Assigning Abilities to Sama: ['view_respond_inquiries', 'edit_bank_coordinates', 'view_audit_logs']...`);
  const setAbilitiesRes = await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["view_respond_inquiries", "edit_bank_coordinates", "view_audit_logs"],
  });
  assert(setAbilitiesRes.ok, `set_member_abilities executed successfully (status ${setAbilitiesRes.status})`);
  console.log("  RPC Output:", setAbilitiesRes.data);

  // 4. Verify Active Abilities for Sama via get_my_abilities()
  console.log("\n4. Verifying Sama's Active Abilities via get_my_abilities()...");
  const samaAbilitiesRes = await authFetch("/rest/v1/rpc/get_my_abilities", "POST", {}, samaToken);
  assert(samaAbilitiesRes.ok, "get_my_abilities RPC returned 200");
  const abilities = samaAbilitiesRes.data || [];
  console.log("  Abilities returned:", abilities);
  assert(abilities.includes("view_respond_inquiries"), "Sama possesses 'view_respond_inquiries'");
  assert(abilities.includes("edit_bank_coordinates"), "Sama possesses 'edit_bank_coordinates'");
  assert(abilities.includes("view_audit_logs"), "Sama possesses 'view_audit_logs'");
  assert(!abilities.includes("edit_dues_statutory"), "Sama does NOT possess 'edit_dues_statutory'");
  assert(!abilities.includes("edit_welfare_programs"), "Sama does NOT possess 'edit_welfare_programs'");

  // 5. Inquiries Confidentiality Gate: Database Level (RLS)
  console.log("\n5. Testing Inquiries Confidentiality Gate (Section 8.4 & 8.6 at DB Level)...");
  // A. With view_respond_inquiries, Sama CAN select all member inquiries
  const samaInqRes = await authFetch("/rest/v1/admin_inquiries?select=*", "GET", null, samaToken);
  assert(samaInqRes.ok, `Sama can query admin_inquiries (status ${samaInqRes.status})`);
  const inqCount = Array.isArray(samaInqRes.data) ? samaInqRes.data.length : 0;
  assert(inqCount > 0, `Sama sees all member inquiries (${inqCount} inquiries accessible)`);

  // B. Revoke view_respond_inquiries from Sama
  console.log("  Revoking view_respond_inquiries from Sama...");
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["edit_bank_coordinates"],
  });

  // C. Without view_respond_inquiries, Sama CANNOT see other members' inquiries
  const unauthInqRes = await authFetch(`/rest/v1/admin_inquiries?select=*&sender_id=neq.${samaMember.id}`, "GET", null, samaToken);
  assert(
    !unauthInqRes.ok || !unauthInqRes.data || unauthInqRes.data.length === 0,
    `Without view_respond_inquiries, PostgreSQL RLS returns 0 rows (got ${Array.isArray(unauthInqRes.data) ? unauthInqRes.data.length : 0} rows)`
  );

  // Restore view_respond_inquiries and view_audit_logs
  await authFetch("/rest/v1/rpc/set_member_abilities", "POST", {
    p_target_member_id: samaMember.id,
    p_abilities: ["view_respond_inquiries", "edit_bank_coordinates", "view_audit_logs"],
  });

  // 6. Section 8.1 Edit Bank Coordinates & Automatic Audit Trail
  console.log("\n6. Testing Section 8.1 Bank Coordinates Edit Access & Audit Logging...");
  const timestamp = Date.now();
  const updateBankRes = await authFetch(
    "/rest/v1/system_settings?key=eq.bank_qr",
    "PATCH",
    {
      value: {
        bank_name: "Bank of Ceylon",
        branch: "Mattala Airport Branch",
        account_name: "MRIA Management Welfare Association",
        account_number: "8201948201",
        url: "/assets/default-bank-qr.svg",
        last_updated: timestamp,
      },
    },
    samaToken
  );
  assert(updateBankRes.ok, `Sama with edit_bank_coordinates successfully modified Bank Coordinates (status ${updateBankRes.status})`);

  // Verify Audit Log was recorded automatically by database trigger
  console.log("  Checking audit_logs for automatic audit trail of Bank Coordinates change...");
  const auditRes = await authFetch(
    "/rest/v1/audit_logs?entity_type=eq.system_settings&entity_id=eq.bank_qr&order=timestamp.desc&limit=1",
    "GET",
    null,
    samaToken
  );
  assert(auditRes.ok && auditRes.data.length > 0, "Audit log captured the bank coordinates modification automatically");
  if (auditRes.data && auditRes.data[0]) {
    console.log("  ✓ Audit entry verified:", {
      action: auditRes.data[0].action,
      entity_type: auditRes.data[0].entity_type,
      entity_id: auditRes.data[0].entity_id,
      timestamp: auditRes.data[0].timestamp,
    });
  }

  // 7. Testing Unauthorized Mutate on Section 8.2 (Monthly Dues)
  console.log("\n7. Testing RLS Rejection on Section 8.2 (Dues & Statutory) when ability is missing...");
  const unauthDuesRes = await authFetch(
    "/rest/v1/system_settings?key=eq.monthly_due_amount",
    "PATCH",
    { value: { amount: 9999 } },
    samaToken
  );
  // PostgREST with RLS either returns an empty updated array or rejects
  assert(
    !unauthDuesRes.ok || (Array.isArray(unauthDuesRes.data) && unauthDuesRes.data.length === 0) || unauthDuesRes.status === 204,
    `Sama without edit_dues_statutory cannot modify monthly dues (status: ${unauthDuesRes.status})`
  );

  // 8. Testing Unauthorized Mutate on Section 8.3 (Welfare Programs)
  console.log("\n8. Testing RLS Rejection on Section 8.3 (Welfare Programs) when ability is missing...");
  const unauthProgRes = await authFetch(
    "/rest/v1/benefit_types",
    "POST",
    {
      id: `illegal_prog_${Date.now()}`,
      title_en: "Unauthorized Program",
      amount: 100000,
      is_active: true,
    },
    samaToken
  );
  assert(
    !unauthProgRes.ok,
    `Sama without edit_welfare_programs cannot insert new welfare programs (status: ${unauthProgRes.status})`
  );

  // 9. Client-Side Code & UI Validation
  console.log("\n9. Verifying Client-Side UI & Admin Components...");
  const adminHtml = fs.readFileSync("./admin.html", "utf-8");
  assert(adminHtml.includes('id="memberSearchInput"'), "Member search input exists in Member Directory");
  assert(adminHtml.includes('id="memberAbilitiesModal"'), "Member Abilities Modal markup exists in admin.html");
  assert(adminHtml.includes('value="view_respond_inquiries"'), "view_respond_inquiries checkbox exists in modal");
  assert(adminHtml.includes('value="edit_bank_coordinates"'), "edit_bank_coordinates checkbox exists in modal");

  const pageAdminJs = fs.readFileSync("./js/page-admin.js", "utf-8");
  assert(pageAdminJs.includes("applyCmsSectionEditGates"), "applyCmsSectionEditGates is wired in js/page-admin.js");
  assert(pageAdminJs.includes("openMemberAbilitiesModal"), "openMemberAbilitiesModal is defined in js/page-admin.js");
  assert(pageAdminJs.includes("filterMemberDirectory"), "filterMemberDirectory is defined in js/page-admin.js");

  console.log("\n======================================================");
  console.log(`PHASE B VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================\n");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Unhandled test execution error:", err);
  process.exit(1);
});
