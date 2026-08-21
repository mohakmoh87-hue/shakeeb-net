import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ═════ 🏷️ «هل اكتمل النشر؟» — جوابٌ في ثانية (سؤالُ محمد المتكرّر 2026-08-21) ═════
// لم يكن في الموقع أيُّ علامةٍ تقول أيَّ إيداعٍ يشغّله، فكان التحقّقُ من وصول دفعةٍ
// يحتاج مسباراً سلوكيّاً لكلّ تغيير (وقد يستحيل حين يكون التغييرُ داخل المزامنة).
// Railway تحقن `RAILWAY_GIT_COMMIT_SHA` في الحاوية، فهذا المسارُ يعيدها.
// 🔓 مفتوحٌ بلا جلسة عمداً: رقمُ إيداعٍ في مستودعٍ عامّ ليس سرّاً، ولا يكشف بياناتٍ.
export async function GET() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  return NextResponse.json(
    {
      commit: sha ? sha.slice(0, 7) : null,
      full: sha,
      startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
      uptimeSec: Math.round(process.uptime()),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
