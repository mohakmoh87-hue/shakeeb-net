import { prisma } from "./prisma";
import { towerIdsOfAgent } from "./guard";
import { getOrCreateBoard, appendCardHistory } from "./field";
import { autoAssignOn, pickAssignee, verifyManualAssignee } from "./autoAssign";
import { isSystemList, ensureCardType } from "./fieldDefaults";
import { fillCardPassword } from "./userPassword";

// 🧩 رفعُ بطاقةٍ انطلاقاً من مشترك — مُستخرَجٌ حرفيّاً من `/api/field/from-subscriber`
// ليستعمله مسارُ مستخدم المشاهدة أيضاً (طلبُ محمد 2026-11-21) **بلا نسخٍ للمنطق**:
// فيه حارسُ البطاقة المرفوعة، ومبلغُ باقة التوصيل، والتوزيعُ التلقائيّ، وسجلُّ التغييرات،
// ورسالةُ «رُفعت لك بطاقة». ونسخُه كان سيُنشئ مساراً ماليّاً ثانياً يتباعد عن الأوّل.
//
// 🔑 والعزلُ على مرحلتَين لا واحدة:
//   `ownerTowerIds` = مكاتبُ **الفاعل** (مِلكيّةُ المشترك تُقاس بها) — للمشاهد مكتبُه وحدَه
//     إن كان نطاقُه مكتبَه، فلا يرفع بطاقةً لمشترك مكتبٍ لا يراه.
//   و`agentTowers` = مكاتبُ **الوكيل** كلُّها، وتُستعمل للتوزيع والإسناد وحدَهما — كي يبقى
//     اختيارُ الفنيّ مطابقاً تماماً لما يحدث حين يرفع مستخدمُ المكتب البطاقةَ نفسَها
//     (اللوحاتُ المشتركة `sharedFieldWith` تعتمد على القائمة الكاملة).
export type CardActor = {
  agentId: number | null;
  actorName: string;
  /** مكاتبُ الفاعل — مِلكيّةُ المشترك تُقاس بها. فارغةٌ ⇒ لا شيء مملوك. */
  ownerTowerIds: number[];
  /** المشاهدُ لا يختار فنيّاً (قرارُ محمد) */
  allowManualTech: boolean;
};

export type CardInput = {
  subscriberId: number;
  operation: string;
  extraPhone?: string;
  note?: string;
  technicianId?: number | null;
};

export type CardOutcome =
  | { ok: true; listName: string; card: { id: number } }
  | { ok: false; error: string; status: number };

// عمودُ اللوحة الذي يحمل اسمَ العمليّة — يُنشأ إن لم يوجد، ويُضمَن نوعُه في «الأنواع والأوقات».
// مشترَكٌ بين بطاقة المشترك والبطاقة الحرّة فلا يتباعد سلوكُ الإنشاء بينهما.
async function opList(officeId: number, operation: string, agentId: number | null) {
  const board = await getOrCreateBoard(officeId);
  let list = await prisma.taskList.findFirst({
    where: { boardId: board.id, name: operation, isDeleted: false },
    orderBy: { position: "asc" },
  });
  if (!list) {
    const count = await prisma.taskList.count({ where: { boardId: board.id, isDeleted: false } });
    list = await prisma.taskList.create({ data: { boardId: board.id, name: operation, position: count } });
  }
  await ensureCardType(agentId, operation);
  return list;
}

