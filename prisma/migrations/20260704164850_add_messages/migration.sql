-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'WHATSAPP', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'SMS',
    "subscriberId" INTEGER,
    "phone" TEXT,
    "text" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdByUser" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_subscriberId_idx" ON "messages"("subscriberId");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");
