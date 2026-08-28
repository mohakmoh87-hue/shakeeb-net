import { promises as fs } from "node:fs";
import path from "node:path";

// ═════ 📱 /app — معاينةُ ستايل تطبيق المشترك «كابينة» (طلب محمد 2026-08-28) ═════
//
// نفسُ وصفة `/supercell` حرفيّاً: **عرضٌ ببياناتٍ وهميّةٍ معزولٌ عن الموقع الحيّ عزلاً تامّاً** —
// ملفٌّ ثابتٌ واحد (`public/subscriber-app.html`، مُحوَّلٌ من ستايل v0 الذي سلّمه محمد) يُقرأ
// ويُعاد كما هو: لا React ولا قاعدةَ ولا جلسات ولا `src/lib`، والصفحةُ بلا أيّ نداءِ شبكة.
// 📌 التطبيقُ الحقيقيُّ خطّتُه محفوظة (docs/subscriber-app-design.md — أربعُ مراحلَ تبدأ
//    بتحصين م-٠) ولا يُبنى إلّا بكلمة محمد؛ هذه معاينةُ إحساسٍ على الهاتف لا غير.
// 🔒 والقراءةُ من `public/` عمداً: Dockerfile ينسخها كاملةً إلى مخرجات standalone.

export const dynamic = "force-dynamic";

export async function GET() {
  const html = await fs.readFile(path.join(process.cwd(), "public", "subscriber-app.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
