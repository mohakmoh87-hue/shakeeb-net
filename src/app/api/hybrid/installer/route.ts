import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// تنزيل مُنصِّب وكيل شكيب نت (النظام الهجين).
// حالياً عنصر نائب حتى إنجاز حزمة الوكيل؛ سيُستبدل بالمُنصِّب الفعلي.
export async function GET() {
  const s = await getSession();
  if (!s) return new Response("غير مصرّح", { status: 401 });

  const body =
    "وكيل شكيب نت — النظام الهجين\n" +
    "=============================\n\n" +
    "حزمة المُنصِّب قيد الإعداد النهائي وستتوفّر هنا قريباً.\n" +
    "عند توفّرها: شغّل الملف بنقرة مزدوجة، ووافق على تنبيه ويندوز، ثم امسح رمز واتساب.\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ShakeebNet-Agent-README.txt"',
    },
  });
}
