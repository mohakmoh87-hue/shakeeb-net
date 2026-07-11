-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "towerId" INTEGER;

-- AlterTable
ALTER TABLE "money_tx" ADD COLUMN     "towerId" INTEGER;

-- CreateIndex
CREATE INDEX "invoices_towerId_idx" ON "invoices"("towerId");

-- CreateIndex
CREATE INDEX "money_tx_towerId_idx" ON "money_tx"("towerId");
