import { prisma } from "@/lib/prisma";
import { isLeaderNow, getWorkerAgentId, getWorkerTowerId } from "@/lib/hybridAgent";
import { appendCardHistory } from "@/lib/field";
import { upsertOdooCard, refreshOdooCard, countOpenOdooCards } from "@/lib/odooCards";
import {
  odooLogin, odooFetchOpenTickets, odooReadTicket, odooReceive, odooChangeBg, odooClose, odooCancel, odooChatterPost,
  isOpenStage, isDoneStage, isCancelledStage, isUnknownStage, type OdooSession,
} from "@/lib/odoo";
import {
  slaStateOf, fillSlaText, inSlaWindow, fmtMin, SLA_ALARM_MIN_DEFAULT, SLA_SEND_MIN_DEFAULT,
  SLA_GRACE_MS, SLA_SEND_CAP, SLA_WA_TTL_MS, SLA_TECH_EVERY_MS,
  SLA_NOTE_DEFAULT, SLA_WA_DEFAULT, SLA_TECH_DEFAULT,
} from "@/lib/odooSla";
import { notify } from "@/lib/notify";

// ===== مزامنة تذاكر أودو — تعمل على عامل حاسبة المكتب المحليّ حصراً (RUN_WORKER)، لا سحابة =====
// سحبٌ كلّ ١٠ دقائق (تذاكر جديدة id>العلامة) + دفعٌ سريعٌ كلّ ٢٠ ثانية (إنجاز/إلغاء ← أودو، «فوريّ»).
// قائد الوكيل فقط (isLeaderNow) يشغّلها لكلّ مكاتب وكيله المفعّلة — فلا تكرار، وعزلٌ صارم بالوكيل.
const PULL_MS = 10 * 60_000;
const PUSH_MS = 20_000;
const SLA_MS = 60_000; // فحص المهلة كلّ دقيقة (على القائد)
const WA_MS = 30_000; // طابور رسائل المشتركين (على حاسبة المكتب نفسها)
const SESSION_TTL = 25 * 60_000;
const CLAIM_TTL_MS = 5 * 60_000; // حجزٌ عالقٌ (انقطاعٌ وسط النداء) يسقط بعد ٥ دقائق

type OfficeRow = {
  id: number; name: string | null; odooUser: string | null; odooPass: string | null; odooUrl: string | null;
  odooLastTicketId: number | null; odooEnabled: string | null; odooUid: number | null;
  odooSlaAlarm: string | null; odooSlaTechText: string | null;
  odooSlaAuto: string | null; odooSlaArmedAt: Date | null;
  odooSlaAlarmMin: number | null; odooSlaSendMin: number | null;
  odooSlaNote: string | null; odooSlaWaText: string | null;
  agentId: number | null;
  /** أ-٢٣ · وحدةُ المزامنة: لوحةٌ غيرُ أولى (فتُكتَب حالتُها في صفّها) أو `null` = المكتبُ نفسُه */
  panelId: number | null;
};

const sessionCache = new Map<number, { s: OdooSession; at: number }>();
let pulling = false;
let pushing = false;
let slaBusy = false;
let waBusy = false;

async function officeSession(o: OfficeRow): Promise<OdooSession> {
  const now = Date.now();
  // 🔴 المفتاحُ **وحدةُ المزامنة** لا المكتب: لوحتان لمكتبٍ واحدٍ بحسابَي أودو مختلفَين كانتا
  // ستتشاركان جلسةً واحدةً ⇒ فتعمل الثانيةُ بحساب الأولى (وهي عينُ علّة الاستيراد التي أُصلحت).
  const ck = o.panelId ?? o.id;
  const c = sessionCache.get(ck);
  if (c && now - c.at < SESSION_TTL) return c.s;
  const pass = o.odooPass ?? ""; // نصٌّ صريح (كـSAS) — العامل لا يملك مفتاح التشفير
  const s = await odooLogin(o.odooUrl, o.odooUser ?? "", pass);
  sessionCache.set(ck, { s, at: now });
  return s;
}

