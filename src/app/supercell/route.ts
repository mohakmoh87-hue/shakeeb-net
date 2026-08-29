import { promises as fs } from "node:fs";
import path from "node:path";

// ═════ 🏢 /supercell — صفحةُ عرضِ بوّابة سوبر سيل (طلب محمد 2026-08-28) ═════
//
// **عرضٌ تسويقيٌّ ببياناتٍ وهميّةٍ بالكامل، معزولٌ عن الموقع الحيّ عزلاً تامّاً**:
//   · ملفٌّ ثابتٌ واحد (`public/supercell.html`) يُقرأ ويُعاد كما هو — لا React ولا layout.
//   · صفرُ استيرادٍ من كود الموقع: لا قاعدةَ بيانات، لا جلسات، لا `src/lib` — فلا يمسّ
//     وكيلاً ولا مشتركاً ولا يُعيد تشغيلَ حاسبات المكاتب.
//   · الصفحةُ نفسُها بلا أيّ نداءِ شبكة (لا fetch ولا /api) — بياناتُها محقونةٌ فيها.
//   · `noindex`: صفحةُ عرضٍ لا تُفهرَس — تُفتح بالرابط المباشر فقط.
// 📌 والربطُ الحقيقيُّ بالنظام قرارٌ لاحقٌ لمحمد («سنقوم بربطها بالطريقة المناسبة») —
//    هذا المسارُ مؤقّتٌ بطبيعته ويُستبدل يومَ يُبنى الحقيقيّ.
// 🔒 وقراءةُ الملفّ من `public/` عمداً: Dockerfile ينسخ `public/` كاملةً إلى مخرجات
//    standalone، فلا نعتمد على اقتفاء الملفّات (outputFileTracing) لملفٍّ حرّ.

import { getPortalEnabled } from "@/lib/appConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  // 🔌 حجبٌ تامٌّ (404) عند إطفاء المالكِ البوّابةَ من /owner/supercell (طلبُ محمد 2026-08-29).
  // getPortalEnabled يقرأ علَماً عامّاً واحداً في system_settings — لا وكيلَ ولا جلسةَ مستخدم.
  if (!(await getPortalEnabled())) {
    return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } });
  }
  const html = await fs.readFile(path.join(process.cwd(), "public", "supercell.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
