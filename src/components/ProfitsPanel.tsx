"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

// ═════ 📈 أرباحُ الشركة — لوحةٌ للقراءة لا قيدٌ ماليّ (طلبُ محمد 2026-08-22) ═════
// خمسةُ مربّعات: أربعةٌ متساويةٌ تُضغَط فتفتح تفصيلَها، والخامسُ **صافي الشهر** ومعه
// زرُّ «شهر جديد». والمدى ثلاثةُ أوضاع: الفترةُ الجارية · **شهريٌّ بلا كتابة تواريخ** ·
// مخصَّصٌ بتنبيهٍ إن خالف طولَ الشهر الفعليّ.
// 📱 وعلى الهاتف: المربّعاتُ ٢×٢ والصافي عريضٌ تحتها، والإعدادُ بطاقاتٌ مكدّسة.

type Box = { count: number; months: number; profit: number; deduct: number; rows: Row[] };
type Row = {
  netUser: string | null; name: string | null; towerId: number; cabinet: number;
  packageName: string | null; months: number; at: string | null;
  profit: number; deduct: number; estimated?: boolean;
};
type Report = {
  from: string; to: string; label: string; warning: string | null; mode: string; monthValue: string;
  dormant: boolean; net: number;
  boxes: { actIn: Box; actExt: Box; instIn: Box; instExt: Box };
  period: { from: string; to: string; label: string; ended: boolean; epoch: string };
  view?: { mode?: string; month?: string; from?: string; to?: string; tower?: number } | null;
};
type Pkg = { id: number; name: string | null; priceDinar: number | null };
type RuleRow = { towerId: number; cabinet: number; kind: string; packageId: number; mode: string | null; percent: number | null; amount: number | null };
type RulesData = { towers: { id: number; name: string | null }[]; packages: Pkg[]; cabinets: Record<string, number[]>; rules: RuleRow[]; dormant: boolean };

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
// 📅 أشهرُ الاختيار بأسمائها — «أرباحُ الشهر السابع» أوضحُ من خانةٍ خامٍّ بصيغة 2026-07
const AR_MONTHS = ["الأوّل", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
function lastMonths(count = 12): { v: string; t: string }[] {
  const now = new Date(Date.now() + 3 * 3600_000); // بتوقيت بغداد
  const out: { v: string; t: string }[] = [];
  for (let i = 0; i < count; i++) {
    const y = now.getUTCFullYear(), m = now.getUTCMonth() - i;
    const d = new Date(Date.UTC(y, m, 1));
    out.push({
      v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      t: `الشهر ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    });
  }
  return out;
}
const BOXES = [
  { k: "actIn", icon: "⚡", t: "تفعيلات داخل المكتب", unit: "شهر" },
  { k: "actExt", icon: "🌐", t: "تفعيلات خارجية", unit: "شهر" },
  { k: "instIn", icon: "🛠️", t: "تنصيبات داخل المكتب", unit: "تنصيب" },
  { k: "instExt", icon: "🏢", t: "تنصيبات خارجية", unit: "تنصيب" },
] as const;

export default function ProfitsPanel() {
  const [rep, setRep] = useState<Report | null>(null);
  const [rules, setRules] = useState<RulesData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // 🗓️ وضعان لا ثلاثة (قرارُ محمد 2026-08-22): «شهريّ» افتراضاً على الشهر الحاليّ،
  //    و«مخصّص» لأيّ تاريخين. وأُلغي «الشهر الجاري» — فنقصُ أرقام هذا الشهر معلومٌ
  //    ومقبولٌ عنده لأنّ العدّ بدأ اليوم، فلا حاجةَ لوضعٍ ثالثٍ يشرحه.
  const [mode, setMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cfg, setCfg] = useState(false);
  const [tower, setTower] = useState(0); // 0 = كلُّ المكاتب
  const restored = useRef(false); // استُعيد الاختيارُ المحفوظُ مرّةً واحدةً لا مع كلّ جلب

  const load = useCallback(async () => {
    const base = mode === "month" && month ? `month=${month}`
      : mode === "custom" && from && to ? `from=${from}&to=${to}` : "";
    const q = [base, tower ? `tower=${tower}` : ""].filter(Boolean).join("&");
    // ⏳ مؤشّرُ الانتظار بعد ١٥٠ مل — فلا يومض للنداءات السريعة، ولا يُضبَط تزامنيّاً
    //    داخل الأثر (نمطُ المشروع يمنعه لأنّه يُطلق تصييراً متتالياً).
    const t = setTimeout(() => setBusy(true), 150);
    try {
      const r = await fetch(`/api/manager/profits${q ? "?" + q : ""}`, { credentials: "same-origin" });
      if (r.ok) {
        const d = (await r.json()) as Report;
        setRep(d);
        // 💾 أوّلُ فتحٍ: يُستعاد اختيارُ العرض المحفوظُ على الحساب (شهريّ/مخصّص + المكتب)
        if (!restored.current) {
          restored.current = true;
          const v = d.view;
          if (v?.mode === "month" && v.month) { setMonth(v.month); setMode("month"); }
          else if (v?.mode === "custom" && v.from && v.to) { setFrom(v.from); setTo(v.to); setMode("custom"); }
          if (v && Number(v.tower)) setTower(Number(v.tower));
        }
      }
    } catch { /* صمتٌ — تبقى الأرقامُ السابقة */ }
    finally { clearTimeout(t); setBusy(false); }
  }, [mode, month, from, to, tower]);

  // 🔄 الجلبُ في أثرٍ واحدٍ عبر دالّةٍ مُذكَّرة — لا ضبطَ حالةٍ مباشرةً داخل الأثر
  const loadRules = useCallback(async () => {
    try {
      const r = await fetch("/api/manager/profit-rules", { credentials: "same-origin" });
      if (r.ok) setRules(await r.json());
    } catch { /* صمتٌ — الإعدادُ يبقى مطويّاً */ }
  }, []);
  // جلبُ البياناتِ عند الفتح وعند تغيّر المدى — نمطُ بقيّة صفحات المشروع.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- جلبٌ شبكيٌّ لا ضبطَ حالةٍ متزامن
  useEffect(() => { void load(); void loadRules(); }, [load, loadRules]);

  const saveTheView = async () => {
    const r = await fetch("/api/manager/profits", {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, month, from, to, tower }),
    });
    setMsg(r.ok ? "✅ ثُبِّت هذا العرضُ على حسابك" : "⛔ تعذّر الحفظ");
    setTimeout(() => setMsg(""), 4000);
  };

  const canNewMonth = !!rep?.period.ended;
  const newMonth = async () => {
    // 🔒 لا يُصفَّر شهرٌ في منتصفه (تصحيحُ محمد) — والخادمُ يرفضه أيضاً حكماً
    if (!canNewMonth) { setMsg("⛔ لم ينتهِ الشهرُ الحاليُّ بعد"); setTimeout(() => setMsg(""), 4000); return; }
    if (!confirm("بدءُ شهرٍ جديد: تُصفَّر الأرقامُ المعروضةُ وتبدأ فترةٌ جديدة.\nولا يُحذَف شيءٌ — القديمُ يبقى بالبحث بين تاريخين. متابعة؟")) return;
    setBusy(true);
    const r = await fetch("/api/manager/profits", { method: "POST", credentials: "same-origin" });
    setBusy(false);
    // بعد بدء الشهر الجديد: تُعرَض أرقامُه هو (الشهرُ الجاري في التقويم)
    if (r.ok) {
      const d = (await r.json().catch(() => null)) as { period?: { from?: string } } | null;
      if (d?.period?.from) {
        const f = new Date(d.period.from);
        setMonth(`${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`);
      }
      setMode("month"); setMsg("✅ بدأ شهرٌ جديد"); void load(); setTimeout(() => setMsg(""), 4000);
    }
  };

  const B = rep?.boxes;
  const net = rep?.net ?? 0;

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-800">📈 أرباح الشركة</h3>
        <span className="text-[11px] text-slate-400">أرقامٌ للقراءة فقط — لا تدخل صندوقاً ولا حساباً</span>
      </div>

      {rep?.dormant && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
          ⏳ جدولُ قواعد الربح غيرُ مُهيَّأ بعد — الصقِ السطرَ الجاهز في القاعدة (docs/sql/profit-rules.sql) ثمّ أعد الفتح. والعدّاداتُ تعمل الآن بربحٍ صفر.
        </div>
      )}

      {/* ── المدى: جارية · شهريّ · مخصّص ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-bold text-slate-700">المدّة:</span>
        {([
          ["month", "شهريّ", "اختر شهراً فتُضبَط بدايتُه ونهايتُه وحدَهما"],
          ["custom", "مخصّص", "اختر أيَّ تاريخين"],
        ] as const).map(([m, t, tip]) => (
          <button key={m} onClick={() => setMode(m)} title={tip}
            className={`rounded-lg border px-3 py-1.5 font-bold transition ${mode === m ? "border-mynet-blue bg-mynet-blue text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t}
          </button>
        ))}
        {mode === "month" && (
          <select value={month || rep?.monthValue || ""} onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-mynet-blue/40 bg-blue-50 px-2 py-1.5 font-bold text-slate-700">
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
        {/* 🏢 مكتبٌ واحدٌ أو الكلّ */}
        <select value={tower} onChange={(e) => setTower(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2 py-1.5 font-bold">
          <option value={0}>كلّ المكاتب</option>
          {(rules?.towers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
        </select>
        <button onClick={() => void saveTheView()} disabled={busy}
          title="يُثبِّت هذا الاختيارَ على حسابك فيفتح عليه في كلّ مرّة (وفي الهاتف أيضاً)"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700 hover:bg-emerald-100">
          💾 حفظُ العرض
        </button>
        {rep && <span className="text-slate-500">{formatDate(rep.from)} ← {formatDate(rep.to)}</span>}
        {busy && <span className="text-slate-400">…</span>}
      </div>

      {rep?.warning && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">
          {rep.warning.replace(/\*\*/g, "")}
        </div>
      )}
      {rep?.period.ended && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-800">
          🗓️ انقضى شهرُ هذه الفترة — والأرقامُ الجديدةُ تتراكم محفوظةً. اضغط «شهر جديد» لتظهر.
        </div>
      )}
      {msg && <div className="mb-3 text-[12px] font-bold text-emerald-700">{msg}</div>}

      {/* ── المربّعات الأربعة (٢×٢ على الهاتف · ٤ على الشاشة) ── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {BOXES.map((b) => {
          const box = B?.[b.k];
          const on = open === b.k;
          return (
            <button key={b.k} onClick={() => setOpen(on ? null : b.k)}
              className={`rounded-xl border p-3 text-center transition ${on ? "border-mynet-blue bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}>
              <div className="text-lg">{b.icon}</div>
              <div className="text-2xl font-extrabold text-slate-800" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(b.k.startsWith("act") ? box?.months ?? 0 : box?.count ?? 0)}
              </div>
              <div className="text-[11px] font-bold text-slate-600">{b.t}</div>
              <div className="mt-1 text-[11px] text-emerald-700">{fmt(box?.profit ?? 0)} د.ع</div>
              {(box?.deduct ?? 0) > 0 && <div className="text-[10px] text-rose-600">− استقطاع {fmt(box?.deduct ?? 0)}</div>}
            </button>
          );
        })}
      </div>

      {/* ── الصافي + شهر جديد ── */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-4 py-3 text-white">
        <div>
          <div className="text-[11px] opacity-90">{rep?.label ?? "الأرباح"}</div>
          <div className="text-2xl font-extrabold" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(net)} د.ع</div>
        </div>
        <button onClick={() => void newMonth()} disabled={busy || !canNewMonth}
          title={canNewMonth ? "بدءُ شهرٍ جديد" : "يُفتَح بعد انقضاء الشهر الحاليّ"}
          className="rounded-lg bg-white/20 px-4 py-2 text-sm font-bold hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40">
          🗓️ شهر جديد{canNewMonth ? "" : " 🔒"}
        </button>
      </div>

      {/* ── تفصيلُ المربّع المفتوح ── */}
      {open && B && (
        <div className="mt-3 max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="p-2">المشترك</th><th className="p-2">اليوزر</th><th className="p-2">الكابينة</th>
                <th className="p-2">الباقة</th><th className="p-2">المدّة</th><th className="p-2">التاريخ</th><th className="p-2">الربح</th>
              </tr>
            </thead>
            <tbody>
              {(B[open as keyof typeof B].rows ?? []).map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 font-semibold text-slate-700">{r.name ?? "—"}</td>
                  <td className="p-2 text-slate-500" dir="ltr">{r.netUser ?? "—"}</td>
                  <td className="p-2 text-slate-500">{r.cabinet ? `FDT${r.cabinet}` : "—"}</td>
                  <td className="p-2 text-slate-500">{r.packageName ?? "—"}</td>
                  <td className="p-2">{r.months}{r.estimated ? " ⁓" : ""}</td>
                  <td className="p-2 text-slate-500" dir="ltr">{r.at ? formatDate(r.at) : "—"}</td>
                  <td className="p-2 font-bold text-emerald-700">{fmt(r.profit)}{r.deduct ? ` − ${fmt(r.deduct)}` : ""}</td>
                </tr>
              ))}
              {!(B[open as keyof typeof B].rows ?? []).length && (
                <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا شيءَ في هذه الفترة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── إعدادُ الأرباح ── */}
      <button onClick={() => setCfg((v) => !v)} className="mt-3 text-[12px] font-bold text-mynet-blue hover:underline">
        ⚙️ إعدادُ الأرباح {cfg ? "▲" : "▼"}
      </button>
      {cfg && rules && <RulesEditor data={rules} onSaved={() => { void load(); }} />}
    </div>
  );
}

// ───────────────────────── إعدادُ القواعد ─────────────────────────
// كلُّ الإدخالات موجودةٌ لكنّها **مطويّةٌ في شاشةٍ واحدة**: تختار النطاق (عامّ · مكتب ·
// كابينات)، ثمّ نمطَ التفعيل (نسبة أو مبلغٌ لكلّ باقة)، ثمّ مبالغَ التنصيب والاستقطاع.
function RulesEditor({ data, onSaved }: { data: RulesData; onSaved: () => void }) {
  const [towerId, setTowerId] = useState(0);
  const [cabinet, setCabinet] = useState(0);
  const cabList = useMemo(() => (towerId ? (data.cabinets[String(towerId)] ?? []) : []), [data.cabinets, towerId]);

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px]">
      {/* النطاق: عامٌّ · مكتب · كابينة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-700">طبّق على:</span>
        <select value={towerId} onChange={(e) => { setTowerId(Number(e.target.value)); setCabinet(0); }}
          className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value={0}>كلّ المكاتب (عامّ)</option>
          {data.towers.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
        </select>
        {towerId > 0 && (
          <select value={cabinet} onChange={(e) => setCabinet(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value={0}>كلّ كابينات المكتب</option>
            {cabList.map((c) => <option key={c} value={c}>FDT{c}</option>)}
          </select>
        )}
        <span className="text-[11px] text-slate-400">الكابينةُ تغلب المكتب، والمكتبُ يغلب العامّ</span>
      </div>

      {/* 🔑 مفتاحُ النطاق يُعيد بناءَ المحرِّر — فالقيمُ المحفوظةُ تُقرأ مرّةً عند التركيب
          بلا أيّ ضبطِ حالةٍ داخل أثر (وهو ما يمنعه نمطُ المشروع). */}
      <ScopeEditor key={`${towerId}|${cabinet}`} data={data} towerId={towerId} cabinet={cabinet} onSaved={onSaved} />
    </div>
  );
}

/** محرِّرُ نطاقٍ واحد — كلُّ إدخالات محمد في شاشةٍ واحدةٍ مطويّة */
function ScopeEditor(
  { data, towerId, cabinet, onSaved }:
  { data: RulesData; towerId: number; cabinet: number; onSaved: () => void },
) {
  const mine = useMemo(
    () => data.rules.filter((r) => r.towerId === towerId && r.cabinet === cabinet),
    [data.rules, towerId, cabinet],
  );
  const head = mine.find((r) => r.kind === "act" && r.packageId === 0);
  const grabInit = (kind: string) => Object.fromEntries(
    mine.filter((r) => r.kind === kind && r.packageId > 0).map((r) => [r.packageId, String(r.amount ?? "")]),
  ) as Record<number, string>;

  const [actMode, setActMode] = useState<"percent" | "fixed">(head?.mode === "fixed" ? "fixed" : "percent");
  const [percent, setPercent] = useState(head?.percent != null ? String(head.percent) : "");
  const [actPkg, setActPkg] = useState<Record<number, string>>(() => grabInit("act"));
  const [instIn, setInstIn] = useState<Record<number, string>>(() => grabInit("instIn"));
  const [instExt, setInstExt] = useState<Record<number, string>>(() => grabInit("instExt"));
  const [deductIn, setDeductIn] = useState<Record<number, string>>(() => grabInit("deductIn"));
  const [deductExt, setDeductExt] = useState<Record<number, string>>(() => grabInit("deductExt"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const num = (m: Record<number, string>) =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [k, Number(v) || 0]));

  const save = async (reset = false) => {
    setBusy(true); setMsg("");
    const body = {
      towerId, cabinets: [cabinet], reset,
      act: { mode: actMode, percent: Number(percent) || 0, perPackage: num(actPkg) },
      instIn: num(instIn), instExt: num(instExt), deductIn: num(deductIn), deductExt: num(deductExt),
    };
    const r = await fetch("/api/manager/profit-rules", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? "✅ حُفظت" : `⛔ ${d.error ?? "تعذّر الحفظ"}`);
    if (r.ok) onSaved();
    setTimeout(() => setMsg(""), 5000);
  };

  const grid = (m: Record<number, string>, set: (v: Record<number, string>) => void, ph: string) => (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
      {data.packages.map((p) => (
        <label key={p.id} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={p.name ?? ""}>{p.name ?? `#${p.id}`}</span>
          <input type="number" value={m[p.id] ?? ""} onChange={(e) => set({ ...m, [p.id]: e.target.value })}
            placeholder={ph} className="w-16 rounded border border-slate-200 px-1 py-0.5 text-[11px]" />
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ⚡ التفعيل — نسبةٌ أو مبلغٌ لكلّ باقة */}
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <b className="text-slate-700">⚡ ربحُ التفعيل</b>
          <label className="flex items-center gap-1"><input type="radio" checked={actMode === "percent"} onChange={() => setActMode("percent")} /> نسبة ٪</label>
          {actMode === "percent" && (
            <input type="number" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="20"
              className="w-20 rounded border border-slate-300 px-2 py-1" />
          )}
          <label className="flex items-center gap-1"><input type="radio" checked={actMode === "fixed"} onChange={() => setActMode("fixed")} /> مبلغٌ لكلّ باقة</label>
        </div>
        {actMode === "fixed"
          ? grid(actPkg, setActPkg, "ربح")
          : <div className="text-[11px] text-slate-500">النسبةُ من <b>سعر بيع الباقة المسجَّل</b> (لا كلفةِ الكارت) × عددِ الأشهر</div>}
      </div>

      {/* 🛠️🏢 التنصيب: لكلّ نوعٍ **ربحُه واستقطاعُه** (تصحيحُ محمد: الاستقطاعُ يختلف بينهما) */}
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <b className="text-slate-700">🛠️ التنصيبُ داخل المكتب</b>
        <div className="mt-1.5 text-[11px] text-slate-500">الربحُ لكلّ باقة</div>
        <div className="mt-1">{grid(instIn, setInstIn, "ربح")}</div>
        <div className="mt-2 text-[11px] text-slate-500">➖ الاستقطاعُ لكلّ باقة</div>
        <div className="mt-1">{grid(deductIn, setDeductIn, "استقطاع")}</div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <b className="text-slate-700">🏢 التنصيبُ خارج المكتب</b>
        <div className="mt-1.5 text-[11px] text-slate-500">الربحُ لكلّ باقة</div>
        <div className="mt-1">{grid(instExt, setInstExt, "ربح")}</div>
        <div className="mt-2 text-[11px] text-slate-500">➖ الاستقطاعُ لكلّ باقة</div>
        <div className="mt-1">{grid(deductExt, setDeductExt, "استقطاع")}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void save(false)} disabled={busy}
          className="rounded-lg bg-mynet-blue px-4 py-2 font-bold text-white disabled:opacity-50">حفظ</button>
        <button onClick={() => void save(true)} disabled={busy}
          className="rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-600">إلغاءُ قواعد هذا النطاق</button>
        {msg && <span className="font-bold text-slate-700">{msg}</span>}
      </div>
    </div>
  );
}
