"use client";

import { useCallback, useEffect, useState } from "react";
import DateRangeFilter from "@/components/DateRangeFilter";

// ===== إنجازات الفنيين: الترتيب من الأول إلى الأخير (طلب محمد 2026-08-05) =====
// كل فنيّي مكاتب الوكيل معاً — لا مكتباً مكتباً. الفترة الافتراضية فترة الراتب الحالية،
// فالمسابقة تبدأ مع بدايتها وتُصفَّر مع نهايتها.
type KindRow = { kind: string; count: number; avgMin: number | null; weight: number };
type Row = {
  technicianId: number; name: string; office: string | null;
  cards: number; points: number; avgMin: number | null; timed: number; byKind: KindRow[];
};
type Tally = { towerId: number | null; office: string; total: number; kinds: { kind: string; count: number }[] };
type Data = {
  from: string | null; to: string | null;
  rows: Row[]; leader: Row | null;
  kindAvg: { kind: string; avgMin: number | null; count: number; weight: number }[];
  byOffice: Tally[]; totals: { total: number; kinds: { kind: string; count: number }[] };
  weights: { label: string; weight: number }[]; defaultWeight: number; minCards: number;
};

const MEDAL = ["🥇", "🥈", "🥉"];

export default function AchievementsModal({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [dateOn, setDateOn] = useState(false); // مطفأ = فترة الراتب الحالية
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback((on: boolean, f: string, t: string) => {
    setLoading(true);
    const qs = on && f && t ? `?from=${f}&to=${t}` : "";
    fetch(`/api/field/achievements${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => { setD(x); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { const t = setTimeout(() => load(dateOn, from, to), 0); return () => clearTimeout(t); }, [load, dateOn, from, to]);

  const top = d?.rows?.[0]?.points ?? 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🏅 إنجازات الفنيين</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>
        <div className="mb-3 text-xs text-slate-500">
          كل فنيّي مكاتبك معاً · الفترة: {d?.from && d?.to ? <b dir="ltr">{d.from} → {d.to}</b> : "—"}
          {!dateOn && <span className="text-slate-400"> (فترة الراتب الحالية)</span>}
        </div>

        <div className="mb-3">
          <DateRangeFilter on={dateOn} setOn={setDateOn} from={from} setFrom={setFrom} to={to} setTo={setTo} label="فترة أخرى" />
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">جاري الحساب…</div>
        ) : !d || d.rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">لا إنجازات في هذه الفترة</div>
        ) : (
          <>
            <ul className="space-y-2">
              {d.rows.map((r, i) => {
                const crown = d.leader?.technicianId === r.technicianId;
                const pct = top > 0 ? Math.max(4, Math.round((r.points / top) * 100)) : 0;
                return (
                  <li key={r.technicianId} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${crown ? "border-amber-300 ring-2 ring-amber-200" : "border-slate-200"}`}>
                    <button onClick={() => setOpen(open === r.technicianId ? null : r.technicianId)} className="w-full px-3 py-2.5 text-right">
                      <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-center text-lg font-extrabold text-slate-400">{MEDAL[i] ?? i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-slate-800">
                            {crown && "👑 "}{r.name}
                            {r.cards < (d.minCards ?? 5) && <span className="mr-1 text-[10px] font-normal text-slate-400">(دون حدّ التتويج)</span>}
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            {r.office ?? "—"} · {r.cards} بطاقة
                            {r.avgMin != null && <> · متوسط {r.avgMin} د ({r.timed} مؤقّتة)</>}
                          </span>
                        </span>
                        <span className="shrink-0 text-left">
                          <span className="block text-lg font-extrabold text-mynet-blue" dir="ltr">{r.points}</span>
                          <span className="block text-[10px] text-slate-400">نقطة</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${crown ? "bg-amber-400" : "bg-mynet-blue/60"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </button>

                    {open === r.technicianId && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500">
                            <tr><th className="p-1 text-right">الفئة</th><th className="p-1">الوزن</th><th className="p-1">البطاقات</th><th className="p-1">متوسط الزمن</th><th className="p-1">النقاط ≈</th></tr>
                          </thead>
                          <tbody>
                            {r.byKind.map((k) => (
                              <tr key={k.kind} className="border-t border-slate-100">
                                <td className="p-1 font-semibold text-slate-700">{k.kind}</td>
                                <td className="p-1 text-center text-slate-500">×{k.weight}</td>
                                <td className="p-1 text-center font-bold text-slate-700">{k.count}</td>
                                <td className="p-1 text-center text-slate-500">{k.avgMin != null ? `${k.avgMin} د` : "—"}</td>
                                <td className="p-1 text-center font-bold text-mynet-blue">{Math.round(k.count * k.weight * 10) / 10}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-1 text-[10px] text-slate-400">«النقاط ≈» بلا معامل السرعة — والمجموع أعلاه يشمله.</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* ===== حصاد المكاتب: كل مكتب على حدة ثم المجموع (طلب محمد) ===== */}
            {d.byOffice.length > 0 && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                <div className="mb-2 font-bold text-slate-800">📊 ما أُنجز في كل مكتب</div>
                <div className="space-y-2">
                  {d.byOffice.map((o) => (
                    <div key={o.towerId ?? "none"} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-bold text-slate-700">🏢 {o.office}</span>
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-extrabold text-mynet-blue ring-1 ring-slate-200" dir="ltr">{o.total}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {o.kinds.map((k) => (
                          <span key={k.kind} className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                            {k.kind} <b className="text-slate-800">{k.count}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* المجموع الكلي لكل المكاتب */}
                <div className="mt-2 rounded-xl border border-mynet-blue/30 bg-sky-50 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-extrabold text-mynet-blue">Σ مجموع كل المكاتب</span>
                    <span className="rounded-full bg-mynet-blue px-2.5 py-0.5 text-xs font-extrabold text-white" dir="ltr">{d.totals.total}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.totals.kinds.map((k) => (
                      <span key={k.kind} className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-sky-200">
                        {k.kind} <b className="text-mynet-blue">{k.count}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* شرح المعادلة — كي لا يكون الترتيب صندوقاً مغلقاً يُشكَّك فيه */}
            <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-bold text-slate-700">كيف تُحتسب النقاط؟</summary>
              <p className="mt-2 leading-6">
                نقاط البطاقة = <b>وزن صعوبة فئتها</b> × <b>معامل سرعتها</b> (زمنها مقارناً بمتوسط الفئة نفسها،
                محدود بين ٠٫٦ و١٫٦). و<b>التوصيل خارج معادلة الوقت تماماً</b>: لا يدخل أي متوسط، ويُحسب
                في العدد بنصف نقطة ثابتة. وأي زمن يتجاوز ٤ ساعات يُتجاهَل (نسيان ضغط «إنجاز» غالباً).
                ولا تتويج بأقلّ من {d.minCards} بطاقات.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.weights.map((w) => (
                  <span key={w.label} className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700">{w.label} ×{w.weight}</span>
                ))}
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-500">أي نوع جديد ×{d.defaultWeight}</span>
              </div>
              {d.kindAvg.length > 0 && (
                <div className="mt-2 text-[11px] text-slate-500">
                  متوسط الفترة لكل فئة: {d.kindAvg.map((k) => `${k.kind} ${k.avgMin} د`).join(" · ")}
                </div>
              )}
            </details>
          </>
        )}
      </div>
    </div>
  );
}
