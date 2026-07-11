-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "managerPhone" TEXT,
ADD COLUMN     "permissions" TEXT,
ADD COLUMN     "towerId" INTEGER;
