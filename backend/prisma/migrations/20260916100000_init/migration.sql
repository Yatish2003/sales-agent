-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'NEEDS_MORE_INFO', 'QUALIFIED', 'NOT_QUALIFIED', 'BOOKED', 'HUMAN_TAKEOVER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('OFFERED', 'CONFIRMED', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalContactId" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedRepId" TEXT,
    "qualificationEvidence" JSONB,
    "extractedService" TEXT,
    "extractedBudget" TEXT,
    "extractedTimeline" TEXT,
    "lastFallback" TEXT,
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "Channel" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarBooking" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'OFFERED',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLogEntry" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "runId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "transcriptSource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "simulateFailure" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentContext" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceFactsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOutput" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "contextVersion" INTEGER NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffMessage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromAgent" TEXT NOT NULL,
    "toAgent" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "contextVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_channel_externalContactId_key" ON "Lead"("channel", "externalContactId");
CREATE INDEX "Message_leadId_createdAt_idx" ON "Message"("leadId", "createdAt");
CREATE UNIQUE INDEX "CalendarBooking_idempotencyKey_key" ON "CalendarBooking"("idempotencyKey");
CREATE INDEX "ActionLogEntry_leadId_createdAt_idx" ON "ActionLogEntry"("leadId", "createdAt");
CREATE INDEX "ActionLogEntry_runId_createdAt_idx" ON "ActionLogEntry"("runId", "createdAt");
CREATE UNIQUE INDEX "AgentRun_runId_key" ON "AgentRun"("runId");
CREATE UNIQUE INDEX "AgentContext_runId_version_key" ON "AgentContext"("runId", "version");
CREATE INDEX "AgentOutput_runId_agentName_contextVersion_idx" ON "AgentOutput"("runId", "agentName", "contextVersion");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarBooking" ADD CONSTRAINT "CalendarBooking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionLogEntry" ADD CONSTRAINT "ActionLogEntry_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentContext" ADD CONSTRAINT "AgentContext_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentOutput" ADD CONSTRAINT "AgentOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HandoffMessage" ADD CONSTRAINT "HandoffMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("runId") ON DELETE CASCADE ON UPDATE CASCADE;
