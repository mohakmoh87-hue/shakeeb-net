"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Family = "تنصيب" | "صيانة" | "توصيل" | "تحويل" | "إعادة" | "أخرى";
type TicketCounts = { new: number; contacted: number; done: number; rejected: number; total: number };
type AgentPerf = {
  agentId: number; name: string;
  counts: { total: number; active: number; online: number | null; source: string } | null;
  tickets: { byStatus: TicketCounts; byType: Record<string, number> } | null;
  field: { completed: number; avgSec: number | null; slaPct: number | null; byFamily: Record<Family, number> } | null;
};
type Summary = {
  counts: { subscribers: number; active: number; online: number } | null;
  tickets: TicketCounts | null;
  field: { completed: number; avgSec: number | null; slaPct: number | null; needsFollowup: number } | null;
};
type Resp = { at: number; view: "tickets" | "field" | "both"; agents: AgentPerf[]; summary: Summary; from: string; to: string };

const FAMILIES: Family[] = ["تنصيب", "صيانة", "توصيل", "تحويل", "إعادة", "أخرى"];
const FAMILY_COLOR: Record<Family, string> = {
  "تنصيب": "#c47b04", "صيانة": "#2f62a8", "توصيل": "#0d96b0", "تحويل": "#7053b3", "إعادة": "#b3496b", "أخرى": "#94a3b8",
};

