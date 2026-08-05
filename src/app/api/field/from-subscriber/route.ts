import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, sameAgentTower, agentTowerIds } from "@/lib/guard";
import { getOrCreateBoard, appendCardHistory } from "@/lib/field";
import { autoAssignOn, pickAssignee, verifyManualAssignee } from "@/lib/autoAssign";

export const dynamic = "force-dynamic";

// خيارات العمليات المسموحة — كل خيار يقابل عموداً في لوحة إدارة الفنيين بنفس الاسم
const OPERATIONS = ["صيانة", "اعادة", "توصيل", "تحويل"] as const;

// إنشاء بطاقة في لوحة إدارة الفنيين انطلاقاً من مشترك:
// يأخذ معلومات المشترك (الاسم، الهاتف، اليوزر) ويضعها في العمود الذي يحمل اسم
// العملية المختارة، ويُنشئ العمود تلقائياً إن لم يكن موجوداً.
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const subscriberId = Number(body?.subscriberId);
  const operation = String(body?.operation ?? "").trim();
  // اختياريان: رقم هاتف إضافي + ملاحظة يكتبهما المستخدم في مربع الحوار (يُضافان للبطاقة)
  const extraPhone = String(body?.extraPhone ?? "").trim().slice(0, 40);
  const note = String(body?.note ?? "").trim().slice(0, 1000);
  // ===== مبلغا بطاقة التوصيل (قرار محمد 2026-08-05) =====
  // «الاشتراك»: **تلقائي من باقة المشترك** — لا يُكتب يدوياً ولا يُقبل من المتصفّح، فسعر
  //   الباقة معروف في النظام وكتابته باليد بابُ خطأ لا فائدة فيه.
  // «التوصيل»: **يدويّ وإلزاميّ عند الإنشاء** (الصفر جائز لكن يُكتب صراحةً) — يُخزَّن على
  //   البطاقة ويظهر على وجهها، فلا يُطلب من الفني عند الإنجاز كما كان.
  let deliveryAmount: number | null = null;
  if (operation === "توصيل") {
    const raw = body?.amount;
    const n = raw == null || raw === "" ? NaN : Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "مبلغ التوصيل مطلوب (اكتب 0 إن كان مجاناً)" }, { status: 400 });
    }
    if (n > 0 && n < 1000) {
      return NextResponse.json({ error: "مبلغ التوصيل لا يقل عن 1000 دينار (أو صفر للمجاني)" }, { status: 400 });
    }
    deliveryAmount = n;
  }
  // اختيار الفني (اختياري) — يُتحقَّق منه لاحقاً بعد معرفة مكتب المشترك
  const wantedTech = body?.technicianId != null ? Number(body.technicianId) : null;
  if (!subscriberId) return NextResponse.json({ error: "معرّف المشترك مطلوب" }, { status: 400 });
  if (!OPERATIONS.includes(operation as (typeof OPERATIONS)[number])) {
    return NextResponse.json({ error: "عملية غير معروفة" }, { status: 400 });
  }

  const sub = await prisma.subscriber.findFirst({
    where: { id: subscriberId, isDeleted: false },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true, packageId: true },
  });
  if (!sub || !(await sameAgentTower(g.session, sub.towerId))) {
    return NextResponse.json({ error: "المشترك غير موجود" }, { status: 404 });
  }

  // سعر باقة المشترك — مصدر «مبلغ الاشتراك» على البطاقة. مقصور على باقات وكيل المستخدم
  // (كي لا يُقرأ سعر وكيل آخر)، وهو نفسه السعر الذي يُحتسب عند التفعيل فلا يختلف رقمان.
  let subAmount = 0;
  let packageName: string | null = null;
  if (operation === "توصيل" && sub.packageId != null) {
    const pkg = await prisma.package.findFirst({
      where: { id: sub.packageId, agentId: g.session?.agentId ?? -1, isDeleted: false },
      select: { name: true, priceDinar: true },
    });
    subAmount = Math.max(0, Math.round(pkg?.priceDinar ?? 0));
    packageName = pkg?.name ?? null;
  }

  // منع بطاقتين فعّالتين لنفس المشترك: إن كانت له بطاقة «مرفوعة» (غير محصّلة/اكمال) نرفض
  // ونذكر تفاصيلها. تُرفع بطاقة جديدة فقط بعد إكمال (تحصيل) البطاقة الحالية.
  const active = await prisma.taskCard.findFirst({
    where: { subscriberId: sub.id, settled: false, isDeleted: false },
    orderBy: { id: "desc" },
    select: { kind: true, done: true, assignee: true, createdAt: true, listId: true },
  });
  if (active) {
    const activeList = await prisma.taskList.findUnique({ where: { id: active.listId }, select: { name: true } });
    const when = active.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const status = active.done ? "منجزة — بانتظار التحصيل" : "قيد التنفيذ";
    const who = active.assignee ? ` · الفني: ${active.assignee}` : "";
    return NextResponse.json({
      error: `⚠️ هذا المشترك لديه بطاقة مرفوعة بالفعل:\n«${active.kind}» في عمود «${activeList?.name ?? "?"}» — ${status}${who}\nبتاريخ ${when}.\nأكمِل (حصّل) البطاقة الحالية قبل رفع بطاقة جديدة.`,
    }, { status: 409 });
  }

  // لوحة إدارة الفنيين الخاصّة بمكتب المشترك (مستقلّة لكل مكتب، تُنشأ إن لم توجد)
  const board = await getOrCreateBoard(sub.towerId ?? null);

  // العمود الذي يحمل اسم العملية — يُنشأ إن لم يوجد
  let list = await prisma.taskList.findFirst({
    where: { boardId: board.id, name: operation, isDeleted: false },
    orderBy: { position: "asc" },
  });
  if (!list) {
    const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
    list = await prisma.taskList.create({ data: { boardId: board.id, name: operation, position: count } });
  }

  // العنوان = اليوزر (يظهر على وجه البطاقة، لا اسم المشترك). الاسم والرقم المخزون في الوصف
  // (يظهران بفتح البطاقة فقط). الهاتف الإضافي والملاحظة (إن كُتبا) يظهران على الوجه أيضاً.
  const title = sub.netUser?.trim() || sub.name?.trim() || `مشترك #${sub.id}`;
  const descLines = [
    `📱 الهاتف: ${sub.phone?.trim() || "—"}`,   // الرقم المخزون — يظهر بفتح البطاقة أو على الوجه إن لم يُدخَل هاتف إضافي
    `👤 اليوزر: ${sub.netUser?.trim() || "—"}`,  // (يبقى للمطابقة الآلية للمكافآت)
    `🧑 المشترك: ${sub.name?.trim() || "—"}`,    // اسم المشترك — يظهر بفتح البطاقة فقط
  ];
  if (packageName) descLines.push(`📦 الباقة: ${packageName} (${subAmount.toLocaleString("en-US")} د.ع)`);
  if (extraPhone) descLines.push(`📞 هاتف إضافي: ${extraPhone}`);
  if (note) descLines.push(`📝 ملاحظة: ${note}`);
  // الفني: اختيار المستخدم صراحةً (يُتحقَّق من وكيله ومكتبه)، وإلا التوزيع التلقائي
  // إن كان مفعَّلاً للمكتب وللنوع. وأي تعثّر لا يُفشل إنشاء البطاقة.
  const agentTowers = await agentTowerIds(g.session);
  let technicianId: number | null = null;
  let assignee: string | null = null;
  let autoNote: string | null = null;
  if (wantedTech != null) {
    const ok = await verifyManualAssignee(wantedTech, sub.towerId, agentTowers);
    if (!ok) return NextResponse.json({ error: "الفني غير موجود أو لا يتبع مكتب المشترك" }, { status: 400 });
    technicianId = ok.id; assignee = ok.name;
  } else {
    try {
      if (await autoAssignOn(sub.towerId, operation, g.session.agentId)) {
        const picked = await pickAssignee(sub.towerId, agentTowers);
        if (picked) { technicianId = picked.id; assignee = picked.name; autoNote = `توزيع تلقائي ← ${picked.name}`; }
        else autoNote = "توزيع تلقائي: لا يوجد فني مؤهّل الآن (حضور/إجازة) — البطاقة بلا فني";
      }
    } catch { /* لا يُفشل الإنشاء */ }
  }
  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    // نوع البطاقة يُؤخذ تلقائياً من العملية (توصيل/تحويل/صيانة/اعادة) + ربط المشترك (لمنع التكرار)
    data: {
      listId: list.id, title, description: descLines.join("\n"), position, kind: operation, subscriberId: sub.id,
      subAmount: subAmount > 0 ? subAmount : null,
      // مبلغ التوصيل يُثبَّت على البطاقة منذ إنشائها (والصفر يُخزَّن صفراً لا فراغاً — فرقٌ يعني «مجاناً بقرار»)
      amount: deliveryAmount,
      technicianId, assignee,
    },
  });
  // أول حدث في سجل التغييرات: إنشاء البطاقة (تاريخه ووقته وفاعله)
  await appendCardHistory(card.id, g.session.fullName ?? g.session.username, "إنشاء البطاقة");
  if (autoNote) await appendCardHistory(card.id, "النظام", autoNote);

  return NextResponse.json({ ok: true, listName: list.name, card }, { status: 201 });
}
