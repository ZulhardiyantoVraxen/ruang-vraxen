import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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

  /**
   * Stores `content` under `<taskId>/<filename>` and returns the object key
   * to save on the Task row. `content` is a Buffer for binary output (PDF,
   * images) and a string for plain text/markdown.
   */
  async putTaskOutput(taskId: string, filename: string, content: string | Buffer, contentType = "text/plain") {
    const key = `${taskId}/${filename}`;
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content, ContentType: contentType }),
    );
    return key;
  }

  /**
   * Writes an arbitrary object by its own explicit key, not nested under a
   * task id - used for small cross-cutting markers like "which GitHub repo
   * does this Project commit to" (see apps/worker's github-repo.json) that
   * don't belong to any single task.
   */
  async putObject(key: string, content: string | Buffer, contentType = "text/plain") {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content, ContentType: contentType }));
    return key;
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  /** Cheap existence check so callers can return a clean 404 instead of letting an S3 error bubble up. */
  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the whole object into memory. MinIO has no published host port in
   * production (internal Docker network only, by design - see
   * docker-compose.prod.yml) and a getSignedDownloadUrl() pointing at
   * `minio:9000` is unreachable from a browser, so the API proxies/streams
   * the bytes itself instead of handing out a direct storage URL.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
