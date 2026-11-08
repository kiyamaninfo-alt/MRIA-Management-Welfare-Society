// Digital Receipt Generator Module

export function renderReceiptHtml(payment, memberName, verifierName = "Association Treasurer") {
  const receiptNum = `MRIA-REC-${payment.id.slice(0, 8).toUpperCase()}`;
  const dateStr = new Date(payment.verified_at || payment.created_at).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const categoryNames = {
    monthly_due: "Monthly Due (මාසික දායක මුදල)",
    admission_fee: "Admission Fee (ඇතුල්වීමේ ගාස්තුව)",
    donation: "Donation / Aid (ආධාර මුදල්)",
  };

  const methodNames = {
    bank_transfer: "Bank Transfer (බැංකු තැන්පතු)",
    cash: "Direct Cash (අතින් මුදල්)",
  };

  return `
    <div id="printableReceipt" class="p-6 bg-white border border-slate-200 rounded-lg max-w-md mx-auto font-sans text-slate-800 shadow-sm print:border-none print:shadow-none">
      <!-- Header -->
      <div class="text-center pb-4 border-b border-slate-200">
        <h2 class="text-xl font-bold text-sky-700 tracking-tight">MRIA Management Welfare Association</h2>
        <p class="text-xs text-slate-500 font-medium mt-0.5">MRIA සුබසාධක කළමනාකරණ සංගමය</p>
        <span class="inline-block mt-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
          Official Digital Receipt
        </span>
      </div>

      <!-- Receipt Meta -->
      <div class="py-4 space-y-2 text-sm border-b border-slate-100">
        <div class="flex justify-between">
          <span class="text-slate-500">Receipt No:</span>
          <span class="font-mono font-semibold text-slate-900">${receiptNum}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">Date & Time:</span>
          <span class="font-medium text-slate-700">${dateStr}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">Received From:</span>
          <span class="font-semibold text-slate-900">${memberName}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">Payment Category:</span>
          <span class="font-medium text-slate-700">${categoryNames[payment.payment_type] || payment.payment_type}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-slate-500">Payment Method:</span>
          <span class="font-medium text-slate-700">${methodNames[payment.payment_method] || payment.payment_method}</span>
        </div>
      </div>

      <!-- Amount -->
      <div class="py-4 text-center bg-slate-50 rounded my-3 border border-slate-100">
        <span class="text-xs text-slate-500 uppercase tracking-wider block font-medium">Amount Received</span>
        <span class="text-2xl font-bold text-slate-900">Rs. ${Number(payment.amount).toFixed(2)}</span>
      </div>

      <!-- Verification Footer -->
      <div class="pt-2 text-center text-xs text-slate-500 space-y-1">
        <p class="text-emerald-600 font-medium flex items-center justify-center gap-1">
          <span class="material-symbols-outlined text-[16px]">verified</span> Verified & Settle in Ledger
        </p>
        <p class="text-[11px] text-slate-400">Authenticated by: ${verifierName}</p>
        <p class="text-[10px] text-slate-400">Mattala Rajapaksa International Airport (MRIA)</p>
      </div>

      <!-- Print Button (Hidden during print) -->
      <div class="mt-5 flex gap-2 print:hidden">
        <button onclick="window.print()" class="flex-1 py-2 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded text-sm font-medium flex items-center justify-center gap-1.5 transition-colors">
          <span class="material-symbols-outlined text-[18px]">print</span> Print / Save PDF
        </button>
      </div>
    </div>
  `;
}
