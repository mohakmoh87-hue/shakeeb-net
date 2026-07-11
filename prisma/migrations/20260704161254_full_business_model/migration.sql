-- AlterTable
ALTER TABLE "users" ADD COLUMN     "legacyId" INTEGER;

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "towers" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "note" TEXT,
    "phone" TEXT,
    "username" TEXT,
    "password" TEXT,
    "passOnline" TEXT,
    "type" INTEGER,
    "price" INTEGER,
    "nesba" INTEGER,
    "groupId" INTEGER,
    "isMain" INTEGER,
    "allowAdd" INTEGER,
    "allowSms" INTEGER,
    "month" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "towers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tower_info" (
    "id" SERIAL NOT NULL,
    "sector" TEXT,
    "towerId" INTEGER,
    "ip" TEXT,
    "username" TEXT,
    "password" TEXT,
    "type" TEXT,
    "userCount" INTEGER,
    "channel" TEXT,
    "company" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tower_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "priceDollar" DOUBLE PRECISION,
    "priceDinar" DOUBLE PRECISION,
    "addPrice" DOUBLE PRECISION,
    "towerId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "packageId" INTEGER,
    "note" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "towerId" INTEGER,
    "groupId" INTEGER,
    "month" INTEGER,
    "money" DOUBLE PRECISION,
    "wasel" DOUBLE PRECISION,
    "carry" DOUBLE PRECISION,
    "sector" TEXT,
    "state" TEXT,
    "type" INTEGER,
    "smsEnabled" INTEGER,
    "createdByUser" TEXT,
    "createdByName" TEXT,
    "wifiUser" TEXT,
    "wifiPass" TEXT,
    "cardCode" TEXT,
    "tele" TEXT,
    "mac" TEXT,
    "affiliate" TEXT,
    "lastSmsDate" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "type" INTEGER,
    "typeName" TEXT,
    "userId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_entries" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "notes" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "money" DOUBLE PRECISION,
    "moneyIn" DOUBLE PRECISION,
    "moneyCarry" DOUBLE PRECISION,
    "moneyType" INTEGER,
    "cardType" TEXT,
    "withdrawal" DOUBLE PRECISION,
    "priceDollar" DOUBLE PRECISION,
    "deposit" DOUBLE PRECISION,
    "balance" DOUBLE PRECISION,
    "operation" TEXT,
    "subscriberId" INTEGER,
    "month" TEXT,
    "card2" TEXT,
    "withdrawalIq" DOUBLE PRECISION,
    "towerId" INTEGER,
    "nextDate" TIMESTAMP(3),
    "userId" INTEGER,
    "pushType" TEXT,
    "createdByUser" TEXT,
    "addPrice" DOUBLE PRECISION,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subscription_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_tx" (
    "id" SERIAL NOT NULL,
    "moneyIn" DOUBLE PRECISION,
    "moneyOut" DOUBLE PRECISION,
    "accountId" INTEGER,
    "userId" INTEGER,
    "date" TIMESTAMP(3),
    "notes" TEXT,
    "pc" TEXT,
    "serverDate" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "money_tx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boxes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "date" TIMESTAMP(3),
    "idFrom" INTEGER,
    "idTo" INTEGER,
    "money" DOUBLE PRECISION,
    "type" INTEGER,
    "oldMoney" DOUBLE PRECISION,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_deps" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "type" INTEGER,
    "money" DOUBLE PRECISION,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "box_deps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharge_cards" (
    "id" SERIAL NOT NULL,
    "number" TEXT,
    "password" TEXT,
    "serial" TEXT,
    "useDate" TIMESTAMP(3),
    "addDate" TIMESTAMP(3),
    "userId" INTEGER,
    "userName" TEXT,

    CONSTRAINT "recharge_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "category" TEXT,
    "priceDinar" DOUBLE PRECISION,
    "priceDollar" DOUBLE PRECISION,
    "priceSale" DOUBLE PRECISION,
    "priceSale2" DOUBLE PRECISION,
    "type" INTEGER,
    "barcode" TEXT,
    "count" DOUBLE PRECISION,
    "minCount" INTEGER,
    "color" TEXT,
    "size" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "number" INTEGER,
    "itemsCount" DOUBLE PRECISION,
    "totalMy" DOUBLE PRECISION,
    "waselHim" DOUBLE PRECISION,
    "pushType" INTEGER,
    "note" TEXT,
    "user" TEXT,
    "type" TEXT,
    "subscriberId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER,
    "itemId" INTEGER,
    "count" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "buyPrice" DOUBLE PRECISION,
    "note" TEXT,
    "barcode" TEXT,
    "color" TEXT,
    "size" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "createdByUser" TEXT,
    "typeId" INTEGER,
    "priorityId" INTEGER,
    "statusId" INTEGER,
    "desc" TEXT,
    "note" TEXT,
    "tower" TEXT,
    "date" TIMESTAMP(3),
    "dateClose" TIMESTAMP(3),
    "isClosed" INTEGER,
    "closedByUser" TEXT,
    "depName" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_priorities" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ticket_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_states" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ticket_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "months" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "user" TEXT,
    "date" TIMESTAMP(3),
    "month" TEXT,
    "money" DOUBLE PRECISION,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "text" TEXT,
    "date" TIMESTAMP(3),
    "done" INTEGER,
    "category" TEXT,
    "desc" TEXT,
    "dateAlert" TIMESTAMP(3),
    "user" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "date" TIMESTAMP(3),
    "desc" TEXT,
    "user" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" SERIAL NOT NULL,
    "type" TEXT,
    "value" TEXT,
    "text" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_templates" (
    "id" SERIAL NOT NULL,
    "type" TEXT,
    "text" TEXT,
    "enable" TEXT,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_types" (
    "id" SERIAL NOT NULL,
    "type" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "push_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "towers_groupId_idx" ON "towers"("groupId");

-- CreateIndex
CREATE INDEX "tower_info_towerId_idx" ON "tower_info"("towerId");

-- CreateIndex
CREATE INDEX "packages_towerId_idx" ON "packages"("towerId");

-- CreateIndex
CREATE INDEX "subscribers_packageId_idx" ON "subscribers"("packageId");

-- CreateIndex
CREATE INDEX "subscribers_towerId_idx" ON "subscribers"("towerId");

-- CreateIndex
CREATE INDEX "subscribers_groupId_idx" ON "subscribers"("groupId");

-- CreateIndex
CREATE INDEX "subscribers_phone_idx" ON "subscribers"("phone");

-- CreateIndex
CREATE INDEX "subscribers_name_idx" ON "subscribers"("name");

-- CreateIndex
CREATE INDEX "subscription_entries_subscriberId_idx" ON "subscription_entries"("subscriberId");

-- CreateIndex
CREATE INDEX "subscription_entries_towerId_idx" ON "subscription_entries"("towerId");

-- CreateIndex
CREATE INDEX "subscription_entries_date_idx" ON "subscription_entries"("date");

-- CreateIndex
CREATE INDEX "money_tx_accountId_idx" ON "money_tx"("accountId");

-- CreateIndex
CREATE INDEX "money_tx_date_idx" ON "money_tx"("date");

-- CreateIndex
CREATE INDEX "recharge_cards_serial_idx" ON "recharge_cards"("serial");

-- CreateIndex
CREATE INDEX "invoices_subscriberId_idx" ON "invoices"("subscriberId");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");
