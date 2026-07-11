-- AlterTable
ALTER TABLE "recharge_cards" ADD COLUMN     "packageId" INTEGER,
ADD COLUMN     "subscriberId" INTEGER;

-- CreateIndex
CREATE INDEX "recharge_cards_packageId_useDate_idx" ON "recharge_cards"("packageId", "useDate");
