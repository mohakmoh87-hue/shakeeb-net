"use client";

// ═════ أ-١ · شاشةُ «بصمات الحضور» للمدير (طلبُ محمد) ═════
//
// بنصّ الطلب:
//   • «زرٌّ جديد يفتح شاشةً تُظهر **كلّ فنيّي كلّ المكاتب الذين بصموا اليوم حصراً**.»
//   • «وفيها زرّ **«سجل»**: يُظهر كلّ الفنيّين، وبالضغط على فنيٍّ تظهر **كلّ بصماته**.»
//
// 🔑 و«الذين بصموا اليوم **حصراً**» شرطٌ لا وصف: المُرشَّحُ الافتراضيُّ يُخفي مَن لم يبصم،
//   فالشاشةُ تُجيب سؤالاً واحداً — «مَن عندي اليوم؟» — ولو عُرض الكلُّ لَغرِق الجوابُ.
//   ومَن لم يبصم يُرى بضغطة «سجل» (وهي الشاشةُ الثانيةُ في الطلب نفسِه).
//
// 🔒 والعزلُ من الخادم لا من الواجهة: `GET /api/field/attendance` يقصر النتيجةَ على
//   مكاتب وكيل المستخدم، ويرفض `officeId` لمكتبٍ لا يتبعه (٤٠٣). فلا نُرشِّح هنا أمناً.

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Tech = {
  id: number; name: string | null;
  shiftStart: string | null; shiftEnd: string | null;
  state: "none" | "in" | "done";
  checkIn: string | null; checkOut: string | null;
  checkInActual: string | null; checkOutActual: string | null;
  checkoutBy: string | null; lateExcuse: string | null;
  towerId: number | null; office: string | null;
  // البند ٩ · يومٌ سابقٌ لم يُغلَق: يحمل يومَه ليُعرَض «معلَّقٌ من …»
  dayKey?: string | null;
};
type LogRow = {
  id: number; dayKey: string | null;
  checkIn: string | null; checkInActual: string | null;
  checkOut: string | null; checkOutActual: string | null;
  checkoutBy: string | null; lateExcuse: string | null;
  inOffice: string | null; outOffice: string | null;
};
type Office = { id: number; name: string | null };

/** الوقتُ بالساعة والدقيقة بتوقيت بغداد — والقيَمُ تأتي UTC من الخادم. */
const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }) : "—";

const STATE: Record<Tech["state"], { label: string; cls: string }> = {
  in: { label: "بصم دخولاً", cls: "bg-emerald-100 text-emerald-700" },
  done: { label: "دخولٌ وخروج", cls: "bg-sky-100 text-sky-700" },
  none: { label: "لم يبصم", cls: "bg-slate-100 text-slate-500" },
};