// ═══════════ أ-٢٣ · أودو لكلّ لوحة (طلب محمد 2026-08-13) ═══════════
// 🔴 **كان أودو للمكتب حصراً**: هذه الدالّةُ تقرأ `towers` وحدَها، والدالّةُ `odooOfPanel`
// معرَّفةٌ في `sasPanel.ts` **ولا يستدعيها أحد** — شفرةٌ ميّتة. فحقولُ أودو على اللوحة
// (وهي موجودةٌ كلُّها: `odooEnabled/Url/User/Pass/Uid/LastOk/LastError/LastTicketId`)
// **يكتبها محرِّرُ اللوحات ولا يقرؤها شيء** — وهو عينُ فخّ «يُكتَب ولا يُقرَأ».
//
// والآن تُرجع الدالّةُ **وحدتَي مزامنةٍ**:
//   (١) المكتبُ بأعمدته — كما كان حرفيّاً (وهو لوحتُه الأولى)
//   (٢) وكلُّ لوحةٍ **غيرِ أولى** لها حسابُ أودو خاصٌّ بها
// ⚠️ واللوحةُ الأولى هي المكتبُ نفسُه، فلو ضُمّت **مع** حسابٍ على أعمدة المكتب لعُوملت
//   التذاكرُ **مرّتَين** (وذاك أصلُ «التنفيذ المزدوج» المسجَّل في ب-١).
// 🔄 (2026-08-27) لكنّ مكتباً أعمدتُه فارغةٌ وحسابُ لوحته الأولى مُدخَلٌ في «لوحات الساس»
//   (كاسبر) كان بلا وحدةٍ أصلاً — فالأولى تُقبَل وحدةً **عند فراغ أعمدة المكتب حصراً**.
//
// 📌 وحقولُ **المهلة (SLA)** تبقى على المكتب وتُورَّث لكلّ لوحاته: فهي **سياسةُ مكتبٍ** (دقائقُ
// الإنذار ونصوصُه) لا خصيصةُ مُخدِّم. أمّا **الاتصالُ والمؤشِّر** (`odooLastTicketId`) فلكلّ
// لوحةٍ وحدَها — ولولا ذلك لأكل مؤشِّرُ إحداهما تذاكرَ الأخرى.
async function offices(agentId: number): Promise<OfficeRow[]> {
  const SLA = {
    odooSlaAlarm: true, odooSlaTechText: true,
    odooSlaAuto: true, odooSlaArmedAt: true, odooSlaAlarmMin: true, odooSlaSendMin: true, odooSlaNote: true, odooSlaWaText: true,
  } as const;
  // ⚠️ و`SasPanel` **بلا علاقةِ Prisma** إلى `Tower` (فيه `towerId` مجرَّداً) ⇒ لا ضمَّ متداخلاً،
  //   فتُقرأ مكاتبُ الوكيل أوّلاً ومنها العزلُ وسياسةُ المهلة.
  const all = await prisma.tower.findMany({
    where: { agentId, isDeleted: false },
    select: {
      id: true, name: true, odooUser: true, odooPass: true, odooUrl: true, odooLastTicketId: true, odooEnabled: true, odooUid: true,
      agentId: true, ...SLA,
    },
  });
  const byId = new Map(all.map((t) => [t.id, t]));
  const rawPanels = all.length
    ? await prisma.sasPanel.findMany({
        where: {
          isDeleted: false,
          // ⚠️ **لا يكفي `not: null`**: لوحاتُ صميم فيها `odooUser = ""` (نصٌّ فارغٌ لا NULL)
          //   فيقبله الترشيح ⇒ وحدةٌ بمستخدمٍ فارغٍ تفشل كلَّ دورةٍ وتكتب خطأً بلا فائدة.
          odooUser: { not: null, notIn: [""] }, odooPass: { not: null, notIn: [""] },
          towerId: { in: all.map((t) => t.id) }, // 🔒 عزلُ الوكيل: مكاتبُه وحدَها
        },
        select: {
          id: true, label: true, towerId: true, isPrimary: true, odooUser: true, odooPass: true, odooUrl: true,
          odooLastTicketId: true, odooEnabled: true, odooUid: true,
        },
      })
    : [];
  // 🔄 (بلاغُ كاسبر 2026-08-27) كان استبعادُ الأولى شرطاً في الاستعلام نفسِه — فحسابُ
  //    أودو المُدخَلُ في **اللوحة الأولى** ميّتٌ دائماً، حتى حين تكون أعمدةُ المكتب فارغةً
  //    (محمد أدخل حسابَي اللوحتين في «لوحات الساس» فسحبت الثانيةُ وحدَها وصمتت الأولى).
  //    الآن: الأولى تُقبَل وحدةً **فقط إن كانت أعمدةُ المكتب بلا حساب** — فلا ازدواجَ أبداً
  //    مع وحدة المكتب (حرسُ «التنفيذ المزدوج» ب-١ قائم)، وصميمُ (حسابُه على المكتب) لا يتغيّر.
  const panels = rawPanels.filter((p) => {
    if (!p.isPrimary) return true;
    const t = byId.get(p.towerId);
    return !(t?.odooUser?.trim() && t?.odooPass?.trim());
  });
  return [
    // (١) المكاتبُ بأعمدتها — بنفس شرطها القديم حرفيّاً (لها user+pass)
    ...all.filter((t) => t.odooUser?.trim() && t.odooPass?.trim()).map((t) => ({ ...t, panelId: null as number | null })),
    // (٢) واللوحاتُ غيرُ الأولى بحساباتها
    ...panels.map((p) => {
      const t = byId.get(p.towerId);
      return {
        // `id` يبقى **معرّفَ المكتب** فكلُّ ما بُني على «تذكرةٌ لمكتبٍ» يظلّ صحيحاً،
        // و`panelId` يُوجِّه كتابةَ الحالة والمؤشِّر إلى صفّ اللوحة لا المكتب.
        id: p.towerId, panelId: p.id,
        name: t?.name ? `${t.name} · ${p.label ?? "لوحة"}` : (p.label ?? null),
        odooUser: p.odooUser, odooPass: p.odooPass, odooUrl: p.odooUrl,
        odooLastTicketId: p.odooLastTicketId, odooEnabled: p.odooEnabled, odooUid: p.odooUid,
        agentId: t?.agentId ?? null,
        // سياسةُ المهلة تُورَّث من المكتب — سياسةُ مكتبٍ لا خصيصةُ مُخدِّم
        odooSlaAlarm: t?.odooSlaAlarm ?? null, odooSlaTechText: t?.odooSlaTechText ?? null,
        odooSlaAuto: t?.odooSlaAuto ?? null, odooSlaArmedAt: t?.odooSlaArmedAt ?? null,
        odooSlaAlarmMin: t?.odooSlaAlarmMin ?? null, odooSlaSendMin: t?.odooSlaSendMin ?? null,
        odooSlaNote: t?.odooSlaNote ?? null, odooSlaWaText: t?.odooSlaWaText ?? null,
      };
    }),
  ];
}

/** حالةُ أودو تُكتَب في صفّ **اللوحة** إن كانت الوحدةُ لوحةً، وإلّا في صفّ المكتب. */
async function saveOdooState(o: OfficeRow, data: Record<string, unknown>): Promise<void> {
  if (o.panelId != null) await prisma.sasPanel.update({ where: { id: o.panelId }, data }).catch(() => {});
  else await prisma.tower.update({ where: { id: o.id }, data }).catch(() => {});
}

// مكتب «أودو نشط»؟ = مفعّل، أو معطّل لكن به بطاقات أودو مفتوحة (drain حتى إنجاز آخرها)
async function isActive(o: OfficeRow): Promise<boolean> {
  if (o.odooEnabled === "1") return true;
  return (await countOpenOdooCards(o.id)) > 0;
}

