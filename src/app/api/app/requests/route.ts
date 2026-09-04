import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSubscriberSession } from "@/lib/subscriberAuth";
import { ensureSubscriberTicketsTable } from "@/lib/subscriberTicket";
import { getOrCreateBoard, appendCardHistory } from "@/lib/field";
import { ensureCardType, isCancelList } from "@/lib/fieldDefaults";
import { towerIdsOfAgent } from "@/lib/guard";
import { autoAssignOn, pickAssignee } from "@/lib/autoAssign";
import { fillCardPassword } from "@/lib/userPassword";

export const dynamic = "force-dynamic";

const TYPES = new Set(["صيانة", "توصيل"]);

// طلبُ صيانةٍ/توصيلٍ من مشتركٍ **مسجَّل** ⇒ بطاقةٌ حقيقيّةٌ على لوحة إدارة الفنيّين (كطلب المكتب
// عبر from-subscriber) في عمود العمليّة (صيانة/توصيل)، تتصرّف كأيّ بطاقة، ووسمُها الوحيد
// «تذكرة مشترك» (viaSubscriber). الوكيلُ حتميٌّ من البيانات: subscriberId → towerId → agentId.
export async function POST(request: Request) {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  if (!rateLimit(`app-request:${sess.subscriberId}`, 6, 60_000)) {
    return NextResponse.json({ error: "طلباتٌ كثيرة، انتظر قليلاً" }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!TYPES.has(type)) return NextResponse.json({ error: "نوعُ طلبٍ غير صالح" }, { status: 400 });

  const sub = await prisma.subscriber.findUnique({
    where: { id: sess.subscriberId },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true, packageId: true, sasId: true, sasPanelId: true, appBanned: true },
  });
  if (!sub) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (sub.appBanned) return NextResponse.json({ error: "محظور" }, { status: 403 });

  const tower = sub.towerId
    ? await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { agentId: true } })
    : null;
  const agentId = tower?.agentId ?? null;

  // حالةٌ حدّيّة: مشتركٌ بلا مكتب/وكيلٍ محدَّد ⇒ نُبقيها تذكرةً (لا لوحةَ نُنشئ عليها) فلا يضيع الطلب
  if (sub.towerId == null || agentId == null) {
    await ensureSubscriberTicketsTable();
    await prisma.subscriberTicket.create({
      data: { name: sub.name ?? "مشترك", phone: sub.phone ?? "", note: note || null, subscriberId: sub.id, towerId: sub.towerId, agentId, type, status: "new", source: "app-request" },
    });
    return NextResponse.json({ ok: true, routed: false });
  }

  // قرار محمد: طلبٌ واحدٌ فعّالٌ لكلّ مشترك — لو له بطاقةٌ غير محصّلةٍ يُرفض الثاني (يتابع حالتَها)
  const active = await prisma.taskCard.findFirst({ where: { subscriberId: sub.id, settled: false, isDeleted: false }, select: { id: true } });
  if (active) return NextResponse.json({ error: "لديك طلبٌ قيدَ المعالجة بالفعل — سنُنجزه أوّلاً، وتستطيع متابعةَ حالتِه." }, { status: 409 });

  const board = await getOrCreateBoard(sub.towerId);
  let list = await prisma.taskList.findFirst({ where: { boardId: board.id, name: type, isDeleted: false }, orderBy: { position: "asc" } });
  if (!list) {
    const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
    list = await prisma.taskList.create({ data: { boardId: board.id, name: type, position: count } });
  }
  await ensureCardType(agentId, type);

  // «مبلغ الاشتراك» للتوصيل من باقة المشترك (مقصورٌ على باقات وكيله) — كما في from-subscriber
  let subAmount = 0;
  let packageName: string | null = null;
  if (type === "توصيل" && sub.packageId != null) {
    const pkg = await prisma.package.findFirst({ where: { id: sub.packageId, agentId, isDeleted: false }, select: { name: true, priceDinar: true } });
    subAmount = Math.max(0, Math.round(pkg?.priceDinar ?? 0));
    packageName = pkg?.name ?? null;
  }

  const title = sub.netUser?.trim() || sub.name?.trim() || `مشترك #${sub.id}`;
  const descLines = [
    `📱 الهاتف: ${sub.phone?.trim() || "—"}`,
    `👤 اليوزر: ${sub.netUser?.trim() || "—"}`,
    `🧑 المشترك: ${sub.name?.trim() || "—"}`,
  ];
  if (packageName) descLines.push(`📦 الباقة: ${packageName} (${subAmount.toLocaleString("en-US")} د.ع)`);
  if (note) descLines.push(`📝 طلب المشترك: ${note}`);

  const agentTowers = await towerIdsOfAgent(agentId);
  let technicianId: number | null = null;
  let assignee: string | null = null;
  let autoNote: string | null = null;
  try {
    if (await autoAssignOn(sub.towerId, type, agentId)) {
      const picked = await pickAssignee(sub.towerId, agentTowers);
      if (picked) { technicianId = picked.id; assignee = picked.name; autoNote = `توزيع تلقائي ← ${picked.name}`; }
      else autoNote = "توزيع تلقائي: لا يوجد فني مؤهّل الآن — البطاقة بلا فني";
    }
  } catch { /* لا يُفشل الإنشاء */ }

  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    data: {
      listId: list.id, title, description: descLines.join("\n"), position, kind: type, subscriberId: sub.id,
      officeId: sub.towerId, subAmount: subAmount > 0 ? subAmount : null, technicianId, assignee,
      viaSubscriber: true,
    },
  });
  void fillCardPassword(card.id, { towerId: sub.towerId, sasPanelId: sub.sasPanelId, netUser: sub.netUser, sasId: sub.sasId });
  await appendCardHistory(card.id, sub.name ?? "المشترك", "طلبٌ من المشترك عبر التطبيق");
  if (autoNote) await appendCardHistory(card.id, "النظام", autoNote);
  const { sendCardRaisedMessage } = await import("@/lib/cardRaisedMessage");
  void sendCardRaisedMessage(card.id);

  return NextResponse.json({ ok: true, routed: true, cardId: card.id }, { status: 201 });
}

