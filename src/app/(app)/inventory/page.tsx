"use client";

import { useCallback, useEffect, useState } from "react";
import CrudManager, { type Field } from "@/components/CrudManager";
import { usePermission } from "@/lib/usePermission";

type Item = {
  id: number;
  name: string | null;
  category: string | null;
  priceSale: number | null;
  priceSale2: number | null;
  priceDinar: number | null;
  count: number | null;
  barcode: string | null;
  towerId: number | null;
};
type Tower = { id: number; name: string | null };
type Tech = { id: number; name: string; towerId: number | null };
type Custody = { id: number; technicianId: number; itemId: number; qty: number; technicianName: string; itemName: string };

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

export default function InventoryPage() {
  const { me } = usePermission();
  const [towers, setTowers] = useState<Tower[]>([]);
  const [custodies, setCustodies] = useState<Custody[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sellItem, setSellItem] = useState<Item | null>(null);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [filterTower, setFilterTower] = useState(""); // فلتر مكتب (للمدير)

  const loadCustodies = useCallback(() => {
    fetch("/api/inventory/custody").then((r) => void (r.ok && r.json().then((d) => setCustodies(d.custodies ?? []))));
  }, []);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
    loadCustodies();
  }, [loadCustodies]);

  const isAdmin = !!me?.isAdmin;
  const towerName = (id: number | null) => towers.find((t) => t.id === id)?.name ?? "—";
  // مجموع ما بذمم الفنيين لكل مادة
  const custodyByItem = (itemId: number) =>
    custodies.filter((c) => c.itemId === itemId).reduce((s, c) => s + c.qty, 0);

  function afterChange() {
    setRefreshKey((k) => k + 1); // إعادة تحميل قائمة المخزن
    loadCustodies();
  }

  const fields: Field[] = [
    { name: "name", label: "اسم المادة", required: true },
    { name: "priceDinar", label: "سعر المادة (الكلفة)", type: "number" },
    { name: "count", label: "الكمية", type: "number" },
    { name: "priceSale", label: "سعر البيع", type: "number" },
    { name: "priceSale2", label: "سعر بيع خاص", type: "number" },
    { name: "category", label: "التصنيف" },
    ...(isAdmin
      ? ([{ name: "towerId", label: "المكتب", type: "select", required: true, options: towers.map((t) => ({ value: t.id, label: t.name ?? `#${t.id}` })) }] as Field[])
      : []),
  ];

  return (
    <>
      <CrudManager<Item>
        key={refreshKey}
        title="المخزن"
        subtitle="المواد والكميات والأسعار — مخزن مستقل لكل مكتب"
        apiBase={filterTower ? `/api/items?officeId=${filterTower}` : "/api/items"}
        addLabel="إضافة مادة"
        fields={fields}
        headerExtra={
          <>
            {isAdmin && towers.length > 0 && (
              <select
                value={filterTower}
                onChange={(e) => setFilterTower(e.target.value)}
                title="اختر مكتباً لعرض مخزنه فقط"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-mynet-blue"
              >
                <option value="">كل المكاتب</option>
                {towers.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
              </select>
            )}
            <button
              onClick={() => { loadCustodies(); setCustodyOpen(true); }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-600"
            >
              🧰 ذمم الفنيين
            </button>
          </>
        }
        rowActions={(r) => (
          <div className="flex gap-1.5">
            <button
              onClick={() => setSellItem(r)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              💵 بيع
            </button>
            <button
              onClick={() => setTransferItem(r)}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              🔁 ترحيل
            </button>
          </div>
        )}
        columns={[
          { header: "#", render: (r) => r.id },
          { header: "الاسم", render: (r) => r.name },
          ...(isAdmin ? [{ header: "المكتب", render: (r: Item) => towerName(r.towerId) }] : []),
          { header: "الكلفة", render: (r) => fmt(r.priceDinar) },
          { header: "سعر البيع", render: (r) => fmt(r.priceSale) },
          {
            header: "المتبقّي (الكلي)",
            render: (r) => (
              <span className={r.count != null && r.count <= 0 ? "font-bold text-red-600" : "text-slate-700"}>
                {fmt(r.count)}
              </span>
            ),
          },
          {
            header: "بالمكتب",
            render: (r) => {
              const held = custodyByItem(r.id);
              const atOffice = (r.count ?? 0) - held;
              return (
                <span className="text-slate-700">
                  {fmt(atOffice)}
                  {held > 0 && <span className="mr-1 text-xs text-amber-600"> (يم الفنيين {fmt(held)})</span>}
                </span>
              );
            },
          },
        ]}
      />

      {sellItem && (
        <SellModal item={sellItem} onClose={() => setSellItem(null)} onDone={() => { setSellItem(null); afterChange(); }} />
      )}
      {transferItem && (
        <TransferModal
          item={transferItem}
          towers={towers}
          atOffice={(transferItem.count ?? 0) - custodyByItem(transferItem.id)}
          onClose={() => setTransferItem(null)}
          onDone={() => { setTransferItem(null); afterChange(); }}
        />
      )}
      {custodyOpen && (
        <CustodyModal
          custodies={custodies}
          onClose={() => setCustodyOpen(false)}
          onDone={afterChange}
        />
      )}
    </>
  );
}

/* ============ نافذة البيع المباشر ============ */
function SellModal({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(String(item.priceSale ?? 0));
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const nQty = Number(qty) || 0;
  const nPrice = Number(price) || 0;
  const nRecv = Number(received) || 0;
  const total = nQty * nPrice;
  const remaining = Math.max(0, total - nRecv);

  async function submit() {
    setBusy(true); setErr("");
    const r = await fetch("/api/inventory/sell", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, qty: nQty, price: nPrice, received: nRecv }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر إتمام البيع"); return; }
    onDone();
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="mb-1 text-lg font-bold text-slate-800">💵 بيع: {item.name}</h3>
      <p className="mb-4 text-sm text-slate-500">بيع مباشر — يمكنك تعديل السعر قبل تسجيله.</p>
      <div className="grid grid-cols-2 gap-3">
        <L label="الكمية"><Inp value={qty} onChange={setQty} type="number" /></L>
        <L label="سعر البيع (قابل للتعديل)"><Inp value={price} onChange={setPrice} type="number" /></L>
        <L label="المبلغ الواصل"><Inp value={received} onChange={setReceived} type="number" placeholder="0" /></L>
        <L label="الإجمالي"><div className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800">{total.toLocaleString("en-US")}</div></L>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
        <span className="text-slate-600">المتبقّي (دين):</span>
        <span className={`font-bold ${remaining > 0 ? "text-red-600" : "text-emerald-700"}`}>{remaining.toLocaleString("en-US")}</span>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={submit} disabled={busy || nQty <= 0}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "جارٍ…" : "تأكيد البيع"}
        </button>
        <button onClick={onClose} className="rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إلغاء</button>
      </div>
    </Overlay>
  );
}

/* ============ نافذة ترحيل مادة بين المكاتب ============ */
function TransferModal({ item, towers, atOffice, onClose, onDone }: { item: Item; towers: Tower[]; atOffice: number; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("1");
  const [toTower, setToTower] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dests = towers.filter((t) => t.id !== item.towerId);

  async function submit() {
    setErr("");
    const n = Number(qty) || 0;
    if (n <= 0) { setErr("أدخل كمية صحيحة"); return; }
    if (n > atOffice) { setErr(`المتوفّر بالمخزن ${atOffice} فقط`); return; }
    if (!toTower) { setErr("اختر المكتب الوجهة"); return; }
    setBusy(true);
    const r = await fetch("/api/inventory/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, qty: n, toTowerId: Number(toTower) }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر الترحيل"); return; }
    onDone();
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="mb-1 text-lg font-bold text-slate-800">🔁 ترحيل: {item.name}</h3>
      <p className="mb-4 text-sm text-slate-500">نقل كمية من هذا المخزن إلى مكتب آخر. المتوفّر للترحيل: <b>{atOffice}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <L label="الكمية"><Inp value={qty} onChange={setQty} type="number" /></L>
        <L label="إلى مكتب">
          <select value={toTower} onChange={(e) => setToTower(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">اختر المكتب…</option>
            {dests.map((t) => <option key={t.id} value={t.id}>{t.name ?? `#${t.id}`}</option>)}
          </select>
        </L>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{busy ? "جارٍ…" : "ترحيل"}</button>
        <button onClick={onClose} className="rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إلغاء</button>
      </div>
    </Overlay>
  );
}

/* ============ نافذة ذمم الفنيين ============ */
function CustodyModal({ custodies, onClose, onDone }: {
  custodies: Custody[]; onClose: () => void; onDone: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [itemId, setItemId] = useState("");
  const [techId, setTechId] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/items").then((r) => void (r.ok && r.json().then(setItems)));
  }, []);

  // عند اختيار المادة: حمّل فنيّي مكتبها فقط (الذمم تُختار للفني فقط)
  const selItem = items.find((i) => i.id === Number(itemId));
  useEffect(() => {
    if (!selItem) { setTechs([]); return; }
    const q = selItem.towerId != null ? `?officeId=${selItem.towerId}` : "";
    fetch(`/api/field/technicians${q}`).then((r) => void (r.ok && r.json().then((d) => setTechs(d.technicians ?? []))));
  }, [selItem?.towerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(direction: "give" | "return") {
    setBusy(true); setErr("");
    const r = await fetch("/api/inventory/custody", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: Number(itemId), technicianId: Number(techId), qty: Number(qty), direction }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّرت العملية"); return; }
    setQty("1");
    onDone();
  }

  // تجميع الذمم حسب الفني
  const byTech = new Map<number, { name: string; rows: Custody[] }>();
  for (const c of custodies) {
    if (!byTech.has(c.technicianId)) byTech.set(c.technicianId, { name: c.technicianName, rows: [] });
    byTech.get(c.technicianId)!.rows.push(c);
  }

  return (
    <Overlay onClose={onClose} wide>
      <h3 className="mb-1 text-lg font-bold text-slate-800">🧰 ذمم الفنيين</h3>
      <p className="mb-4 text-sm text-slate-500">تسليم مواد للفني لا يُنقِص إجمالي المخزن — يبقى كما هو، ويُحسب ما بحوزة كل فني.</p>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <L label="المادة">
            <select value={itemId} onChange={(e) => { setItemId(e.target.value); setTechId(""); }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">اختر المادة…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </L>
          <L label="الفني (فقط الفنيون)">
            <select value={techId} onChange={(e) => setTechId(e.target.value)} disabled={!itemId}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">{itemId ? "اختر الفني…" : "اختر المادة أولاً"}</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </L>
          <L label="الكمية"><Inp value={qty} onChange={setQty} type="number" /></L>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={() => act("give")} disabled={busy || !itemId || !techId}
            className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
            📤 تسليم للفني
          </button>
          <button onClick={() => act("return")} disabled={busy || !itemId || !techId}
            className="flex-1 rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
            📥 إرجاع للمكتب
          </button>
        </div>
      </div>

      <div className="mt-4 max-h-64 overflow-y-auto">
        {byTech.size === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">لا توجد ذمم حالياً.</p>
        ) : (
          [...byTech.values()].map((t, idx) => (
            <div key={idx} className="mb-2 rounded-lg border border-slate-200 p-3">
              <div className="mb-1 font-semibold text-slate-700">👷 {t.name}</div>
              <div className="flex flex-wrap gap-2">
                {t.rows.map((c) => (
                  <span key={c.id} className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                    {c.itemName}: <b>{fmt(c.qty)}</b>
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إغلاق</button>
    </Overlay>
  );
}

/* ============ عناصر مساعدة ============ */
function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92dvh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl`}>
        {children}
      </div>
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
function Inp({ value, onChange, type = "text", placeholder }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-mynet-blue focus:outline-none" />
  );
}
