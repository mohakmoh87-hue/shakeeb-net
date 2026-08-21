import { prisma } from "./prisma";
import { getEffectiveTemplateFull } from "./smsTemplates";
import { renderTemplate, sendViaProvider } from "./messaging";
import { baghdadDayKey } from "./messageDedup";

// ═════ 📋 رسائل سجلّ المزامنة — تبويبا «تفعيل خارجي» و«تنصيب خارجي» (طلب محمد 2026-08-20) ═════
//
// بنصّه: قالبٌ لكلّ تبويب («تفعيلات خارجية» = selfActivated · «تنصيبات خارجية» =
// externalInstall)، وجيك بوكس «إرسال رسائل تلقائي» لكلّ تبويب (**الافتراضيُّ إيقاف**)،
// وبلا صحٍّ إرسالٌ يدويٌّ بالتحديد.
//
// ═════ 🔒 «طابورٌ خاصٌّ لا يُمسَح أبداً + حارسٌ يمنع التكرار بأيّ شكل» (نصُّه 2026-08-21) ═════
// المزامنةُ الليليّةُ تعمل من الموقع **والحاسباتُ مطفأة** — فالرسالةُ التي تتعذّر:
//   · تدخل صفَّ `messages` بعلامة SYNC_MSG_MARK في `error` (فتُرى في سجلّ الرسائل).
//   · **لا تُمسَح أبداً** (لا TTL — بخلاف طابور ٤-ب القديم ذي الـ٢٤ ساعة): تنتظر حتى
//     تشتغل حاسبةُ مكتبها فيصرّفها `drainSyncMsgQueue` (يُنادى عند جهوزيّة الواتساب
//     وفي دورة المجدول).
//   · حارسُ التكرار **فيزيائيٌّ لا برمجيّ**: `dedupKey` فريدٌ في القاعدة (فهرس 2026-08-19
//     الجزئيّ) بمفتاح `synclog:{نوع}:t{مكتب}:s{sasId}:{يوم بغداد للحدث}` — فمهما تسابقت
//     مزامنةُ الموقع مع مزامنة الحاسبة، أو أُعيدت قراءةُ تفعيلات الأمس كلَّ دورة، أو ضُغط
//     زرُّ الإرسال اليدويّ مرّتَين: **الإدراجُ الثاني يصطدم بالفهرس ولا توجد رسالةٌ ثانية**.
//   · و«الحَجزُ قبل الأثر» (درسُ تكرار الشدن): الصفُّ يُدرَج **قبل** أيّ إرسال، والإرسالُ
//     لا يجري إلّا لمن حجز الصفَّ ذرّيّاً — فلا نافذةَ بين الإرسال والتسجيل يدخل منها تكرار.
const SYNC_MSG_MARK = "📨 في طابور رسائل سجلّ المزامنة";
const CLAIM_MARK = "⏳ قيد الإرسال (سجلّ المزامنة)";
const GAP_MS = 10_000;   // فاصلُ مكافحة الحظر — نفسُ فاصل ساحب البثّ
const BATCH = 30;        // سقفُ الدورة الواحدة والباقي في التالية
const STALE_CLAIM_MS = 10 * 60_000; // حَجزٌ مات صاحبُه (انهيارٌ وسط الإرسال) يُحرَّر بعدها

// 🔑 أين يُخزَّن الجيك بوكس؟ صفُّ إعدادٍ **في جدول القوالب نفسِه** بنوعٍ يبدأ بـ«__»
//   (سابقة SEED_MARK): كلُّ قوائم القوالب تستثني هذه السابقةَ أصلاً فلا يظهر لأحد،
//   والحاسباتُ تملك قراءةَ sms_templates سلفاً (منحٌ وسياسةُ RLS قائمان).
const FLAGS_TYPE = "__syncAutoMsg";

export type SyncAutoMsgFlags = { self: boolean; install: boolean };

/** جيك بوكسا «إرسال رسائل تلقائي» للوكيل — الافتراضيُّ إيقافُ الاثنين (قرار محمد) */
export async function getSyncAutoMsgFlags(agentId: number | null): Promise<SyncAutoMsgFlags> {
  const off: SyncAutoMsgFlags = { self: false, install: false };
  if (agentId == null) return off;
  try {
    const row = await prisma.smsTemplate.findFirst({
      where: { agentId, towerId: null, type: FLAGS_TYPE }, select: { text: true },
    });
    if (!row?.text) return off;
    const v = JSON.parse(row.text) as Partial<SyncAutoMsgFlags>;
    return { self: v.self === true, install: v.install === true };
  } catch { return off; }
}

