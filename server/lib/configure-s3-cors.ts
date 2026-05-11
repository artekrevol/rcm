import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

/**
 * Ensures the S3 bucket has a CORS rule that allows browser-direct PUT uploads
 * (presigned URLs). Without this rule, the browser's preflight OPTIONS request
 * is rejected by S3 and fetch() throws a network error.
 *
 * Called once at server startup. Idempotent — safe to call repeatedly.
 * No-ops silently if S3_BUCKET_NAME or AWS credentials are not configured
 * (e.g. local dev without AWS).
 */
export async function configureS3Cors(): Promise<void> {
  const bucket = process.env.S3_BUCKET_NAME?.trim();
  const region = process.env.AWS_REGION?.trim();
  if (!bucket || !region) return;

  const s3 = new S3Client({ region });

  const corsRule = {
    AllowedHeaders: ["Content-Type", "content-type"],
    AllowedMethods: ["PUT"],
    AllowedOrigins: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  };

  try {
    // Check if rule already matches to avoid unnecessary PutBucketCors calls.
    const existing = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    const already = existing.CORSRules?.some(
      (r) =>
        r.AllowedMethods?.includes("PUT") &&
        r.AllowedOrigins?.includes("*") &&
        r.AllowedHeaders?.some((h) => h === "Content-Type" || h === "*")
    );
    if (already) {
      console.log("[s3-cors] CORS already configured — skipping.");
      return;
    }
  } catch {
    // GetBucketCors throws NoSuchCORSConfiguration if no rule exists — proceed to set it.
  }

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: [corsRule] },
    })
  );

  console.log(`[s3-cors] CORS configured on bucket ${bucket}: PUT allowed from all origins.`);
}
