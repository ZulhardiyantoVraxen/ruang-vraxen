import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3-compatible wrapper (works against MinIO locally and any real S3/
 * S3-compatible bucket in production - same env vars, different endpoint).
 * Agent outputs that are too long for Task.resultSummary (full reports,
 * generated code, drafts) go here; only the object key is stored in Postgres.
 */
export class ObjectStorageClient {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
  }) {
    this.bucket = config.bucket;
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "us-east-1",
      forcePathStyle: true, // required for MinIO
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /** Stores `content` under `<taskId>/<filename>` and returns the object key to save on the Task row. */
  async putTaskOutput(taskId: string, filename: string, content: string, contentType = "text/plain") {
    const key = `${taskId}/${filename}`;
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content, ContentType: contentType }),
    );
    return key;
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
