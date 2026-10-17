-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('ATAS', 'AHLI', 'RUTIN');

-- CreateEnum
CREATE TYPE "DivisionStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'WORKING', 'REVIEWING', 'COLLABORATING', 'PAUSED');

-- CreateEnum
CREATE TYPE "ModelVariant" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TRIAGE', 'TODO', 'SCHEDULED', 'READY', 'RUNNING', 'BLOCKED', 'REVIEW', 'APPROVAL_PENDING', 'DONE', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('EXECUTOR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CostCapScope" AS ENUM ('AGENT', 'DIVISION', 'TASK');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'RECOMMENDED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ModelClass" (
    "id" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL,
    "label" TEXT NOT NULL,
    "openRouterModelFree" TEXT,
    "openRouterModelPaid" TEXT NOT NULL,
    "requiresZeroRetention" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DivisionStatus" NOT NULL DEFAULT 'ONBOARDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRole" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL,
    "modelClassId" TEXT NOT NULL,
    "responsibilities" TEXT,
    "maxConcurrentTasks" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "agentRoleId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'IDLE',
    "modelVariant" "ModelVariant" NOT NULL DEFAULT 'FREE',
    "systemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "parentTaskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TRIAGE',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "maxRevisions" INTEGER NOT NULL DEFAULT 3,
    "resultSummary" TEXT,
    "resultObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverRef" TEXT,
    "decidedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCap" (
    "id" TEXT NOT NULL,
    "scope" "CostCapScope" NOT NULL,
    "divisionId" TEXT,
    "agentId" TEXT,
    "maxCostUsd" DECIMAL(10,4) NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "maxIterations" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT,
    "modelUsed" TEXT NOT NULL,
    "modelVariant" "ModelVariant" NOT NULL,
    "source" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionOnboardingSession" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "qaLog" JSONB NOT NULL DEFAULT '[]',
    "recommendedRoster" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionOnboardingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelClass_tier_key" ON "ModelClass"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "Division_slug_key" ON "Division"("slug");

-- CreateIndex
CREATE INDEX "Division_status_idx" ON "Division"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRole_divisionId_name_key" ON "AgentRole"("divisionId", "name");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE INDEX "Task_divisionId_status_idx" ON "Task"("divisionId", "status");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAssignment_agentId_idx" ON "TaskAssignment"("agentId");

-- CreateIndex
CREATE INDEX "Approval_taskId_status_idx" ON "Approval"("taskId", "status");

-- CreateIndex
CREATE INDEX "UsageLog_agentId_createdAt_idx" ON "UsageLog"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_taskId_idx" ON "UsageLog"("taskId");

-- AddForeignKey
ALTER TABLE "AgentRole" ADD CONSTRAINT "AgentRole_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRole" ADD CONSTRAINT "AgentRole_modelClassId_fkey" FOREIGN KEY ("modelClassId") REFERENCES "ModelClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCap" ADD CONSTRAINT "CostCap_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCap" ADD CONSTRAINT "CostCap_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionOnboardingSession" ADD CONSTRAINT "DivisionOnboardingSession_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
