-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "isEmployee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "recharge_cards" ADD COLUMN     "price" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "manager_tx" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "manager_tx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manager_tx_type_idx" ON "manager_tx"("type");
