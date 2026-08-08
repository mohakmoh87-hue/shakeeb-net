import { prisma } from "@/lib/prisma";
import { getOrCreateBoard, appendCardHistory } from "@/lib/field";
import { bgIsSet, type OdooTicket } from "@/lib/odoo";

// ===== بطاقات تذاكر أودو في لوحة إدارة الفنيين — يعيد استعمال TaskCard/TaskList القائمين =====
export const ODOO_LIST_NAME = "تذاكر أودو"; // اسم عمود الوصول (صندوق وارد) — ليس فئة

// بطاقة أودو تأتي **بلا فئة** (kind فارغ): لا فئة «أودو»، ولا لون فئة، ولا خصم وقت.
// التمييز البصريّ = وسمٌ جانبيّ عاموديّ (viaOdoo) يُصيّره العميل، لونه لون الفئة عند إسنادها.

// العمود «تذاكر أودو» للوحة المكتب — يُنشأ إن لم يوجد (بلا CardType ⇒ بلا فئة)
export async function getOrCreateOdooList(towerId: number | null) {
  const board = await getOrCreateBoard(towerId ?? null);
  let list = await prisma.taskList.findFirst({ where: { boardId: board.id, name: ODOO_LIST_NAME, isDeleted: false }, orderBy: { position: "asc" } });
  if (!list) {
    const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
    list = await prisma.taskList.create({ data: { boardId: board.id, name: ODOO_LIST_NAME, position: count } });
  }
  return list;
}

// إنشاء بطاقة أودو إن لم توجد (منع تكرار بـ odooTicketId — نسخة أودو واحدة، id فريد عالميّاً؛
// نبحث في كامل البطاقات فحتى التي غادرت العمود بعد إسناد فئة لا تُكرَّر). يعيد {created, cardId}.
export async function upsertOdooCard(towerId: number | null, ticket: OdooTicket): Promise<{ created: boolean; cardId: number }> {
  const existing = await prisma.taskCard.findFirst({ where: { odooTicketId: ticket.id, isDeleted: false }, select: { id: true } });
  if (existing) return { created: false, cardId: existing.id };

  const list = await getOrCreateOdooList(towerId);
  // اليوزر إلزاميّ حين تكون قيمة BG في أودو فارغة/غير مضبوطة (كتذاكر التنصيب) — محسوم بالفحص الحيّ
  const usernameRequired = !bgIsSet(ticket.bg);

  const title = (ticket.name || `تذكرة أودو #${ticket.id}`).slice(0, 200);
  const descLines: string[] = [];
  if (ticket.customerName) descLines.push(`🧑 المشترك: ${ticket.customerName}`);
  if (ticket.phone) descLines.push(`📱 الهاتف: ${ticket.phone}`);
  if (ticket.fdt || ticket.fat) descLines.push(`🗺️ FDT/FAT: ${ticket.fdt ?? "—"} / ${ticket.fat ?? "—"}`);
  if (ticket.issueType) descLines.push(`🏷️ النوع: ${ticket.issueType}`);
  descLines.push(`🔗 عبر أودو — تذكرة #${ticket.id}`);
  if (usernameRequired) descLines.push("⚠️ إدخال اليوزر (BG) إلزاميّ عند الإنجاز — بصيغة bg-x-x-x@x");

  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    data: {
      listId: list.id, title, description: descLines.join("\n"), position,
      kind: "", viaOdoo: true, odooTicketId: ticket.id, usernameRequired, // بلا فئة — الوسم الجانبيّ يميّزها
    },
  });
  await appendCardHistory(card.id, "أودو", `سُحبت من أودو (تذكرة #${ticket.id})${usernameRequired ? " — يوزر إلزاميّ" : ""}`);
  return { created: true, cardId: card.id };
}

// عدد بطاقات أودو المفتوحة (غير المنجزة وغير الملغاة) لمكتب — للعدّاد ومنطق «drain»
export async function countOpenOdooCards(towerId: number): Promise<number> {
  const board = await prisma.taskBoard.findFirst({ where: { towerId, isDeleted: false }, select: { id: true } });
  if (!board) return 0;
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, select: { id: true } });
  const listIds = lists.map((l) => l.id);
  if (!listIds.length) return 0;
  // مفتوحة = viaOdoo، لم تُنجَز (done=false)، لم تُلغَ (settled=false)، غير مؤرشفة/محذوفة
  return prisma.taskCard.count({ where: { listId: { in: listIds }, viaOdoo: true, done: false, settled: false, isDeleted: false, archivedAt: null } });
}