const ar = (n: number) => n.toLocaleString("en-US");
function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.round(sec / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)} س` : `${m} د`;
}
function slaPill(pct: number | null) {
  if (pct == null) return <span className="text-slate-400">—</span>;
  const cls = pct >= 90 ? "bg-emerald-100 text-emerald-700" : pct >= 75 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  const ic = pct >= 90 ? "✓" : pct >= 75 ? "◐" : "⚠";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>{ic} {pct}%</span>;
}

export default function AgentPerfTab() {
  const [period, setPeriod] = useState<"day" | "month" | "range">("month");
  const [d1, setD1] = useState("");
  const [d2, setD2] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("completed");

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ period });
    if (period === "range" && d1 && d2) { qs.set("d1", d1); qs.set("d2", d2); }
    fetch(`/api/company/agent-performance?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setData(d); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [period, d1, d2]);
  useEffect(() => { if (period !== "range" || (d1 && d2)) load(); }, [load, period, d1, d2]);

  const view = data?.view ?? "both";
  const hasField = view === "field" || view === "both";
  const hasTickets = view === "tickets" || view === "both";

  const sortOptions = useMemo(() => {
    const o: { v: string; t: string }[] = [];
    if (hasField) o.push({ v: "completed", t: "📦 الأكثر إنجازاً" }, { v: "sla", t: "🎯 الأعلى التزاماً" }, { v: "avg", t: "⏱️ الأسرع" });
    if (hasTickets) o.push({ v: "subs", t: "👥 الأكثر مشتركين" }, { v: "tickets", t: "📥 الأكثر تذاكر" });
    o.push({ v: "name", t: "🔤 الاسم" });
    return o;
  }, [hasField, hasTickets]);
  useEffect(() => { if (!sortOptions.some((o) => o.v === sort)) setSort(sortOptions[0]?.v ?? "name"); }, [sortOptions, sort]);

  const rows = useMemo(() => {
    let a = [...(data?.agents ?? [])];
    const qq = q.trim();
    if (qq) a = a.filter((x) => x.name.includes(qq));
    const metric = (x: AgentPerf, m: string): number => {
      if (m === "completed") return x.field?.completed ?? 0;
      if (m === "sla") return x.field?.slaPct ?? -1;
      if (m === "avg") return x.field?.avgSec != null ? -x.field.avgSec : -Infinity; // faster first
      if (m === "subs") return x.counts?.total ?? 0;
      if (m === "tickets") return x.tickets?.byStatus.total ?? 0;
      return 0;
    };
    if (sort === "name") a.sort((x, y) => x.name.localeCompare(y.name, "ar"));
    else a.sort((x, y) => metric(y, sort) - metric(x, sort));
    return a;
  }, [data, q, sort]);

  const s = data?.summary;
  const tiles: { icon: string; label: string; value: string; tone?: "slate" | "amber" | "emerald" }[] = [];
  if (s?.field) tiles.push(
    { icon: "📦", label: "المُنجَز", value: ar(s.field.completed) },
    { icon: "⏱️", label: "متوسط الزمن", value: fmtDur(s.field.avgSec) },
    { icon: "🎯", label: "الالتزام بالمهلة", value: s.field.slaPct != null ? `${s.field.slaPct}%` : "—" },
    { icon: "⚠️", label: "بحاجة لمتابعة", value: ar(s.field.needsFollowup), tone: s.field.needsFollowup > 0 ? "amber" : "slate" },
  );
  if (s?.counts) tiles.push(
    { icon: "👥", label: "المشتركون", value: ar(s.counts.subscribers) },
    { icon: "🟢", label: "الأكتف", value: ar(s.counts.active) },
    { icon: "📶", label: "المتصلون", value: ar(s.counts.online) },
  );
  if (s?.tickets && !s?.counts) tiles.push({ icon: "📥", label: "التذاكر", value: ar(s.tickets.total) });
  else if (s?.tickets) tiles.push({ icon: "📥", label: "التذاكر", value: ar(s.tickets.total) }, { icon: "✅", label: "تذاكرُ أُنجزت", value: ar(s.tickets.done) });

  const noSlaYet = hasField && s?.field != null && s.field.slaPct == null;

  return (
    <div className="space-y-4">
      {/* فلترُ الفترة */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
          {([["day", "اليوم"], ["month", "هذا الشهر"], ["range", "بين تاريخين"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={`rounded-lg px-3 py-1.5 transition ${period === k ? "bg-[#16213e] text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
          ))}
        </div>
        {period === "range" && (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>من</span>
            <input type="date" value={d1} onChange={(e) => setD1(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
            <span>إلى</span>
            <input type="date" value={d2} onChange={(e) => setD2(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
          </div>
        )}
        {loading && <span className="text-xs text-slate-400">جارٍ التحميل…</span>}
      </div>

      {/* بطاقاتُ المؤشّرات */}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-lg">{t.icon}</span>
                <span className={`text-2xl font-extrabold ${t.tone === "amber" ? "text-amber-600" : t.tone === "emerald" ? "text-emerald-600" : "text-slate-800"}`} dir="ltr">{t.value}</span>
              </div>
              <div className="mt-1 text-[11px] font-semibold text-slate-500">{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* وسيلةُ الأنواع */}
      {hasField && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-500">أنواع البطاقات:</span>
          {FAMILIES.slice(0, 5).map((f) => (
            <span key={f} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FAMILY_COLOR[f] }} />{f}</span>
          ))}
        </div>
      )}

      {/* الجدول */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-extrabold text-slate-800">أداء الوكلاء</div>
            <div className="text-[11px] text-slate-500">المعروض {rows.length} وكيلاً</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ابحث باسم الوكيل…" className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-700">
              {sortOptions.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500">
                <th className="p-2 text-center">#</th>
                <th className="p-2">الوكيل</th>
                {hasTickets && <th className="p-2 text-center">كلّي</th>}
                {hasTickets && <th className="p-2 text-center">أكتف</th>}
                {hasTickets && <th className="p-2 text-center">متصل</th>}
                {hasTickets && <th className="p-2 text-center">التذاكر</th>}
                {hasField && <th className="p-2 text-center">المُنجَز</th>}
                {hasField && <th className="p-2">التوزيع</th>}
                {hasField && <th className="p-2 text-center">متوسط الزمن</th>}
                {hasField && <th className="p-2 text-center">الالتزام</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const fieldTot = a.field ? FAMILIES.reduce((x, f) => x + a.field!.byFamily[f], 0) : 0;
                return (
                  <tr key={a.agentId} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="p-2 text-center text-[11px] font-bold text-slate-400">{i + 1}</td>
                    <td className="p-2 font-semibold text-slate-800">{a.name}</td>
                    {hasTickets && <td className="p-2 text-center tabular-nums text-slate-700" dir="ltr">{a.counts ? ar(a.counts.total) : "—"}</td>}
                    {hasTickets && <td className="p-2 text-center tabular-nums text-emerald-700" dir="ltr">{a.counts ? ar(a.counts.active) : "—"}</td>}
                    {hasTickets && <td className="p-2 text-center tabular-nums text-sky-700" dir="ltr">{a.counts?.online != null ? ar(a.counts.online) : "—"}</td>}
                    {hasTickets && (
                      <td className="p-2 text-center text-[11px]">
                        {a.tickets && a.tickets.byStatus.total > 0
                          ? <span><b className="text-slate-700">{ar(a.tickets.byStatus.total)}</b>{a.tickets.byStatus.done > 0 && <span className="text-emerald-600"> · {ar(a.tickets.byStatus.done)}✓</span>}{a.tickets.byStatus.new > 0 && <span className="text-amber-600"> · {ar(a.tickets.byStatus.new)}🆕</span>}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasField && <td className="p-2 text-center font-bold tabular-nums text-slate-800" dir="ltr">{a.field ? ar(a.field.completed) : "—"}</td>}
                    {hasField && (
                      <td className="p-2">
                        {fieldTot > 0 ? (
                          <div className="flex h-3.5 min-w-[120px] overflow-hidden rounded bg-slate-100">
                            {FAMILIES.map((f) => a.field!.byFamily[f] > 0 && (
                              <span key={f} title={`${f}: ${a.field!.byFamily[f]}`} style={{ background: FAMILY_COLOR[f], flexGrow: a.field!.byFamily[f] }} />
                            ))}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasField && <td className="p-2 text-center tabular-nums text-slate-600" dir="ltr">{a.field ? fmtDur(a.field.avgSec) : "—"}</td>}
                    {hasField && <td className="p-2 text-center">{a.field ? slaPill(a.field.slaPct) : "—"}</td>}
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={2 + (hasTickets ? 4 : 0) + (hasField ? 4 : 0)} className="py-10 text-center text-sm text-slate-400">لا بيانات في هذه الفترة</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {noSlaYet && (
          <div className="mt-3 rounded-lg bg-sky-50 p-2 text-[11px] text-sky-700">
            🎯 «الالتزام بالمهلة» يبدأ بالتراكم من تفعيل الميزة — البطاقاتُ المُنجَزة قبلها بلا ختمِ وقتٍ فلا تدخل النسبة.
          </div>
        )}
      </div>
    </div>
  );
}
