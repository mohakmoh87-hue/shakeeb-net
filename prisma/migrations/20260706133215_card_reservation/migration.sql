-- AlterTable
ALTER TABLE "recharge_cards" ADD COLUMN     "reservedAt" TIMESTAMP(3),
ADD COLUMN     "reservedBy" INTEGER;
