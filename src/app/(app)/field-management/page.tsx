"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Board = { id: number; name: string };
type List = { id: number; name: string; position: number };
type Card = {
  id: number; listId: number; title: string; description: string | null;
  assignee: string | null; technicianId: number | null; kind: string;
  label: string | null; dueDate: string | null; position: number; done: boolean;
  amount: number | null; serviceDetails: string | null; completedAt: string | null;
  materialsInfo: string | null;
  startedAt: string | null; durationSec: number | null; postponedTo: string | null;
};

// تنسيق مدة بالثواني إلى نص عربي مقروء
function fmtDuration(sec: number | null): string {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} س ${m} د`;
  if (m > 0) return `${m} د`;
  return `${sec} ث`;
}
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
type Office = { id: number; name: string | null };
type Technician = { id: number; name: string; phone: string | null; isSupport?: boolean };
type CardType = { id: number; name: string; deliveryOnly: boolean };

// لون ثابت لكل نوع بطاقة (تصنيف) — يُشتق من اسم النوع فيبقى ثابتاً لكل تصنيف
const KIND_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-pink-500", "bg-cyan-600", "bg-red-500", "bg-lime-600", "bg-indigo-500", "bg-orange-500"];
const kindColor = (name: string) => KIND_COLORS[[...(name || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0) % KIND_COLORS.length];
const fmtDue = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }) : null);

export default function FieldManagementPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [newList, setNewList] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [cardText, setCardText] = useState("");
  const [cardTypes, setCardTypes] = useState<CardType[]>([]);
  const [cardKind, setCardKind] = useState("صيانة");
  const [cardTech, setCardTech] = useState("");
  const [cardDue, setCardDue] = useState("");
  const [sel, setSel] = useState<Card | null>(null);
  const [completing, setCompleting] = useState<Card | null>(null);
  const [postponing, setPostponing] = useState<Card | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  // الفنيون والمكاتب (لوحة مستقلّة لكل مكتب، والمدير يختار المكتب)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState<number | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [supportModal, setSupportModal] = useState(false);
  const [techName, setTechName] = useState("");
  const [techPhone, setTechPhone] = useState("");

  const load = useCallback((office?: number | null) => {
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/board${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setBoard(d.board); setLists(d.lists); setCards(d.cards);
        setTechnicians(d.technicians ?? []); setOffices(d.offices ?? []);
        setCardTypes(d.cardTypes ?? []); setOfficeId(d.officeId ?? null);
        setIsManager(!!d.isManager); setCanManage(!!d.canManage);
      }
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addTechnician() {
    const name = techName.trim();
    if (!name) return;
    const r = await fetch("/api/field/technicians", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: techPhone.trim() || null, officeId }),
    });
    if (r.ok) { const t = await r.json(); setTechnicians((x) => [...x, t]); setTechName(""); setTechPhone(""); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت الإضافة"); }
  }
  async function deleteTechnician(id: number) {
    if (!confirm("حذف هذا الفني؟")) return;
    setTechnicians((x) => x.filter((t) => t.id !== id));
    await fetch(`/api/field/technicians?id=${id}`, { method: "DELETE" });
  }

  async function createType() {
    const name = prompt("اسم نوع البطاقة الجديد:");
    if (!name?.trim()) return;
    const deliveryOnly = confirm("هل هو من نوع «التوصيل» (مبلغ فقط بلا تفاصيل/صورة عند الإنجاز)؟\nموافق = توصيل، إلغاء = صيانة (حقول كاملة)");
    const r = await fetch("/api/field/card-types", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), deliveryOnly }),
    });
    if (r.ok) { const t = await r.json(); setCardTypes((x) => (x.some((y) => y.id === t.id) ? x : [...x, t])); setCardKind(t.name); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت الإضافة"); }
  }

  async function addCard(listId: number) {
    const title = cardText.trim();
    if (!title) { setAddingTo(null); return; }
    const tech = technicians.find((t) => String(t.id) === cardTech);
    const payload = {
      listId, title, kind: cardKind,
      technicianId: tech?.id ?? null, assignee: tech?.name ?? null,
      dueDate: cardDue || null,
    };
    setCardText(""); setCardTech(""); setCardDue(""); setCardKind(cardTypes[0]?.name ?? "صيانة");
    const r = await fetch("/api/field/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) { const c = await r.json(); setCards((x) => [...x, c]); }
  }
  async function addList() {
    const name = newList.trim();
    if (!name || !board) return;
    setNewList("");
    const r = await fetch("/api/field/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardId: board.id, name }) });
    if (r.ok) { const l = await r.json(); setLists((x) => [...x, l]); }
  }
  async function renameList(l: List) {
    const name = prompt("اسم العمود:", l.name);
    if (name == null) return;
    setLists((x) => x.map((y) => (y.id === l.id ? { ...y, name } : y)));
    await fetch("/api/field/lists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id, name }) });
  }
  async function deleteList(l: List) {
    if (!confirm(`حذف العمود «${l.name}» وكل بطاقاته؟`)) return;
    setLists((x) => x.filter((y) => y.id !== l.id));
    setCards((x) => x.filter((c) => c.listId !== l.id));
    await fetch(`/api/field/lists?id=${l.id}`, { method: "DELETE" });
  }
  async function moveCard(card: Card, toListId: number) {
    if (card.listId === toListId) return;
    const pos = cards.filter((c) => c.listId === toListId).length;
    setCards((x) => x.map((c) => (c.id === card.id ? { ...c, listId: toListId, position: pos } : c)));
    if (sel?.id === card.id) setSel({ ...sel, listId: toListId });
    await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card.id, listId: toListId, position: pos }) });
  }
  async function saveCard(patch: Partial<Card>) {
    if (!sel) return;
    const merged = { ...sel, ...patch };
    setSel(merged);
    setCards((x) => x.map((c) => (c.id === sel.id ? merged : c)));
    await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel.id, ...patch }) });
  }
  async function startCard() {
    if (!sel) return;
    const r = await fetch("/api/field/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    if (r.ok) { const c = await r.json(); setSel(c); setCards((x) => x.map((y) => (y.id === c.id ? c : y))); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر البدء"); }
  }
  async function deleteCard() {
    if (!sel) return;
    if (!confirm("حذف هذه البطاقة؟")) return;
    setCards((x) => x.filter((c) => c.id !== sel.id));
    const id = sel.id; setSel(null);
    await fetch(`/api/field/cards?id=${id}`, { method: "DELETE" });
  }

  const isDeliveryKind = (name: string) => cardTypes.find((t) => t.name === name)?.deliveryOnly ?? name === "توصيل";

  if (loading) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col md:h-screen" style={{ background: "linear-gradient(160deg,#1c8fe6 0%,#0f6fbf 60%,#0a4f8a 100%)" }}>
      {/* ترويسة اللوحة */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <span className="text-xl">🛠️</span>
          <h1 className="text-lg font-bold">إدارة الفنيين</h1>
        </div>
        <button onClick={() => router.push("/dashboard")} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">← الرئيسية</button>
      </div>

      {/* الأعمدة */}
      <div className="flex flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
        {lists.map((l) => {
          const listCards = cards.filter((c) => c.listId === l.id).sort((a, b) => a.position - b.position);
          return (
            <div
              key={l.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const c = cards.find((x) => x.id === dragId); if (c) moveCard(c, l.id); setDragId(null); }}
              className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl bg-slate-100 shadow-lg"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="font-bold text-slate-700">{l.name} <span className="text-xs font-normal text-slate-400">({listCards.length})</span></span>
                <div className="flex gap-1 text-slate-400">
                  <button onClick={() => renameList(l)} className="rounded px-1 hover:bg-slate-200" title="إعادة تسمية">✏️</button>
                  <button onClick={() => deleteList(l)} className="rounded px-1 hover:bg-red-100" title="حذف">🗑️</button>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-2">
                {listCards.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onClick={() => setSel(c)}
                    className="cursor-pointer rounded-lg bg-white p-2.5 shadow-sm transition hover:shadow-md"
                  >
                    {/* شريط لون التصنيف (النوع) */}
                    <div className={`mb-1.5 h-1.5 w-10 rounded-full ${kindColor(c.kind)}`} />
                    <div className={`text-sm font-medium text-slate-800 ${c.done ? "line-through opacity-60" : ""}`}>{c.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`rounded px-1.5 py-0.5 font-semibold text-white ${kindColor(c.kind)}`}>{isDeliveryKind(c.kind) ? "🚚" : "🔧"} {c.kind}</span>
                      {c.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {c.assignee}</span>}
                      {c.dueDate && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">📅 {fmtDue(c.dueDate)}</span>}
                      {c.done && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ منجزة {c.amount != null ? `— ${Number(c.amount).toLocaleString("en-US")}` : ""}</span>}
                      {!c.done && c.postponedTo && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">📅 مؤجّلة {fmtDateTime(c.postponedTo)}</span>}
                      {!c.done && !c.postponedTo && c.startedAt && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">⏱ جارية</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* إضافة بطاقة */}
              <div className="p-2">
                {addingTo === l.id ? (
                  <div className="space-y-1.5 rounded-lg bg-white p-2 shadow-inner">
                    <textarea autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} rows={2} placeholder="عنوان البطاقة..." className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <select value={cardKind} onChange={(e) => { if (e.target.value === "__new__") createType(); else setCardKind(e.target.value); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                        {cardTypes.map((t) => <option key={t.id} value={t.name}>{t.deliveryOnly ? "🚚" : "🔧"} {t.name}</option>)}
                        {canManage && <option value="__new__">➕ نوع جديد…</option>}
                      </select>
                      <select value={cardTech} onChange={(e) => setCardTech(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                        <option value="">— بدون فني —</option>
                        {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
                      </select>
                    </div>
                    <input type="date" value={cardDue} onChange={(e) => setCardDue(e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                    <div className="flex gap-1">
                      <button onClick={() => addCard(l.id)} className="flex-1 rounded-lg bg-mynet-blue px-3 py-1 text-sm font-semibold text-white">إضافة البطاقة</button>
                      <button onClick={() => { setAddingTo(null); setCardText(""); setCardTech(""); setCardDue(""); setCardKind("maintenance"); }} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200">✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingTo(l.id); setCardText(""); }} className="w-full rounded-lg px-2 py-1.5 text-right text-sm text-slate-500 hover:bg-slate-200">+ إضافة بطاقة</button>
                )}
              </div>
            </div>
          );
        })}

        {/* إضافة عمود */}
        <div className="w-[280px] shrink-0 rounded-xl bg-white/20 p-2">
          <input value={newList} onChange={(e) => setNewList(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addList()} placeholder="+ إضافة عمود جديد" className="w-full rounded-lg bg-white/90 px-3 py-2 text-sm outline-none" />
          {newList.trim() && <button onClick={addList} className="mt-1 w-full rounded-lg bg-white py-1.5 text-sm font-semibold text-mynet-blue">إضافة العمود</button>}
        </div>
      </div>

      {/* شريط سفلي وسط الصفحة: المكاتب جنب بعض + الفنيون — متاح للجميع (ليساعد الفني مكتباً آخر وقت الضغط) */}
      {offices.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/20 bg-black/25 px-4 py-2.5">
          {offices.map((o) => (
            <button
              key={o.id}
              onClick={() => { setOfficeId(o.id); load(o.id); }}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${officeId === o.id ? "bg-white text-mynet-blue shadow" : "bg-white/20 text-white hover:bg-white/35"}`}
            >
              {o.name ?? `مكتب ${o.id}`}
            </button>
          ))}
          {canManage && (
            <button onClick={() => setTechModal(true)} className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-emerald-600">
              👷 الفنيون ({technicians.length})
            </button>
          )}
          {officeId != null && (
            <button onClick={() => setSupportModal(true)} className="rounded-lg bg-purple-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-purple-600">
              🤝 دعم مؤقت
            </button>
          )}
        </div>
      )}

      {/* تفاصيل البطاقة */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={() => setSel(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <input value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} onBlur={() => saveCard({ title: sel.title })} className="flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-bold text-slate-800 hover:border-slate-200 focus:border-mynet-blue" />
              <button onClick={() => setSel(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            <label className="mb-1 block text-xs font-semibold text-slate-500">الحالة (العمود)</label>
            <select value={sel.listId} onChange={(e) => moveCard(sel, Number(e.target.value))} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            {/* التصنيف: كل نوع مستطيل ملوّن يُضغَط لاختياره (بدل القائمة المنسدلة) */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيف</label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {cardTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => saveCard({ kind: t.name })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white transition ${kindColor(t.name)} ${sel.kind === t.name ? "ring-2 ring-slate-800 ring-offset-1" : "opacity-55 hover:opacity-100"}`}
                >
                  {t.deliveryOnly ? "🚚" : "🔧"} {t.name}
                </button>
              ))}
              {!cardTypes.some((t) => t.name === sel.kind) && (
                <button className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ring-2 ring-slate-800 ring-offset-1 ${kindColor(sel.kind)}`}>{sel.kind}</button>
              )}
              {canManage && (
                <button onClick={createType} className="rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">➕ نوع</button>
              )}
            </div>

            <label className="mb-1 block text-xs font-semibold text-slate-500">الفني المسؤول</label>
            {technicians.length > 0 ? (
              <select
                value={sel.technicianId ?? ""}
                onChange={(e) => {
                  const t = technicians.find((x) => String(x.id) === e.target.value);
                  saveCard({ technicianId: t?.id ?? null, assignee: t?.name ?? null });
                }}
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— بدون فني —</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
              </select>
            ) : (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                لا يوجد فنيون لهذا المكتب بعد{canManage ? " — أضِفهم من زر «الفنيون» بالأعلى" : ""}.
              </div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ الاستحقاق</label>
            <input type="date" value={sel.dueDate ? sel.dueDate.slice(0, 10) : ""} onChange={(e) => saveCard({ dueDate: e.target.value || null })} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />

            {/* المحتوى (التفاصيل) لا يظهر إلا بعد ضغط «بدء» */}
            {(sel.startedAt || sel.done) ? (
              <>
                <label className="mb-1 block text-xs font-semibold text-slate-500">الوصف / التفاصيل</label>
                <textarea value={sel.description ?? ""} onChange={(e) => setSel({ ...sel, description: e.target.value })} onBlur={() => saveCard({ description: sel.description })} rows={4} placeholder="تفاصيل الطلب / الصيانة / التنصيب..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </>
            ) : (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-400">
                🔒 محتوى البطاقة مخفي — اضغط «بدء العمل» لعرض التفاصيل وبدء احتساب الوقت.
                {sel.postponedTo && <div className="mt-2 font-bold text-amber-600">📅 مؤجّلة إلى {fmtDateTime(sel.postponedTo)}</div>}
              </div>
            )}

            {sel.done ? (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="mb-1 font-bold text-emerald-700">✓ منجزة (بانتظار التحصيل)</div>
                {sel.amount != null && <div className="text-slate-600">المبلغ: <b>{Number(sel.amount).toLocaleString("en-US")}</b> د.ع</div>}
                {sel.serviceDetails && <div className="text-slate-600">التفاصيل: {sel.serviceDetails}</div>}
                {sel.durationSec != null && <div className="text-slate-600">⏱ مدة الإنجاز: <b>{fmtDuration(sel.durationSec)}</b></div>}
                {sel.materialsInfo && (() => { try { const m = JSON.parse(sel.materialsInfo) as { name: string; qty: number }[]; return <div className="text-slate-600">المواد: {m.map((x) => `${x.name}×${x.qty}`).join("، ")}</div>; } catch { return null; } })()}
              </div>
            ) : !sel.startedAt ? (
              <button
                onClick={startCard}
                className="mb-3 w-full rounded-lg bg-mynet-blue px-4 py-3 text-base font-bold text-white hover:bg-mynet-blue-dark"
              >
                ▶ بدء العمل
              </button>
            ) : (
              <>
                <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700">⏱ بدأ العمل: {fmtDateTime(sel.startedAt)}</div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setCompleting(sel); setSel(null); }}
                    disabled={sel.technicianId == null}
                    title={sel.technicianId == null ? "وجّه البطاقة لفني أولاً" : ""}
                    className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    ✓ إنجاز
                  </button>
                  <button
                    onClick={() => { setPostponing(sel); setSel(null); }}
                    className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    📅 تأجيل
                  </button>
                </div>
              </>
            )}
            <div className="flex items-center justify-end">
              <button onClick={deleteCard} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">🗑️ حذف البطاقة</button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة التأجيل */}
      {postponing && (
        <PostponeModal
          card={postponing}
          onClose={() => setPostponing(null)}
          onDone={() => { setPostponing(null); load(officeId); }}
        />
      )}

      {/* نافذة الدعم المؤقّت */}
      {supportModal && officeId != null && (
        <SupportModal officeId={officeId} onClose={() => setSupportModal(false)} onChange={() => load(officeId)} />
      )}

      {/* نافذة إنجاز البطاقة بحقولها الواجبة */}
      {completing && (
        <CompletionModal
          card={completing}
          deliveryOnly={isDeliveryKind(completing.kind)}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); load(officeId); }}
        />
      )}

      {/* إدارة الفنيين (إضافة/حذف) — لصاحب صلاحية field.manage */}
      {techModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={() => setTechModal(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">👷 فنيّو {isManager ? (offices.find((o) => o.id === officeId)?.name ?? "المكتب") : "المكتب"}</h3>
              <button onClick={() => setTechModal(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>
            <p className="mb-3 text-xs text-slate-500">أضِف فنيّي هذا المكتب؛ يظهرون كخيارات عند توجيه البطاقات إليهم.</p>

            {/* نموذج الإضافة */}
            <div className="mb-4 flex flex-wrap gap-2">
              <input value={techName} onChange={(e) => setTechName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTechnician()} placeholder="اسم الفني" className="min-w-[140px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input value={techPhone} onChange={(e) => setTechPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTechnician()} placeholder="الهاتف (اختياري)" dir="ltr" className="min-w-[120px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={addTechnician} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark">+ إضافة</button>
            </div>

            {/* قائمة الفنيين */}
            {technicians.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">لا يوجد فنيون بعد</div>
            ) : (
              <ul className="space-y-1.5">
                {technicians.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-700">{t.name}</div>
                      {t.phone && <div className="text-xs text-slate-400" dir="ltr">{t.phone}</div>}
                    </div>
                    <button onClick={() => deleteTechnician(t.id)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">حذف</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== نافذة الدعم المؤقّت (استعارة فني من مكتب آخر) ========== */
type SupportTech = { id: number; name: string; homeOffice: string };
function SupportModal({ officeId, onClose, onChange }: { officeId: number; onClose: () => void; onChange: () => void }) {
  const [borrowed, setBorrowed] = useState<SupportTech[]>([]);
  const [candidates, setCandidates] = useState<SupportTech[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/field/support?officeId=${officeId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setBorrowed(d.borrowed ?? []); setCandidates(d.candidates ?? []); }
    });
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  async function borrow(id: number) {
    setBusy(true);
    await fetch("/api/field/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId: id, officeId }) });
    setBusy(false); load(); onChange();
  }
  async function ret(id: number) {
    setBusy(true);
    await fetch(`/api/field/support?technicianId=${id}`, { method: "DELETE" });
    setBusy(false); load(); onChange();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">🤝 دعم مؤقّت</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        <p className="mb-3 text-xs text-slate-500">استعِر فنياً من مكتب آخر ليعمل مؤقتاً في هذا المكتب وقت الضغط. يظهر ضمن فنّييك ويمكن توجيه البطاقات إليه.</p>

        {borrowed.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-sm font-bold text-purple-700">المُعارون حالياً</div>
            <ul className="space-y-1.5">
              {borrowed.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                  <div><div className="text-sm font-semibold text-slate-700">{t.name}</div><div className="text-xs text-slate-400">من {t.homeOffice}</div></div>
                  <button disabled={busy} onClick={() => ret(t.id)} className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100">↩ إرجاع</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-1.5 text-sm font-bold text-slate-700">فنيّو المكاتب الأخرى</div>
        {candidates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-sm text-slate-400">لا يوجد فنيون متاحون للاستعارة</div>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div><div className="text-sm font-semibold text-slate-700">{t.name}</div><div className="text-xs text-slate-400">من {t.homeOffice}</div></div>
                <button disabled={busy} onClick={() => borrow(t.id)} className="rounded bg-purple-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-600">استعارة</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ========== نافذة تأجيل البطاقة ========== */
function PostponeModal({ card, onClose, onDone }: { card: Card; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit() {
    setErr("");
    if (!when) { setErr("حدّد موعد المشترك (تاريخ ووقت)"); return; }
    setBusy(true);
    const r = await fetch("/api/field/postpone", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, postponeTo: new Date(when).toISOString() }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر التأجيل"); return; }
    onDone();
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-800">📅 تأجيل: {card.title}</h3>
        <p className="mb-3 text-sm text-slate-500">المشترك غير متواجد — حدّد الموعد الذي يريده.</p>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{busy ? "جارٍ…" : "تأجيل"}</button>
          <button onClick={onClose} className="rounded-lg bg-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-300">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

/* ========== نافذة إنجاز البطاقة ========== */
type CustodyMat = { itemId: number; name: string; priceSale: number; available: number };
function CompletionModal({ card, deliveryOnly, onClose, onDone }: { card: Card; deliveryOnly: boolean; onClose: () => void; onDone: () => void }) {
  const isTransfer = card.kind === "تحويل";
  const isDelivery = deliveryOnly && !isTransfer;
  const fullFields = !isDelivery && !isTransfer; // صيانة/تنصيب: تفاصيل + صورة + مواد
  const [details, setDetails] = useState("");
  const [newUser, setNewUser] = useState("");
  const [amount, setAmount] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [mats, setMats] = useState<CustodyMat[]>([]);
  const [picked, setPicked] = useState<Record<number, number>>({}); // itemId -> qty
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!fullFields || card.technicianId == null) return;
    fetch(`/api/field/tech-custody?technicianId=${card.technicianId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMats(d.materials ?? []));
  }, [card.technicianId, fullFields]);

  const materialsTotal = Object.entries(picked).reduce((s, [id, q]) => {
    const m = mats.find((x) => x.itemId === Number(id)); return s + (m ? m.priceSale * q : 0);
  }, 0);
  const nAmount = Number(amount) || 0;
  const salesShare = Math.min(nAmount, materialsTotal);
  const pettyShare = Math.max(0, nAmount - materialsTotal);

  function togglePick(m: CustodyMat) {
    setPicked((p) => { const n = { ...p }; if (n[m.itemId]) delete n[m.itemId]; else n[m.itemId] = 1; return n; });
  }
  function setQty(itemId: number, q: number, max: number) {
    setPicked((p) => ({ ...p, [itemId]: Math.max(1, Math.min(q, max)) }));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setErr("");
    try { setPhoto(await compressImage(f)); } catch { setErr("تعذّر قراءة الصورة"); }
  }

  async function submit() {
    setErr("");
    if (nAmount <= 0) { setErr("المبلغ مطلوب"); return; }
    if (isTransfer) {
      if (!newUser.trim()) { setErr("اليوزر الجديد مطلوب لإنجاز التحويل"); return; }
    } else if (fullFields) {
      if (!details.trim()) { setErr("تفاصيل الصيانة مطلوبة"); return; }
      if (!photo) { setErr("رفع صورة مطلوب"); return; }
    }
    setBusy(true);
    const materials = Object.entries(picked).map(([id, q]) => ({ itemId: Number(id), qty: q }));
    const r = await fetch("/api/field/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, serviceDetails: details, amount: nAmount, newUser, photo, materials }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error ?? "تعذّر الإنجاز"); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{isTransfer ? "🔁 إنجاز تحويل" : isDelivery ? "🚚 إنجاز توصيل" : "🔧 إنجاز صيانة"}: {card.title}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>

        {isTransfer && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">اليوزر الجديد <span className="text-red-500">*</span></label>
            <input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="اكتب اليوزر الجديد للمشترك" dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}

        {fullFields && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">تفاصيل الصيانة <span className="text-red-500">*</span></label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="ماذا تمّ من عمل..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </>
        )}

        <label className="mb-1 block text-xs font-semibold text-slate-500">المبلغ المستلم من الزبون <span className="text-red-500">*</span></label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" dir="ltr" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />

        {fullFields && (
          <>
            <label className="mb-1 block text-xs font-semibold text-slate-500">المواد المُستهلَكة من ذمّتك (اختياري)</label>
            {mats.length === 0 ? (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">لا مواد بذمّتك.</div>
            ) : (
              <div className="mb-3 space-y-1.5">
                {mats.map((m) => {
                  const on = picked[m.itemId] != null;
                  return (
                    <div key={m.itemId} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${on ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
                      <input type="checkbox" checked={on} onChange={() => togglePick(m)} className="h-4 w-4 accent-amber-500" />
                      <span className="flex-1 text-slate-700">{m.name} <span className="text-xs text-slate-400">({m.priceSale.toLocaleString("en-US")} — متاح {m.available})</span></span>
                      {on && <input type="number" value={picked[m.itemId]} min={1} max={m.available} onChange={(e) => setQty(m.itemId, Number(e.target.value), m.available)} className="w-16 rounded border border-slate-300 px-2 py-1 text-sm" dir="ltr" />}
                    </div>
                  );
                })}
              </div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">صورة العمل <span className="text-red-500">*</span></label>
            <input type="file" accept="image/*" capture="environment" onChange={onFile} className="mb-2 w-full text-sm" />
            {photo && <img src={photo} alt="preview" className="mb-3 max-h-40 rounded-lg border border-slate-200" />}
          </>
        )}

        {nAmount > 0 && fullFields && Object.keys(picked).length > 0 && (
          <div className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            <div>قيمة المواد المباعة: <b>{materialsTotal.toLocaleString("en-US")}</b></div>
            <div>يُسجَّل للمبيعات: <b className="text-emerald-700">{salesShare.toLocaleString("en-US")}</b> — للنثرية: <b className="text-blue-700">{pettyShare.toLocaleString("en-US")}</b></div>
          </div>
        )}

        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "جارٍ الإنجاز…" : "✓ تأكيد الإنجاز"}
        </button>
      </div>
    </div>
  );
}

// ضغط الصورة قبل الرفع (تصغير + JPEG) لتفادي تضخّم قاعدة البيانات/الاستضافة
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        let { width, height } = img;
        if (width > max || height > max) {
          if (width > height) { height = Math.round((height * max) / width); width = max; }
          else { width = Math.round((width * max) / height); height = max; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
