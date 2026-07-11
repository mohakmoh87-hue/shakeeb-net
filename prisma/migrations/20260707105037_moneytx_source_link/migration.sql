-- AlterTable
ALTER TABLE "money_tx" ADD COLUMN     "sourceId" INTEGER,
ADD COLUMN     "sourceType" TEXT;

-- CreateIndex
CREATE INDEX "money_tx_sourceType_sourceId_idx" ON "money_tx"("sourceType", "sourceId");
