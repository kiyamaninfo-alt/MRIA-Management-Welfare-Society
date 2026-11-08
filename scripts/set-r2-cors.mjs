import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

// Simple .env parser if process.env values are not set
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim() || "2d2c1e1d9771b3617b5649eafa1e1885";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim() || "c85474fe67c365c981fc37de64eb9931";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim() || "438ff1d076a0b53aa4f8781f504b7c5d2d8350c9e185423881f35f3d19a94866";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME?.trim() || "mria-slips-private";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  console.log(`Setting CORS for R2 bucket: ${R2_BUCKET_NAME} on account: ${R2_ACCOUNT_ID}...`);

  const corsRules = [
    {
      AllowedOrigins: ["*"],
      AllowedMethods: ["GET", "PUT", "POST", "HEAD", "DELETE"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "Content-Type", "Content-Length", "x-amz-request-id", "x-amz-checksum-crc32"],
      MaxAgeSeconds: 3600,
    },
  ];

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: corsRules,
      },
    })
  );

  console.log("CORS updated successfully! Fetching current CORS configuration to verify...");

  const getCors = await s3.send(
    new GetBucketCorsCommand({
      Bucket: R2_BUCKET_NAME,
    })
  );

  console.log("Current CORS Rules:", JSON.stringify(getCors.CORSRules, null, 2));
}

main().catch((err) => {
  console.error("Error setting CORS:", err);
  process.exit(1);
});
