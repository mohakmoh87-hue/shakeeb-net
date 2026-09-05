"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

// ═════ 🏷️ أرباحُ المبيع — لوحةٌ للقراءة (طلبُ محمد 2026-09-05) ═════
// أربعةُ مربّعات تُضغَط فتفتح تفصيلَها (انتشار · توصيل · مبيعات · نثرية) وخامسٌ صافي + «شهر جديد».
// شهريٌّ (بحالةٍ مستقلّةٍ عن أرباح الشركة) + بحثٌ بين تاريخين بأثرٍ رجعيّ + اختيارُ مكتب/مستخدم.

type Box = { count: number; total: number; rows: Row[] };
type Row = { name: string; sub: string | null; office: string; user: string | null; at: string | null; amount: number };
type UserRow = { userId: number; name: string; spread: number; delivery: number; sales: number; petty: number; net: number };
type Report = {
  from: string; to: string; label: string; warning: string | null; mode: string; monthValue: string; net: number; tower: number;
  boxes: { spread: Box; delivery: Box; sales: Box; petty: Box };
  byUser: UserRow[];
  offices: { id: number; name: string }[];
  period: { from: string; to: string; label: string; ended: boolean; epoch: string };
  view?: { mode?: string; month?: string; from?: string; to?: string; tower?: number } | null;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
const AR_MONTHS = ["الأوّل", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
function lastMonths(count = 12): { v: string; t: string }[] {
  const now = new Date(Date.now() + 3 * 3600_000);
  const out: { v: string; t: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, t: `الشهر ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}
const BOXES = [
  { k: "spread", icon: "📡", t: "أرباح انتشار" },
  { k: "delivery", icon: "🚚", t: "أرباح التوصيل" },
  { k: "sales", icon: "🛒", t: "ربح المبيعات" },
  { k: "petty", icon: "🧾", t: "النثرية" },
] as const;

export default function SaleProfitsPanel() {
  const [rep, setRep] = useState<Report | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tower, setTower] = useState(0);
  const restored = useRef(false);

  const load = useCallback(async () => {
    const base = mode === "month" && month ? `month=${month}` : mode === "custom" && from && to ? `from=${from}&to=${to}` : "";
    const q = [base, tower ? `tower=${tower}` : ""].filter(Boolean).join("&");
    const t = setTimeout(() => setBusy(true), 150);
    try {
      const r = await fetch(`/api/manager/sale-profits${q ? "?" + q : ""}`, { credentials: "same-origin" });
      if (r.ok) {
        const d = (await r.json()) as Report;
        setRep(d);
        if (!restored.current) {
          restored.current = true;
          const v = d.view;
          if (v?.mode === "month" && v.month) { setMonth(v.month); setMode("month"); }
          else if (v?.mode === "custom" && v.from && v.to) { setFrom(v.from); setTo(v.to); setMode("custom"); }
          if (v && Number(v.tower)) setTower(Number(v.tower));
        }
      }
    } catch { /* صمت */ }
    finally { clearTimeout(t); setBusy(false); }
  }, [mode, month, from, to, tower]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- جلبٌ شبكيٌّ لا ضبطَ حالةٍ متزامن
  useEffect(() => { void load(); }, [load]);

  const saveTheView = async () => {
    const r = await fetch("/api/manager/sale-profits", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, month, from, to, tower }) });
    setMsg(r.ok ? "✅ ثُبِّت هذا العرضُ على حسابك" : "⛔ تعذّر الحفظ");
    setTimeout(() => setMsg(""), 4000);
  };

  const canNewMonth = !!rep?.period.ended;
  const newMonth = async () => {
    if (!canNewMonth) { setMsg("⛔ لم ينتهِ الشهرُ الحاليُّ بعد"); setTimeout(() => setMsg(""), 4000); return; }
    if (!confirm("بدءُ شهرٍ جديد لأرباح المبيع: تُصفَّر الأرقامُ المعروضةُ وتبدأ فترةٌ جديدة.\nولا يُحذَف شيءٌ — القديمُ يبقى بالبحث بين تاريخين. متابعة؟")) return;
    setBusy(true);
    const r = await fetch("/api/manager/sale-profits", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "newMonth" }) });
    setBusy(false);
    if (r.ok) {
      const d = (await r.json().catch(() => null)) as { period?: { from?: string } } | null;
      if (d?.period?.from) { const f = new Date(d.period.from); setMonth(`${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`); }
      setMode("month"); setMsg("✅ بدأ شهرٌ جديد"); void load(); setTimeout(() => setMsg(""), 4000);
    }
  };

  const B = rep?.boxes;
  const net = rep?.net ?? 0;

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-800">🏷️ أرباح المبيع</h3>
        <span className="text-[11px] text-slate-400">أرقامٌ للقراءة فقط</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-bold text-slate-700">المدّة:</span>
        {([["month", "شهريّ"], ["custom", "مخصّص"]] as const).map(([m, t]) => (
          <button key={m} onClick={() => setMode(m)}
            className={`rounded-lg border px-3 py-1.5 font-bold transition ${mode === m ? "border-mynet-blue bg-mynet-blue text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>{t}</button>
        ))}
        {mode === "month" && (
          <select value={month || rep?.monthValue || ""} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-mynet-blue/40 bg-blue-50 px-2 py-1.5 font-bold text-slate-700">
            {lastMonths().map((m) => <option key={m.v} value={m.v}>{m.t}</option>)}
          </select>
        )}
        {mode === "custom" && (
          <span className="flex flex-wrap items-center gap-1 rounded-lg border border-mynet-blue/40 bg-blue-50 px-2 py-1">
            <b className="text-slate-700">من</b>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
            <b className="text-slate-700">إلى</b>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1" />
          </span>
        )}
        <select value={tower} onChange={(e) => setTower(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1.5 font-bold">
          <option value={0}>كلّ المكاتب</option>
          {(rep?.offices ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button onClick={() => void saveTheView()} disabled={busy} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700 hover:bg-emerald-100">💾 حفظُ العرض</button>
        {rep && <span className="text-slate-500">{formatDate(rep.from)} ← {formatDate(rep.to)}</span>}
        {busy && <span className="text-slate-400">…</span>}
      </div>

      {rep?.warning && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">{rep.warning.replace(/\*\*/g, "")}</div>}
      {rep?.period.ended && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-800">🗓️ انقضى شهرُ هذه الفترة — والأرقامُ الجديدةُ تتراكم محفوظةً. اضغط «شهر جديد» لتظهر.</div>}
      {msg && <div className="mb-3 text-[12px] font-bold text-emerald-700">{msg}</div>}

      {/* المربّعات الأربعة (٢×٢ على الهاتف · ٤ على الشاشة) */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {BOXES.map((b) => {
          const box = B?.[b.k];
          const on = open === b.k;
          const negative = (box?.total ?? 0) < 0;
          return (
            <button key={b.k} onClick={() => setOpen(on ? null : b.k)}
              className={`rounded-xl border p-3 text-center transition ${on ? "border-mynet-blue bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}>
              <div className="text-lg">{b.icon}</div>
              <div className={`text-xl font-extrabold ${negative ? "text-rose-600" : "text-slate-800"}`} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(box?.total ?? 0)}</div>
              <div className="text-[11px] font-bold text-slate-600">{b.t}</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{fmt(box?.count ?? 0)} حركة</div>
            </button>
          );
        })}
      </div>

      {/* أرباحُ المبيع بحسب المستخدم المنفصل */}
      {(rep?.byUser?.length ?? 0) > 0 && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <b className="text-[13px] text-slate-700">👥 أرباحُ المبيع بحسب المستخدم</b>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="text-[10.5px] text-slate-500">
                  <th className="p-1.5 text-right">المستخدم</th><th className="p-1.5 text-right">انتشار</th><th className="p-1.5 text-right">توصيل</th>
                  <th className="p-1.5 text-right">مبيعات</th><th className="p-1.5 text-right">نثرية</th><th className="p-1.5 text-right">الصافي</th>
                </tr>
              </thead>
              <tbody>
                {rep!.byUser.map((u) => (
                  <tr key={u.userId} className="border-t border-slate-200">
                    <td className="p-1.5 font-bold text-slate-700">👤 {u.name}</td>
                    <td className="p-1.5 text-slate-600">{fmt(u.spread)}</td>
                    <td className="p-1.5 text-slate-600">{fmt(u.delivery)}</td>
                    <td className="p-1.5 text-slate-600">{fmt(u.sales)}</td>
                    <td className="p-1.5 text-rose-600">{fmt(u.petty)}</td>
                    <td className="p-1.5 font-extrabold text-slate-800">{fmt(u.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* الصافي + شهر جديد */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-4 py-3 text-white">
        <div>
          <div className="text-[11px] opacity-90">صافي أرباح المبيع — {rep?.label ?? ""}</div>
          <div className="text-2xl font-extrabold" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(net)} د.ع</div>
          <div className="text-[10px] opacity-80">انتشار + توصيل + مبيعات − نثرية</div>
        </div>
        <button onClick={() => void newMonth()} disabled={busy || !canNewMonth}
          className="rounded-lg bg-white/20 px-4 py-2 text-sm font-bold hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40">
          🗓️ شهر جديد{canNewMonth ? "" : " 🔒"}
        </button>
      </div>

      {/* تفصيلُ المربّع المفتوح */}
      {open && B && (
        <div className="mt-3 max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr><th className="p-2">البيان</th><th className="p-2">التفصيل</th><th className="p-2">المكتب</th><th className="p-2">المستخدم</th><th className="p-2">التاريخ</th><th className="p-2">المبلغ</th></tr>
            </thead>
            <tbody>
              {(B[open as keyof typeof B].rows ?? []).map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 font-semibold text-slate-700">{r.name || "—"}</td>
                  <td className="p-2 text-slate-500">{r.sub ?? "—"}</td>
                  <td className="p-2 text-slate-500">{r.office}</td>
                  <td className="p-2 text-slate-500">{r.user ?? "—"}</td>
                  <td className="p-2 text-slate-500" dir="ltr">{r.at ? formatDate(r.at) : "—"}</td>
                  <td className={`p-2 font-bold ${r.amount < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmt(r.amount)}</td>
                </tr>
              ))}
              {!(B[open as keyof typeof B].rows ?? []).length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا شيءَ في هذه الفترة</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
