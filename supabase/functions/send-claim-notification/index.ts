import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface ClaimPayload {
  claimId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://aqbpanrsotkpnqxhlces.supabase.co";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_CjtgAQJgXXLWI-FOft-wzQ_3sekCrWa";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");

    // User client to verify the caller
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ClaimPayload = await req.json();
    if (!body || !body.claimId) {
      return new Response(JSON.stringify({ error: "claimId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use admin client if service role key available, otherwise fallback to userClient
    const dbClient = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
      : userClient;

    // Fetch claim details with member and benefit type information
    const { data: claim, error: claimError } = await dbClient
      .from("benefit_claims")
      .select(`
        id,
        claim_amount,
        notes,
        status,
        created_at,
        member_id,
        members:member_id (
          id,
          full_name,
          email,
          epf_number,
          designation
        ),
        benefit_types:benefit_type_id (
          title_en,
          title_si
        )
      `)
      .eq("id", body.claimId)
      .single();

    if (claimError || !claim) {
      return new Response(JSON.stringify({ error: "Claim not found: " + (claimError?.message || "") }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch committee officials to notify
    const { data: officials, error: offError } = await dbClient
      .from("members")
      .select("email, full_name, role")
      .eq("is_approved", true)
      .in("role", ["admin", "manager", "secretary", "treasurer", "committee_member"]);

    const officialEmails = officials ? officials.map((o: any) => o.email).filter(Boolean) : [];

    const memberData: any = Array.isArray(claim.members) ? claim.members[0] : claim.members;
    const benefitData: any = Array.isArray(claim.benefit_types) ? claim.benefit_types[0] : claim.benefit_types;
    
    const memberName = memberData?.full_name || "Unknown Member";
    const memberEpf = memberData?.epf_number || "N/A";
    const memberDesignation = memberData?.designation || "N/A";
    const benefitTitle = benefitData ? `${benefitData.title_si || ""} (${benefitData.title_en || ""})` : "General Benefit";
    const amountFormatted = Number(claim.claim_amount).toLocaleString("en-US", {
      minimumFractionDigits: 2,
    });

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      console.log(`[send-claim-notification] RESEND_API_KEY not configured. Simulated dispatch for claim ${claim.id} to ${officialEmails.length} officials.`);
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: "Notification logged; email gateway pending RESEND_API_KEY configuration.",
          recipientCount: officialEmails.length,
          claimId: claim.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (officialEmails.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No active committee members found to notify.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Send via Resend API
    const emailSubject = `[MRIA Welfare] New Benefit Claim: ${benefitTitle} - ${memberName} (EPF: ${memberEpf})`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">MRIA කළමනාකාර සුබසාධක සංගමය</h2>
        <h3 style="color: #334155;">New Welfare Benefit Claim Submitted</h3>
        <p>A new welfare grant application has been submitted and is pending committee review:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Applicant Name:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${memberName}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">EPF Number:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${memberEpf}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Designation:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${memberDesignation}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Benefit Type:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${benefitTitle}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Amount Requested:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #166534; font-weight: bold;">LKR ${amountFormatted}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Description / Notes:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${claim.notes || "None provided"}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Submitted Date:</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${new Date(claim.created_at).toLocaleString()}</td></tr>
        </table>
        <p>Please log in to the Administrative Management Console to inspect the attached supporting documents and process this request.</p>
        <footer style="margin-top: 30px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px;">
          © MRIA කළමනාකාර සුබසාධක සංගමය — Automated System Notification
        </footer>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MRIA Welfare Association <onboarding@resend.dev>",
        to: officialEmails,
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();

    return new Response(
      JSON.stringify({
        success: resendRes.ok,
        resend: resendData,
        recipientCount: officialEmails.length,
      }),
      {
        status: resendRes.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[send-claim-notification] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
