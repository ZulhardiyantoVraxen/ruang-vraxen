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
