import { Injectable } from "@nestjs/common";
import { ObjectStorageClient } from "@platform/shared";

/**
 * Thin NestJS wrapper around the shared S3/MinIO client, using the same env
 * vars as apps/worker's config.ts (OBJECT_STORAGE_*) so both sides read the
 * same bucket without duplicating credentials anywhere new.
 */
@Injectable()
export class ObjectStorageService {
  private readonly client = new ObjectStorageClient({
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9000",
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "platform",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "platform123",
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? "agent-outputs",
  });

  exists(key: string) {
    return this.client.exists(key);
  }

  /** The API is the only public door onto object storage - it reads the object itself and streams it back. */
  getObjectBuffer(key: string) {
    return this.client.getObjectBuffer(key);
  }

  /** Reads a small JSON marker object (see apps/worker's github-output.json), or null if it doesn't exist. */
  async getJson<T>(key: string): Promise<T | null> {
    if (!(await this.client.exists(key))) return null;
    try {
      const buffer = await this.client.getObjectBuffer(key);
      return JSON.parse(buffer.toString("utf-8")) as T;
    } catch {
      return null;
    }
  }

  /** Writes a small JSON marker object by its own key (see getJson). */
  putJson<T>(key: string, data: T) {
    return this.client.putObject(key, JSON.stringify(data), "application/json");
  }
}
