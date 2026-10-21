-- AlterTable
ALTER TABLE "MeetingRoom" ADD COLUMN "lastSummaryTitle" TEXT,
ADD COLUMN "lastSummaryText" TEXT,
ADD COLUMN "lastSummaryAt" TIMESTAMP(3),
ADD COLUMN "lastSummaryDriveUrl" TEXT;