// آخر ملاحظة إلغاء من سجلّ البطاقة (يخزّنها مسار cancel كـ«إلغاء البطاقة — {note}»)
function cancelNoteFromHistory(history: string | null): string | null {
  if (!history) return null;
  try {
    const arr = JSON.parse(history) as { text?: string }[];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = String(arr[i]?.text ?? "").match(/إلغاء البطاقة\s*—\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch { /* تجاهل */ }
  return null;
}

// هل يُسمح لهذا الوكيل بالميزة ٢ (إرسال رسائل أودو والمشتركين)؟ إذنٌ من مالك النظام.
// **يُفحَص عند التنفيذ** لا عند الحفظ وحده: سحبُ الإذن يجب أن يقطع الإرسال فوراً ولو بقي
// مفتاح المكتب مشتعلاً (اصطاده تدقيقٌ عدائيّ 2026-08-09).
const allowCache = new Map<number, { v: boolean; at: number }>();
async function sendAllowedFor(agentId: number): Promise<boolean> {
  const hit = allowCache.get(agentId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v = false;
  try {
    const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { odooSlaSendAllowed: true } });
    v = !!a?.odooSlaSendAllowed;
  } catch { v = false; } // تعذّرت القراءة (صلاحية/شبكة) ⇒ **فشلٌ مغلق**: لا إرسال
  allowCache.set(agentId, { v, at: Date.now() });
  return v;
}

/** أ-١٥/٤ · أسماءُ المراحل المجهولة التي نُبِّه عليها — مرّةً لكلّ اسمٍ لا كلَّ دورة */
const unknownStages = new Set<string>();

async function listIdsOf(towerId: number): Promise<number[]> {
  // مجموعةُ اللوحة: يُحلُّ المكتبُ إلى لوحته المشتركة. مساراتُ المصالحة/الدفع (runPull/runSlaSweep)
  // معزولةٌ بـodooPanelId لكلّ لوحة؛ ومسارا **العامل** (runTechAlerts/runWaQueue) يُقيَّمان لكلّ
  // حاسبةِ مكتبٍ لا لكلّ لوحة، فيُرفَقان بـodooOfficeScope(officeId) على اللوحة المشتركة.
  const { fieldBoardOffice } = await import("@/lib/field");
  const boardOffice = (await fieldBoardOffice(towerId)) ?? towerId;
  const board = await prisma.taskBoard.findFirst({ where: { towerId: boardOffice, isDeleted: false }, select: { id: true } });
  if (!board) return [];
  const lists = await prisma.taskList.findMany({ where: { boardId: board.id, isDeleted: false }, select: { id: true } });
  return lists.map((l) => l.id);
}

// عزلُ بطاقات المكتب على اللوحة المشتركة لمسارات العامل (التي لا تُفلتر بـodooPanelId): حين يكون
// المكتبُ ضمن مجموعةٍ (لوحةٌ مشتركةٌ فيها بطاقاتُ مكتبٍ آخر) نُقيّد بـofficeId؛ ومكتبٌ مستقلٌّ لا فلتر
// (فتشمل بطاقاتُه القديمةَ بـofficeId=null — سلوكُ اليوم حرفيّاً). يُبقي مكتبَ الحاسبة على بطاقاته وحده.
async function odooOfficeScope(officeId: number): Promise<{ officeId?: number }> {
  const { fieldGroupOffices } = await import("@/lib/field");
  const group = await fieldGroupOffices(officeId);
  return group.length > 1 ? { officeId } : {};
}

// ===== السحب (كلّ ١٠د): تذاكر جديدة + رسيف Change Team + إنشاء بطاقات + مصالحة القائمة =====
async function runPull(): Promise<void> {
  if (pulling) return; pulling = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    for (const o of await offices(agentId)) {
      if (!(await isActive(o))) continue; // معطّل بلا بطاقات مفتوحة ⇒ لا مزامنة
      const enabled = o.odooEnabled === "1";
      try {
        const s = await officeSession(o);
        // نجاح الدخول ⇒ الشارة خضراء + uid
        await saveOdooState(o, { odooLastOk: new Date(), odooLastError: null, ...(o.odooUid == null ? { odooUid: s.uid } : {}) });

        // (١) مسحٌ شامل كلّ دورة: كلّ التذاكر المفتوحة المُسنَدة للمكتب — **بلا قيد العلامة**.
        // يلتقط الجديد، و**يعيد إنشاء بطاقةٍ حُذفت وتذكرتها ما زالت مفتوحة** (كي لا تبقى معلّقةً
        // في أودو بلا Done/Cancel — طلب محمد)، و**يُحدّث البطاقات القائمة** (إلزاميّة اليوزر/الهاتف/bg).
        // المعطّل (drain): تحديث القائم فقط — لا بطاقات جديدة.
        const tickets = await odooFetchOpenTickets(s, 0);
        const openById = new Map<number, (typeof tickets)[number]>();
        let maxId = o.odooLastTicketId ?? 0;
        for (const t of tickets) {
          maxId = Math.max(maxId, t.id);
          // حارس المصدر: مُسنَد لحساب المكتب حصراً
          if (t.assignedUid != null && t.assignedUid !== s.uid) continue;
          // ═════ أ-١٥/٤ · المرحلةُ المجهولةُ تُسحَب ولا تُسقَط صامتةً (مُصلَحة 2026-08-14) ═════
          // كان الشرطُ `!isOpenStage` يُسقط **كلَّ** مرحلةٍ خارج أربعةِ أسماءٍ محفوظة — فتذكرةٌ
          // في مرحلةٍ أُعيدت تسميتُها في أودو **لا تُسحَب أبداً** ويظنّها الجميعُ منتهية.
          // والصواب: يُسقَط المنتهي وحدَه (`isDoneStage`)، والمجهولُ يُسحَب ويُنبَّه على اسمه
          // — فالغيابُ عن قائمةٍ ثابتةٍ عندنا ليس دليلَ انتهاءٍ في أودو.
          if (isDoneStage(t.stageName)) continue;
          if (isUnknownStage(t.stageName) && !unknownStages.has(t.stageName)) {
            unknownStages.add(t.stageName);
            console.warn(`[odoo-sync] ⚠️ مرحلةٌ غيرُ معروفة «${t.stageName}» (مكتب ${o.id}) — تُسحَب تذاكرُها ولا تُسقَط`);
          }
          openById.set(t.id, t);
          const existing = await prisma.taskCard.findFirst({ where: { odooTicketId: t.id, isDeleted: false }, select: { id: true } });
          if (existing) { await refreshOdooCard(existing.id, t); continue; } // قائمة ⇒ تحديثٌ فقط
          if (!enabled) continue; // drain: لا إنشاء
          // Change Team ⇒ رسيف تلقائيّ؛ In Progres ⇒ بلا رسيف (مُستلَمٌ مسبقاً)
          if (t.stageName.trim().toLowerCase() === "change team") {
            try { await odooReceive(s, t.id); } catch { /* لا يمنع الإنشاء */ }
          }
          await upsertOdooCard(o.id, t, o.panelId);
        }
        if (maxId > (o.odooLastTicketId ?? 0)) await saveOdooState(o, { odooLastTicketId: maxId });

        // (٢) مصالحة: بطاقات مفتوحة تذاكرها **ليست** ضمن المفتوح المسحوب ⇒ تحقّقٌ مباشر (أُغلقت خارجيّاً؟)
        const listIds = await listIdsOf(o.id);
        // مجموعةُ اللوحة: odooPanelId=null متصادمٌ بين مكتبَي المجموعة على اللوحة المشتركة، فنعزل
        // بـofficeId أيضاً (مستقلٌّ ⇒ بلا فلتر). وإلّا قرأ القائدُ تذكرةَ المكتب الآخر بجلسته وأغلقها خطأً.
        const officeScope = await odooOfficeScope(o.id);
        if (listIds.length) {
          const open = await prisma.taskCard.findMany({
            where: { listId: { in: listIds }, ...officeScope, odooPanelId: o.panelId, viaOdoo: true, odooTicketId: { not: null }, done: false, settled: false, isDeleted: false, archivedAt: null },
            // ═════ أ-١٥/٦ · المصالحةُ مسقوفةٌ بأربعين — **فلتكن بترتيبٍ عادل** (2026-08-14) ═════
            // كانت بلا `orderBy` ⇒ ترتيبُ القاعدة (id تصاعديّاً غالباً) يعني أنّ أوّلَ أربعين
            // بطاقةً تُفحَص كلَّ دورةٍ إلى الأبد، **والباقي لا يُفحَص أبداً** في مكتبٍ مزدحم —
            // وهي عينُ الحالة التي أخفت `#1444601` عن المصالحة. الأقدمُ **فحصاً** أوّلاً
            // (`odooFetchedAt` تُحدَّث عند كلّ تحديثٍ للبطاقة) فيدور الطابورُ على الجميع.
            select: { id: true, odooTicketId: true }, take: 40,
            orderBy: [{ odooFetchedAt: "asc" }, { id: "asc" }],
          });
          for (const c of open) {
            if (openById.has(c.odooTicketId as number)) continue; // ما زالت مفتوحةً — حُدّثت أعلاه
            try {
              const tk = await odooReadTicket(s, c.odooTicketId as number);
              if (tk && isDoneStage(tk.stageName)) {
                // ═════ 🔴 أ-١٥/١ · الإلغاءُ ليس إنجازاً (علّةٌ كامنةٌ مُصلَحة 2026-08-14) ═════
                // كان `cancelled` داخل `DONE_STAGES` فتُختَم البطاقةُ `done: true` ⇒ **عملٌ لم
                // يُعمَل يُحتسب إنجازاً للفنيّ ويُكسبه نقاطَه** (`card_completions` تُبنى من
                // المنجَز). والصواب: الملغاةُ تخرج من اللوحة بـ`settled` (خارج التحصيل) لا
                // بـ`done` — فلا تُعَدُّ في إنجازاته ولا في نقاطه، ويبقى أثرُها في السجلّ.
                const cancelled = isCancelledStage(tk.stageName);
                await prisma.taskCard.update({
                  where: { id: c.id },
                  data: cancelled
                    ? { settled: true, techNote: "أُلغيت في أودو — لا تُحتسب إنجازاً", odooPushedAt: new Date() }
                    : { done: true, completedAt: new Date(), techNote: "أُنجزت/أُغلقت خارجيّاً في أودو", odooPushedAt: new Date() },
                });
                await appendCardHistory(c.id, "أودو", cancelled
                  ? `أُلغيت في أودو (${tk.stageName}) — خرجت من اللوحة ولا تُحتسب إنجازاً للفنيّ`
                  : `أُغلقت خارجيّاً في أودو (${tk.stageName})`);
              }
            } catch { /* تذكرة واحدة — تجاهل */ }
          }
        }
      } catch (e) {
        sessionCache.delete(o.panelId ?? o.id); // متوسّط(٢٠): المفتاحُ نفسُه الذي خُزنت به — كان o.id فتبقى جلسةُ اللوحة الميّتة محبوسةً حتى انقضاء عمرها
        await saveOdooState(o, { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[odoo-sync] pull:", e instanceof Error ? e.message : e);
  } finally { pulling = false; }
}

// ===== الدفع (كلّ ٢٠ث، «فوريّ»): بطاقات أودو منجَزة/ملغاة لم تُدفَع ← أودو =====
async function runPush(): Promise<void> {
  if (pushing) return; pushing = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    await pushAgentToOdoo(agentId);
  } catch (e) {
    console.error("[odoo-sync] push:", e instanceof Error ? e.message : e);
  } finally { pushing = false; }
}

// ===== دفعٌ مشترك بين العامل والسحابة (طلب محمد 2026-08-09: بديلٌ سحابيّ عند إغلاق المكاتب) =====
// يدفع لكلّ مكاتب الوكيل: (١) الإنجاز/الإلغاء ⇒ close/cancel، (٢) ملاحظة التأجيل اليدويّ ⇒ chatter.
// **لا سحبَ ولا واتساب ولا إرسالاً تلقائيّاً** — هذه تبقى على العامل المحليّ حصراً (قرار الأجور).
// وإن لم يكن هناك معلّقٌ لمكتبٍ فلا دخولَ لأودو إطلاقاً (زهيد).
/** ب-١/الأصل ٤ · ينشر الملاحظةَ في محادثة العميل **مرّةً واحدةً أبداً**.
 *  الختمُ يُكتَب **قبل** أن نعود، فلو انقطع شيءٌ بعده لم تُنشر ثانيةً. وإن كان مختوماً
 *  سلفاً فهذه إعادةُ محاولةٍ لخطوةٍ لاحقة (الإغلاق) — فنتخطّى النشرَ بلا صوت. */
async function postNoteOnce(
  cardId: number, notedAt: Date | null, s: OdooSession, ticketId: number, note: string, accessToken: string | null,
): Promise<void> {
  if (notedAt) return; // نُشرت في محاولةٍ سابقة — والعميلُ لا يُرسَل له مرّتَين
  await odooChatterPost(s, ticketId, note, accessToken);
  // ⚠️ لا `.catch()` صامتٌ هنا: لو تعذّر الختمُ لَعُدنا إلى تكرار النشر — فليُفشِل الدفعَ
  // كلَّه بدلاً من ذلك (يُفَكّ الحجزُ وتُعاد المحاولةُ، والملاحظةُ ستُنشر ثانيةً مرّةً واحدةً
  // على الأكثر في هذه الحالة النادرة، وهو أهونُ من تكرارٍ كلَّ دورةٍ إلى الأبد).
  await prisma.taskCard.update({ where: { id: cardId }, data: { odooNotedAt: new Date() } });
}

export async function pushAgentToOdoo(agentId: number): Promise<{ pushed: number; notes: number }> {
  let pushed = 0, notes = 0;
  for (const o of await offices(agentId)) {
    const listIds = await listIdsOf(o.id);
    if (!listIds.length) continue;
    // مجموعةُ اللوحة: عزلٌ إضافيٌّ بـofficeId (odooPanelId=null متصادمٌ على اللوحة المشتركة)
    const officeScope = await odooOfficeScope(o.id);
    const [pending, postponed] = await Promise.all([
      prisma.taskCard.findMany({
        where: {
          listId: { in: listIds }, ...officeScope, odooPanelId: o.panelId, viaOdoo: true, odooTicketId: { not: null }, odooPushedAt: null,
          isDeleted: false, OR: [{ done: true }, { settled: true }],
        },
        select: { id: true, odooTicketId: true, done: true, settled: true, serviceDetails: true, techNote: true, odooBg: true, history: true, odooNotedAt: true },
        take: 25,
      }),
      // ملاحظة تأجيلٍ يدويّ أحدث من آخر دفع (تُدفَع دائماً — لا تخضع لمفاتيح الإرسال)
      prisma.taskCard.findMany({
        where: {
          listId: { in: listIds }, ...officeScope, odooPanelId: o.panelId, viaOdoo: true, odooTicketId: { not: null },
          done: false, settled: false, isDeleted: false, archivedAt: null,
          postponeNote: { not: null }, postponeNoteAt: { not: null },
        },
        select: { id: true, odooTicketId: true, postponeNote: true, postponeNoteAt: true, postponePushedAt: true },
        take: 25,
      }),
    ]);
    const dueNotes = postponed.filter((c) => c.postponeNoteAt && (!c.postponePushedAt || c.postponeNoteAt.getTime() > c.postponePushedAt.getTime()));
    if (!pending.length && !dueNotes.length) continue; // لا شيء ⇒ بلا دخولٍ لأودو

    let s: OdooSession;
    try { s = await officeSession(o); }
    catch (e) {
      sessionCache.delete(o.panelId ?? o.id); // متوسّط(٢٠): المفتاحُ نفسُه الذي خُزنت به — كان o.id فتبقى جلسةُ اللوحة الميّتة محبوسةً حتى انقضاء عمرها
      await saveOdooState(o, { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) }).catch(() => {});
      continue;
    }

    for (const c of pending) {
      const ticketId = c.odooTicketId as number;
      // حجزٌ ذرّيّ قبل أيّ نداء: صار للدفع **مصدران** (العامل والسحابة)، ولحظةَ عودة حاسبةٍ
      // أثناء دورةٍ سحابيّة قد يدفعان البطاقة نفسها ⇒ ملاحظةٌ مكرّرة في أودو وإغلاقٌ مرّتين.
      const claimed = await prisma.taskCard.updateMany({ where: { id: c.id, odooPushedAt: null }, data: { odooPushedAt: new Date() } });
      if (claimed.count !== 1) continue;
      try {
        const note = (c.serviceDetails && c.serviceDetails.trim()) || (c.techNote && c.techNote.trim()) || cancelNoteFromHistory(c.history) || (c.done ? "أُنجزت" : "أُلغيت");
        const tk = await odooReadTicket(s, ticketId);
        const accessToken = tk?.accessToken ?? null;
        if (c.done) {
          // إنجاز: BG (إن وُجد) ← ملاحظة ← close
          if (c.odooBg && c.odooBg.trim()) { try { await odooChangeBg(s, ticketId, c.odooBg.trim()); } catch { /* الملاحظة والإغلاق أهمّ */ } }
          await postNoteOnce(c.id, c.odooNotedAt, s, ticketId, note, accessToken);
          await odooClose(s, ticketId);
        } else {
          // إلغاء: ملاحظة ← cancel
          await postNoteOnce(c.id, c.odooNotedAt, s, ticketId, note, accessToken);
          await odooCancel(s, ticketId);
        }
        // ═════ أ-١٥/٢ · **تحقُّقٌ أنّ الإغلاق وقع فعلاً** (علّةٌ كامنةٌ مُصلَحة 2026-08-14) ═════
        // كان `odooClose` يُنادى ويُفترَض نجاحُه ما لم يرمِ استثناءً — لكنّ أودو قد يردّ ٢٠٠
        // ولا تنتقل المرحلة (صلاحيّة/حالةُ سير عمل). فتبقى التذكرةُ **مفتوحةً في سوبر سيل**
        // والبطاقةُ مختومةً عندنا ⇒ **بلا مُعيدٍ ولا إنذار** — وهي عينُ ما اشتكى منه محمد.
        // ⇒ تُقرأ التذكرةُ بعد الدفع: إن بقيت مفتوحةً يُفكّ الحجزُ (فتُعاد المحاولة) ويُكتب
        //   السببُ في سجلّ البطاقة. والملاحظةُ لا تُعاد (ختمُها `odooNotedAt` باقٍ).
        const after = await odooReadTicket(s, ticketId).catch(() => null);
        if (after && !isDoneStage(after.stageName)) {
          await prisma.taskCard.update({ where: { id: c.id }, data: { odooPushedAt: null } }).catch(() => {});
          await appendCardHistory(c.id, "أودو",
            `⚠️ لم يُغلق فعلاً — التذكرةُ ما زالت «${after.stageName ?? "؟"}» بعد الدفع، ستُعاد المحاولة`).catch(() => {});
          continue; // لا يُحتسب مدفوعاً
        }
        await appendCardHistory(c.id, "أودو", c.done ? "دُفِع الإنجاز إلى أودو (close) ✓ مؤكَّد" : "دُفِع الإلغاء إلى أودو (cancel) ✓ مؤكَّد");
        pushed++;
      } catch (e) {
        // فشل الدفع: يُفكّ الحجز (odooPushedAt=null) فتُعاد المحاولة — مقاومة الإطفاء/الانقطاع.
        // ═════ ب-١/الأصل ٤ (2026-08-13) ═════
        // 🔴 وكان هذا الفكُّ **يُعيد نشرَ الملاحظة في محادثة العميل** كلَّ دورةٍ إن نجح النشرُ
        //   وفشل ما بعده (`close` أو حتى كتابةُ السجلّ) — خرقٌ صريحٌ لقاعدة «لا يُفَكّ الحجزُ
        //   بعد أثرٍ لا يُسترَدّ». والإغلاقُ يتحمّل التكرارَ، أمّا رسالةٌ يراها العميلُ فلا.
        // ⇒ الحلُّ ليس منعَ الإعادة (فيبقى الإغلاقُ معلَّقاً للأبد) بل **ختمُ الأثر وحدَه**:
        //   `odooNotedAt` لا يُفَكّ، فالإعادةُ تُكمل الإغلاقَ ولا تُعيد النشر. (`postNoteOnce`)
        await prisma.taskCard.update({ where: { id: c.id }, data: { odooPushedAt: null } }).catch(() => {});
        await appendCardHistory(c.id, "أودو", `تعذّر الدفع إلى أودو: ${String((e as Error).message ?? "").slice(0, 120)}`).catch(() => {});
      }
    }

    for (const c of dueNotes) {
      const ticketId = c.odooTicketId as number;
      const stamp = c.postponeNoteAt as Date;
      const prev = c.postponePushedAt;
      // حجزٌ ذرّيّ بنفس المنطق: يُختَم بطابع **الملاحظة** لا بـ«الآن»، فملاحظةٌ أحدث تبقى مستحقّة
      const claimed = await prisma.taskCard.updateMany({
        where: { id: c.id, ...(prev ? { postponePushedAt: prev } : { postponePushedAt: null }) },
        data: { postponePushedAt: stamp },
      });
      if (claimed.count !== 1) continue;
      // ب-١/الأصل ٤ · هل نُشرت الملاحظةُ فعلاً قبل الفشل؟ فالحجزُ لا يُفَكّ بعد أثرٍ
      // لا يُسترَدّ — ولو فشلت كتابةُ السجلّ وحدَها لَعادت الملاحظةُ إلى محادثة العميل.
      let posted = false;
      try {
        const tk = await odooReadTicket(s, ticketId);
        await odooChatterPost(s, ticketId, c.postponeNote as string, tk?.accessToken ?? null);
        posted = true; // ⇐ من هنا فصاعداً لا يجوز فكُّ الحجز
        await appendCardHistory(c.id, "أودو", `دُفِعت ملاحظة التأجيل إلى أودو — ${c.postponeNote}`);
        notes++;
      } catch (e) {
        if (!posted) await prisma.taskCard.update({ where: { id: c.id }, data: { postponePushedAt: prev } }).catch(() => {});
        await appendCardHistory(c.id, "أودو", `تعذّر إبلاغ أودو بالتأجيل: ${String((e as Error).message ?? "").slice(0, 120)}`).catch(() => {});
      }
    }
  }
  return { pushed, notes };
}

/** هل لهذا الوكيل عاملٌ محليٌّ نبض حديثاً؟ (البديل السحابيّ لا يعمل إلّا إن كانت الحاسبات مطفأة) */
export async function agentHasLiveWorker(agentId: number, withinMs = 15 * 60_000): Promise<boolean> {
  const row = await prisma.hybridWorker.findFirst({
    where: { agentId, approved: true, lastSeen: { gte: new Date(Date.now() - withinMs) } },
    select: { id: true },
  });
  return !!row;
}

// ===== الميزة ١ (إنذارات): إشعار المدير مرّةً + تنبيه الفنيّ كلّ ١٥ دقيقة =====
// «حتى انتهاء البطاقة إنجازاً أو إلغاءً» (قرار محمد) — فالتنبيه يستمرّ بعد التأجيل التلقائيّ.
// واستثناءٌ واحدٌ معلَن: بطاقةٌ أُجّلت **يدويّاً** إلى موعدٍ قادم يتوقّف تنبيهها حتى يحلّ موعدها،
// وإلّا نبّهنا الفنيّ كلّ ربع ساعةٍ لأيّامٍ على موعدٍ لم يحن.
type SlaCardRow = {
  id: number; title: string; odooTicketId: number | null; odooCreatedAt: Date | null; odooFetchedAt: Date | null;
  createdAt: Date; postponedTo: Date | null; odooPhone: string | null; odooBg: string | null;
  history: string | null; technicianId: number | null; slaAlertAt: Date | null; slaTechAt: Date | null;
};
async function notifyManagers(o: OfficeRow, cards: SlaCardRow[], alarmMin: number, sendMin: number, now: Date): Promise<void> {
  for (const c of cards) {
    if (c.slaAlertAt != null) continue; // أُشعِر مرّةً — لا تكرار (الوميض يكفي بعدها)
    if (c.postponedTo && c.postponedTo.getTime() > now.getTime()) continue; // مؤجَّلة لموعدٍ قادم
    const st = slaStateOf({ ...c, viaOdoo: true, postponedTo: null, slaNoteAt: null }, now, alarmMin, sendMin);
    if (st.level !== "danger" && st.level !== "over") continue;
    const claim = await prisma.taskCard.updateMany({ where: { id: c.id, slaAlertAt: null }, data: { slaAlertAt: now } });
    if (claim.count !== 1) continue;
    await notify({
      agentId: o.agentId, towerId: o.id, type: "odooSla",
      title: "⏳ تذكرة أودو تأخّرت",
      body: `${c.title} — مكتب ${o.name ?? o.id}${st.toSendMin > 0 ? ` · متبقٍّ ${fmtMin(st.toSendMin)}` : ""}`,
      refType: "taskCard", refId: c.id, url: "/field-management",
    });
  }
}

// تنبيه الفنيّ كلّ ١٥ دقيقة — **على حاسبة مكتبه** (واتساب مكتبه محليّاً بلا مُرحِّلٍ بمهلة ١٥ث
// داخل حلقةٍ على القائد). يستمرّ **حتى إنجاز البطاقة أو إلغائها** — أي بعد التأجيل التلقائيّ أيضاً
// (قرار محمد)، فلا يُرشَّح هنا بـslaNoteAt خلافاً لسويب الإرسال.
async function runTechAlerts(o: { id: number; name: string | null; agentId: number | null; odooSlaAlarm: string | null; odooSlaTechText: string | null; odooSlaAlarmMin: number | null; odooSlaSendMin: number | null }, listIds: number[], now: Date, officeScope: { officeId?: number } = {}): Promise<void> {
  if (o.odooSlaAlarm !== "1" || !inSlaWindow(now)) return;
  const alarmMin = o.odooSlaAlarmMin ?? SLA_ALARM_MIN_DEFAULT;
  const sendMin = o.odooSlaSendMin ?? SLA_SEND_MIN_DEFAULT;
  const cards = await prisma.taskCard.findMany({
    where: {
      listId: { in: listIds }, ...officeScope, viaOdoo: true, odooTicketId: { not: null }, technicianId: { not: null },
      done: false, settled: false, isDeleted: false, archivedAt: null,
    },
    select: {
      id: true, title: true, odooTicketId: true, odooCreatedAt: true, odooFetchedAt: true, createdAt: true,
      postponedTo: true, odooPhone: true, odooBg: true, technicianId: true, slaTechAt: true,
    },
    take: 40,
  });
  const { sendWhatsApp } = await import("@/lib/whatsapp");
  for (const c of cards) {
    if (c.postponedTo && c.postponedTo.getTime() > now.getTime()) continue; // مؤجَّلة لموعدٍ قادم ⇒ صمت
    if (c.slaTechAt != null && now.getTime() - c.slaTechAt.getTime() < SLA_TECH_EVERY_MS) continue;
    const st = slaStateOf({ ...c, viaOdoo: true, postponedTo: null, slaNoteAt: null }, now, alarmMin, sendMin);
    if (st.level !== "danger" && st.level !== "over") continue;
    const tech = await prisma.technician.findFirst({
      where: { id: c.technicianId as number, isDeleted: false, agentId: o.agentId ?? -1 }, // عزل الوكيل
      select: { phone: true },
    });
    if (!tech?.phone) continue;
    // حجزٌ ذرّيّ على الطابع السابق: حاسبتان لا تُرسلان تنبيهاً واحداً مرّتين
    const prev = c.slaTechAt;
    const claim = await prisma.taskCard.updateMany({
      where: { id: c.id, slaTechAt: prev }, data: { slaTechAt: now },
    });
    if (claim.count !== 1) continue;
    const text = fillSlaText((o.odooSlaTechText ?? "").trim() || SLA_TECH_DEFAULT, {
      office: o.name, ticket: c.odooTicketId, phone: c.odooPhone, bg: c.odooBg,
    });
    const r = await sendWhatsApp(o.id, tech.phone, `${text}\n📋 ${c.title}`);
    if (!r.ok) await prisma.taskCard.updateMany({ where: { id: c.id }, data: { slaTechAt: prev } }).catch(() => {});
    else await prisma.message.create({
      data: { channel: "WHATSAPP", phone: tech.phone, text, status: "SENT", createdByUser: "أودو-تنبيه", agentId: o.agentId },
    }).catch(() => {});
  }
}

// ===== مهلة سوبر سيل (كلّ دقيقة، على القائد): ملاحظة التأجيل إلى أودو =====
// سوبر سيل تُغرّم إن مضت ساعتان بلا إجراء. المسار هنا شقّان:
//   (أ) **تأجيلٌ يدويّ** لبطاقة أودو ⇒ تُدفَع ملاحظة الفنيّ إلى أودو (الربط الثلاثيّ المتّفق عليه:
//       إنجاز=close · إلغاء=cancel · تأجيل=ملاحظة). يُدفَع دائماً، بلا علاقةٍ بمفتاح التلقائيّ.
//   (ب) **تأجيلٌ تلقائيّ** عند تجاوز عتبة الإرسال (٩٠ دقيقةَ نافذة) بنصّ المدير — بشروطٍ صارمة:
//       مفتاح التلقائيّ مُشعَل، والبطاقة سُحبت **بعد** لحظة التسليح (فلا رشقةَ تذاكرَ قديمة لحظة
//       التشعيل)، ومضت مهلة رؤية ١٠ دقائق على سحبها، وبسقف ٥ رسائل للمكتب في الدورة.
// الترتيب إلزاميّ: **أودو أوّلاً** (فعلٌ قابل للتكرار) ثمّ إدراج الواتساب في الطابور — كي لا يُبلَّغ
// المشترك بتأجيلٍ لا تعلمه أودو (فتقع الغرامة والمشترك مُبلَّغ).
async function runSlaSweep(): Promise<void> {
  if (slaBusy) return; slaBusy = true;
  try {
    if (!isLeaderNow()) return;
    const agentId = getWorkerAgentId();
    if (agentId == null) return;
    const sendAllowed = await sendAllowedFor(agentId); // إذن مالك النظام — يُفحَص كلّ دورة
    for (const o of await offices(agentId)) {
      const listIds = await listIdsOf(o.id);
      if (!listIds.length) continue;
      // مجموعةُ اللوحة: عزلٌ إضافيٌّ بـofficeId (odooPanelId=null متصادمٌ على اللوحة المشتركة)
      const officeScope = await odooOfficeScope(o.id);
      // الميزة ١ مطفأة ومفتاح الإرسال مطفأ ⇒ لا عمل هنا إلّا دفعُ ملاحظات التأجيل اليدويّ
      const alarmOn = o.odooSlaAlarm === "1";
      // لا يُرشَّح بـslaNoteAt هنا: البطاقة المؤجَّلة يدويّاً مرّةً أخرى يجب أن تُدفَع ملاحظتها
      // الجديدة إلى أودو (الترشيح بالختم كان يُسقط كلّ تأجيلٍ بعد الأوّل — اصطاده تدقيق عدائيّ).
      const cards = await prisma.taskCard.findMany({
        where: {
          listId: { in: listIds }, ...officeScope, odooPanelId: o.panelId, viaOdoo: true, odooTicketId: { not: null },
          done: false, settled: false, isDeleted: false, archivedAt: null,
        },
        select: {
          id: true, title: true, odooTicketId: true, odooCreatedAt: true, odooFetchedAt: true, createdAt: true,
          postponedTo: true, odooPhone: true, odooBg: true, history: true, slaNoteAt: true,
          postponeNote: true, postponeNoteAt: true, postponePushedAt: true,
          technicianId: true, slaAlertAt: true, slaTechAt: true,
        },
        take: 60,
      });
      if (!cards.length) continue;

      const alarmMin = o.odooSlaAlarmMin ?? SLA_ALARM_MIN_DEFAULT;
      const sendMin = o.odooSlaSendMin ?? SLA_SEND_MIN_DEFAULT;
      // الإرسال التلقائيّ: إذن المالك + الميزة ١ + مفتاح المكتب + التسليح + ربط أودو مفعّل
      const armed = sendAllowed && alarmOn && o.odooEnabled === "1" && o.odooSlaAuto === "1" && o.odooSlaArmedAt != null;
      const now = new Date();

      // ===== الميزة ١ (على القائد): إشعار المدير في الجرس مرّةً عند العتبة =====
      // تنبيهُ الفنيّ ليس هنا: هو واتسابٌ يجري على حاسبة مكتبه (runTechAlerts في طابور المكتب).
      if (alarmOn) await notifyManagers(o, cards, alarmMin, sendMin, now);

      type Due = { id: number; ticketId: number; phone: string | null; bg: string | null; manual: boolean; note: string };
      const due: Due[] = [];
      for (const c of cards) {
        const base = { id: c.id, ticketId: c.odooTicketId as number, phone: c.odooPhone, bg: c.odooBg };
        // ملاحظة التأجيل اليدويّ لا تُعالَج هنا: تدفعها pushAgentToOdoo (كلّ ٢٠ث على العامل،
        // ومن السحابة عند إغلاق المكاتب) — فلا يتفرّق منطقُ الدفع في موضعين.
        if (c.postponedTo) continue; // مؤجَّلة ⇒ لا تأجيل تلقائيّ عليها
        if (c.slaNoteAt) continue; // أُبلِغت أودو تلقائيّاً ⇒ خرجت من المهلة
        if (!armed) continue;
        const fetched = c.odooFetchedAt ?? c.createdAt;
        if (o.odooSlaArmedAt && fetched.getTime() < o.odooSlaArmedAt.getTime()) continue; // ما سُحب قبل التسليح
        if (now.getTime() - fetched.getTime() < SLA_GRACE_MS) continue; // مهلة الرؤية
        const st = slaStateOf({ ...c, viaOdoo: true }, now, alarmMin, sendMin);
        if (st.ageMin < sendMin) continue;
        const note = fillSlaText((o.odooSlaNote ?? "").trim() || SLA_NOTE_DEFAULT, {
          office: o.name, ticket: base.ticketId, phone: base.phone, bg: base.bg,
        });
        due.push({ ...base, manual: false, note: note || SLA_NOTE_DEFAULT });
      }
      if (!due.length) continue;

      let s: OdooSession;
      try { s = await officeSession(o); }
      catch (e) {
        sessionCache.delete(o.panelId ?? o.id); // متوسّط(٢٠): المفتاحُ نفسُه الذي خُزنت به — كان o.id فتبقى جلسةُ اللوحة الميّتة محبوسةً حتى انقضاء عمرها
        await saveOdooState(o, { odooLastOk: null, odooLastError: String((e as Error).message ?? "خطأ").slice(0, 200) }).catch(() => {});
        continue; // الإنذار يبقى مشتعلاً — لم يُبلَّغ أودو
      }

      let autoSent = 0;
      for (const d of due) {
        if (!d.manual && autoSent >= SLA_SEND_CAP) break; // السقف للتلقائيّ فقط
        // ختمٌ على مستوى **التذكرة** لا البطاقة: بطاقةٌ حُذفت فأُعيد إنشاؤها (السحب يعيدها بطلب
        // محمد) لا تُبلَّغ **تلقائيّاً** مرّتين — نفحص كلّ بطاقات هذه التذكرة ولو كانت محذوفة.
        // ويُقصَر الشرط على التلقائيّ: ملاحظة الفنيّ اليدويّة تُدفَع دائماً (فعلٌ قابل للتكرار في أودو).
        if (!d.manual) {
          const already = await prisma.taskCard.count({ where: { odooTicketId: d.ticketId, slaNoteAt: { not: null } } });
          if (already > 0) {
            await prisma.taskCard.update({ where: { id: d.id }, data: { slaNoteAt: new Date() } }).catch(() => {});
            continue;
          }
        }
        // حجزٌ ذرّيّ **قبل** أيّ نداء شبكة: يمنع إرسالاً مزدوجاً لحظة انتقال القيادة بين حاسبتين
        const claim = await prisma.taskCard.updateMany({
          where: {
            id: d.id, ...(d.manual ? {} : { slaNoteAt: null }),
            OR: [{ slaClaimedAt: null }, { slaClaimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } }],
          },
          data: { slaClaimedAt: new Date() },
        });
        if (claim.count !== 1) continue; // حاسبةٌ أخرى تُعالجها الآن
        try {
          const tk = await odooReadTicket(s, d.ticketId);
          await odooChatterPost(s, d.ticketId, d.note, tk?.accessToken ?? null);
          // التأجيل التلقائيّ يُبلّغ المشترك؛ واليدويّ لا (المكتب كلّمه فعلاً قبل أن يؤجّل)
          const queueWa = !d.manual && !!d.phone;
          await prisma.taskCard.update({
            where: { id: d.id },
            data: d.manual
              ? { postponePushedAt: new Date(), slaClaimedAt: null } // اليدويّ لا يُختَم بـslaNoteAt
              : { slaNoteAt: new Date(), ...(queueWa ? { slaWaQueuedAt: new Date() } : {}) },
          });
          await appendCardHistory(d.id, "أودو", d.manual
            ? `دُفِعت ملاحظة التأجيل إلى أودو — ${d.note}`
            : `⏳ تأجيلٌ تلقائيّ (تجاوز ${sendMin}د): دُفِعت الملاحظة إلى أودو${queueWa ? " وأُدرجت رسالة المشترك في الطابور" : d.phone ? "" : " — لا هاتف في التذكرة"}`);
          if (!d.manual) autoSent++;
        } catch (e) {
          // فشل أودو ⇒ يُفكّ الحجز فتُعاد المحاولة، ولا واتساب إطلاقاً، والإنذار يبقى مشتعلاً
          await prisma.taskCard.update({ where: { id: d.id }, data: { slaClaimedAt: null } }).catch(() => {});
          await appendCardHistory(d.id, "أودو", `تعذّر إبلاغ أودو بالتأجيل: ${String((e as Error).message ?? "").slice(0, 120)}`).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("[odoo-sla] sweep:", e instanceof Error ? e.message : e);
  } finally { slaBusy = false; }
}

// «رقمنا» للتذكرة: بمطابقة يوزرها (bg-x-x-x@x) مع مشتركي المكتب — بلا تخمينٍ نصّيّ آخر
async function ourPhoneFor(bg: string | null, towerId: number): Promise<string | null> {
  const u = (bg ?? "").trim();
  if (!u) return null;
  const sub = await prisma.subscriber.findFirst({
    where: { towerId, isDeleted: false, netUser: { equals: u, mode: "insensitive" } },
    select: { phone: true },
  });
  return sub?.phone?.trim() || null;
}

// ===== طابور رسائل المشتركين (كلّ ٣٠ث، على **حاسبة المكتب نفسها** لا القائد) =====
// جلسة الواتساب مربوطةٌ بحاسبة مكتبها، فما دامت مطفأةً تبقى الرسالة مؤرشفةً على البطاقة
// وتُرسَل لحظة فتحها. وتُلغى بعد يومٍ كامل (قرار محمد) بشارةٍ على البطاقة.
async function runWaQueue(): Promise<void> {
  if (waBusy) return; waBusy = true;
  try {
    const agentId = getWorkerAgentId();
    const towerId = getWorkerTowerId();
    if (agentId == null || towerId == null) return; // حاسبةٌ غير مربوطةٍ بمكتب لا تُرسل
    // عزل: المكتب يتبع وكيل هذه الحاسبة
    const office = await prisma.tower.findFirst({
      where: { id: towerId, agentId, isDeleted: false },
      select: {
        id: true, name: true, agentId: true, odooSlaWaText: true, odooEnabled: true, odooSlaAuto: true,
        odooSlaAlarm: true, odooSlaTechText: true, odooSlaAlarmMin: true, odooSlaSendMin: true,
      },
    });
    if (!office) return;
    const listIds = await listIdsOf(towerId);
    if (!listIds.length) return;
    // مجموعةُ اللوحة: على لوحةٍ مشتركةٍ نقصر بطاقاتِ هذه الحاسبة على مكتبها (officeId) — فلا يمسّ
    // عاملُ مكتبٍ بطاقاتِ المكتب الآخر (تفريغُ الطابور/التنبيه/الإرسال). مستقلٌّ = بلا فلتر (سلوكُ اليوم).
    const officeScope = await odooOfficeScope(towerId);
    // تنبيه الفنيّ (الميزة ١) — من هذه الحاسبة لأنّها صاحبة جلسة واتساب مكتبها
    await runTechAlerts(office, listIds, new Date(), officeScope);
    // ===== بوّابة الطابور (اصطادها تدقيقٌ عدائيّ) =====
    // كان الطابور يُرسل ما فيه بلا فحص أيّ مفتاح: فإطفاء الإرسال أو سحب إذن المالك أو إطفاء ربط
    // أودو لا يمنع رسالةً مُدرَجةً من الخروج بعده. الآن: أيّ إطفاء ⇒ **يُفرَّغ الطابور** بسببٍ ظاهر.
    const gateOn = office.odooEnabled === "1" && office.odooSlaAlarm === "1" && office.odooSlaAuto === "1"
      && (await sendAllowedFor(agentId));
    if (!gateOn) {
      const stale = await prisma.taskCard.updateMany({
        where: { listId: { in: listIds }, ...officeScope, viaOdoo: true, slaWaQueuedAt: { not: null }, slaWaSentAt: null },
        data: { slaWaQueuedAt: null, slaWaError: "أُلغيت — أُطفئ إرسال رسائل أودو" },
      });
      if (stale.count) console.log(`[odoo-sla] أُفرِغ الطابور (${stale.count}) — المفتاح مطفأ`);
      return;
    }
    const rows = await prisma.taskCard.findMany({
      // done/settled/archivedAt: بطاقةٌ أُنجزت أو أُلغيت بعد الإدراج **لا** يُبلَّغ مشتركها بتأجيل
      where: {
        listId: { in: listIds }, ...officeScope, viaOdoo: true, slaWaQueuedAt: { not: null }, slaWaSentAt: null,
        isDeleted: false, done: false, settled: false, archivedAt: null,
      },
      select: { id: true, odooTicketId: true, odooPhone: true, odooBg: true, slaWaQueuedAt: true },
      take: 20,
    });
    for (const c of rows) {
      const queuedAt = c.slaWaQueuedAt as Date;
      if (Date.now() - queuedAt.getTime() > SLA_WA_TTL_MS) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: "أُلغيت — مضى يومٌ قبل فتح حاسبة المكتب" } });
        await appendCardHistory(c.id, "أودو", "أُلغيت رسالة المشترك — مضى يومٌ على تأجيلها").catch(() => {});
        continue;
      }
      if (!c.odooPhone) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: "لا هاتف في التذكرة" } });
        continue;
      }
      if (!inSlaWindow()) return; // خارج نافذة ١٠:٠٠←٢٤:٠٠ لا إرسال (لا رسالةَ الثالثة فجراً)
      // ===== تسلسل الهاتف (قرار محمد): رقم التذكرة ← فإن كان بلا واتساب فرقمنا ← فإن عُدِما يُلغى =====
      const ours = await ourPhoneFor(c.odooBg, towerId);
      const targets: string[] = [];
      for (const p of [c.odooPhone, ours]) {
        const v = (p ?? "").trim();
        if (v && !targets.includes(v)) targets.push(v);
      }
      const { sendWhatsApp, hasWhatsApp } = await import("@/lib/whatsapp");
      let chosen: string | null = null;
      for (const p of targets) {
        const has = await hasWhatsApp(towerId, p); // null = تعذّر الفحص ⇒ نجرّب على أيّ حال
        if (has !== false) { chosen = p; break; }
      }
      if (!chosen) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: "أُلغيت — لا واتساب لرقم التذكرة ولا لرقمنا" } });
        await appendCardHistory(c.id, "أودو", "أُلغيت رسالة المشترك — لا واتساب لرقم التذكرة ولا للرقم المسجّل عندنا").catch(() => {});
        continue;
      }
      // حجزٌ ذرّيّ قبل الإرسال — الواتساب فعلٌ لا رجعة فيه. ويُعاد فحص الإنجاز/الإلغاء **داخل**
      // الحجز: البطاقة قد تُنجَز في نفس اللحظة التي نفحص فيها (سباق) فتخرج رسالة تأجيلٍ بعد الزيارة.
      const claim = await prisma.taskCard.updateMany({
        where: { id: c.id, slaWaSentAt: null, done: false, settled: false, isDeleted: false, archivedAt: null },
        data: { slaWaSentAt: new Date() },
      });
      if (claim.count !== 1) continue;
      const text = fillSlaText((office.odooSlaWaText ?? "").trim() || SLA_WA_DEFAULT, {
        office: office.name, ticket: c.odooTicketId, phone: chosen, bg: c.odooBg,
      });
      const res = await sendWhatsApp(towerId, chosen, text);
      if (res.ok) {
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaQueuedAt: null, slaWaError: null } });
        // سجلّ الرسائل: agentId صريحٌ للعزل (هاتف التذكرة قد لا يكون مشتركاً عندنا)
        await prisma.message.create({
          data: { channel: "WHATSAPP", phone: chosen, text, status: "SENT", createdByUser: "أودو-مهلة", agentId },
        }).catch(() => {});
        await appendCardHistory(c.id, "أودو", `أُرسلت رسالة التأجيل إلى المشترك (${chosen}${chosen === c.odooPhone ? "" : " — رقمنا"})`).catch(() => {});
      } else {
        // تبقى في الطابور لتُعاد المحاولة (حتى انتهاء اليوم) — والسبب ظاهرٌ على البطاقة
        await prisma.taskCard.update({ where: { id: c.id }, data: { slaWaSentAt: null, slaWaError: String(res.error ?? "تعذّر الإرسال").slice(0, 160) } });
      }
    }
  } catch (e) {
    console.error("[odoo-sla] wa-queue:", e instanceof Error ? e.message : e);
  } finally { waBusy = false; }
}

export function startOdooSync(): void {
  const g = globalThis as unknown as { __odooSyncStarted?: boolean };
  if (g.__odooSyncStarted) return;
  g.__odooSyncStarted = true;
  setTimeout(() => { void runPull(); }, 60_000); // أوّل سحب بعد استقرار الإقلاع (يلتقط ما فات أثناء الإطفاء)
  setInterval(() => { void runPull(); }, PULL_MS);
  setInterval(() => { void runPush(); }, PUSH_MS);
  setInterval(() => { void runSlaSweep(); }, SLA_MS);
  setInterval(() => { void runWaQueue(); }, WA_MS);
  console.log("[odoo-sync] بدأت مزامنة تذاكر أودو (سحب 10د · دفع 20ث · مهلة 1د · طابور المشتركين 30ث) — محليّ على العامل");
}
