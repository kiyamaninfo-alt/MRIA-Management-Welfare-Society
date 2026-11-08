import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") || "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") || "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") || "";
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") || "mria-slips-private";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine requested slip_key from query param or body
    const url = new URL(req.url);
    let slipKey = url.searchParams.get("slip_key");
    if (!slipKey && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      slipKey = body.slipKey || body.slip_key;
    }

    if (!slipKey) {
      return new Response(JSON.stringify({ error: "Missing slip_key parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch caller's member record and role
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, role, is_approved")
      .eq("user_id", user.id)
      .single();

    if (memberError || !member || !member.is_approved) {
      return new Response(JSON.stringify({ error: "Forbidden: Not an active member" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStaff = ["admin", "manager", "official", "treasurer"].includes(member.role);

    if (!isStaff) {
      // General member can only view slips for their own payments
      const { data: ownPayment } = await supabaseAdmin
        .from("payments")
        .select("id")
        .eq("member_id", member.id)
        .eq("slip_key", slipKey)
        .maybeSingle();

      if (!ownPayment) {
        return new Response(JSON.stringify({ error: "Access denied to requested slip" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: slipKey,
    });

    // 15-minute presigned GET URL (900 seconds)
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return new Response(
      JSON.stringify({ signedUrl, expiresIn: 900 }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
