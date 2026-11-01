"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

// ═════ 🔁🧰 نافذةُ «الترحيلات والذمم» — طلبُ محمد 2026-11-01 ═════
// ثلاثةُ تبويبات (ترحيلات · ذمم · كلُّ الحركات) وصفُّ بحثٍ واحد، وعمودُ «مُسجَّل/مشتَقّ»
// صريحٌ كي يُعرَف ما هو قيدٌ كُتب لحظتَه وما هو مستنتَجٌ من أثرٍ آخر.

type Row = {
  key: string; at: string; kind: string; recorded: boolean; voided: boolean;
  itemId: number | null; itemName: string; qty: number;
  fromTowerId: number | null; toTowerId: number | null;
  technicianId: number | null; technicianName: string | null;
  unitCost: number | null; total: number | null; user: string | null; note: string;
};
type Office = { id: number; name: string };
type Tech = { id: number; name: string; towerId: number | null };

const TABS = [
  { id: "transfers", label: "🔁 الترحيلات", kinds: ["TRANSFER", "SUPPORT"] },
  { id: "custody", label: "🧰 الذمم", kinds: ["GIVE", "RETURN"] },
  { id: "cardsales", label: "💰 مبيعات الذمم", kinds: ["CARD_USE"] },
  { id: "all", label: "📊 كلُّ الحركات", kinds: [] as string[] },
] as const;

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

const KIND_CLS: Record<string, string> = {
  TRANSFER: "bg-sky-100 text-sky-800", SUPPORT: "bg-indigo-100 text-indigo-800",
  GIVE: "bg-amber-100 text-amber-800", RETURN: "bg-emerald-100 text-emerald-800",
  CARD_USE: "bg-violet-100 text-violet-800", QTY_UP: "bg-teal-100 text-teal-800",
  QTY_DOWN: "bg-rose-100 text-rose-800", BUY: "bg-slate-200 text-slate-800", SELL: "bg-lime-100 text-lime-800",
};