// حدثٌ من سجلّ البطاقة مُنقّىً للمشترك — قائمةٌ بيضاءُ صارمة: كلُّ نصٍّ حرٍّ داخليٍّ يُخفى
// (ملاحظةُ الفنيّ، سببُ التأجيل، المبالغ، أسماءُ الفنيّين) فلا يُسرَّب للمشترك شيءٌ داخليّ.
function curateEventText(t: string): string | null {
  if (t.includes("طلبٌ من المشترك") || t === "إنشاء البطاقة") return "📩 تمّ استلامُ طلبك";
  if (t.startsWith("توزيع تلقائي")) return t.includes("لا يوجد فني") ? null : "👷 أُسند طلبُك لفنيّ";
  if (t.includes("استلام البطاقة") || t.includes("تحويل البطاقة من")) return "👷 أُسند طلبُك لفنيّ";
  if (t.includes("بدء العمل")) return "🚗 الفنيُّ باشر التنفيذ";
  if (t.includes("تأجيل البطاقة إلى")) return "📅 " + t.split(" — ")[0].replace("تأجيل البطاقة", "أُجّل الموعد"); // التاريخُ فقط، بلا سببِ التأجيل الداخليّ
  if (t.includes("إنجاز البطاقة")) return "✅ تمّ إنجازُ طلبك";
  if (t.includes("إلغاء البطاقة")) return "🚫 أُلغي طلبُك";
  if (t.includes("حُذف الطلب")) return "🗑️ حُذف الطلب";
  return null; // داخليٌّ/نصٌّ حرٌّ/غيرُ معروف ⇒ يُخفى تماماً
}

// حالةُ بطاقات المشترك + تسلسلُ الأحداث (طلب محمد): يرى ما جرى على طلبه — استُلم/أُسند/باشر/مؤجّل/منجز/ملغى/محذوف.
export async function GET() {
  const sess = await getSubscriberSession();
  if (!sess) return NextResponse.json({ error: "غير مسجّل" }, { status: 401 });
  // نُبقي المحذوفةَ حديثاً (ضمن الأحدث ١٥) ليراها المشترك «حُذف الطلب» بدل أن تختفي فجأة
  const cards = await prisma.taskCard.findMany({
    where: { subscriberId: sess.subscriberId },
    orderBy: { id: "desc" }, take: 15,
    select: { id: true, kind: true, done: true, isDeleted: true, startedAt: true, postponedTo: true, technicianId: true, assignee: true, listId: true, createdAt: true, history: true },
  });
  const listIds = [...new Set(cards.map((c) => c.listId))];
  const lists = listIds.length ? await prisma.taskList.findMany({ where: { id: { in: listIds } }, select: { id: true, name: true } }) : [];
  const cancelIds = new Set(lists.filter((l) => isCancelList(l.name)).map((l) => l.id));
  const fmt = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const items = cards.map((c) => {
    let state: string, label: string, detail: string | null = null;
    if (c.isDeleted) { state = "deleted"; label = "حُذف الطلب"; }
    else if (c.done) { state = "done"; label = "تمّ الإنجاز ✓"; }
    else if (cancelIds.has(c.listId)) { state = "cancelled"; label = "أُلغيت"; }
    else if (c.postponedTo) { state = "postponed"; label = "مؤجّلة"; detail = `إلى ${fmt(c.postponedTo)}`; }
    else if (c.startedAt) { state = "in_progress"; label = "الفنيُّ باشر التنفيذ"; }
    else if (c.technicianId || c.assignee) { state = "assigned"; label = "استُلمت — أُسندت لفنيّ"; }
    else { state = "new"; label = "بانتظار الاستلام"; }
    let hist: { at?: string; text?: string }[] = [];
    try { hist = c.history ? JSON.parse(c.history) : []; } catch { hist = []; }
    const timeline = hist
      .map((e) => { const text = curateEventText(String(e?.text ?? "").trim()); if (!text) return null; const d = e?.at ? new Date(e.at) : null; const ok = d != null && !isNaN(d.getTime()); return { ts: ok ? d!.getTime() : 0, at: ok ? fmt(d!) : "", text }; })
      .filter((x): x is { ts: number; at: string; text: string } => x != null);
    return { id: c.id, kind: c.kind, state, label, detail, createdAt: fmt(c.createdAt), timeline };
  });
  return NextResponse.json({ items });
}
