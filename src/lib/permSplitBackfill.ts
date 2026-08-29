import { prisma } from "./prisma";
import { bakeSplitPairs } from "./rbac";

// ═════ ردمُ «فكِّ الربط» بين الصلاحيّات (طلبُ محمد 2026-08-29) ═════
//
// كانت أربعُ صلاحيّاتٍ «أب» تَستلزمُ «ابناً» ضمناً في `rbac.can` و`expandLegacyPermissions`،
// فيستحيلُ منحُ الأب دون الابن. بلاغُ محمد: لا يستطيع نزعَ «رؤية رواتب الفنيين» (field.payroll)
// عن مستخدمٍ يملك «إدارة الفنيين» (field.manage) — تعودُ عند كلّ فتحٍ وتبقى ممنوحةً وقتَ التشغيل.
// القرار: **فصلٌ تامٌّ للأزواج الأربعة**. وقبل إزالة الاستلزام من `rbac.ts` نُثبّت الابنَ
// **صراحةً** (منحاً ومنعاً) لكلّ من يملك الأبَ الآن — فلا يتغيّر الأثرُ الفعليُّ للحظة، ولا
// يفقدُ ولا يكسبُ أيُّ مستخدمٍ (لأيّ وكيل) صلاحيّةً كان عليها. (جدولُ SPLIT_PAIRS ودالّةُ
// bakeSplitPairs النقيّةُ في rbac.ts — بلا قاعدةٍ فتُختبَران وحدهما.)
//
// ⏱️ يُنفَّذ **مرّةً واحدةً عالميّاً** (علَمُ systemSetting) من داخل `getSession` **قبل** قراءة
//    الصلاحيّات — و`getSession` يقرأ القاعدةَ حيّةً كلَّ طلب — فالترتيبُ مضمونٌ بلا فجوة:
//    أوّلُ طلبٍ بعد النشر يُثبّت الصلاحيّات ثمّ يقرؤها، فلا لحظةَ يُزال فيها الاستلزامُ قبل الردم.
//    والعمليّاتُ ذرّيّةٌ متسامحة (تُضيف الابنَ إن غاب فقط) فإعادةُ التنفيذ لا تضرّ.

const FLAG = "permSplitBackfill:v1";

let done = false;
let inflight: Promise<void> | null = null;

async function run(): Promise<void> {
  const flag = await prisma.systemSetting.findFirst({ where: { type: FLAG }, select: { id: true } });
  if (flag) { done = true; return; }

  const users = await prisma.user.findMany({ select: { id: true, permissions: true, deniedPermissions: true } });
  for (const u of users) {
    const baked = bakeSplitPairs(
      (u.permissions ?? "").split(",").filter(Boolean),
      (u.deniedPermissions ?? "").split(",").filter(Boolean),
    );
    if (baked) {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          permissions: baked.permissions.join(","),
          deniedPermissions: baked.denied.join(",") || null,
        },
      });
    }
  }

  await prisma.systemSetting.create({
    data: {
      type: FLAG,
      text: "ثُبّتت الصلاحيّاتُ المُستلزَمةُ صراحةً قبل فكِّ ربط الأزواج الأربعة",
      value: new Date().toISOString().slice(0, 10),
    },
  });
  done = true;
}

// يُستدعى من getSession قبل قراءة صلاحيّات المستخدم. يُنفَّذ مرّةً، ويجمع الطلباتِ المتزامنة
// في تنفيذٍ واحد. لا يكسرُ المصادقةَ إن فشل — يُعاد في الطلب التالي.
export function ensurePermSplitBackfillOnce(): Promise<void> {
  if (done) return Promise.resolve();
  if (!inflight) {
    inflight = run()
      .catch((e) => { console.error("[permSplitBackfill] فشل الردم — يُعاد في الطلب التالي:", e); })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
