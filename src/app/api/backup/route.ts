import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

// نسخة احتياطية: تصدير كل البيانات إلى JSON (للمدير فقط)
export async function GET() {
  const g = await guard("settings.manage");
  if (g.error) return g.error;

  const [
    users, groups, towers, towerInfo, packages, subscribers, accounts,
    subscriptionEntries, moneyTx, boxes, boxDeps, rechargeCards, items,
    invoices, invoiceItems, tickets, ticketTypes, ticketPriorities,
    ticketStates, months, notes, events, systemSettings, smsTemplates,
    pushTypes, messages,
  ] = await Promise.all([
    prisma.user.findMany({ select: { id: true, fullName: true, username: true, role: true, isActive: true, isDeleted: true } }),
    prisma.group.findMany(),
    prisma.tower.findMany(),
    prisma.towerInfo.findMany(),
    prisma.package.findMany(),
    prisma.subscriber.findMany(),
    prisma.account.findMany(),
    prisma.subscriptionEntry.findMany(),
    prisma.moneyTx.findMany(),
    prisma.box.findMany(),
    prisma.boxDep.findMany(),
    prisma.rechargeCard.findMany(),
    prisma.item.findMany(),
    prisma.invoice.findMany(),
    prisma.invoiceItem.findMany(),
    prisma.ticket.findMany(),
    prisma.ticketType.findMany(),
    prisma.ticketPriority.findMany(),
    prisma.ticketState.findMany(),
    prisma.month.findMany(),
    prisma.note.findMany(),
    prisma.event.findMany(),
    prisma.systemSetting.findMany(),
    prisma.smsTemplate.findMany(),
    prisma.pushType.findMany(),
    prisma.message.findMany(),
  ]);

  const backup = {
    _meta: { app: "شكيب نت", version: 1, date: new Date().toISOString() },
    users, groups, towers, towerInfo, packages, subscribers, accounts,
    subscriptionEntries, moneyTx, boxes, boxDeps, rechargeCards, items,
    invoices, invoiceItems, tickets, ticketTypes, ticketPriorities,
    ticketStates, months, notes, events, systemSettings, smsTemplates,
    pushTypes, messages,
  };

  const filename = `shakeeb-net-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
