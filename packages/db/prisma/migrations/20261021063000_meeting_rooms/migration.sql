-- CreateEnum
CREATE TYPE "MeetingRoomType" AS ENUM ('DIRECTOR_CEO', 'OPEN');

-- CreateEnum
CREATE TYPE "MeetingRoomStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "MeetingSenderType" AS ENUM ('DIRECTOR', 'AGENT');

-- CreateTable
CREATE TABLE "MeetingRoom" (
    "id" TEXT NOT NULL,
    "type" "MeetingRoomType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MeetingRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingRoomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMessage" (
    "id" TEXT NOT NULL,
    "meetingRoomId" TEXT NOT NULL,
    "senderType" "MeetingSenderType" NOT NULL,
    "senderAgentId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRoom_type_status_idx" ON "MeetingRoom"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingParticipant_meetingRoomId_agentId_key" ON "MeetingParticipant"("meetingRoomId", "agentId");

-- CreateIndex
CREATE INDEX "MeetingMessage_meetingRoomId_createdAt_idx" ON "MeetingMessage"("meetingRoomId", "createdAt");

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingRoomId_fkey" FOREIGN KEY ("meetingRoomId") REFERENCES "MeetingRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMessage" ADD CONSTRAINT "MeetingMessage_meetingRoomId_fkey" FOREIGN KEY ("meetingRoomId") REFERENCES "MeetingRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMessage" ADD CONSTRAINT "MeetingMessage_senderAgentId_fkey" FOREIGN KEY ("senderAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
