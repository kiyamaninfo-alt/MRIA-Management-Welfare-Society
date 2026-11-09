import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") || "2d2c1e1d9771b3617b5649eafa1e1885";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") || "c85474fe67c365c981fc37de64eb9931";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") || "438ff1d076a0b53aa4f8781f504b7c5d2d8350c9e185423881f35f3d19a94866";
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") || "mria-slips-private";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://aqbpanrsotkpnqxhlces.supabase.co";
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

    // Verify member registration and approval
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, is_approved")
      .eq("user_id", user.id)
      .single();

    if (memberError || !member || !member.is_approved) {
      return new Response(JSON.stringify({ error: "User is not an approved member" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileName, fileType, fileSize, folder } = await req.json();

    // Validation
    const allowedMime = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowedMime.includes(fileType)) {
      return new Response(JSON.stringify({ error: "Invalid file type. Allowed: JPEG, PNG, PDF" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fileSize || fileSize > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File exceeds maximum allowed size of 5 MB" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetFolder = folder === "claims" ? "claims" : "slips";
    const ext = fileName ? fileName.split(".").pop() : "jpg";
    const yearMonth = new Date().toISOString().slice(0, 7);
    const uniqueId = crypto.randomUUID();
    const slipKey = `${targetFolder}/${yearMonth}/${member.id}_${uniqueId}.${ext}`;

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: slipKey,
      ContentType: fileType,
    });

    // 10-minute presigned PUT URL
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });

    return new Response(
      JSON.stringify({ uploadUrl, slipKey, key: slipKey }),
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