export async function setSyncAutoMsgFlag(agentId: number, kind: "self" | "install", on: boolean): Promise<SyncAutoMsgFlags> {
  const cur = await getSyncAutoMsgFlags(agentId);
  const next = { ...cur, [kind]: on };
  const row = await prisma.smsTemplate.findFirst({ where: { agentId, towerId: null, type: FLAGS_TYPE }, select: { id: true } });
  if (row) await prisma.smsTemplate.update({ where: { id: row.id }, data: { text: JSON.stringify(next) } });
  else await prisma.smsTemplate.create({ data: { agentId, towerId: null, type: FLAGS_TYPE, text: JSON.stringify(next) } });
  return next;
}

export type SyncMsgPayload = {
  towerId: number;
  /** هويّةُ الحدث في الساس — عمودُ مفتاح منع التكرار */
  sasId: number | null;
  /** وقتُ التفعيلة (لأحداث التفعيل) — يومُها البغداديُّ جزءٌ من مفتاح التكرار */
  activatedAt?: Date | null;
  subscriberId?: number | null;
  /** هاتفُ الساس إن وُجد — وإلّا يُقرأ هاتفُ المشترك المحفوظ */
  phone?: string | null;
  netUser?: string | null;
  name?: string | null;
  packageName?: string | null;
  sasDateTo?: Date | null;
};

const isUniqueClash = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2002";

/** مفتاحُ منع التكرار الفيزيائيّ — لكلّ (نوع·مكتب·حساب ساس·يوم الحدث) رسالةٌ واحدةٌ لا غير */
function syncMsgDedupKey(kind: "self" | "install", towerId: number, sasId: number | null, eventAt: Date | null | undefined): string {
  return `synclog:${kind}:t${towerId}:s${sasId ?? 0}:${baghdadDayKey(eventAt ?? new Date())}`;
}

/** محاولةُ تسليم صفٍّ محجوزٍ ذرّيّاً: نجاحٌ ⇒ SENT، وتعذُّرٌ ⇒ يعود للطابور (لا يُمسَح ولا يُختَم فاشلاً) */
async function deliverClaimed(id: number, towerId: number, phone: string, text: string, image?: string | null): Promise<boolean> {
  const res = await sendViaProvider("WHATSAPP", phone, text, towerId, image);
  if (res.ok) {
    await prisma.message.update({ where: { id }, data: { status: "SENT", error: null } }).catch(() => {});
    return true;
  }
  // واتساب المكتب مطفأ (المزامنةُ الليليّة والحاسباتُ طافية) ⇒ يبقى في الطابور للتصريف
  await prisma.message.update({ where: { id }, data: { status: "PENDING", error: SYNC_MSG_MARK } }).catch(() => {});
  return false;
}

/**
 * يُرسل رسالةَ قالبِ التبويب لمشتركٍ واحد — من المزامنة (تلقائيّاً حين الصحّ) ومن زرّ
 * الإرسال اليدويّ. **الإدراجُ في الطابور أوّلاً** (بحارس التكرار الفيزيائيّ) ثمّ محاولةُ
 * التسليم الفوريّ؛ فالتعذُّرُ لا يُضيع شيئاً والتكرارُ مستحيلٌ بأيّ شكل.
 */
