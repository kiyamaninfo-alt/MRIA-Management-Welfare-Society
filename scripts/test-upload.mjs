import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";

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

async function testUpload() {
  const testKey = `slips/test/test-${Date.now()}.pdf`;
  const fileType = "application/pdf";
  const dummyPdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF";

  console.log("1. Generating presigned PUT URL...");
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: testKey,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
  console.log("Presigned PUT URL generated:", uploadUrl);

  console.log("2. Simulating browser fetch PUT...");
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": fileType,
    },
    body: dummyPdf,
  });

  console.log("PUT Response Status:", putRes.status, putRes.statusText);
  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error("PUT Error Response:", errText);
    throw new Error(`Upload failed: ${putRes.status}`);
  }

  console.log("3. Generating presigned GET URL to verify download...");
  const getCommand = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: testKey,
  });
  const getUrl = await getSignedUrl(s3, getCommand, { expiresIn: 600 });
  const getRes = await fetch(getUrl);
  console.log("GET Response Status:", getRes.status);
  const downloadedText = await getRes.text();
  console.log("Downloaded match:", downloadedText === dummyPdf);

  console.log("✅ All storage tests passed successfully!");
}

testUpload().catch(console.error);
