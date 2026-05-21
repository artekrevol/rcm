import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

function getS3Client(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION });
}

function getBucket(): string {
  const b = process.env.S3_BUCKET_NAME?.trim();
  if (!b) throw new Error("S3_BUCKET_NAME env var not set");
  return b;
}

export function buildS3Key(
  organizationId: string,
  draftId: string,
  documentType: "va-referral" | "qb-invoice"
): string {
  return `documents/${organizationId}/${draftId}/${documentType}.pdf`;
}

export async function uploadPdfToS3(
  pdfBytes: Buffer,
  organizationId: string,
  draftId: string,
  documentType: "va-referral" | "qb-invoice"
): Promise<string> {
  const s3 = getS3Client();
  const bucket = getBucket();
  const key = buildS3Key(organizationId, draftId, documentType);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBytes,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    })
  );

  return key;
}

export async function getPdfFromS3(s3Key: string): Promise<Buffer> {
  const s3 = getS3Client();
  const bucket = getBucket();

  const resp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: s3Key })
  );

  if (!resp.Body) throw new Error("Empty S3 response body");

  const stream = resp.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Upload any buffer to S3 under a caller-supplied key.
 * Returns the key that was written.
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  key: string,
  contentType = "application/octet-stream"
): Promise<string> {
  const s3 = getS3Client();
  const bucket = getBucket();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );

  return key;
}

export async function deletePdfFromS3(s3Key: string): Promise<void> {
  const s3 = getS3Client();
  const bucket = getBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
}
