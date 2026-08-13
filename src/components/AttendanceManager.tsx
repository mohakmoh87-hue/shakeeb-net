"use client";

import { useCallback, useEffect, useState } from "react";

const todayKey = () => new Date(new Date().getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10); // بغداد
const fmtTime = (d: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }) : "—";

type Rec = { id: number; dayKey: string | null; checkIn: string | null; checkInActual: string | null; checkOut: string | null; checkOutActual: string | null; checkoutBy: string | null; lateExcuse: string | null;
  // أ-١٠/القاعدة ٣ · **أين** بصم — يأتيان من الخادم **فقط حين يختلف** المكانُ عن مكتبه
  // الأصليّ. و`office` اسمُ المكتب الذي يُحتسَب له اليومُ (الأصليُّ دائماً).
  office?: string | null; inOffice?: string | null; outOffice?: string | null };

// إدارة حضور الفني للمدير: سجل البصمات (تاريخ + دخول + خروج) مع حذف كل بصمة، خروج يدوي، وإضافة يوم كامل.
export default function AttendanceManager({ technicianId, technicianName, onClose, onChange }: { technicianId: number; technicianName: string; onClose: () => void; onChange: () => void }) {
  const [log, setLog] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [addDate, setAddDate] = useState(todayKey());
  const [showAdd, setShowAdd] = useState(false);

  const loadLog = useCallback(() => {
    setLoading(true);
    fetch(`/api/field/attendance?technicianId=${technicianId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLog(d?.log ?? []))
      .finally(() => setLoading(false));
  }, [technicianId]);
  useEffect(() => { loadLog(); }, [loadLog]);

  async function req(method: string, body?: Record<string, unknown>, qs?: string) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/field/attendance${qs ?? ""}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر التنفيذ" }); return false; }
    loadLog(); onChange();
    return true;
  }

  // ===== أ-٢٤ · أيّامٌ يمكن تصحيحُ خروجها (طلب محمد 2026-08-13) =====
  // كان الشرطُ «بصمةُ **اليوم** وهي مفتوحة» — وكرونُ auto-checkout يُغلق المفتوحةَ عند ٠٠:١٥
  // بغداد، فحين ينتبه المديرُ صباحاً يكون القسمُ قد اختفى. ولذلك ظنّ محمد أنّ الميزة أُزيلت.
  // الآن: كلُّ يومٍ له دخولٌ وخروجُه **ناقصٌ أو من الكرون** قابلٌ للتصحيح؛ وبصمةُ الفنيّ
  // الحقيقيّة (`tech`) لا تُمَسّ — فهي شهادتُه ولا يجوز للمدير طمسُها.
  // أ-٢٥ · ويُضاف "tech-late": إغلاقُ الفنيّ لسجلّ أمسِ بعد منتصف الليل **يُقصُّ عند نهاية
  // دوامه** فلا إضافيَّ فيه. فإن كان عمل فعلاً بعد دوامه فهذا هو مكانُ تصحيحه — ولذلك
  // وُسِم بغير "tech": لئلّا يمنعه حارسُ «شهادةُ الفنيّ لا تُمَسّ» من التصحيح.
  const fixable = log.filter((r) => r.dayKey && r.checkIn && (!r.checkOut || r.checkoutBy === "auto" || r.checkoutBy === "tech-late"));
  const [fixDay, setFixDay] = useState<string>("");
  const [fixAt, setFixAt] = useState<string>("");
  const day = fixDay || fixable[0]?.dayKey || "";
  const dayRec = fixable.find((r) => r.dayKey === day);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🗓️ سجل حضور {technicianName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.m}</div>}

        {/* سجل البصمات: تاريخ + دخول + خروج + حذف */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-1 bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500">
            <span>التاريخ</span><span className="text-center">دخول</span><span className="text-center">خروج</span><span> </span>
          </div>
          {loading ? (
            <div className="p-4 text-center text-sm text-slate-400">جاري التحميل…</div>
          ) : log.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400">لا بصمات في السجل الحالي</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {log.map((r) => (
                <li key={r.id} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-1 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-700" dir="ltr">{r.dayKey}</span>
                  <span className="text-center font-bold leading-tight text-emerald-700" dir="ltr">
                    {fmtTime(r.checkIn)}
                    {r.checkInActual && fmtTime(r.checkInActual) !== fmtTime(r.checkIn) && (
                      <span className="block text-[9px] font-normal text-slate-400" title="وقت البصمة الحقيقي">فعلي {fmtTime(r.checkInActual)}</span>
                    )}
                    {/* أ-١٠ · بصم من مكتبٍ آخر — واليومُ محسوبٌ لمكتبه الأصليّ (قاعدةُ محمد) */}
                    {r.inOffice && (
                      <span className="block text-[9px] font-normal text-sky-600" dir="rtl" title="بصم دخولَه من هذا المكتب — واليومُ محسوبٌ لمكتبه الأصليّ">📍 {r.inOffice}</span>
                    )}
                  </span>
                  <span className="text-center font-bold leading-tight text-rose-600" dir="ltr">
                    {fmtTime(r.checkOut)}
                    {r.checkOut && r.checkoutBy === "auto" && <span className="mr-1 text-[9px] text-amber-500">تلقائي</span>}
                    {r.checkOut && r.checkoutBy === "tech-late" && <span className="mr-1 text-[9px] text-indigo-500" title="أغلقه الفنيّ بعد منتصف الليل — والمُحتسَبُ مقصوصٌ عند نهاية دوامه">متأخّر</span>}
                    {r.checkOutActual && fmtTime(r.checkOutActual) !== fmtTime(r.checkOut) && (
                      <span className="block text-[9px] font-normal text-slate-400" title="وقت البصمة الحقيقي">فعلي {fmtTime(r.checkOutActual)}</span>
                    )}
                    {r.outOffice && (
                      <span className="block text-[9px] font-normal text-sky-600" dir="rtl" title="بصم خروجَه من هذا المكتب — واليومُ محسوبٌ لمكتبه الأصليّ">📍 {r.outOffice}</span>
                    )}
                  </span>
                  <button
                    onClick={() => { if (r.dayKey && confirm(`حذف بصمة ${r.dayKey}؟`)) req("DELETE", undefined, `?technicianId=${technicianId}&dayKey=${r.dayKey}`); }}
                    disabled={busy} title="حذف هذه البصمة" className="rounded-lg px-1.5 py-1 text-sm text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">🗑️</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* أ-٢٤ · بصمةُ خروجٍ يدويّة — لأيّ يومٍ ناقصٍ أو أغلقه الكرون، وبثلاثة خيارات */}
        {fixable.length > 0 && (
          <>
            <div className="mb-1 text-sm font-bold text-slate-700">بصمة خروج يدوية (نسيان الفني)</div>
            <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-bold text-amber-800">اليوم:</span>
                <select value={day} onChange={(e) => { setFixDay(e.target.value); setFixAt(""); }}
                  className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm">
                  {fixable.map((r) => (
                    <option key={r.id} value={r.dayKey ?? ""}>
                      {r.dayKey}{r.dayKey === todayKey() ? " (اليوم)" : ""} · دخول {fmtTime(r.checkIn)}
                      {r.checkoutBy === "auto" ? ` · خروجٌ تلقائيّ ${fmtTime(r.checkOut)}`
                        : r.checkoutBy === "tech-late" ? ` · أغلقه الفنيُّ متأخّراً ${fmtTime(r.checkOut)}`
                        : " · بلا خروج"}
                    </option>
                  ))}
                </select>
              </div>
              {dayRec?.checkoutBy === "tech-late" && (
                <div className="mb-2 text-[11px] text-indigo-800">
                  ℹ️ أغلقه الفنيُّ بنفسه بعد منتصف الليل، و**المُحتسَبُ مقصوصٌ عند نهاية دوامه** (بلا إضافيّ).
                  فإن كان عمل فعلاً إلى وقتٍ متأخّرٍ فصحّحه هنا بـ«خروجه الفعليّ».
                </div>
              )}
              {dayRec?.checkoutBy === "auto" && (
                <div className="mb-2 text-[11px] text-amber-800">
                  ⚠️ هذا اليوم أغلقه النظامُ تلقائياً عند منتصف الليل — والتصحيحُ يُعيد حسابَ الخصم والإضافيّ.
                </div>
              )}
              <div className="mb-2 grid grid-cols-2 gap-2">
                <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "now", outDay: day })) setMsg({ t: "ok", m: "سُجّل الخروج بالوقت الحالي ✓" }); }} disabled={busy || !day}
                  className="flex flex-col items-center gap-1 rounded-xl bg-white py-2.5 font-bold text-amber-700 shadow-sm active:scale-95 disabled:opacity-60">
                  <span className="text-lg leading-none">🕐</span><span className="text-[11px]">الوقت الحالي</span>
                </button>
                <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "scheduled", outDay: day })) setMsg({ t: "ok", m: "سُجّل الخروج بنهاية دوامه ✓" }); }} disabled={busy || !day}
                  className="flex flex-col items-center gap-1 rounded-xl bg-white py-2.5 font-bold text-amber-700 shadow-sm active:scale-95 disabled:opacity-60">
                  <span className="text-lg leading-none">⏰</span><span className="text-[11px]">نهاية دوامه</span>
                </button>
              </div>
              {/* وقتُ خروجه **الفعليّ** — والخصمُ والإضافيُّ يُحسبان منه بالضبط */}
              <div className="flex items-center gap-2">
                <input type="time" value={fixAt} onChange={(e) => setFixAt(e.target.value)}
                  className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-center text-sm" />
                <button onClick={async () => { if (await req("PATCH", { technicianId, mode: "custom", at: fixAt, outDay: day })) { setMsg({ t: "ok", m: `سُجّل خروجه الفعليّ ${fixAt} ✓` }); setFixAt(""); } }}
                  disabled={busy || !day || !/^\d{2}:\d{2}$/.test(fixAt)}
                  className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-50">
                  ✍️ خروجه الفعليّ
                </button>
              </div>
            </div>
          </>
        )}

        {/* إضافة بصمة يوم كامل (لتاريخ فائت) */}
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">➕ إضافة بصمة يوم كامل</button>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ اليوم المُضاف</label>
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} dir="ltr" className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
            <p className="mb-3 text-[11px] text-slate-400">تُسجَّل الدخول والخروج بوقتَي الدوام (بلا خصم/إضافي).</p>
            <div className="flex gap-2">
              <button onClick={async () => { if (await req("PATCH", { technicianId, addDay: addDate })) { setMsg({ t: "ok", m: "أُضيفت بصمة يوم كامل ✓" }); setShowAdd(false); } }} disabled={busy}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "..." : "إضافة"}</button>
              <button onClick={() => setShowAdd(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
