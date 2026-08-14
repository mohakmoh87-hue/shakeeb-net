import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmOwnerPassword } from "@/lib/guard";

// ═════ و-٤ · بوّابةُ الحذفِ الجماعيِّ الكبير — تُجمَّد حتى كلمةِ مرور المالك ═════
//
// 🔴 **الحادثةُ التي تُبرّرها، مقيسةٌ لا مُتخيَّلة**: في ٩ آب ٢٠٢٦ حُذفت **٤٣٤ كارتاً**
//   بحكم «الكروت الوهميّة» في ضغطةٍ واحدة — وكان **٧٤ منها كروتاً حقيقيّةً مبيعةً وقُبض
//   ثمنُها** (٣٥٬٠٠٠ للواحد). ولم يُنبِّه ذلك أحداً: لا تأكيدٌ ولا سجلُّ سيريالات، ولم
//   يُكتشَف إلّا بعد أربعةِ أيّامٍ حين أرسل محمد قائمةَ سيريالاتٍ بيده.
//
// 🔑 وقاعدةُ محمد القائمة في البرنامج تُطبَّق هنا نفسُها: «عند تغيير أيّ حصّةٍ له ألّا يتمّ
//   الإجراءُ إلّا بإدخال باسورد المالك» (`confirmOwnerPassword` في مسارات المالك).
//   فما يُحرَس به مالُ **الحصص** يُحرَس به مالُ **المخزن**.
//
// ⚖️ والحدُّ ٥٠ صفّاً: حذفُ خمسينَ فأقلَّ عملٌ يوميٌّ (تنظيفُ وجبةٍ أو تصحيحُ إدخال)،
//   وما فوقها يعني وجبةً كاملةً — وهذا ما وقع. فالبوّابةُ لا تُعطّل العملَ اليوميّ.

/** الحدُّ الذي يصير الحذفُ بعده «دفعةً كبيرة» فيلزمها إذنُ المالك. */
export const BULK_DELETE_GATE = 50;

/**
 * يفحص إن كان الحذفُ يتجاوز الحدَّ، فيطلب كلمةَ مرور المالك.
 * @returns `NextResponse` بخطأٍ إن وجب المنعُ، أو `null` إن كان الطريقُ سالكاً.
 */
export async function requireOwnerForBulk(opts: {
  count: number;
  userId: number | undefined;
  ownerPassword: unknown;
  /** وصفٌ يُكتَب في سجلّ التدقيق (مصدرُ الحذف) */
  what: string;
}): Promise<NextResponse | null> {
  if (opts.count <= BULK_DELETE_GATE) return null;

  const pass = typeof opts.ownerPassword === "string" ? opts.ownerPassword : null;
  const ok = opts.userId != null && (await confirmOwnerPassword(opts.userId, pass));
  if (ok) {
    // ✅ ويُسجَّل أنّ الإذنَ أُعطي — فالبوّابةُ التي لا تُترك أثراً لا تُحاسِب أحداً
    await prisma.auditLog.create({
      data: {
        userId: opts.userId, action: "BULK_DELETE_OWNER_OK", entity: "rechargeCard",
        entityId: String(opts.count),
        details: `أُذن بحذفِ ${opts.count} كارتاً (${opts.what}) بكلمةِ مرور المالك`,
      },
    }).catch(() => {});
    return null;
  }

  // ⛔ والمنعُ يُسجَّل أيضاً: محاولةُ حذفِ وجبةٍ كاملةٍ حدثٌ يستحقّ أثراً ولو رُدَّت
  await prisma.auditLog.create({
    data: {
      userId: opts.userId, action: "BULK_DELETE_BLOCKED", entity: "rechargeCard",
      entityId: String(opts.count),
      details: `مُنع حذفُ ${opts.count} كارتاً (${opts.what}) — ${pass ? "كلمةُ مرور المالك خاطئة" : "بلا كلمةِ مرور المالك"}`,
    },
  }).catch(() => {});

  return NextResponse.json({
    error: `🛡️ حذفُ ${opts.count} كارتاً دفعةً واحدةً يحتاج **كلمةَ مرور المالك**.\n` +
           `وسببُ ذلك حادثةٌ حقيقيّة: في ٩ آب حُذفت ٤٣٤ كارتاً في ضغطةٍ واحدة، وكان ٧٤ منها ` +
           `مبيعاً ومقبوضَ الثمن. فإن كنتَ متأكّداً فأدخِل كلمةَ المرور وأعِد المحاولة.`,
    needOwnerPassword: true,
    count: opts.count,
  }, { status: 403 });
}
