-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('STAGED', 'PENDING_DNS', 'LIVE');

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'STAGED',
    "sourceKind" TEXT NOT NULL,
    "subdomain" TEXT,
    "liveUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_slug_key" ON "Release"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Release_subdomain_key" ON "Release"("subdomain");

-- CreateIndex
CREATE INDEX "Release_status_idx" ON "Release"("status");
