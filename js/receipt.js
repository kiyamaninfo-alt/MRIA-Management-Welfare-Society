// Digital Receipt Generator Module
import { getLanguage } from "./i18n.js";

export async function shareReceipt(payment, memberName, verifierName) {
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

  const amountVal = Number(paymentObj.amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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

  const paymentTypeKey = paymentObj.payment_type || "monthly_due";
  const categoryDisplay = isSi ? (categoryNamesSi[paymentTypeKey] || paymentTypeKey) : (categoryNamesEn[paymentTypeKey] || paymentTypeKey);
  const payerName = memberName || (isSi ? "සංගමයේ සාමාජික" : "Association Member");

  const shareText = `*MRIA Management Welfare Association*\n` +
    `*Official Digital Voucher / Receipt*\n` +
    `--------------------------------\n` +
    `📄 Receipt No: ${receiptNum}\n` +
    `👤 Member: ${payerName}\n` +
    `📅 Date: ${dateStr}\n` +
    `🏷 Category: ${categoryDisplay}\n` +
    `💰 Amount: Rs. ${amountVal}\n` +
    `✅ Status: Verified & Settled in Ledger\n` +
    `✍️ Authenticated By: ${verifierName || "Treasurer"}\n` +
    `--------------------------------\n` +
    `Mattala Rajapaksa International Airport (MRIA)`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: `MRIA Welfare Receipt - ${receiptNum}`,
        text: shareText,
      });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn("navigator.share failed, fallback to clipboard/whatsapp:", err);
    }
  }

  // Fallback: copy to clipboard
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareText);
      alert(isSi ? "රිසිට්පත් තොරතුරු පිටපත් කරන ලදී! ඔබට එය WhatsApp හරහා යැවිය හැක." : "Receipt details copied to clipboard! You can paste and share via WhatsApp or Message.");
      return;
    }
  } catch (clipErr) {
    console.warn("Clipboard copy failed:", clipErr);
  }

  // Second fallback: direct WhatsApp share link
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  window.open(waUrl, "_blank");
}

if (typeof window !== "undefined") {
  window.shareReceipt = shareReceipt;
  window.shareCurrentReceipt = function () {
    if (window.__lastReceiptData) {
      shareReceipt(
        window.__lastReceiptData.payment,
        window.__lastReceiptData.memberName,
        window.__lastReceiptData.verifierName
      );
    }
  };
}

export function renderReceiptHtml(payment, memberName, verifierName = "භාණ්ඩාගාරික / Treasurer") {
  const isSi = getLanguage() === "si";
  const paymentObj = payment || {};

  // Store for global share handler
  if (typeof window !== "undefined") {
    window.__lastReceiptData = { payment, memberName, verifierName };
  }

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
  const printBtnText = isSi ? "මුද්‍රණය / PDF" : "Print / PDF";
  const shareBtnText = isSi ? "බෙදාගන්න" : "Share Receipt";

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

      <!-- Print and Share Buttons (Hidden during print) -->
      <div class="mt-5 grid grid-cols-2 gap-2.5 print:hidden">
        <button type="button" onclick="window.print()" class="py-2.5 px-3 bg-sky-700 hover:bg-sky-800 text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors shadow">
          <span class="material-symbols-outlined text-[18px]">print</span>
          <span>${printBtnText}</span>
        </button>
        <button type="button" onclick="window.shareCurrentReceipt()" class="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors shadow">
          <span class="material-symbols-outlined text-[18px]">share</span>
          <span>${shareBtnText}</span>
        </button>
      </div>
    </div>
  `;
}
