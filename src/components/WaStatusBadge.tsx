"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ═════ مؤشِّرُ حالة واتساب المكاتب — بجانب «التقرير اليوميّ» (طلبُ محمد 2026-08-13) ═════
// كان في شريط أزرار المشتركين بجانب «+ مشترك جديد»، ونُقل إلى ترويسة التقرير اليوميّ
// لأنّ زرّاً جديداً («تنصيبات خارجيّة») سيأخذ مكانَه ويُزيحه يساراً.
//
// 🔑 **ويقول لماذا**: سأل محمد «تظهر لي غيرُ متصلٍ في الرئيسيّة وأجدُ المكاتبَ الثلاثةَ
//   متّصلة». والقياسُ كشف أنّ المقصودَ **مكتبُ الشهداء**: واتسابُه مُطفأٌ **للمشتركين**
//   لكنّ له **رقمَ مدير** ⇒ يُحصى بحقٍّ لأنّ **تقريرَ المدير يُرسَل عبر واتساب**.
//   فالتنبيهُ كان صادقاً والناقصُ **سببُه**: «غير متصل» بلا سببٍ تُقرأ عطلاً، فيفتح
//   المديرُ بطاقاتِ المكاتب المُشتغَلة فيجدها متّصلةً فيظنّ البرنامجَ كاذباً.

type Office = { id: number; name: string | null; state: string; need?: "subscribers" | "manager" };

const NEED_LABEL: Record<string, string> = {
  subscribers: "رسائل المشتركين",
  manager: "تقرير المدير فقط",
};

export default function WaStatusBadge() {
  const router = useRouter();
  const [offices, setOffices] = useState<Office[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/whatsapp/offices-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.offices) setOffices(d.offices as Office[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!offices || offices.length === 0) return null;

  const down = offices.filter((o) => o.state !== "ready");
  const allUp = down.length === 0;

  // السببُ لكلّ مكتبٍ منقطع — فالمديرُ يعرف أيَّ شيءٍ يتعطّل فعلاً قبل أن يقرّر
  const title = allUp
    ? "كلُّ مكاتب الواتساب متصلة"
    : "اضغط لفتح صفحة الربط.\n" + down
        .map((o) => `• ${o.name ?? "؟"} — يحتاجه لـ${NEED_LABEL[o.need ?? "subscribers"] ?? "الرسائل"}`)
        .join("\n");

  return (
    <button
      className={`wa ${allUp ? "up" : "down"}`}
      onClick={() => router.push("/towers")}
      title={title}
      style={{ marginInlineStart: 8 }}
    >
      <span className="wa-d" />
      {allUp ? "واتساب متصل" : `واتساب غير متصل ${down.length} مكتب`}
      {/* المكتبُ الذي يحتاجه لتقرير المدير وحدَه يُوسَم صريحاً — وهو أكثرُ ما التبس */}
      {!allUp && down.every((o) => o.need === "manager") && (
        <span style={{ fontWeight: 400, fontSize: 10, marginInlineStart: 4 }}>(لتقرير المدير)</span>
      )}
    </button>
  );
}
