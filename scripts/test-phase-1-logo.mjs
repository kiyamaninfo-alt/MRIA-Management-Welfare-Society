// scripts/test-phase-1-logo.mjs
// Phase 1 Verification: Canonical Symbol-Only Emblem Logo & Path Consistency

import fs from "fs";
import path from "path";

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

function run() {
  console.log("=== PHASE 1 VERIFICATION: CANONICAL EMBLEM LOGO & PATH CONSISTENCY ===\n");

  const cwd = process.cwd();
  const logoRelativePath = path.join("assets", "mria-logo.svg");
  const logoFullPath = path.join(cwd, logoRelativePath);

  // 1. Asset File Existence & Geometry
  console.log("1. Inspecting local logo file on disk...");
  assert(fs.existsSync(logoFullPath), `Canonical asset file exists at ${logoRelativePath}`);

  const logoContent = fs.readFileSync(logoFullPath, "utf8");
  assert(logoContent.includes("<svg") && logoContent.includes("</svg>"), "Asset is valid XML/SVG markup");
  assert(logoContent.includes('viewBox="0 0 120 120"'), "viewBox is standardized at '0 0 120 120'");

  // 2. Symbol-Only Invariant: Zero Text Strings Inside SVG
  console.log("\n2. Verifying symbol-only invariant (zero embedded lettering)...");
  assert(!logoContent.includes("<text"), "SVG contains zero <text> elements (symbol-only emblem)");
  assert(!logoContent.toLowerCase().includes("mria"), "SVG contains zero embedded 'MRIA' lettering");
  assert(!logoContent.includes("කළමනාකාර"), "SVG contains zero Sinhala script lettering");

  // 3. Motif Design Components
  console.log("\n3. Verifying required symbolic motifs...");
  assert(logoContent.includes("Left Aviation Wing") || logoContent.includes("Right Aviation Wing"), "Aviation wings vector motif is present");
  assert(logoContent.includes("Protective Welfare Shield"), "Protective welfare shield vector motif is present");
  assert(logoContent.includes("Compass Star"), "Central star/spark navigation motif is present");

  // 4. Page Consumer Linkage Verification
  console.log("\n4. Verifying HTML page consumption...");
  const pages = ["index.html", "dashboard.html", "admin.html", "unauthorized.html"];

  for (const page of pages) {
    const pagePath = path.join(cwd, page);
    assert(fs.existsSync(pagePath), `${page} exists`);
    const pageContent = fs.readFileSync(pagePath, "utf8");

    assert(
      pageContent.includes('src="/assets/mria-logo.svg"'),
      `${page} correctly points to /assets/mria-logo.svg`
    );
    assert(
      !pageContent.includes("lh3.googleusercontent.com/aida/AEtjO1UlQKrv"),
      `${page} contains no external Google-hosted temporary logo URL`
    );
  }

  // 5. Service Worker Precache
  console.log("\n5. Verifying offline service worker caching...");
  const swPath = path.join(cwd, "sw.js");
  if (fs.existsSync(swPath)) {
    const swContent = fs.readFileSync(swPath, "utf8");
    assert(swContent.includes("'/assets/mria-logo.svg'"), "Service worker precaches /assets/mria-logo.svg for offline PWA operation");
  }

  console.log("\n======================================================");
  console.log(`PHASE 1 VERIFICATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("======================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

run();
