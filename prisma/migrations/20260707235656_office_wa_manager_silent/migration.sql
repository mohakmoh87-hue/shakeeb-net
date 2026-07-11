-- AlterTable
ALTER TABLE "towers" ADD COLUMN     "managerPhone" TEXT,
ADD COLUMN     "silent" TEXT DEFAULT '1',
ADD COLUMN     "waEnabled" TEXT DEFAULT '1';
