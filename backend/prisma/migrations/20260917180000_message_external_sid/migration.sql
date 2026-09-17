-- AlterTable
ALTER TABLE "Message" ADD COLUMN "externalMessageSid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalMessageSid_key" ON "Message"("externalMessageSid");
