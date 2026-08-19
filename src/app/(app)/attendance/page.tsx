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

import { useCallback, useEffect, useRef, useState } from "react";
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
  // البند ٧ · الخصمُ وأثرُ مسحه
  lateDeduction: number | null; earlyDeduction: number | null;
  salaryStatementId: number | null;
  deductionClearedBy: string | null; deductionClearedAt: string | null;
  deductionClearReason: string | null; deductionClearedAmount: number | null;
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
  // ═════ توحيدُ الحضور في هذا الزرّ (طلبُ محمد 2026-08-14) ═════
  // «نحن لدينا الآن حضورُ الفنيّين بزرٍّ مستقلّ ويجب نقلُ كلّ شيءٍ إليه… وأيُّ شيءٍ يتعلّق
  //  بحضور الفنيّين يجب أن يكون في الزرّ الجديد». فنُقلت هنا ميزاتُ نافذة إدارة الفنيّين
  //  كلُّها: **حذفُ بصمة · بصمةُ خروجٍ يدويّةٍ بخياراتها الثلاثة · إضافةُ يومٍ كامل** —
  //  ومعها بحثٌ بين تاريخين. ولم يُمَسّ أيُّ مسارٍ خلفيّ: كلُّها مساراتٌ قائمةٌ مجرَّبة.
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [fixDay, setFixDay] = useState("");
  const [fixAt, setFixAt] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const autoOpened = useRef(false); // «?tech=N» يُفتَح مرّةً واحدةً لا في كلّ تحديثٍ دوريّ

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
        const rows: Tech[] = Array.isArray(d?.technicians) ? d.technicians : [];
        setTechs(rows);
        setOpen(Array.isArray(d?.open) ? d.open : []);
        // زرُّ «الحضور» في إدارة الفنيّين يقود إلى هنا بـ`?tech=N` — فتُفتَح بصماتُه فوراً.
        // ويقع هنا لا في `useEffect`: تغييرُ الحالة داخل ردّ الوعد لا يُشعل تصييراً متتالياً
        // (وهي قاعدةُ هذا الملفّ أعلاه). و`autoOpened` مرجعٌ لا حالةٌ فلا يُعيد التصيير،
        // ولو لم يكن الفنيُّ في معروض اليوم يُشعَل «سجل» ليظهر.
        if (!autoOpened.current) {
          autoOpened.current = true;
          const want = Number(new URLSearchParams(window.location.search).get("tech")) || 0;
          const t = want ? rows.find((x) => x.id === want) : undefined;
          if (t) { setShowAll(true); openLog(t); }
        }
      })
      .catch(() => setErr("تعذّر الاتصال بالخادم"))
      .finally(() => setLoading(false));
    // `openLog` مقصودٌ خارجَ التبعيّات: إدخالُه يُغيّر هويّةَ `load` في كلّ تصيير، فيُعاد
    // بناءُ مؤقّتِ الدقيقة بلا انقطاع. ولا خطرَ إغلاقٍ قديم — لا يستعمل إلّا مُثبِّتاتٍ
    // (`setState` و`loadLog` بتبعيّاتٍ فارغة).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


  // ═══ البند ٧ · مسحُ خصمٍ بسببٍ إلزاميّ («ولأيّ سبب وليس فقط البصمة») ═══
  // ⛔ وقاعدةُ محمد: يومٌ مختومٌ بكشفِ راتبٍ **لا يُمسَح** — المسارُ يرفضه ٤٠٩، والواجهةُ
  //    لا تُظهر الزرَّ له أصلاً فلا يُضغَط ما سيُرفَض.
  const [clearing, setClearing] = useState<number | null>(null);
  async function clearDeduction(row: LogRow) {
    const reason = prompt("سببُ مسح الخصم (إلزاميّ):")?.trim();
    if (!reason) return;
    setClearing(row.id);
    const r = await fetch("/api/field/attendance/clear-deduction", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceId: row.id, reason }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setClearing(null);
    if (!r?.ok) { alert(d?.error ?? "تعذّر مسح الخصم"); return; }
    if (openTech) openLog(openTech); // إعادةُ قراءةٍ فيظهر أثرُ المسح فوراً
    load();
  }

  const loadLog = useCallback((techId: number, f?: string, t?: string) => {
    setLog(null);
    const q = new URLSearchParams({ technicianId: String(techId) });
    if (f) q.set("from", f);
    if (t) q.set("to", t);
    fetch(`/api/field/attendance?${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLog(Array.isArray(d?.log) ? d.log : []))
      .catch(() => setLog([]));
  }, []);

  function openLog(t: Tech) {
    setOpenTech(t);
    setAct(null); setFixDay(""); setFixAt(""); setShowAdd(false);
    setFrom(""); setTo("");
    setAddDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" }));
    loadLog(t.id);
  }

  /** نداءُ تعديلٍ على البصمة (خروجٌ يدويّ · إضافةُ يوم · حذفُ بصمة) — بمساراتها القائمة. */
  async function attReq(method: string, body?: Record<string, unknown>, qs?: string): Promise<boolean> {
    if (!openTech) return false;
    setBusy(true); setAct(null);
    const r = await fetch(`/api/field/attendance${qs ?? ""}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setAct({ t: "err", m: d?.error ?? "تعذّر التنفيذ" }); return false; }
    loadLog(openTech.id, from, to);
    load(); // يُحدِّث جدولَ اليوم أيضاً
    return true;
  }

  // أ-٢٤ · أيّامٌ يمكن تصحيحُ خروجها: لها دخولٌ وخروجُها ناقصٌ أو من الكرون أو أغلقه الفنيُّ متأخّراً.
  // (وبصمةُ الفنيّ الحقيقيّةُ `tech` لا تُمَسّ — شهادتُه، ويرفضها الخادمُ أصلاً.)
  const fixable = (log ?? []).filter((r) => r.dayKey && r.checkIn && (!r.checkOut || r.checkoutBy === "auto" || r.checkoutBy === "tech-late"));
  const fixSel = fixDay || fixable[0]?.dayKey || "";
  const fixRec = fixable.find((r) => r.dayKey === fixSel);

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

      <div data-app-bar className="mb-4 flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
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

            {act && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${act.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{act.m}</div>}

            {/* بحثٌ بين تاريخين — لمراجعة بصماتٍ أقدم من ١٢٠ يوماً */}
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <label className="text-[11px] font-semibold text-slate-600">من
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr"
                  className="mr-1 rounded-lg border border-slate-300 px-2 py-1 text-xs" /></label>
              <label className="text-[11px] font-semibold text-slate-600">إلى
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr"
                  className="mr-1 rounded-lg border border-slate-300 px-2 py-1 text-xs" /></label>
              <button onClick={() => loadLog(openTech.id, from, to)}
                className="rounded-lg bg-mynet-blue px-3 py-1 text-xs font-bold text-white">بحث</button>
              <button onClick={() => { setFrom(""); setTo(""); loadLog(openTech.id); }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">آخر ١٢٠ يوماً</button>
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
                      <th className="px-3 py-2 text-center font-semibold">الخصم</th>
                      <th className="px-3 py-2 text-right font-semibold">ملاحظات</th>
                      <th className="px-3 py-2"></th>
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
                        <td className="px-3 py-2 text-center text-[12px]">
                          {r.deductionClearedAt ? (
                            <span className="text-emerald-600"
                              title={`مسحه ${r.deductionClearedBy ?? "—"} · السبب: ${r.deductionClearReason ?? "—"}`}>
                              مُسِح{r.deductionClearedAmount ? ` (${r.deductionClearedAmount.toLocaleString("en-US")})` : ""}
                            </span>
                          ) : ((r.lateDeduction ?? 0) + (r.earlyDeduction ?? 0)) <= 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <b className="text-red-600 tabular-nums">
                                {((r.lateDeduction ?? 0) + (r.earlyDeduction ?? 0)).toLocaleString("en-US")}
                              </b>
                              {/* يومٌ مختومٌ بكشفٍ: لا زرَّ مسحٍ — «لا مسحَ بعد صرف الراتب» */}
                              {r.salaryStatementId == null ? (
                                <button onClick={() => void clearDeduction(r)} disabled={clearing === r.id}
                                  className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                                  {clearing === r.id ? "…" : "مسح"}
                                </button>
                              ) : (
                                <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500"
                                  title="اليومُ مختومٌ بكشف راتبٍ مصروف">مختوم</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-slate-500">
                          {r.checkoutBy && r.checkoutBy !== "tech" && <span className="mr-1">خروجٌ آليّ</span>}
                          {r.lateExcuse === "pending" && <span className="mr-1 text-amber-600">عذرٌ معلّق</span>}
                          {r.lateExcuse === "approved" && <span className="mr-1 text-emerald-600">عذرٌ مقبول</span>}
                          {r.lateExcuse === "rejected" && <span className="mr-1 text-red-500">عذرٌ مرفوض</span>}
                          {!r.checkOut && r.checkIn && <span className="text-slate-400">يومٌ مفتوح</span>}
                        </td>
                        {/* حذفُ البصمة — كان في نافذة إدارة الفنيّين، ومكانُه هنا (طلبُ محمد) */}
                        <td className="px-2 py-2 text-center">
                          {r.salaryStatementId == null ? (
                            <button
                              onClick={() => { if (r.dayKey && confirm(`حذف بصمة ${r.dayKey}؟`)) void attReq("DELETE", undefined, `?technicianId=${openTech.id}&dayKey=${r.dayKey}`); }}
                              disabled={busy} title="حذف هذه البصمة"
                              className="rounded-lg px-1.5 py-1 text-sm text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">🗑️</button>
                          ) : (
                            <span className="text-[10px] text-slate-300" title="يومٌ مختومٌ بكشف راتب">🔒</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-[11px] text-slate-400">«فعليّ» = وقتُ البصمة قبل أيّ تعديل · الوسمُ البنفسجيُّ = بصم من مكتبٍ غير مكتبه · 🔒 = يومٌ مختومٌ بكشف راتب</div>
              </div>
            )}

            {/* ═════ أ-٢٤ · بصمةُ خروجٍ يدويّةٍ بخياراتها الثلاثة (نُقلت من إدارة الفنيّين) ═════ */}
            {fixable.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-sm font-bold text-slate-700">بصمة خروج يدوية (نسيان الفني)</div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="shrink-0 text-xs font-bold text-amber-800">اليوم:</span>
                    <select value={fixSel} onChange={(e) => { setFixDay(e.target.value); setFixAt(""); }}
                      className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm">
                      {fixable.map((r) => (
                        <option key={r.id} value={r.dayKey ?? ""}>
                          {r.dayKey} · دخول {hhmm(r.checkIn)}
                          {r.checkoutBy === "auto" ? ` · خروجٌ تلقائيّ ${hhmm(r.checkOut)}`
                            : r.checkoutBy === "tech-late" ? ` · أغلقه الفنيُّ متأخّراً ${hhmm(r.checkOut)}`
                            : " · بلا خروج"}
                        </option>
                      ))}
                    </select>
                  </div>
                  {fixRec?.checkoutBy === "tech-late" && (
                    <div className="mb-2 text-[11px] text-indigo-800">
                      ℹ️ أغلقه الفنيُّ بنفسه بعد منتصف الليل، والمُحتسَبُ مقصوصٌ عند نهاية دوامه (بلا إضافيّ). فإن عمل فعلاً إلى وقتٍ متأخّرٍ فصحّحه بـ«خروجه الفعليّ».
                    </div>
                  )}
                  {fixRec?.checkoutBy === "auto" && (
                    <div className="mb-2 text-[11px] text-amber-800">
                      ⚠️ أغلقه النظامُ تلقائياً عند منتصف الليل — والتصحيحُ يُعيد حسابَ الخصم والإضافيّ.
                    </div>
                  )}
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <button onClick={async () => { if (await attReq("PATCH", { technicianId: openTech.id, mode: "now", outDay: fixSel })) setAct({ t: "ok", m: "سُجّل الخروج بالوقت الحالي ✓" }); }}
                      disabled={busy || !fixSel}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2.5 font-bold text-amber-700 shadow-sm active:scale-95 disabled:opacity-60">
                      <span className="text-lg leading-none">🕐</span><span className="text-[11px]">الوقت الحالي</span>
                    </button>
                    <button onClick={async () => { if (await attReq("PATCH", { technicianId: openTech.id, mode: "scheduled", outDay: fixSel })) setAct({ t: "ok", m: "سُجّل الخروج بنهاية دوامه ✓" }); }}
                      disabled={busy || !fixSel}
                      className="flex flex-col items-center gap-1 rounded-xl bg-white py-2.5 font-bold text-amber-700 shadow-sm active:scale-95 disabled:opacity-60">
                      <span className="text-lg leading-none">⏰</span><span className="text-[11px]">نهاية دوامه</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="time" value={fixAt} onChange={(e) => setFixAt(e.target.value)} dir="ltr"
                      className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-center text-sm" />
                    <button onClick={async () => { if (await attReq("PATCH", { technicianId: openTech.id, mode: "custom", at: fixAt, outDay: fixSel })) { setAct({ t: "ok", m: `سُجّل خروجه الفعليّ ${fixAt} ✓` }); setFixAt(""); } }}
                      disabled={busy || !fixSel || !/^\d{2}:\d{2}$/.test(fixAt)}
                      className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-50">
                      ✍️ خروجه الفعليّ
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ═════ إضافةُ بصمةِ يومٍ كامل (نُقلت من إدارة الفنيّين) ═════ */}
            <div className="mt-3">
              {!showAdd ? (
                <button onClick={() => setShowAdd(true)}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
                  ➕ إضافة بصمة يوم كامل
                </button>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ اليوم المُضاف</label>
                  <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} dir="ltr"
                    className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-mynet-blue" />
                  <p className="mb-3 text-[11px] text-slate-400">تُسجَّل الدخولُ والخروجُ بوقتَي دوامه (بلا خصمٍ ولا إضافيّ).</p>
                  <div className="flex gap-2">
                    <button onClick={async () => { if (await attReq("PATCH", { technicianId: openTech.id, addDay: addDate })) { setAct({ t: "ok", m: "أُضيفت بصمةُ يومٍ كامل ✓" }); setShowAdd(false); } }}
                      disabled={busy || !addDate}
                      className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "..." : "إضافة"}</button>
                    <button onClick={() => setShowAdd(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