export async function createCardFromSubscriber(input: CardInput, actor: CardActor): Promise<CardOutcome> {
  const subscriberId = Number(input.subscriberId);
  const operation = String(input.operation ?? "").trim();
  const extraPhone = String(input.extraPhone ?? "").trim().slice(0, 40);
  const note = String(input.note ?? "").trim().slice(0, 1000);
  const wantedTech = actor.allowManualTech && input.technicianId != null ? Number(input.technicianId) : null;

  if (!subscriberId) return { ok: false, error: "معرّف المشترك مطلوب", status: 400 };
  if (!operation || isSystemList(operation)) return { ok: false, error: "عملية غير صالحة", status: 400 };

  const sub = await prisma.subscriber.findFirst({
    where: { id: subscriberId, isDeleted: false },
    select: { id: true, name: true, phone: true, netUser: true, towerId: true, packageId: true, sasId: true, sasPanelId: true },
  });
  if (!sub || sub.towerId == null || !actor.ownerTowerIds.includes(sub.towerId)) {
    return { ok: false, error: "المشترك غير موجود", status: 404 };
  }

  let subAmount = 0;
  let packageName: string | null = null;
  if (operation === "توصيل" && sub.packageId != null) {
    const pkg = await prisma.package.findFirst({
      where: { id: sub.packageId, agentId: actor.agentId ?? -1, isDeleted: false },
      select: { name: true, priceDinar: true },
    });
    subAmount = Math.max(0, Math.round(pkg?.priceDinar ?? 0));
    packageName = pkg?.name ?? null;
  }

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
    return {
      ok: false,
      error: `⚠️ هذا المشترك لديه بطاقة مرفوعة بالفعل:\n«${active.kind}» في عمود «${activeList?.name ?? "?"}» — ${status}${who}\nبتاريخ ${when}.\nأكمِل (حصّل) البطاقة الحالية قبل رفع بطاقة جديدة.`,
      status: 409,
    };
  }

  const list = await opList(sub.towerId, operation, actor.agentId ?? null);

  const title = sub.netUser?.trim() || sub.name?.trim() || `مشترك #${sub.id}`;
  const descLines = [
    `📱 الهاتف: ${sub.phone?.trim() || "—"}`,
    `👤 اليوزر: ${sub.netUser?.trim() || "—"}`,
    `🧑 المشترك: ${sub.name?.trim() || "—"}`,
  ];
  if (packageName) descLines.push(`📦 الباقة: ${packageName} (${subAmount.toLocaleString("en-US")} د.ع)`);
  if (extraPhone) descLines.push(`📞 هاتف إضافي: ${extraPhone}`);
  if (note) descLines.push(`📝 ملاحظة: ${note}`);

  const agentTowers = actor.agentId != null ? await towerIdsOfAgent(actor.agentId) : [];
  let technicianId: number | null = null;
  let assignee: string | null = null;
  let autoNote: string | null = null;
  if (wantedTech != null) {
    const ok = await verifyManualAssignee(wantedTech, sub.towerId, agentTowers);
    if (!ok) return { ok: false, error: "الفني غير موجود أو لا يتبع مكتب المشترك", status: 400 };
    technicianId = ok.id; assignee = ok.name;
  } else {
    try {
      if (await autoAssignOn(sub.towerId, operation, actor.agentId)) {
        const picked = await pickAssignee(sub.towerId, agentTowers);
        if (picked) { technicianId = picked.id; assignee = picked.name; autoNote = `توزيع تلقائي ← ${picked.name}`; }
        else autoNote = "توزيع تلقائي: لا يوجد فني مؤهّل الآن (حضور/إجازة) — البطاقة بلا فني";
      }
    } catch { /* لا يُفشل الإنشاء */ }
  }

  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    data: {
      listId: list.id, title, description: descLines.join("\n"), position, kind: operation, subscriberId: sub.id,
      officeId: sub.towerId,
      subAmount: subAmount > 0 ? subAmount : null,
      technicianId, assignee,
    },
  });
  void fillCardPassword(card.id, { towerId: sub.towerId, sasPanelId: sub.sasPanelId, netUser: sub.netUser, sasId: sub.sasId });
  await appendCardHistory(card.id, actor.actorName, "إنشاء البطاقة");
  if (autoNote) await appendCardHistory(card.id, "النظام", autoNote);
  const { sendCardRaisedMessage } = await import("./cardRaisedMessage");
  void sendCardRaisedMessage(card.id);

  return { ok: true, listName: list.name, card };
}

// ═════ 🆕 بطاقةٌ حرّةٌ بلا مشترك (طلبُ محمد 2026-11-21) ═════
// «تنصيبُ مشتركٍ جديدٍ غيرِ موجودٍ أصلاً في قاعدة البيانات»: نصٌّ حرٌّ يكتبه الرافع،
// ونوعٌ من أعمدة مكتبه، وفنيٌّ اختياريّ. بلا مشتركٍ ⇒ بلا حارسِ تكرار، وبلا مبلغِ
// باقة، وبلا رسالةِ «رُفعت لك بطاقة»، وبلا كلمةِ مرورِ يوزر — فلا شيءَ منها له معنى هنا.
export type FreeCardInput = {
  officeId: number;
  operation: string;
  text: string;
  technicianId?: number | null;
};

export async function createFreeCard(input: FreeCardInput, actor: CardActor): Promise<CardOutcome> {
  const officeId = Number(input.officeId);
  const operation = String(input.operation ?? "").trim();
  const text = String(input.text ?? "").trim().slice(0, 2000);
  const wantedTech = actor.allowManualTech && input.technicianId != null ? Number(input.technicianId) : null;

  if (!officeId || !actor.ownerTowerIds.includes(officeId)) {
    return { ok: false, error: "المكتب خارج نطاقك", status: 403 };
  }
  if (!operation || isSystemList(operation)) return { ok: false, error: "نوعُ البطاقة غير صالح", status: 400 };
  if (!text) return { ok: false, error: "اكتب تفاصيلَ الطلب", status: 400 };

  const list = await opList(officeId, operation, actor.agentId ?? null);

  // العنوانُ سطرُ النصّ الأوّل (وجهُ البطاقة)، والنصُّ كاملاً في الوصف
  const firstLine = text.split("\n")[0]!.trim();
  const title = (firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine) || operation;

  const agentTowers = actor.agentId != null ? await towerIdsOfAgent(actor.agentId) : [];
  let technicianId: number | null = null;
  let assignee: string | null = null;
  let autoNote: string | null = null;
  if (wantedTech != null) {
    const ok = await verifyManualAssignee(wantedTech, officeId, agentTowers);
    if (!ok) return { ok: false, error: "الفني غير موجود أو لا يتبع هذا المكتب", status: 400 };
    technicianId = ok.id; assignee = ok.name;
  } else {
    try {
      if (await autoAssignOn(officeId, operation, actor.agentId)) {
        const picked = await pickAssignee(officeId, agentTowers);
        if (picked) { technicianId = picked.id; assignee = picked.name; autoNote = `توزيع تلقائي ← ${picked.name}`; }
        else autoNote = "توزيع تلقائي: لا يوجد فني مؤهّل الآن (حضور/إجازة) — البطاقة بلا فني";
      }
    } catch { /* لا يُفشل الإنشاء */ }
  }

  const position = await prisma.taskCard.count({ where: { listId: list.id, isDeleted: false } });
  const card = await prisma.taskCard.create({
    data: {
      listId: list.id, title, description: text, position, kind: operation,
      officeId, technicianId, assignee,
    },
  });
  await appendCardHistory(card.id, actor.actorName, "إنشاء البطاقة");
  if (autoNote) await appendCardHistory(card.id, "النظام", autoNote);

  return { ok: true, listName: list.name, card };
}
