"use client";

import { useCallback, useEffect, useState } from "react";
import CrudManager, { type Field } from "@/components/CrudManager";
import { usePermission } from "@/lib/usePermission";
import AddItemModal from "@/components/AddItemModal";
import { PurchaseReceiptModal, PurchaseLogModal } from "@/components/PurchaseReceiptModal";

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
type Tech = { id: number; name: string; towerId: number | null; isSupport?: boolean };
type Custody = { id: number; technicianId: number; itemId: number; qty: number; technicianName: string; itemName: string };

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

export default function InventoryPage() {
  const { me } = usePermission();
  const [towers, setTowers] = useState<Tower[]>([]);
  const [custodies, setCustodies] = useState<Custody[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [batchItem, setBatchItem] = useState<Item | null>(null); // 📦 سجلّ الدفعات
  const [addOpen, setAddOpen] = useState(false); // ➕ نافذة إضافة مادة
  const [purchaseOpen, setPurchaseOpen] = useState(false); // 🧾 وصل شراء
  const [logOpen, setLogOpen] = useState(false); // 📒 سجلّ وصولات الشراء
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

  // المدير: كل الحقول. المستخدم العادي: الكمية فقط (زيادة المخزون عند استلام بضاعة) —
  // إضافة/حذف المواد وتعديل الأسعار من صلاحية المدير، والخادم يفرض ذلك أيضاً.
  // ✏️ «زرُّ تعديل يعود إلى ما كان عليه: يزيد أو ينقص عددَ مادة» (قرارُ محمد 2026-08-25).
  //    فالشراءُ صار في نافذة «➕ إضافة مادة» بسعر دفعته، و«تعديل» صار **تصحيحَ عدد**:
  //    للمدير زيادةً ونقصاناً بلا سعر، وللمستخدم زيادةً بسعرٍ إلزاميّ (بابُه الوحيد).
  const fields: Field[] = isAdmin
    ? [{ name: "count", label: "الكمية (تصحيح — زيادة أو نقصان)", type: "number", required: true }]
    : [
        { name: "count", label: "الكمية (الزيادة فقط — لا يمكن الإنقاص)", type: "number", required: true },
        // 📦 «يجب إدخال سعر المادة عند زيادة عددها» (قرار محمد 2026-08-25) — والخادمُ
        //    يفرضه أيضاً، فلا تمرّ زيادةٌ بلا سعرٍ من أيّ باب.
        { name: "batchBuyPrice", label: "سعر شراء هذه الدفعة (إلزامي)", type: "number", required: true },
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
        // ➕ الإضافةُ لها نافذتُها الخاصّة (بحثٌ في القائمة · اختيارٌ · أو اسمٌ جديد) —
        //    اقتراحُ محمد 2026-08-25. فزرُّ الإضافة المدمَج مُطفأ، وزرُّنا في الترويسة.
        canAdd={false}
        canDelete={isAdmin}
        summary={(rows) => {
          // قيمة المخزون = الكمية × السعر (تعكس البحث/فلتر المكتب المعروض)
          const cost = rows.reduce((s, r) => s + (r.count ?? 0) * (r.priceDinar ?? 0), 0);
          const sale = rows.reduce((s, r) => s + (r.count ?? 0) * (r.priceSale ?? 0), 0);
          const qty = rows.reduce((s, r) => s + (r.count ?? 0), 0);
          const box = (label: string, value: number, cls: string) => (
            <div className={`rounded-xl border px-4 py-3 ${cls}`}>
              <div className="text-xs font-semibold opacity-80">{label}</div>
              <div className="text-lg font-extrabold tabular-nums">{fmt(value)}</div>
            </div>
          );
          // مجاميع المبالغ (الكلفة/المبيع/الربح) للمدير فقط — الموظّف يرى العدد لا القيمة
          return (
            <div className={`mb-3 grid gap-3 ${isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:max-w-xs"}`}>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs font-semibold text-slate-500">عدد المواد / القطع</div>
                <div className="text-lg font-extrabold tabular-nums text-slate-700">{fmt(rows.length)} / {fmt(qty)}</div>
              </div>
              {isAdmin && box("مجموع الكلفة", cost, "border-amber-200 bg-amber-50 text-amber-800")}
              {isAdmin && box("مجموع المبيع", sale, "border-emerald-200 bg-emerald-50 text-emerald-800")}
              {isAdmin && box("الربح المتوقّع", sale - cost, "border-sky-200 bg-sky-50 text-sky-800")}
            </div>
          );
        }}
        clientSearch={{ placeholder: "🔍 ابحث باسم المادة...", get: (r) => `${r.name ?? ""} ${r.category ?? ""} ${r.barcode ?? ""}` }}
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
            {/* ➕ نافذةُ الإضافة الجديدة — للمدير حصراً (قرارُ محمد 2026-08-25) */}
            {isAdmin && (
              <button
                onClick={() => setAddOpen(true)}
                className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white shadow hover:bg-mynet-blue-dark"
              >
                ➕ إضافة مادة
              </button>
            )}
            {/* 🧾 وصلُ شراءٍ متعدّدُ المواد + دفعاتُ FIFO — للمدير (طلبُ محمد 2026-09-05) */}
            {isAdmin && (
              <button onClick={() => setPurchaseOpen(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700">
                🧾 وصل شراء
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setLogOpen(true)} className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-700">
                📒 سجلّ وصولات الشراء
              </button>
            )}
          </>
        }
        rowActions={(r) => (
          <div className="flex gap-1.5">
            {/* لا بيع من المخزن — قرار محمد 2026-08-04: البيع حصراً من «فاتورة مبيع»
                كي يكون لكل بيع وصلٌ يُرى ويُحذف. المخزن للتعديل والإضافة والترحيل فقط. */}
            <button
              onClick={() => setTransferItem(r)}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              🔁 ترحيل
            </button>
            {/* 📦 سجلُّ الدفعات — يجيب سؤال محمد: بكم اشتُريت في كلّ مرّة، ومتى، وبيد من.
                🔒 للمدير وحدَه كخانة «الكلفة» — والخادمُ يفرضه أيضاً بـ403. */}
            {isAdmin && (
              <button
                onClick={() => setBatchItem(r)}
                className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                📦 الدفعات
              </button>
            )}
          </div>
        )}
        columns={[
          { header: "#", render: (r) => r.id },
          { header: "الاسم", render: (r) => r.name },
          ...(isAdmin ? [{ header: "المكتب", render: (r: Item) => towerName(r.towerId) }] : []),
          // الكلفة للمدير فقط (الخادم يحجبها أيضاً عن غير المدير)
          // 📊 وصارت **متوسّطَ الشراء المرجّح** لا سعرَ آخر دفعة (طلبُ محمد: «وأن يظهر
          //    متوسّطُ السعر لي») — والتفصيلُ دفعةً دفعةً في نافذة «📦 الدفعات».
          ...(isAdmin ? [{ header: "متوسّط الشراء", render: (r: Item) => fmt(r.priceDinar) }] : []),
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
      {batchItem && <BatchesModal item={batchItem} onClose={() => setBatchItem(null)} />}
      {addOpen && (
        <AddItemModal
          towers={towers}
          defaultTowerId={filterTower ? Number(filterTower) : null}
          onClose={() => setAddOpen(false)}
          onDone={afterChange}
        />
      )}
      {purchaseOpen && (
        <PurchaseReceiptModal
          towers={towers}
          defaultTowerId={filterTower ? Number(filterTower) : null}
          onClose={() => setPurchaseOpen(false)}
          onDone={afterChange}
        />
      )}
      {logOpen && <PurchaseLogModal onClose={() => setLogOpen(false)} />}
    </>
  );
}

/* ============ نافذة ترحيل مادة بين المكاتب ============ */
function TransferModal({ item, towers, atOffice, onClose, onDone }: { item: Item; towers: Tower[]; atOffice: number; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("1");
  const [toTower, setToTower] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // مكاتب الوجهة تُجلب من مسار الترحيل نفسه: قائمة /api/towers مقصورة على مكتب
  // المستخدم، فكانت هذه القائمة تظهر **فارغة** لمستخدم المكتب فلا يستطيع الترحيل.
  const [agentTowers, setAgentTowers] = useState<Tower[]>([]);
  useEffect(() => {
    fetch("/api/inventory/transfer")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.offices) setAgentTowers(d.offices); })
      .catch(() => {});
  }, []);
  const dests = (agentTowers.length ? agentTowers : towers).filter((t) => t.id !== item.towerId);

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
            <option value="">{dests.length ? "اختر المكتب…" : "لا مكتب آخر لوكيلك"}</option>
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
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
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

// ═════ 📦 سجلُّ دفعات المادة — سؤالُ محمد 2026-08-25 ═════
// «سعرُ الشراء قد يختلف لنفس المادة في وقتٍ لاحق — كيف سأعرف سعرَ شراء المادة في كلّ
//  مرّةٍ أزيد العدد؟» فهذه النافذةُ جوابُه: كلُّ دفعةٍ بسعرها ووقتها وصاحبها.
// 🔑 وقراءةٌ محضة: لا تكتب شيئاً، ولا تمسّ كلفةَ المادة ولا حسابَ الربح (قرارُ محمد).
type BatchRow = { id: number; at: string; user: string; before: number; after: number; delta: number; buyPrice: number | null };

function BatchesModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/items/${item.id}/batches`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("تعذّر جلب السجلّ"))))
      .then((d) => setRows(d.rows ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "تعذّر جلب السجلّ"));
  }, [item.id]);

  const ins = (rows ?? []).filter((r) => r.delta > 0);
  const withPrice = ins.filter((r) => r.buyPrice != null);
  // 📊 متوسّطُ **كلّ ما اشتُري تاريخيّاً** — ويختلف عمداً عن «متوسّط الشراء المعتمد»
  //    (`priceDinar`) الذي يحسبه الخادمُ على **المخزون الباقي** لحظةَ كلّ زيادة.
  //    فاختلافُهما ليس تناقضاً: هذا تاريخُ مشترياتك، وذاك كلفةُ ما في يدك الآن.
  const totalQty = withPrice.reduce((s, r) => s + r.delta, 0);
  const totalCost = withPrice.reduce((s, r) => s + r.delta * (r.buyPrice ?? 0), 0);
  const avg = totalQty > 0 ? totalCost / totalQty : null;
  const last = withPrice[0]?.buyPrice ?? null; // الأحدثُ أوّلاً (ترتيبُ الخادم)

  return (
    <Overlay onClose={onClose} wide>
      <h3 className="mb-1 text-lg font-bold text-slate-800">📦 سجلّ دفعات: {item.name}</h3>
      <p className="mb-4 text-sm text-slate-500">كلُّ زيادةِ كميّةٍ بسعر شرائها ووقتها وصاحبها — للاطّلاع فقط، ولا يغيّر كلفة المادة.</p>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] font-medium text-slate-500">آخر سعر شراء</div>
          <div className="text-lg font-extrabold text-slate-800">{last != null ? last.toLocaleString("en-US") : "—"}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] font-medium text-slate-500">متوسّط كل المشتريات</div>
          <div className="text-lg font-extrabold text-slate-800">{avg != null ? Math.round(avg).toLocaleString("en-US") : "—"}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <div className="text-[11px] font-medium text-emerald-700">متوسّط الشراء المعتمد</div>
          <div className="text-lg font-extrabold text-emerald-800">{item.priceDinar != null ? item.priceDinar.toLocaleString("en-US") : "—"}</div>
        </div>
      </div>

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      {rows == null && !err && <p className="py-6 text-center text-sm text-slate-400">جارٍ التحميل…</p>}

      {rows != null && rows.length === 0 && (
        <p className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-500">لا حركاتِ كميّةٍ مسجّلةٌ لهذه المادة بعد.</p>
      )}

      {rows != null && rows.length > 0 && (
        <div className="max-h-[46dvh] overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">الحركة</th>
                <th className="p-2 text-right">سعر الشراء</th>
                <th className="p-2 text-right">الرصيد</th>
                <th className="p-2 text-right">بواسطة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 whitespace-nowrap text-slate-600" dir="ltr">
                    {new Date(r.at).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className={`p-2 font-bold ${r.delta > 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {r.delta > 0 ? "+" : "−"}{Math.abs(r.delta).toLocaleString("en-US")}
                  </td>
                  <td className="p-2 font-bold text-slate-800">
                    {/* 🔒 صفوفٌ قديمةٌ سبقت الميزةَ لا سعرَ لها — تُقال الحقيقةُ ولا يُلفَّق رقم */}
                    {r.delta > 0
                      ? (r.buyPrice != null ? r.buyPrice.toLocaleString("en-US") : <span className="text-xs font-normal text-slate-400">لم يُسجَّل (قبل الميزة)</span>)
                      : <span className="text-xs font-normal text-slate-400">—</span>}
                  </td>
                  <td className="p-2 text-slate-500" dir="ltr">{r.before} → {r.after}</td>
                  <td className="p-2 text-slate-600">{r.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إغلاق</button>
    </Overlay>
  );
}
