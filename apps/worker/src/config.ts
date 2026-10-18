// Unlike apps/api (which gets this for free from @nestjs/config) and
// apps/web (which Next.js loads automatically), nothing in apps/worker read
// a local .env file before this - locally it silently ran on the
// http://localhost:* fallbacks below with no OPENROUTER_API_KEY, which is
// why only exporting shell env vars by hand ever worked. `cp
// infra/.env.example apps/worker/.env` now actually takes effect.
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  apiUrl: process.env.API_URL ?? "http://localhost:4000",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  openRouterApiKey: process.env.OPENROUTER_API_KEY, // validated lazily - worker can idle without it until first task
  objectStorage: {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9000",
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "platform",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "platform123",
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? "agent-outputs",
  },
};

export { required };
