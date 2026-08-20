import { prisma } from "./prisma";
import { getEffectiveTemplateFull } from "./smsTemplates";
import { renderTemplate, sendViaProvider } from "./messaging";
import { formatDate } from "./format";

// ═════ 📋 رسائل سجلّ المزامنة — تبويبا «تفعيل خارجي» و«تنصيب خارجي» (طلب محمد 2026-08-20) ═════
//
// بنصّه: قالبٌ لكلّ تبويب («تفعيلات خارجية» = selfActivated · «تنصيبات خارجية» =
// externalInstall)، وفي أعلى كلّ تبويبٍ جيك بوكس «إرسال رسائل تلقائي»: صحٌّ ⇒ تصل
// الرسالةُ تلقائيّاً لحظةَ الرصد، وبلا صحٍّ ⇒ يدويّاً بتحديد واحدٍ أو مجموعةٍ وضغط إرسال.
// **والافتراضيُّ للاثنين: غيرُ مفعَّل** (نصُّه الحرفيّ 2026-08-20).
//
// 🔑 أين يُخزَّن الجيك بوكس؟ صفُّ إعدادٍ **في جدول القوالب نفسِه** بنوعٍ يبدأ بـ«__»
//   (سابقة SEED_MARK): كلُّ قوائم القوالب تستثني هذه السابقةَ أصلاً فلا يظهر لأحد،
//   والحاسباتُ تملك قراءةَ sms_templates سلفاً (منحٌ وسياسةُ RLS قائمان) — فالمزامنةُ
//   على الحاسبة ترى العلَم بلا عمودٍ جديدٍ ولا SQL يُلصَق.
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
  subscriberId?: number | null;
  /** هاتفُ الساس إن وُجد — وإلّا يُقرأ هاتفُ المشترك المحفوظ */
  phone?: string | null;
  netUser?: string | null;
  name?: string | null;
  packageName?: string | null;
  sasDateTo?: Date | null;
};

/**
 * يُرسل رسالةَ قالبِ التبويب لمشتركٍ واحد. يُنادى من المزامنة (تلقائيّاً حين الصحّ) ومن
 * زرّ الإرسال اليدويّ في النافذة. لا يرمي استثناءً — الرسالةُ مكسبٌ لا واجب.
 *
 * فشلُ الإرسال (واتساب المكتب مطفأ): إن كان للصفّ مشتركٌ محفوظٌ يدخل طابورَ «فعّل
 * بنفسه» القائم (PENDING بوسم createdByUser="sync" — تصرّفه الحاسبةُ حين يعود واتسابُها
 * ويُمسَح بعد ٢٤ ساعة). والجديدُ غيرُ المحفوظ بلا طابورٍ (لا مكتبَ يُنسَب إليه صفُّه) ⇒ "failed".
 */
export async function sendSyncLogMessage(
  kind: "self" | "install",
  p: SyncMsgPayload,
): Promise<"sent" | "queued" | "failed" | "skipped"> {
  try {
    const office = await prisma.tower.findUnique({
      where: { id: p.towerId },
      select: { id: true, name: true, agentId: true, waEnabled: true },
    });
    if (!office || office.waEnabled === "0") return "skipped";
    const tpl = await getEffectiveTemplateFull(kind === "install" ? "externalInstall" : "selfActivated", office.agentId, office.id);
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

    const text = renderTemplate(tpl.text, {
      name: p.name, netUser: p.netUser, phone,
      package: pkgName, dateTo: p.sasDateTo ? formatDate(p.sasDateTo) : "",
      carry, remaining: carry,
      office: office.name ?? "",
    });

    const res = await sendViaProvider("WHATSAPP", phone, text, p.towerId, tpl.image);
    if (res.ok) {
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: p.subscriberId ?? null, phone, text,
          status: "SENT", agentId: office.agentId, createdByUser: "sync",
        },
      }).catch(() => {});
      return "sent";
    }
    if (p.subscriberId != null) {
      await prisma.message.create({
        data: {
          channel: "WHATSAPP", subscriberId: p.subscriberId, phone, text,
          status: "PENDING", error: res.error ?? "واتساب المكتب غير متصل — بالطابور",
          agentId: office.agentId, createdByUser: "sync",
        },
      }).catch(() => {});
      return "queued";
    }
    return "failed";
  } catch { return "failed"; }
}
