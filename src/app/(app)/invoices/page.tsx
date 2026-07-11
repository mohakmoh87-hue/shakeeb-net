"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type Item = {
  id: number;
  name: string | null;
  priceSale: number | null;
  priceSale2: number | null;
  count: number | null;
};
type Line = { itemId: number; name: string; count: number; price: number };
type Sub = { id: number; name: string | null; netUser: string | null };

const fmt = (n: number) => Number(n).toLocaleString("en-US");

export default function NewInvoicePage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<number | "">("");
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // المشترك (إلزامي) — بحث حي
  const [subQuery, setSubQuery] = useState("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);

  useEffect(() => {
    fetch("/api/items").then((r) => void (r.ok && r.json().then(setItems)));
  }, []);

  useEffect(() => {
    if (sub) return; // لا تبحث بعد الاختيار
    const t = setTimeout(() => {
      fetch(`/api/subscribers?q=${encodeURIComponent(subQuery)}`).then((r) => void (r.ok && r.json().then(setSubs)));
    }, 250);
    return () => clearTimeout(t);
  }, [subQuery, sub]);

  function addLine() {
    if (!pick) return;
    const it = items.find((i) => i.id === pick);
    if (!it) return;
    if (lines.some((l) => l.itemId === it.id)) return;
    setLines((ls) => [
      ...ls,
      { itemId: it.id, name: it.name ?? `#${it.id}`, count: 1, price: it.priceSale ?? 0 },
    ]);
    setPick("");
  }

  function updateLine(itemId: number, field: "count" | "price", value: number) {
    setLines((ls) =>
      ls.map((l) => (l.itemId === itemId ? { ...l, [field]: value } : l)),
    );
  }
  function removeLine(itemId: number) {
    setLines((ls) => ls.filter((l) => l.itemId !== itemId));
  }

  const total = lines.reduce((s, l) => s + l.count * l.price, 0);

  async function save() {
    setError("");
    if (!sub) {
      setError("اختر المشترك (إلزامي)");
      return;
    }
    if (lines.length === 0) {
      setError("أضف مادة واحدة على الأقل");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriberId: sub.id,
          items: lines.map((l) => ({ itemId: l.itemId, count: l.count, price: l.price })),
          note,
          paid: Number(paid) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ");
        return;
      }
      router.push(`/invoices/${data.id}/receipt`);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="فاتورة مبيع"
        subtitle="إنشاء فاتورة بيع جديدة"
        action={
          <button onClick={() => router.push("/inventory")} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300">
            📦 إدارة المواد (المخزن)
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* الأصناف */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(Number(e.target.value) || "")}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
            >
              <option value="">— اختر مادة لإضافتها —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({fmt(i.priceSale ?? 0)} د.ع) — متوفر: {i.count ?? 0}
                </option>
              ))}
            </select>
            <button
              onClick={addLine}
              className="rounded-lg bg-mynet-blue px-4 py-2 font-semibold text-white hover:bg-mynet-blue-dark"
            >
              + إضافة
            </button>
          </div>

          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2">المادة</th>
                <th className="p-2">الكمية</th>
                <th className="p-2">السعر</th>
                <th className="p-2">المجموع</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-slate-400">لم تُضف أصناف بعد</td></tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.itemId} className="border-t border-slate-100">
                    <td className="p-2 font-medium">{l.name}</td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={1}
                        value={l.count}
                        onChange={(e) => updateLine(l.itemId, "count", Math.max(1, Number(e.target.value)))}
                        className="w-20 rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        value={l.price}
                        onChange={(e) => updateLine(l.itemId, "price", Number(e.target.value))}
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                      <div className="mt-1 flex gap-1">
                        <button type="button" onClick={() => updateLine(l.itemId, "price", items.find((i) => i.id === l.itemId)?.priceSale ?? 0)} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200">عادي</button>
                        <button type="button" onClick={() => updateLine(l.itemId, "price", items.find((i) => i.id === l.itemId)?.priceSale2 ?? 0)} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-200">خاص</button>
                      </div>
                    </td>
                    <td className="p-2 font-semibold">{fmt(l.count * l.price)}</td>
                    <td className="p-2">
                      <button onClick={() => removeLine(l.itemId)} className="text-red-500 hover:text-red-700">✕</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* الملخّص */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-800">ملخّص الفاتورة</h3>

          {/* المشترك (إلزامي) */}
          <label className="mb-1 block text-sm font-medium text-slate-700">المشترك (إلزامي)</label>
          {sub ? (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="text-sm font-semibold text-emerald-800">{sub.name}{sub.netUser ? ` — ${sub.netUser}` : ""}</span>
              <button onClick={() => { setSub(null); setSubQuery(""); }} className="text-xs text-red-500 hover:underline">تغيير</button>
            </div>
          ) : (
            <div className="mb-3">
              <input
                value={subQuery}
                onChange={(e) => setSubQuery(e.target.value)}
                placeholder="ابحث بالاسم أو اليوزر..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
              />
              {subQuery && subs.length > 0 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200">
                  {subs.slice(0, 20).map((s) => (
                    <button key={s.id} onClick={() => setSub(s)} className="block w-full px-3 py-1.5 text-right text-sm hover:bg-slate-50">
                      {s.name}{s.netUser ? ` — ${s.netUser}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mb-3 flex items-center justify-between text-lg">
            <span className="text-slate-600">الإجمالي</span>
            <span className="font-extrabold text-mynet-blue">{fmt(total)} د.ع</span>
          </div>
          <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ المدفوع</label>
          <input
            type="number"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            placeholder={String(total)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />
          <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "جاري الحفظ..." : "حفظ وطباعة الفاتورة 🧾"}
          </button>
        </div>
      </div>
    </div>
  );
}