export default function AttendancePage() {
  const { can, me } = usePermission();
  const [techs, setTechs] = useState<Tech[]>([]);
  const [open, setOpen] = useState<Tech[]>([]); // أيّامٌ سابقةٌ لم تُغلَق (البند ٩)
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSel, setOfficeSel] = useState<string>("");
  const [showAll, setShowAll] = useState(false); // «سجل» = كلُّ الفنيّين لا مَن بصم اليوم
  const [openTech, setOpenTech] = useState<Tech | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ⚠️ لا `setState` **متزامنٌ** هنا: نداءُ الدالّة من داخل `useEffect` مع تصفيرٍ متزامنٍ
  //   للخطأ يُشعل `react-hooks/set-state-in-effect` (تصييرٌ متتالٍ). فكلُّ تغييرِ حالةٍ
  //   يقع داخل ردّ الوعد — والنتيجةُ نفسُها بلا تصييرٍ زائد.
  const load = useCallback(() => {
    const qs = officeSel ? `?officeId=${officeSel}` : "";
    fetch(`/api/field/attendance${qs}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) { setErr(d?.error ?? "تعذّر جلب الحضور"); return; }
        setErr("");
        setTechs(Array.isArray(d?.technicians) ? d.technicians : []);
        setOpen(Array.isArray(d?.open) ? d.open : []);
      })
      .catch(() => setErr("تعذّر الاتصال بالخادم"))
      .finally(() => setLoading(false));
  }, [officeSel]);

  useEffect(() => { load(); }, [load]);
  // تحديثٌ كلَّ دقيقةٍ: البصماتُ تقع أثناء فتح الشاشة، وشاشةُ حضورٍ قديمةٌ تُضلّل
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then((rows: Office[]) => setOffices(rows))));
  }, []);

  function openLog(t: Tech) {
    setOpenTech(t);
    setLog(null);
    fetch(`/api/field/attendance?technicianId=${t.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLog(Array.isArray(d?.log) ? d.log : []))
      .catch(() => setLog([]));
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("field.manage") && !can("field.payroll")) {
    return (
      <div className="p-6">
        <PageHeader title="بصمات الحضور" />
        <div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية عرض حضور الفنيين.</div>
      </div>
    );
  }

  // البند ٩ · المعروضُ افتراضاً = **حضورُ اليوم + كلُّ يومٍ لم يُغلَق** (ولو من أمس).
  // ومَن بُصِم خروجُه (بيد المدير أو آليّاً) يسقط من `open` في الخادم فيختفي هنا.
  const stamped = techs.filter((t) => t.state !== "none");
  const shown = showAll ? techs : [...open, ...stamped];

  return (
    <div className="p-6">
      <PageHeader
        title="بصمات الحضور"
        subtitle={`حضورُ اليوم ${stamped.length} من ${techs.length}${open.length ? ` · ومعلَّقٌ من أيّامٍ سابقة: ${open.length}` : ""}`}
      />

      <div className="mb-4 flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-sm font-semibold text-slate-600">المكتب:</span>
        <select value={officeSel} onChange={(e) => setOfficeSel(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-mynet-blue">
          <option value="">كلّ المكاتب</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
        </select>
        {/* «سجل» — الشاشةُ الثانيةُ في الطلب: كلُّ الفنيّين لا مَن بصم اليوم */}
        <button onClick={() => setShowAll((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${showAll ? "bg-mynet-blue text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
          {showAll ? "📋 الكلّ (اضغط للعودة لبصمات اليوم)" : "📋 سجل — كلّ الفنيّين"}
        </button>
        <button onClick={load} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">
          ⟳ تحديث
        </button>
        <span className="text-[11px] text-slate-400">يتحدّث تلقائياً كلّ دقيقة</span>
      </div>

      {err && <div className="mb-3 max-w-5xl rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</div>}

      {loading ? (
        <div className="text-slate-400">جاري التحميل...</div>
      ) : shown.length === 0 ? (
        <div className="max-w-5xl rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-slate-500 shadow-sm">
          {showAll ? "لا فنيّين في هذا النطاق." : "لا بصماتَ اليوم ولا يومَ معلَّقاً — اضغط «سجل» لرؤية كلّ الفنيّين."}
        </div>
      ) : (
        <div className="max-w-5xl overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">الفنيّ</th>
                <th className="px-3 py-2 text-right font-semibold">المكتب</th>
                <th className="px-3 py-2 text-center font-semibold">الحالة</th>
                <th className="px-3 py-2 text-center font-semibold">دخول</th>
                <th className="px-3 py-2 text-center font-semibold">خروج</th>
                <th className="px-3 py-2 text-center font-semibold">الدوام</th>
                <th className="px-3 py-2 text-center font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={`${t.id}:${t.dayKey ?? "today"}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-3 py-2 font-semibold text-slate-800">
                    {t.name ?? `فنيّ ${t.id}`}
                    {/* يومٌ سابقٌ لم يُغلَق — يُميَّز بيومه كي لا يُقرأ كحضورِ اليوم */}
                    {t.dayKey && (
                      <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        معلَّقٌ من {t.dayKey}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{t.office ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE[t.state].cls}`}>{STATE[t.state].label}</span>
                    {t.lateExcuse === "pending" && (
                      <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">عذرٌ معلّق</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{hhmm(t.checkIn)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {hhmm(t.checkOut)}
                    {/* خروجٌ ختمه النظامُ لا الفنيّ — يُميَّز كي لا يُقرأ كبصمةٍ حقيقيّة */}
                    {t.checkoutBy && t.checkoutBy !== "tech" && (
                      <span className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">آليّ</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-[12px] text-slate-500 tabular-nums">
                    {t.shiftStart || t.shiftEnd ? `${t.shiftStart ?? "—"} – ${t.shiftEnd ?? "—"}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => openLog(t)}
                      className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100">
                      كلّ بصماته
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* بصماتُ فنيٍّ واحدٍ — الشاشةُ الثالثةُ في الطلب («بالضغط على فنيٍّ تظهر كلّ بصماته») */}
      {openTech && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpenTech(null)}>
          <div className="mt-8 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">
                بصمات {openTech.name ?? `فنيّ ${openTech.id}`}
                {openTech.office && <span className="mr-2 text-xs font-normal text-slate-500">— {openTech.office}</span>}
              </h3>
              <button onClick={() => setOpenTech(null)} className="rounded-lg bg-slate-100 px-3 py-1 text-sm text-slate-600 hover:bg-slate-200">إغلاق</button>
            </div>
            {log == null ? (
              <div className="py-6 text-center text-slate-400">جاري التحميل...</div>
            ) : log.length === 0 ? (
              <div className="py-6 text-center text-slate-500">لا بصماتَ مسجّلة.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold">اليوم</th>
                      <th className="px-3 py-2 text-center font-semibold">دخول</th>
                      <th className="px-3 py-2 text-center font-semibold">خروج</th>
                      <th className="px-3 py-2 text-right font-semibold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700 tabular-nums">{r.dayKey ?? "—"}</td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          {hhmm(r.checkIn)}
                          {/* وقتُ البصمة الحقيقيُّ يُعرَض حين يختلف عمّا احتُسب (تعديلُ مدير/تقريب) */}
                          {r.checkInActual && r.checkIn && r.checkInActual !== r.checkIn && (
                            <span className="mr-1 text-[10px] text-slate-400">(فعليّ {hhmm(r.checkInActual)})</span>
                          )}
                          {r.inOffice && <span className="mr-1 rounded bg-purple-100 px-1 py-0.5 text-[10px] text-purple-700">{r.inOffice}</span>}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          {hhmm(r.checkOut)}
                          {r.checkOutActual && r.checkOut && r.checkOutActual !== r.checkOut && (
                            <span className="mr-1 text-[10px] text-slate-400">(فعليّ {hhmm(r.checkOutActual)})</span>
                          )}
                          {r.outOffice && <span className="mr-1 rounded bg-purple-100 px-1 py-0.5 text-[10px] text-purple-700">{r.outOffice}</span>}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-slate-500">
                          {r.checkoutBy && r.checkoutBy !== "tech" && <span className="mr-1">خروجٌ آليّ</span>}
                          {r.lateExcuse === "pending" && <span className="mr-1 text-amber-600">عذرٌ معلّق</span>}
                          {r.lateExcuse === "approved" && <span className="mr-1 text-emerald-600">عذرٌ مقبول</span>}
                          {r.lateExcuse === "rejected" && <span className="mr-1 text-red-500">عذرٌ مرفوض</span>}
                          {!r.checkOut && r.checkIn && <span className="text-slate-400">يومٌ مفتوح</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-[11px] text-slate-400">آخرُ ١٢٠ يوماً · «فعليّ» = وقتُ البصمة قبل أيّ تعديل · الوسمُ البنفسجيُّ = بصم من مكتبٍ غير مكتبه</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
