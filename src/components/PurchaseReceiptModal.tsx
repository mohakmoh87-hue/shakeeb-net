"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";

// ═════ 🏬🧾 نافذةُ وصل شراءٍ متعدّدِ المواد + سجلُّ الوصولات (طلبُ محمد 2026-09-05) ═════
// ترويسة (مكتبُ الشراء = المورِّد · رقم · تاريخ · مكتبٌ مستلِم) + أسطرٌ (مادةٌ من القائمة أو
// جديدة + سعرُ شراء + سعرُ بيع) + مجموعٌ حيٌّ يطابق الوصلَ + تسديدٌ نقديٌّ/دَين.

type Tower = { id: number; name: string | null };
type ItemOpt = { id: number; name: string | null };
type Line = { key: number; itemId: number | null; newName: string; qty: string; buyPrice: string; sellPrice: string };

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
let lineSeq = 1;
const emptyLine = (): Line => ({ key: lineSeq++, itemId: null, newName: "", qty: "1", buyPrice: "", sellPrice: "" });

export function PurchaseReceiptModal({ towers, defaultTowerId, onClose, onDone }: { towers: Tower[]; defaultTowerId: number | null; onClose: () => void; onDone: () => void }) {
  const [towerId, setTowerId] = useState<number>(defaultTowerId ?? towers[0]?.id ?? 0);
  const [vendorName, setVendorName] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [payType, setPayType] = useState<"cash" | "debt">("cash");
  const [source, setSource] = useState<"daily" | "total">("daily");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadItems = useCallback(async () => {
    if (!towerId) { setItems([]); return; }
    try {
      const r = await fetch(`/api/items?officeId=${towerId}`, { credentials: "same-origin" });
      if (r.ok) setItems(((await r.json()) as ItemOpt[]).map((i) => ({ id: i.id, name: i.name })));
    } catch { /* صمت */ }
  }, [towerId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- جلبٌ شبكيّ
  useEffect(() => { void loadItems(); }, [loadItems]);

  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.buyPrice) || 0), 0);
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    setErr("");
    if (!towerId) { setErr("اختر المكتب المستلِم"); return; }
    if (!vendorName.trim()) { setErr("اكتب اسم مكتب الشراء (المورِّد)"); return; }
    const clean = lines
      .map((l) => ({ itemId: l.itemId, name: l.itemId ? null : l.newName.trim(), qty: Number(l.qty) || 0, buyPrice: Number(l.buyPrice) || 0, sellPrice: l.sellPrice.trim() ? Number(l.sellPrice) : null }))
      .filter((l) => (l.itemId || l.name) && l.qty > 0);
    if (!clean.length) { setErr("أضِف مادةً واحدةً على الأقلّ (باسمٍ وعدد)"); return; }
    for (const l of clean) if (!(l.buyPrice >= 0)) { setErr("أدخل سعرَ الشراء لكلّ مادة"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/purchase-receipts", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorName: vendorName.trim(), receiptNumber: receiptNumber.trim() || null, date, towerId, lines: clean, payment: { type: payType, source: payType === "cash" ? source : null } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error ?? "تعذّر الحفظ"); setBusy(false); return; }
      onDone(); onClose();
    } catch { setErr("تعذّر الاتصال"); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-3" onClick={onClose}>
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🧾 وصلُ شراءٍ جديد</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* الترويسة */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="col-span-2 flex flex-col gap-1 text-[12px] font-bold text-slate-600">
            مكتبُ الشراء (المورِّد)
            <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="اسم المحل المشترى منه" className="rounded-lg border border-slate-300 px-2 py-1.5 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
            رقمُ الوصل
            <input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-bold text-slate-600">
            التاريخ
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 font-normal" />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[12px] font-bold text-slate-600">
            المكتبُ المستلِم للمخزن
            <select value={towerId} onChange={(e) => { setTowerId(Number(e.target.value)); setLines((ls) => ls.map((l) => ({ ...l, itemId: null }))); }} className="rounded-lg border border-slate-300 px-2 py-1.5 font-normal">
              {towers.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
            </select>
          </label>
        </div>

        {/* الأسطر */}
        <div className="mt-3 space-y-2">
          {lines.map((l) => {
            const isNew = l.itemId == null && l.newName !== "__pick__";
            return (
              <div key={l.key} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <div className="col-span-2 flex flex-col gap-1">
                    <select
                      value={l.itemId == null ? "__new__" : String(l.itemId)}
                      onChange={(e) => { const v = e.target.value; setLine(l.key, v === "__new__" ? { itemId: null } : { itemId: Number(v), newName: "" }); }}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]">
                      <option value="__new__">➕ مادة جديدة…</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.name ?? `#${it.id}`}</option>)}
                    </select>
                    {l.itemId == null && (
                      <input value={l.newName} onChange={(e) => setLine(l.key, { newName: e.target.value })} placeholder="اسم المادة الجديدة" className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
                    )}
                  </div>
                  <input type="number" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="العدد" className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
                  <input type="number" value={l.buyPrice} onChange={(e) => setLine(l.key, { buyPrice: e.target.value })} placeholder="سعر الشراء" className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
                  <input type="number" value={l.sellPrice} onChange={(e) => setLine(l.key, { sellPrice: e.target.value })} placeholder="سعر البيع" className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]" />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>المجموع: {fmt((Number(l.qty) || 0) * (Number(l.buyPrice) || 0))} د.ع</span>
                  {lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="font-bold text-rose-600 hover:underline">حذف السطر</button>}
                </div>
                {isNew && null}
              </div>
            );
          })}
          <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className="rounded-lg border border-dashed border-mynet-blue/50 bg-blue-50 px-3 py-1.5 text-[13px] font-bold text-mynet-blue hover:bg-blue-100">➕ إضافة مادة أخرى</button>
        </div>

        {/* المجموع + التسديد */}
        <div className="mt-3 rounded-xl bg-slate-800 px-4 py-3 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[12px] opacity-90">مجموعُ الوصل (يطابق وصلَك)</span>
            <span className="text-2xl font-extrabold" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(total)} د.ع</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <b className="text-slate-700">التسديد:</b>
          <label className="flex items-center gap-1"><input type="radio" checked={payType === "cash"} onChange={() => setPayType("cash")} /> نقدي</label>
          <label className="flex items-center gap-1"><input type="radio" checked={payType === "debt"} onChange={() => setPayType("debt")} /> دين (يبقى متبقّياً)</label>
          {payType === "cash" && (
            <span className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
              <label className="flex items-center gap-1"><input type="radio" checked={source === "daily"} onChange={() => setSource("daily")} /> من التقرير اليوميّ</label>
              <label className="flex items-center gap-1"><input type="radio" checked={source === "total"} onChange={() => setSource("total")} /> من المبلغ الكلّيّ</label>
            </span>
          )}
        </div>

        {err && <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">إلغاء</button>
          <button onClick={() => void submit()} disabled={busy} className="rounded-lg bg-mynet-blue px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "…" : "حفظ الوصل"}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── سجلُّ وصولات الشراء + تسديدُ الدَّين ───────────
type Receipt = { id: number; office: string; vendorName: string; receiptNumber: string | null; date: string; total: number; paid: number; remaining: number; note: string | null };

export function PurchaseLogModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [payId, setPayId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paySource, setPaySource] = useState<"daily" | "total">("daily");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/purchase-receipts", { credentials: "same-origin" });
      if (r.ok) { const d = await r.json(); setRows(d.receipts ?? []); setTotalDebt(d.totalDebt ?? 0); }
    } catch { /* صمت */ }
    finally { setBusy(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- جلبٌ شبكيّ
  useEffect(() => { void load(); }, [load]);

  async function pay(id: number) {
    const amt = Number(payAmount) || 0;
    if (amt <= 0) { setMsg("أدخل مبلغاً صحيحاً"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/purchase-receipts/${id}/pay`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, source: paySource }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? "تعذّر التسديد"); setBusy(false); return; }
      setPayId(null); setPayAmount(""); await load();
    } catch { setMsg("تعذّر الاتصال"); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-3" onClick={onClose}>
      <div className="my-4 w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">📒 سجلُّ وصولات الشراء</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {totalDebt > 0 && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700">إجماليُّ الدَّين المتبقّي عليك: {fmt(totalDebt)} د.ع</div>}
        {msg && <div className="mb-2 text-[12px] font-bold text-rose-700">{msg}</div>}
        <div className="max-h-[65vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr><th className="p-2">الرقم</th><th className="p-2">المورِّد</th><th className="p-2">المكتب</th><th className="p-2">التاريخ</th><th className="p-2">المجموع</th><th className="p-2">المسدَّد</th><th className="p-2">المتبقّي</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 text-slate-500">{r.receiptNumber || `#${r.id}`}</td>
                  <td className="p-2 font-semibold text-slate-700">{r.vendorName}</td>
                  <td className="p-2 text-slate-500">{r.office}</td>
                  <td className="p-2 text-slate-500" dir="ltr">{formatDate(r.date)}</td>
                  <td className="p-2 text-slate-700">{fmt(r.total)}</td>
                  <td className="p-2 text-emerald-700">{fmt(r.paid)}</td>
                  <td className={`p-2 font-bold ${r.remaining > 0 ? "text-rose-600" : "text-slate-400"}`}>{fmt(r.remaining)}</td>
                  <td className="p-2">
                    {r.remaining > 0 && (payId === r.id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(r.remaining)} className="w-20 rounded border border-slate-300 px-1 py-0.5" />
                        <select value={paySource} onChange={(e) => setPaySource(e.target.value as "daily" | "total")} className="rounded border border-slate-300 px-1 py-0.5">
                          <option value="daily">اليوميّ</option>
                          <option value="total">الكلّيّ</option>
                        </select>
                        <button onClick={() => void pay(r.id)} disabled={busy} className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white disabled:opacity-50">سدّد</button>
                        <button onClick={() => { setPayId(null); setPayAmount(""); }} className="text-slate-400">✕</button>
                      </span>
                    ) : (
                      <button onClick={() => { setPayId(r.id); setPayAmount(String(r.remaining)); }} className="rounded-lg bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700">تسديد الدَّين</button>
                    ))}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-slate-400">{busy ? "…" : "لا وصولاتِ شراءٍ بعد"}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