export default function InventoryMovesModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<string>("transfers");
  const [rows, setRows] = useState<Row[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [showCost, setShowCost] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [techId, setTechId] = useState("");
  const [q, setQ] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const load = useCallback(async (tabId: string) => {
    setBusy(true); setErr("");
    const kinds = TABS.find((t) => t.id === tabId)?.kinds ?? [];
    const sp = new URLSearchParams();
    if (kinds.length) sp.set("kinds", kinds.join(","));
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (officeId) sp.set("officeId", officeId);
    if (techId) sp.set("techId", techId);
    if (q.trim()) sp.set("q", q.trim());
    if (minPrice) sp.set("minPrice", minPrice);
    if (maxPrice) sp.set("maxPrice", maxPrice);
    try {
      const r = await fetch(`/api/inventory/moves?${sp.toString()}`, { credentials: "same-origin" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error ?? "تعذّرت القراءة"); setRows([]); return; }
      setRows(d.rows ?? []);
      setOffices(d.offices ?? []);
      setTechs(d.technicians ?? []);
      setLabels(d.labels ?? {});
      setShowCost(!!d.showCost);
      setTruncated(!!d.truncated);
    } catch { setErr("تعذّر الاتصال"); }
    finally { setBusy(false); }
  }, [from, to, officeId, techId, q, minPrice, maxPrice]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- جلبٌ شبكيّ
  useEffect(() => { void load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setFrom(""); setTo(""); setOfficeId(""); setTechId(""); setQ(""); setMinPrice(""); setMaxPrice("");
  }

  function exportCsv() {
    const head = ["الوقت", "الحركة", "المادّة", "العدد", "من مكتب", "إلى مكتب", "الفنيّ", "السعر", "المجموع", "المستخدم", "المصدر", "ملاحظة"];
    const name = (id: number | null) => (id == null ? "" : offices.find((o) => o.id === id)?.name ?? `#${id}`);
    const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) => [
      formatDateTime(r.at), labels[r.kind] ?? r.kind, r.itemName, r.qty, name(r.fromTowerId), name(r.toTowerId),
      r.technicianName ?? "", r.unitCost ?? "", r.total ?? "", r.user ?? "",
      r.recorded ? "مُسجَّل" : "مشتَقّ", (r.voided ? "ملغاة — " : "") + r.note,
    ].map(cell).join(","));
    const csv = "﻿" + [head.map(cell).join(","), ...body].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `الترحيلات-والذمم-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const officeName = (id: number | null) => (id == null ? "—" : offices.find((o) => o.id === id)?.name ?? `#${id}`);
  const totalQty = rows.reduce((s, r) => s + (r.voided ? 0 : r.qty), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-2 sm:p-3" onClick={onClose}>
      <div className="my-3 w-full max-w-5xl rounded-2xl bg-white p-3 shadow-xl sm:p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 sm:text-lg">🔁🧰 الترحيلات والذمم</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold sm:text-sm ${tab === t.id ? "bg-mynet-blue text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fld label="من تاريخ"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INP} /></Fld>
            <Fld label="إلى تاريخ"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INP} /></Fld>
            {offices.length > 1 && (
              <Fld label="المكتب">
                <select value={officeId} onChange={(e) => setOfficeId(e.target.value)} className={INP}>
                  <option value="">كل المكاتب</option>
                  {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Fld>
            )}
            <Fld label="الفنيّ">
              <select value={techId} onChange={(e) => setTechId(e.target.value)} className={INP}>
                <option value="">كل الفنيّين</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Fld>
            {showCost && <Fld label="سعر من"><input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className={INP} /></Fld>}
            {showCost && <Fld label="سعر إلى"><input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={INP} /></Fld>}
            <div className="col-span-2">
              <Fld label="كلمة (مادّة · فنيّ · مكتب · مستخدم · ملاحظة · رقم)">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(tab); }} placeholder="🔍 اكتب ثمّ اضغط بحث…" className={INP} />
              </Fld>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button onClick={() => void load(tab)} disabled={busy} className="rounded-lg bg-mynet-blue px-4 py-1.5 text-sm font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-50">{busy ? "جارٍ…" : "بحث"}</button>
            <button onClick={() => { reset(); }} className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-300">تصفير</button>
            <button onClick={exportCsv} disabled={!rows.length} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">⬇️ تصدير (يفتح بإكسل)</button>
            <span className="ms-auto self-center text-xs font-bold text-slate-500">
              {fmt(rows.length)} حركة · مجموعُ القطع {fmt(totalQty)}
            </span>
          </div>
        </div>

        {err && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{err}</p>}
        {truncated && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">النتائجُ أكثرُ من المعروض — ضيّق التاريخَ أو البحث.</p>}

        <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-right text-[12px] sm:text-[13px]">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-2 py-2 font-bold">الوقت</th>
                <th className="px-2 py-2 font-bold">الحركة</th>
                <th className="px-2 py-2 font-bold">المادّة</th>
                <th className="px-2 py-2 font-bold">العدد</th>
                <th className="px-2 py-2 font-bold">من ← إلى</th>
                <th className="px-2 py-2 font-bold">الفنيّ</th>
                {showCost && <th className="px-2 py-2 font-bold">السعر</th>}
                <th className="hidden px-2 py-2 font-bold sm:table-cell">بواسطة</th>
                <th className="px-2 py-2 font-bold">التفصيل</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && !busy && (
                <tr><td colSpan={showCost ? 9 : 8} className="px-3 py-8 text-center text-slate-400">
                  لا حركةَ في هذا النطاق
                  {tab === "custody" && <span className="mt-1 block text-[11px]">وتسليمُ الذمم واستلامُها يُسجَّلان من 2026-11-01 — وما قبلَه لم يُكتب في القاعدة</span>}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.key} className={`border-t border-slate-100 ${r.voided ? "bg-rose-50/40 text-slate-400 line-through" : "hover:bg-slate-50"}`}>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatDateTime(r.at)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold ${KIND_CLS[r.kind] ?? "bg-slate-100 text-slate-700"}`}>
                      {labels[r.kind] ?? r.kind}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-semibold text-slate-700">{r.itemName}</td>
                  <td className="px-2 py-1.5 font-bold tabular-nums">{fmt(r.qty)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                    {r.fromTowerId != null && r.toTowerId != null
                      ? `${officeName(r.fromTowerId)} ← ${officeName(r.toTowerId)}`
                      : r.fromTowerId != null ? `من ${officeName(r.fromTowerId)}`
                      : r.toTowerId != null ? `إلى ${officeName(r.toTowerId)}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{r.technicianName ?? "—"}</td>
                  {showCost && <td className="px-2 py-1.5 tabular-nums text-slate-600">{fmt(r.unitCost)}</td>}
                  <td className="hidden px-2 py-1.5 text-slate-500 sm:table-cell">{r.user ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-500">
                    <span className={`me-1 rounded px-1 py-0.5 font-bold ${r.recorded ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {r.recorded ? "مُسجَّل" : "مشتَقّ"}
                    </span>
                    {r.voided && <span className="me-1 rounded bg-rose-100 px-1 py-0.5 font-bold text-rose-700">ملغاة</span>}
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          «مُسجَّل» قيدٌ كُتب لحظةَ الحركة · «مشتَقّ» مستنتَجٌ من فاتورةٍ أو دفعةٍ أو قيدِ كميّة.
          وحركاتُ الترحيل والتسليم والاستلام تُسجَّل من 2026-11-01 — وما قبلها لم يكن له أثرٌ في القاعدة
          إلّا ترحيلاتِ الدعم ومبيعاتِ الذمم على البطاقات.
        </p>
      </div>
    </div>
  );
}

const INP = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px] outline-none focus:border-mynet-blue";

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
