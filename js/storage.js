import { CONFIG } from "./config.js";
import { getCurrentSession } from "./auth.js";

/**
 * Uploads a file (bank slip or welfare claim document) to Cloudflare R2 via presigned PUT URL.
 */
export async function uploadStorageFile(file, folder = "slips") {
  if (!navigator.onLine) {
    throw new Error("Cannot upload file while offline. Please connect to the internet.");
  }

  // Client validation
  const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Invalid file type. Only JPEG, PNG, and PDF files are accepted.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("File exceeds maximum allowed size of 5 MB.");
  }

  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("Authentication required to upload files.");
  }

  // 1. Request presigned PUT URL from Supabase Edge Function
  const res = await fetch(`${CONFIG.FUNCTIONS_URL}/upload-slip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      folder,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to initiate file upload (${res.status})`);
  }

  const { uploadUrl, slipKey, key } = await res.json();
  const fileKey = key || slipKey;

  // 2. Direct PUT binary to Cloudflare R2 presigned URL
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
    },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload to storage failed (${uploadRes.status})`);
  }

  return fileKey;
}

/**
 * Backward compatibility alias for uploading bank slips.
 */
export const uploadBankSlip = (file) => uploadStorageFile(file, "slips");

/**
 * Retrieves a temporary 15-minute presigned GET URL to view a bank slip.
 */
export async function getSignedSlipUrl(slipKey) {
  if (!slipKey) return null;

  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("Authentication required to view bank slip.");
  }

  const res = await fetch(`${CONFIG.FUNCTIONS_URL}/get-slip-url?slip_key=${encodeURIComponent(slipKey)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to get signed slip URL (${res.status})`);
  }

  const { signedUrl } = await res.json();
  return signedUrl;
}
