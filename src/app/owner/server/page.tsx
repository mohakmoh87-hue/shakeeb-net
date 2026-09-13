"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";

type Metrics = {
  server: {
    hostname: string; uptimeSec: number; cpuCount: number; cpuModel: string; load: number[];
    ramTotal: number; ramFree: number; ramUsed: number;
    disk: { totalBytes: number; usedBytes: number; freeBytes: number; pct: string } | null;
  };
  postgres: {
    sizeBytes: number; connTotal: number; connActive: number; connIdle: number; connIdleTx: number;
    connMax: number; cacheHitPct: number; tables: { table: string; bytes: number; rows: number }[];
  };
  services: Record<string, string>;
  at: number;
};

const fmtBytes = (b: number) => {
  if (!b || b < 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}ي ${h}س` : h ? `${h}س ${m}د` : `${m}د`;
};
const barColor = (pct: number) => (pct >= 85 ? "bg-rose-500" : pct >= 65 ? "bg-amber-500" : "bg-emerald-500");

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full ${barColor(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function Gauge({ label, usedLabel, totalLabel, pct }: { label: string; usedLabel: string; totalLabel: string; pct: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-700">{label}</span>
        <span className="text-xs text-slate-400" dir="ltr">{Math.round(pct)}%</span>
      </div>
      <div className="mb-2 text-lg font-extrabold text-slate-800" dir="ltr">{usedLabel} <span className="text-sm font-normal text-slate-400">/ {totalLabel}</span></div>
      <Bar pct={pct} />
    </div>
  );
}

const SERVICE_LABEL: Record<string, string> = {
  "mynet-web": "التطبيق (إنتاج)", "mynet-web-test": "التطبيق (تجربة)", postgresql: "قاعدة البيانات", "mynet-backup.timer": "النسخ الاحتياطيّ",
};

export default function OwnerServerPage() {
  const [tab, setTab] = useState<"metrics" | "logs" | "sql" | "actions">("metrics");
  const [m, setM] = useState<Metrics | null>(null);
  const [at, setAt] = useState<Date | null>(null);

  const loadMetrics = useCallback(() => {
    fetch("/api/owner/server-metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setM(d); setAt(new Date()); } })
      .catch(() => {});
  }, []);
  usePolling(loadMetrics, 5000, { enabled: tab === "metrics" });

  const ramPct = m ? (m.server.ramUsed / m.server.ramTotal) * 100 : 0;
  const diskPct = m?.server.disk ? (m.server.disk.usedBytes / m.server.disk.totalBytes) * 100 : 0;
  const connPct = m ? (m.postgres.connTotal / m.postgres.connMax) * 100 : 0;

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">🖥️ إدارة السيرفر</h1>
        <div className="flex items-center gap-2">
          {at && <span className="text-[11px] text-slate-400">آخر تحديث {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          <a href="/owner" className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200">↩ لوحة المالك</a>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {([["metrics", "📊 المقاييس"], ["logs", "📜 السجلّات"], ["sql", "🗄️ SQL"], ["actions", "⚙️ إجراءات"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "metrics" && (
        !m ? <div className="py-16 text-center text-sm text-slate-400">…جارٍ قراءة المقاييس</div> : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-l from-slate-50 to-white p-4 text-sm text-slate-600">
              <b className="text-slate-800">{m.server.hostname}</b> · {m.server.cpuModel} · {m.server.cpuCount} خيط · تشغيلٌ منذ {fmtUptime(m.server.uptimeSec)} · الحمل <span dir="ltr">{m.server.load.join(" · ")}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Gauge label="الذاكرة (RAM)" usedLabel={fmtBytes(m.server.ramUsed)} totalLabel={fmtBytes(m.server.ramTotal)} pct={ramPct} />
              {m.server.disk
                ? <Gauge label="القرص" usedLabel={fmtBytes(m.server.disk.usedBytes)} totalLabel={fmtBytes(m.server.disk.totalBytes)} pct={diskPct} />
                : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-400">القرص: غير متاح</div>}
              <Gauge label="اتصالات القاعدة" usedLabel={String(m.postgres.connTotal)} totalLabel={String(m.postgres.connMax)} pct={connPct} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-blue-50 p-3 text-center ring-1 ring-blue-100"><div className="text-[11px] font-semibold text-blue-500">نشِطة</div><div className="text-xl font-extrabold text-blue-700" dir="ltr">{m.postgres.connActive}</div></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200"><div className="text-[11px] font-semibold text-slate-500">خاملة</div><div className="text-xl font-extrabold text-slate-700" dir="ltr">{m.postgres.connIdle}</div></div>
              <div className="rounded-xl bg-amber-50 p-3 text-center ring-1 ring-amber-100"><div className="text-[11px] font-semibold text-amber-600">خاملة بمعاملة</div><div className="text-xl font-extrabold text-amber-700" dir="ltr">{m.postgres.connIdleTx}</div></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center ring-1 ring-emerald-100"><div className="text-[11px] font-semibold text-emerald-600">إصابةُ الكاش</div><div className="text-xl font-extrabold text-emerald-700" dir="ltr">{m.postgres.cacheHitPct}%</div></div>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(m.services).map(([s, st]) => (
                <span key={s} className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${st === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : st === "inactive" ? "bg-slate-100 text-slate-500 ring-slate-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
                  {st === "active" ? "🟢" : st === "inactive" ? "⚪" : "🔴"} {SERVICE_LABEL[s] ?? s}: {st}
                </span>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">
                <span>الجداول ({m.postgres.tables.length}) — القاعدةُ {fmtBytes(m.postgres.sizeBytes)}</span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-slate-400"><tr><th className="p-2 text-right font-medium">الجدول</th><th className="p-2 text-left font-medium">الحجم</th><th className="p-2 text-left font-medium">الصفوف</th></tr></thead>
                  <tbody>
                    {m.postgres.tables.map((t) => (
                      <tr key={t.table} className="border-t border-slate-50">
                        <td className="p-2 font-semibold text-slate-700" dir="ltr">{t.table}</td>
                        <td className="p-2 text-left tabular-nums text-slate-600" dir="ltr">{fmtBytes(t.bytes)}</td>
                        <td className="p-2 text-left tabular-nums text-slate-500" dir="ltr">{t.rows.toLocaleString("en-US")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}

      {tab === "logs" && <LogsTab />}
      {tab === "sql" && <SqlTab />}
      {tab === "actions" && <ActionsTab />}
    </div>
  );
}

function LogsTab() {
  const services = ["mynet-web-test", "mynet-web", "postgresql", "mynet-backup"];
  const [svc, setSvc] = useState("mynet-web-test");
  const [lines, setLines] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback((s: string) => {
    setBusy(true); setErr("");
    fetch(`/api/owner/server-logs?service=${encodeURIComponent(s)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setLines(d.lines ?? []); if (d.error) setErr(d.error); })
      .catch(() => setErr("تعذّر الجلب"))
      .finally(() => setBusy(false));
  }, []);
  usePolling(() => load(svc), 10_000);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={svc} onChange={(e) => { setSvc(e.target.value); load(e.target.value); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          {services.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s] ?? s}</option>)}
        </select>
        <button onClick={() => load(svc)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700">↻ تحديث</button>
        {busy && <span className="text-xs text-slate-400">…</span>}
      </div>
      {err && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{err}</div>}
      <pre className="max-h-[65vh] overflow-auto rounded-2xl border border-slate-800 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100" dir="ltr">{lines.join("\n") || "—"}</pre>
    </div>
  );
}

