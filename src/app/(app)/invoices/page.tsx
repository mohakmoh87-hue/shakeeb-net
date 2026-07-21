"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintNowButton from "@/components/PrintNowButton";

type Item = {
  id: number;
  name: string | null;
  priceSale: number | null;
  priceSale2: number | null;
  count: number | null;
};
type Line = { itemId: number; name: string; count: number; price: number };
type Sub = { id: number; name: string | null; netUser: string | null };
type InvRow = {
  id: number; number: number | null; date: string | null; totalMy: number | null;
  waselHim: number | null; type: string | null; note: string | null; subscriberName: string | null;
};

const fmt = (n: number) => Number(n).toLocaleString("en-US");

export default function NewInvoicePage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<number | "">("");
  const [itemQuery, setItemQuery] = useState(""); // بحث عن مادة
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [saving, setSaving] = useState(false);
  // بيع مباشر: بلا مشترك (نقدي) + اسم زبون اختياري
  const [direct, setDirect] = useState(false);
  const [customerName, setCustomerName] = useState("");
  // سجل وصولات فواتير المبيع (المكان الوحيد لعرضها)
  const [logOpen, setLogOpen] = useState(false);
  const [logRows, setLogRows] = useState<InvRow[]>([]);
  const [logBusy, setLogBusy] = useState(false);
  // المشترك (إلزامي) — بحث حي
  const [subQuery, setSubQuery] = useState("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  // مكافأة المشترك (سحب الكود خصماً)
  const [rewardsOn, setRewardsOn] = useState(false);
  const [reward, setReward] = useState<{ balance: number } | null>(null);
  const [rewardPulled, setRewardPulled] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const [rewardBusy, setRewardBusy] = useState(false); // ضُغط «سحب» والاستعلام لم يكتمل بعد
  const rewardLookup = useRef<Promise<{ balance: number } | null> | null>(null); // استعلام الرصيد الجاري

  useEffect(() => {
    fetch("/api/items").then((r) => void (r.ok && r.json().then(setItems)));
  }, []);

  // جلب رصيد مكافأة المشترك المختار — مع الاحتفاظ بوعد الاستعلام: ضغطة «سحب» قبل
  // اكتماله تنتظره فيأتي الجواب صحيحاً فوراً (لا «ليس لديه كود» خاطئة على شبكة بطيئة)
  useEffect(() => {
    setRewardsOn(false); setReward(null); setRewardPulled(false); setNoCode(false); setRewardBusy(false);
    if (!sub) { rewardLookup.current = null; return; }
    rewardLookup.current = fetch(`/api/rewards/lookup?subscriberId=${sub.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.found) return null;
        setRewardsOn(!!d.rewardsEnabled);
        if (d.rewardsEnabled && (d.balance ?? 0) > 0) {
          const rw = { balance: d.balance as number };
          setReward(rw);
          return rw;
        }
        return null;
      })
      .catch(() => null);
  }, [sub]);

  // سحب الكود: فوري إن اكتمل الاستعلام، وإلا ينتظره (زر «…») ثم يجيب بدقة
  async function pullReward() {
    if (rewardBusy || rewardPulled) return;
    if (reward) { setNoCode(false); setRewardPulled(true); return; }
    setRewardBusy(true);
    const rw = await (rewardLookup.current ?? Promise.resolve(null));
    setRewardBusy(false);
    if (rw) { setNoCode(false); setRewardPulled(true); } else setNoCode(true);
  }

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
  const discount = !direct && rewardPulled && reward ? Math.min(reward.balance, total) : 0;
  const netTotal = Math.max(0, total - discount);

  // سجل الوصولات: جلب/حذف
  async function loadLog() {
    setLogBusy(true);
    const rows = await fetch("/api/invoices").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setLogRows(rows); setLogBusy(false);
  }
  async function deleteInvoice(row: InvRow) {
    if (!confirm(`حذف وصل الفاتورة #${row.number ?? row.id} عكسياً؟\nسيُلغى مبلغها من الصندوق وتُرجَع المواد للمخزون.`)) return;
    const r = await fetch(`/api/invoices/${row.id}/void`, { method: "POST" });
    if (r.ok) setLogRows((xs) => xs.filter((x) => x.id !== row.id));
    else alert((await r.json().catch(() => ({})))?.error ?? "تعذّر الحذف");
  }

  // الحفظ: silent = حفظ فقط (الزبون لا يريد وصلاً)؛ print = حفظ + طباعة صامتة فورية
  // على طابعة المكتب — بلا فتح أي صفحة أو تاب.
  async function save(mode: "silent" | "print") {
    setError(""); setOkMsg("");
    if (!direct && !sub) { setError("اختر المشترك أو فعّل «بيع مباشر»"); return; }
    if (lines.length === 0) { setError("أضف مادة واحدة على الأقل"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriberId: direct ? null : sub!.id,
          direct,
          customerName: direct ? customerName.trim() || null : null,
          items: lines.map((l) => ({ itemId: l.itemId, count: l.count, price: l.price })),
          note,
          // البيع المباشر نقدي: الفارغ = دفع المبلغ كاملاً
          paid: direct && paid === "" ? netTotal : Number(paid) || 0,
          useReward: !direct && rewardPulled,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "فشل الحفظ"); return; }
      let printed = false;
      if (mode === "print") {
        const pr = await fetch("/api/print", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "invoice", id: data.id }),
        }).catch(() => null);
        const pd = await pr?.json().catch(() => null);
        printed = !!(pr?.ok && pd?.ok && pd.workerOnline);
        setOkMsg(printed ? `✓ حُفظت الفاتورة #${data.number ?? data.id} وأُرسلت للطابعة` : `✓ حُفظت الفاتورة #${data.number ?? data.id} — ⚠ حاسبة المكتب غير متصلة للطباعة`);
      } else {
        setOkMsg(`✓ حُفظت الفاتورة #${data.number ?? data.id} (بلا طباعة)`);
      }
      // تفريغ النموذج لفاتورة جديدة
      setLines([]); setPaid(""); setNote(""); setSub(null); setSubQuery(""); setCustomerName("");
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
          <div className="flex gap-2">
            <button onClick={() => { setLogOpen(true); void loadLog(); }} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark">
              🧾 سجل وصولات المبيع
            </button>
            <button onClick={() => router.push("/inventory")} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300">
              📦 إدارة المواد (المخزن)
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* الأصناف */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* بحث عن مادة + الاختيار (القائمة تتصفّى بالبحث فوراً) */}
          <div className="mb-2">
            <input
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder="🔍 ابحث عن مادة بالاسم..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
            />
          </div>
          <div className="mb-4 flex gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(Number(e.target.value) || "")}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
            >
              <option value="">— اختر مادة لإضافتها —</option>
              {items
                .filter((i) => !itemQuery.trim() || (i.name ?? "").toLowerCase().includes(itemQuery.trim().toLowerCase()))
                .map((i) => (
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

          {/* بيع مباشر: نقدي بلا مشترك — اسم الزبون اختياري */}
          <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} className="h-4 w-4 accent-amber-600" />
            ⚡ بيع مباشر (بلا مشترك — نقدي)
          </label>
          {direct && (
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="اسم الزبون (اختياري)"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
            />
          )}

          {/* المشترك (إلزامي إلا مع البيع المباشر) */}
          {!direct && (<>
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

          {/* سحب كود مكافأة المشترك (يظهر عند اختيار مشترك ومكتبه مفعّل للمكافآت) */}
          {sub && rewardsOn && (
            <div className="mb-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-fuchsia-800">🎁 كود المكافأة</span>
                {!rewardPulled ? (
                  <button type="button" onClick={pullReward} disabled={rewardBusy} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-700 disabled:opacity-50">{rewardBusy ? "…" : "سحب كود المكافأة"}</button>
                ) : (
                  <button type="button" onClick={() => { setRewardPulled(false); setNoCode(false); }} className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-300">إلغاء السحب — يبقى الكود للمشترك</button>
                )}
              </div>
              {noCode && !rewardPulled && <div className="mt-2 text-xs font-semibold text-slate-500">ليس لديه كود خصم</div>}
              {rewardPulled && reward && (
                <div className="mt-2 text-xs text-fuchsia-700">خُصم <b>{fmt(discount)}</b> د.ع{reward.balance > total && <span> (يبقى {fmt(reward.balance - total)} للمشترك)</span>}</div>
              )}
            </div>
          )}
          </>)}

          <div className="mb-1 flex items-center justify-between text-lg">
            <span className="text-slate-600">الإجمالي</span>
            <span className={`font-extrabold ${discount > 0 ? "text-slate-400 line-through" : "text-mynet-blue"}`}>{fmt(total)} د.ع</span>
          </div>
          {discount > 0 && (
            <div className="mb-3 flex items-center justify-between text-lg">
              <span className="text-fuchsia-700">بعد المكافأة</span>
              <span className="font-extrabold text-mynet-blue">{fmt(netTotal)} د.ع</span>
            </div>
          )}
          <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ المدفوع</label>
          <input
            type="number"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            placeholder={String(netTotal)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />
          <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-mynet-blue"
          />
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {okMsg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{okMsg}</div>}
          {/* حفظ + طباعة صامتة فورية (بلا فتح صفحة)، أو حفظ فقط (الزبون لا يريد وصلاً) */}
          <button
            onClick={() => void save("print")}
            disabled={saving}
            className="mb-2 w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "جاري الحفظ..." : "🖨️ حفظ وطباعة وصل"}
          </button>
          <button
            onClick={() => void save("silent")}
            disabled={saving}
            className="w-full rounded-lg bg-slate-600 py-2.5 font-bold text-white shadow hover:bg-slate-700 disabled:opacity-60"
          >
            {saving ? "..." : "💾 حفظ فقط (بلا وصل)"}
          </button>
        </div>
      </div>

      {/* سجل وصولات فواتير المبيع — المكان الوحيد لعرضها، مع طباعة فورية وحذف لكل وصل */}
      {logOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" onClick={() => setLogOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-lg font-bold text-slate-800">🧾 سجل وصولات فواتير المبيع</h3>
              <button onClick={() => setLogOpen(false)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-200">✕ إغلاق</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {logBusy ? (
                <div className="p-8 text-center text-slate-400">جاري التحميل...</div>
              ) : logRows.length === 0 ? (
                <div className="p-8 text-center text-slate-400">لا وصولات بعد</div>
              ) : (
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2">#</th><th className="p-2">التاريخ</th><th className="p-2">المشتري</th>
                      <th className="p-2">الإجمالي</th><th className="p-2">المدفوع</th><th className="p-2">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-2 font-bold">#{r.number ?? r.id}</td>
                        <td className="p-2 whitespace-nowrap" dir="ltr">{r.date ? new Date(r.date).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td className="p-2">{r.subscriberName ?? (r.type === "بيع مباشر" ? (r.note?.match(/الزبون:\s*([^—]+)/)?.[1]?.trim() ?? "بيع مباشر") : "—")}</td>
                        <td className="p-2 font-semibold">{fmt(r.totalMy ?? 0)}</td>
                        <td className="p-2 text-emerald-700">{fmt(r.waselHim ?? 0)}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <PrintNowButton kind="invoice" id={r.id} />
                            <button onClick={() => void deleteInvoice(r)} className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