export async function sendSyncLogMessage(
  kind: "self" | "install",
  p: SyncMsgPayload,
): Promise<"sent" | "queued" | "duplicate" | "failed" | "skipped"> {
  try {
    const office = await prisma.tower.findUnique({
      where: { id: p.towerId },
      select: { id: true, name: true, agentId: true, waEnabled: true },
    });
    if (!office || office.waEnabled === "0") return "skipped";
    const tplType = kind === "install" ? "externalInstall" : "selfActivated";
    const tpl = await getEffectiveTemplateFull(tplType, office.agentId, office.id);
    if (!tpl) return "skipped"; // القالبُ معطَّل

    // الهاتف والباقة: من الساس أوّلاً، ومن صفّ المشترك المحفوظ عند غيابهما
    let phone = (p.phone ?? "").trim();
    let pkgName = (p.packageName ?? "").trim();
    let carry = 0;
    if (p.subscriberId != null) {
      const sub = await prisma.subscriber.findUnique({
        where: { id: p.subscriberId },
        select: { phone: true, packageId: true, carry: true, waEnabled: true, isDeleted: true },
      });
      if (!sub || sub.isDeleted) return "skipped";
      if (sub.waEnabled === false) return "skipped"; // أطفأ رسائلَه — يُحترم كبقيّة القوالب
      if (!phone) phone = (sub.phone ?? "").trim();
      carry = sub.carry ?? 0;
      if (!pkgName && sub.packageId != null) {
        const pkg = await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true } });
        pkgName = pkg?.name ?? "";
      }
    }
    if (!phone) return "failed"; // لا رقمَ إطلاقاً — تُبلَّغ الواجهةُ برفضٍ مقروء

    // ⚠️ قالبا سجلّ المزامنة **بلا تاريخ انتهاءٍ أبداً** (قرار محمد 2026-08-21): تاريخُ
    // لحظةِ الرصد خاطئٌ حتماً للتنصيبات (عرضُ ١٠ أيّامٍ قبل إضافة الأيّام الحقيقيّة) —
    // فأيُّ سطرٍ فيه متغيّرُ التاريخ يُمحى من النصّ حتى لو كتبه أحدٌ يدويّاً في القالب.
    const tplText = tpl.text.split(/\r?\n/).filter((l) => !/\{(تاريخ_الانتهاء|dateTo)\}/.test(l)).join("\n");
    const text = renderTemplate(tplText, {
      name: p.name, netUser: p.netUser, phone,
      package: pkgName, dateTo: "",
      carry, remaining: carry,
      office: office.name ?? "",
    });

    // ═══ الحَجزُ قبل الأثر: الإدراجُ أوّلاً، والفهرسُ الفريدُ يصدّ أيَّ تكرار ═══
    let rowId: number;
    try {
      const row = await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: p.subscriberId ?? null, phone, text,
          status: "PENDING", error: SYNC_MSG_MARK,
          agentId: office.agentId, createdByUser: "syncmsg", templateType: tplType,
          dedupKey: syncMsgDedupKey(kind, p.towerId, p.sasId, p.activatedAt),
        },
        select: { id: true },
      });
      rowId = row.id;
    } catch (e) {
      if (isUniqueClash(e)) return "duplicate"; // أُرسلت (أو في الطابور) سلفاً — مستحيلٌ تكرارُها
      throw e;
    }

    // محاولةُ التسليم الفوريّ — بعد حَجز الصفّ (نحن مُدرجُه فمُلّاكُه حتى أوّلِ تصريف)
    const claim = await prisma.message.updateMany({
      where: { id: rowId, status: "PENDING", error: SYNC_MSG_MARK },
      data: { error: CLAIM_MARK },
    });
    if (claim.count !== 1) return "queued"; // ساحبٌ سبقنا إليه — سيتكفّل به
    return (await deliverClaimed(rowId, p.towerId, phone, text, tpl.image)) ? "sent" : "queued";
  } catch { return "failed"; }
}

// ═════ تصريفُ الطابور — «يُرسَل فورَ اشتغال الحاسبة» (يُنادى عند جهوزيّة واتساب المكتب ودوريّاً) ═════
/** عمرُ الطابور الأقصى: ٢٤ ساعةً ثمّ يسقط (قرارُ محمد 2026-08-21) */
const QUEUE_MAX_AGE_MS = 24 * 3600_000;
const draining = new Set<number>(); // حارسُ عدم تراكب الدورات لكلّ مكتب