function SqlTab() {
  const [query, setQuery] = useState("SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setErr(""); setInfo("");
    try {
      const r = await fetch("/api/owner/server-sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "فشل الاستعلام"); setRows([]); setCols([]); }
      else {
        const rs: Record<string, unknown>[] = d.rows ?? [];
        setRows(rs); setCols(rs.length ? Object.keys(rs[0]) : []);
        setInfo(`${d.count} صفّاً${d.truncated ? " (عُرض أوّل ٥٠٠)" : ""}`);
      }
    } catch { setErr("تعذّر التنفيذ"); }
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">للقراءة فقط — يُنفَّذ داخل معاملةٍ READ ONLY، فأيُّ كتابةٍ تُرفَض من القاعدة نفسها.</div>
      <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={4} dir="ltr" spellCheck={false}
        className="w-full rounded-xl border border-slate-300 bg-slate-900 p-3 font-mono text-[13px] text-slate-100 outline-none focus:border-sky-500" />
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">{busy ? "…" : "▶ تشغيل"}</button>
        {info && <span className="text-xs text-slate-500">{info}</span>}
      </div>
      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" dir="ltr">{err}</div>}
      {cols.length > 0 && (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm" dir="ltr">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{cols.map((c) => <th key={c} className="p-2 text-left font-medium">{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-50">
                  {cols.map((c) => <td key={c} className="whitespace-nowrap p-2 text-slate-700">{row[c] === null ? "∅" : typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionsTab() {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  async function run(action: string, label: string) {
    const ownerPassword = prompt(`🔒 أدخل كلمة سرّ المالك لتأكيد: ${label}`);
    if (!ownerPassword) return;
    setBusy(action); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/owner/server-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ownerPassword }) });
      const d = await r.json();
      if (r.ok) setMsg(d.result ?? "تمّ"); else setErr(d.error ?? "فشل الإجراء");
    } catch { setErr("تعذّر التنفيذ"); }
    setBusy("");
  }
  const A = ({ action, label, desc, cls }: { action: string; label: string; desc: string; cls: string }) => (
    <button onClick={() => run(action, label)} disabled={!!busy}
      className={`rounded-2xl border p-4 text-right shadow-sm disabled:opacity-60 ${cls}`}>
      <div className="text-base font-extrabold">{busy === action ? "…" : label}</div>
      <div className="mt-1 text-xs opacity-80">{desc}</div>
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">كلُّ إجراءٍ يتطلّب كلمةَ سرّ المالك ويُسجَّل في التدقيق.</div>
      {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">✓ {msg}</div>}
      {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <A action="vacuum" label="🧹 VACUUM ANALYZE" desc="تنظيفٌ وتحديثُ إحصاءات القاعدة (يحرّر مساحةً ميتة)" cls="border-emerald-200 bg-emerald-50 text-emerald-800" />
        <A action="analyze" label="📊 ANALYZE" desc="تحديثُ إحصاءات المخطِّط فقط (أسرع)" cls="border-sky-200 bg-sky-50 text-sky-800" />
        <A action="sync-now" label="🔄 مزامنةُ الساس الآن" desc="مزامنةُ كلّ المكاتب في الخلفيّة (تحتاج إنترنت الساس)" cls="border-indigo-200 bg-indigo-50 text-indigo-800" />
      </div>
    </div>
  );
}
