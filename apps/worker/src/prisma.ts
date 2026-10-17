import { PrismaClient } from "@platform/db";

// Worker reads directly from Postgres (own connection pool) - cheaper than
// round-tripping through the API for every lookup. State-changing calls
// still go through apps/api's REST endpoints (api-client.ts) so all
// business-rule logic (revision caps, approval creation, cost caps) stays
// in one place.
export const prisma = new PrismaClient();
