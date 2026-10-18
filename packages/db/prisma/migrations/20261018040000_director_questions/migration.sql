-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'AWAITING_DIRECTOR';

-- CreateEnum
CREATE TYPE "DirectorQuestionStatus" AS ENUM ('OPEN', 'ANSWERED');

-- CreateTable
CREATE TABLE "DirectorQuestion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "agentId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "DirectorQuestionStatus" NOT NULL DEFAULT 'OPEN',
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "DirectorQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectorQuestion_status_idx" ON "DirectorQuestion"("status");

-- CreateIndex
CREATE INDEX "DirectorQuestion_divisionId_idx" ON "DirectorQuestion"("divisionId");

-- CreateIndex
CREATE INDEX "DirectorQuestion_taskId_idx" ON "DirectorQuestion"("taskId");

-- AddForeignKey
ALTER TABLE "DirectorQuestion" ADD CONSTRAINT "DirectorQuestion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorQuestion" ADD CONSTRAINT "DirectorQuestion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorQuestion" ADD CONSTRAINT "DirectorQuestion_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;
