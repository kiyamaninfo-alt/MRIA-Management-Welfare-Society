// Digital Receipt Generator Module
import { getLanguage } from "./i18n.js";

export function renderReceiptHtml(payment, memberName, verifierName = "භාණ්ඩාගාරික / Treasurer") {
  const isSi = getLanguage() === "si";
  const paymentObj = payment || {};
  const receiptNum = paymentObj.id
    ? `MRIA-REC-${paymentObj.id.slice(0, 8).toUpperCase()}`
    : `MRIA-REC-${Math.floor(1000 + Math.random() * 9000)}`;

  const rawDate = paymentObj.paid_at || paymentObj.verified_at || paymentObj.created_at || new Date().toISOString();
  const dateObj = new Date(rawDate);
  const dateStr = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleString("en-GB", {
        timeZone: "Asia/Colombo",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : new Date().toISOString().slice(0, 10);

  const categoryNamesEn = {
    monthly_due: "Monthly Due",
    admission_fee: "Admission Fee",
    donation: "Donation / Aid",
  };

  const categoryNamesSi = {
    monthly_due: "මාසික දායක මුදල",
    admission_fee: "ඇතුල්වීමේ ගාස්තුව",
    donation: "ආධාර මුදල්",
  };

  const methodNamesEn = {
    bank_transfer: "Bank Transfer",
    cash: "Direct Cash",
  };

  const methodNamesSi = {
    bank_transfer: "බැංකු තැන්පතු",
    cash: "අතින් දුන් මුදල්",
  };

  const paymentTypeKey = paymentObj.payment_type || "monthly_due";
  const paymentMethodKey = paymentObj.payment_method || "cash";
  const amountVal = Number(paymentObj.amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const payerName = memberName || (isSi ? "සංගමයේ සාමාජික" : "Association Member");

  const title = isSi ? "MRIA කළමනාකාර සුබසාධක සංගමය" : "MRIA Management Welfare Association";
  const subtitle = isSi ? "නිල ඩිජිටල් රිසිට්පත" : "Official Digital Voucher & Receipt";
  const recLabel = isSi ? "රිසිට්පත් අංකය:" : "Receipt No:";
  const dateLabel = isSi ? "දිනය හා වේලාව:" : "Date & Time:";
  const payerLabel = isSi ? "මුදල් ගෙවූ සාමාජිකයා:" : "Received From:";
  const catLabel = isSi ? "ගෙවීම් කාණ්ඩය:" : "Payment Category:";
  const methodLabel = isSi ? "ගෙවූ ආකාරය:" : "Payment Method:";
  const amountLabel = isSi ? "ලැබුණු මුළු මුදල" : "Total Amount Received";
  const verifiedLabel = isSi ? "තහවුරු කර ලෙජරයේ සටහන් කරන ලදී" : "Verified & Settled in Ledger";
  const authByLabel = isSi ? "තහවුරු කළේ:" : "Authenticated by:";
  const printBtnText = isSi ? "මුද්‍රණය / PDF සුරකින්න" : "Print / Save PDF";

  const categoryDisplay = isSi ? (categoryNamesSi[paymentTypeKey] || paymentTypeKey) : (categoryNamesEn[paymentTypeKey] || paymentTypeKey);
  const methodDisplay = isSi ? (methodNamesSi[paymentMethodKey] || paymentMethodKey) : (methodNamesEn[paymentMethodKey] || paymentMethodKey);

  return `
    <div id="printableReceipt" class="p-6 bg-white border border-slate-200 rounded-2xl max-w-md mx-auto font-sans text-slate-800 shadow-sm print:border-none print:shadow-none ${isSi ? "lang-si" : ""}">
      <!-- Header -->
      <div class="text-center pb-4 border-b border-slate-200">
        <h2 class="text-lg font-bold text-sky-800 tracking-tight">${title}</h2>
        <span class="inline-block mt-2 px-3 py-1 text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
          ${subtitle}
        </span>
      </div>

      <!-- Receipt Meta -->
      <div class="py-4 space-y-2 text-sm border-b border-slate-100">
        <div class="flex justify-between">
          <span class="text-slate-500">${recLabel}</span>
          <span class="font-mono font-semibold text-slate-900">${receiptNum}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">${dateLabel}</span>
          <span class="font-medium text-slate-700">${dateStr}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">${payerLabel}</span>
          <span class="font-semibold text-slate-900">${payerName}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">${catLabel}</span>
          <span class="font-medium text-slate-700">${categoryDisplay}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">${methodLabel}</span>
          <span class="font-medium text-slate-700">${methodDisplay}</span>
        </div>
      </div>

      <!-- Amount -->
      <div class="py-4 text-center bg-slate-50 rounded-xl my-3 border border-slate-100">
        <span class="text-xs text-slate-500 uppercase tracking-wider block font-medium mb-1">${amountLabel}</span>
        <span class="text-2xl font-bold text-slate-900">Rs. ${amountVal}</span>
      </div>

      <!-- Verification Footer -->
      <div class="pt-2 text-center text-xs text-slate-500 space-y-1">
        <p class="text-emerald-600 font-semibold flex items-center justify-center gap-1">
          <span class="material-symbols-outlined text-[16px]">verified</span> ${verifiedLabel}
        </p>
        <p class="text-[11px] text-slate-400">${authByLabel} ${verifierName}</p>
        <p class="text-[10px] text-slate-400">Mattala Rajapaksa International Airport (MRIA)</p>
      </div>

      <!-- Print Button (Hidden during print) -->
      <div class="mt-5 flex gap-2 print:hidden">
        <button onclick="window.print()" class="flex-1 py-2.5 px-4 bg-sky-700 hover:bg-sky-800 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow">
          <span class="material-symbols-outlined text-[18px]">print</span> ${printBtnText}
        </button>
      </div>
    </div>
  `;
}
