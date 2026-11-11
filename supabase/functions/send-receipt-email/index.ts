const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface ReceiptEmailPayload {
  paymentId?: string;
  claimId?: string;
  isGrant?: boolean;
  voucherType?: string;
  recipientEmail: string;
  recipientName: string;
  recipientEpf?: string;
  receiptNumber: string;
  amount: number;
  paymentType: string;
  paymentMethod?: string;
  paidAt?: string;
  notes?: string;
  collectedByName?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://aqbpanrsotkpnqxhlces.supabase.co";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_CjtgAQJgXXLWI-FOft-wzQ_3sekCrWa";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ReceiptEmailPayload = await req.json();
    if (!body || !body.recipientEmail || !body.receiptNumber) {
      return new Response(JSON.stringify({ error: "recipientEmail and receiptNumber are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      recipientEmail,
      recipientName,
      recipientEpf,
      receiptNumber,
      amount,
      paymentType,
      paymentMethod,
      paidAt,
      notes,
      collectedByName,
    } = body;

    const formattedAmount = Number(amount || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const categoryNamesEn: Record<string, string> = {
      monthly_due: "Monthly Due Contribution",
      admission_fee: "New Member Statutory Admission Fee",
      donation: "Voluntary Donation / Welfare Aid",
    };
    const categoryNamesSi: Record<string, string> = {
      monthly_due: "මාසික දායක මුදල",
      admission_fee: "නව සාමාජික ඇතුල්වීමේ ගාස්තුව",
      donation: "සුබසාධන ආධාර මුදල්",
    };

    const catEn = categoryNamesEn[paymentType] || paymentType;
    const catSi = categoryNamesSi[paymentType] || "";

    const methodNames: Record<string, string> = {
      cash: "Direct Cash Float (අතින් දුන් මුදල් / භාණ්ඩාගාරය)",
      bank_transfer: "Bank Transfer / Direct Deposit (බැංකු තැන්පතු)",
      qr_payment: "LankaQR / QR Scan (QR ගෙවීම්)",
      slip: "Bank Deposit Slip (බැංකු රිසිට්පත්)",
    };
    const methodDisplay = methodNames[paymentMethod || "cash"] || (paymentMethod || "Direct Cash Float");

    const isGrantVoucher = Boolean(body.isGrant || body.voucherType === "grant" || (receiptNumber && receiptNumber.includes("GRNT")));

    // Format date in Sri Lanka Time
    const dateObj = paidAt ? new Date(paidAt) : new Date();
    const formattedDate = dateObj.toLocaleString("en-GB", {
      timeZone: "Asia/Colombo",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const emailSubject = isGrantVoucher
      ? `[MRIA Welfare Grant] Benefit Disbursement Voucher: ${receiptNumber} (Rs. ${formattedAmount})`
      : `[MRIA Welfare Receipt] Payment Confirmation: ${receiptNumber} (Rs. ${formattedAmount})`;

    const emailHtml = isGrantVoucher
      ? `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
        <!-- Header -->
        <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #0c4a6e; margin: 0 0 6px 0; font-size: 20px; font-weight: 800;">
            MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය
          </h2>
          <div style="font-size: 13px; color: #0284c7; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
            Mattala Rajapaksa International Airport • Management Welfare Association
          </div>
          <div style="margin-top: 10px; display: inline-block; padding: 4px 12px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 9999px; color: #065f46; font-size: 12px; font-weight: 700;">
            ✓ Official Benefit Grant Voucher / නිල සුබසාධන ප්‍රදාන වවුචරය
          </div>
        </div>

        <!-- Salutation -->
        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          Dear <strong>${recipientName}</strong>${recipientEpf ? ` (EPF: ${recipientEpf})` : ""},
        </p>
        <p style="font-size: 13px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
          This is your official digital welfare grant disbursement voucher confirming that your welfare benefit payout has been authorized and disbursed from the Society Treasury.
        </p>

        <!-- Voucher Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 40%;">Voucher Number:</td>
            <td style="padding: 10px 14px; font-weight: 700; font-family: monospace; color: #0369a1; border-bottom: 1px solid #e2e8f0;">${receiptNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Disbursement Date & Time:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${formattedDate} (Sri Lanka Time)</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Benefit Program / Facility:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
              ${catEn} ${catSi ? `<span style="color: #0284c7; font-size: 11px;">(${catSi})</span>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Beneficiary Member:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${recipientName} ${recipientEpf ? `(EPF: ${recipientEpf})` : ""}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Authorized & Disbursed By:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${collectedByName || "Welfare Association Treasurer"}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Payment Method:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${methodDisplay}</td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Notes / Remarks:</td>
            <td style="padding: 10px 14px; color: #475569; border-bottom: 1px solid #e2e8f0;">${notes}</td>
          </tr>` : ""}
          <tr style="background-color: #f0fdf4;">
            <td style="padding: 14px; font-weight: 800; color: #166534; font-size: 14px;">Total Amount Disbursed:</td>
            <td style="padding: 14px; font-weight: 800; color: #166534; font-size: 18px;">LKR ${formattedAmount} /=</td>
          </tr>
        </table>

        <!-- Status & Portal link -->
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 24px;">
          This disbursement has been recorded in the Society Treasury Ledger. You can log into your member portal at any time to review your benefit applications and history.
        </p>

        <!-- Footer -->
        <footer style="border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.4;">
          © MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය — Mattala Rajapaksa International Airport<br/>
          Automated Statutory Financial Notification
        </footer>
      </div>
      `
      : `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
        <!-- Header -->
        <div style="text-align: center; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #0c4a6e; margin: 0 0 6px 0; font-size: 20px; font-weight: 800;">
            MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය
          </h2>
          <div style="font-size: 13px; color: #0284c7; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
            Mattala Rajapaksa International Airport • Management Welfare Association
          </div>
          <div style="margin-top: 10px; display: inline-block; padding: 4px 12px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 9999px; color: #065f46; font-size: 12px; font-weight: 700;">
            ✓ Official Digital Payment Receipt / නිල ගෙවීම් රිසිට්පත
          </div>
        </div>

        <!-- Salutation -->
        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          Dear <strong>${recipientName}</strong>${recipientEpf ? ` (EPF: ${recipientEpf})` : ""},
        </p>
        <p style="font-size: 13px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
          Thank you for your payment. This is your official digital payment voucher confirming receipt of cash intake at the Association Treasury Desk.
        </p>

        <!-- Receipt Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 40%;">Receipt Number:</td>
            <td style="padding: 10px 14px; font-weight: 700; font-family: monospace; color: #0369a1; border-bottom: 1px solid #e2e8f0;">${receiptNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Collection Date & Time:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${formattedDate} (Sri Lanka Time)</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Payment Category:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
              ${catEn} ${catSi ? `<span style="color: #0284c7; font-size: 11px;">(${catSi})</span>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Payment Method:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${methodDisplay}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Issued & Authenticated By:</td>
            <td style="padding: 10px 14px; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${collectedByName || "Welfare Association Treasurer"}</td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding: 10px 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Notes / Remarks:</td>
            <td style="padding: 10px 14px; color: #475569; border-bottom: 1px solid #e2e8f0;">${notes}</td>
          </tr>` : ""}
          <tr style="background-color: #f0fdf4;">
            <td style="padding: 14px; font-weight: 800; color: #166534; font-size: 14px;">Total Amount Received:</td>
            <td style="padding: 14px; font-weight: 800; color: #166534; font-size: 18px;">LKR ${formattedAmount} /=</td>
          </tr>
        </table>

        <!-- Status & Portal link -->
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 24px;">
          This transaction has been immediately verified and settled in the Association Cash Book Ledger. You can log into your member dashboard at any time to review your full contribution history.
        </p>

        <!-- Footer -->
        <footer style="border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.4;">
          © MRIA කළමනාකාර අංශයේ සුබසාධක සංගමය — Mattala Rajapaksa International Airport<br/>
          Automated Statutory Financial Notification
        </footer>
      </div>
      `;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      console.log(`[send-receipt-email] RESEND_API_KEY not configured. Simulated dispatch for receipt ${receiptNumber} to ${recipientEmail}`);
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: "Receipt logged; email gateway pending RESEND_API_KEY configuration.",
          recipient: recipientEmail,
          receiptNumber,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MRIA Welfare Association <receipts@resend.dev>",
        to: [recipientEmail],
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();

    return new Response(
      JSON.stringify({
        success: resendRes.ok,
        resend: resendData,
        recipient: recipientEmail,
        receiptNumber,
      }),
      {
        status: resendRes.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[send-receipt-email] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