export async function drainSyncMsgQueue(towerId: number): Promise<{ sent: number; waiting: number }> {
  const out = { sent: 0, waiting: 0 };
  if (draining.has(towerId)) return out;
  draining.add(towerId);
  try {
    // ═════ 🧹 عمرُ الطابور ٢٤ ساعة (قرارُ محمد 2026-08-21 مساءً) ═════
    // كان «لا يُمسَح أبداً» بطلبه السابق، ثمّ صحّحه: «كلُّ طابورٍ لا يُمسَح اجعله يُمسَح
    // كلَّ ٢٤ ساعة». والعلّةُ عمليّةٌ: رسالةُ تفعيلٍ أو تنصيبٍ تصل المشتركَ بعد يومَين
    // لا معنى لها — بل تُربكه. فما تجاوز يوماً في الطابور يسقط ولا يُرسَل.
    // 🔒 والحذفُ مقصورٌ على **صفوف هذا الطابور** حصراً (وسمُه + مفتاحُ تكراره)،
    //    فلا يمسّ سجلَّ الرسائل ولا طابورَ البثّ ولا رسائلَ «فعّل بنفسه».
    await prisma.message.deleteMany({
      where: {
        status: "PENDING", channel: "WHATSAPP",
        error: { in: [SYNC_MSG_MARK, CLAIM_MARK] },
        dedupKey: { startsWith: "synclog:" },
        date: { lt: new Date(Date.now() - QUEUE_MAX_AGE_MS) },
      },
    }).catch(() => {});

    // حَجزٌ مات صاحبُه (انهيارٌ/إطفاءٌ وسط الإرسال) يُعاد للطابور — فلا صفَّ يخلد محجوزاً
    await prisma.message.updateMany({
      where: {
        status: "PENDING", error: CLAIM_MARK,
        dedupKey: { startsWith: "synclog:" },
        updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) },
      },
      data: { error: SYNC_MSG_MARK },
    }).catch(() => {});

    // 🔒 صفوفُ **هذا المكتب** حصراً — المكتبُ جزءٌ من المفتاح فلا حاجةَ لجدول المشتركين
    //   (ولا يصحّ: رسائلُ الجدد غير المحفوظين بلا subscriberId أصلاً)
    const mine = await prisma.message.findMany({
      where: {
        status: "PENDING", channel: "WHATSAPP", error: SYNC_MSG_MARK,
        OR: [
          { dedupKey: { startsWith: `synclog:self:t${towerId}:` } },
          { dedupKey: { startsWith: `synclog:install:t${towerId}:` } },
        ],
      },
      select: { id: true, phone: true, text: true, templateType: true },
      orderBy: { id: "asc" },
      take: BATCH, // والباقي في الدورة التالية (المجدولُ يعود كلَّ دقيقة)
    });
    if (!mine.length) return out;

    // صورةُ القالب الفعّالةُ لحظةَ الإرسال (سُلَّم مكتب←وكيل) — تُقرأ مرّةً لكلّ نوعٍ لا لكلّ صفّ
    const office = await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true } });
    const imageOf = new Map<string, string | null>();
    for (const t of new Set(mine.map((m) => m.templateType ?? ""))) {
      if (!t) { imageOf.set(t, null); continue; }
      const tpl = await getEffectiveTemplateFull(t, office?.agentId ?? null, towerId).catch(() => null);
      imageOf.set(t, tpl?.image ?? null);
    }

    let first = true;
    for (const m of mine) {
      if (!m.phone) { out.waiting++; continue; } // بلا هاتفٍ لا يُرسَل ولا يُمسَح — قد يُصحَّح لاحقاً
      // ⏱️ الفاصلُ قبل كلّ رسالةٍ عدا الأولى — فلا رشقةَ تُعرّض الرقم للحظر
      if (!first) await new Promise((r) => setTimeout(r, GAP_MS));
      first = false;
      // الحَجزُ الذرّيُّ قبل الإرسال — حاسبتان متراكبتان لا تُرسلان صفّاً مرّتَين
      const claim = await prisma.message.updateMany({
        where: { id: m.id, status: "PENDING", error: SYNC_MSG_MARK },
        data: { error: CLAIM_MARK },
      });
      if (claim.count !== 1) continue;
      if (await deliverClaimed(m.id, towerId, m.phone, m.text, imageOf.get(m.templateType ?? ""))) out.sent++;
      else out.waiting++;
    }
  } catch { /* الطابورُ لا يُخاطَر بمزامنةٍ أو مجدولٍ لأجله */ } finally {
    draining.delete(towerId); // يُحرَّر دائماً — وإلّا تجمّد تصريفُ المكتب إلى الأبد
  }
  return out;
}
