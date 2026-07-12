"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Board = { id: number; name: string };
type List = { id: number; name: string; position: number };
type Card = {
  id: number; listId: number; title: string; description: string | null;
  assignee: string | null; label: string | null; dueDate: string | null;
  position: number; done: boolean;
};
type Office = { id: number; name: string | null };
type Technician = { id: number; name: string; phone: string | null };

const LABELS = [
  { key: "red", cls: "bg-red-500", name: "عاجل" },
  { key: "amber", cls: "bg-amber-500", name: "مهم" },
  { key: "green", cls: "bg-emerald-500", name: "عادي" },
  { key: "blue", cls: "bg-blue-500", name: "متابعة" },
  { key: "purple", cls: "bg-purple-500", name: "أخرى" },
];
const labelCls = (k: string | null) => LABELS.find((l) => l.key === k)?.cls ?? "";
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
  const [sel, setSel] = useState<Card | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  // الفنيون والمكاتب (لوحة مستقلّة لكل مكتب، والمدير يختار المكتب)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState<number | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [techName, setTechName] = useState("");
  const [techPhone, setTechPhone] = useState("");

  const load = useCallback((office?: number | null) => {
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/board${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setBoard(d.board); setLists(d.lists); setCards(d.cards);
        setTechnicians(d.technicians ?? []); setOffices(d.offices ?? []);
        setOfficeId(d.officeId ?? null); setIsManager(!!d.isManager); setCanManage(!!d.canManage);
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

  async function addCard(listId: number) {
    const title = cardText.trim();
    if (!title) { setAddingTo(null); return; }
    setCardText("");
    const r = await fetch("/api/field/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, title }) });
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
  async function deleteCard() {
    if (!sel) return;
    if (!confirm("حذف هذه البطاقة؟")) return;
    setCards((x) => x.filter((c) => c.id !== sel.id));
    const id = sel.id; setSel(null);
    await fetch(`/api/field/cards?id=${id}`, { method: "DELETE" });
  }

  if (loading) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  return (
    <div className="flex h-[calc(100dvh-52px)] flex-col md:h-screen" style={{ background: "linear-gradient(160deg,#1c8fe6 0%,#0f6fbf 60%,#0a4f8a 100%)" }}>
      {/* ترويسة اللوحة */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <span className="text-xl">🛠️</span>
          <h1 className="text-lg font-bold">إدارة الفنيين</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* اختيار المكتب — للمدير فقط (لوحة مستقلّة لكل مكتب) */}
          {isManager && offices.length > 0 && (
            <select
              value={officeId ?? ""}
              onChange={(e) => { const v = Number(e.target.value); setOfficeId(v); load(v); }}
              className="rounded-lg border border-white/30 bg-white/90 px-3 py-1.5 text-sm font-semibold text-slate-700 outline-none"
            >
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
            </select>
          )}
          {/* إدارة الفنيين — تظهر بصلاحية field.manage فقط */}
          {canManage && (
            <button onClick={() => setTechModal(true)} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/30">
              👷 الفنيون ({technicians.length})
            </button>
          )}
          <button onClick={() => router.push("/dashboard")} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">← الرئيسية</button>
        </div>
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
                    {c.label && <div className={`mb-1.5 h-1.5 w-10 rounded-full ${labelCls(c.label)}`} />}
                    <div className={`text-sm font-medium text-slate-800 ${c.done ? "line-through opacity-60" : ""}`}>{c.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {c.assignee && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">👤 {c.assignee}</span>}
                      {c.dueDate && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">📅 {fmtDue(c.dueDate)}</span>}
                      {c.done && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ منجزة</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* إضافة بطاقة */}
              <div className="p-2">
                {addingTo === l.id ? (
                  <div className="space-y-1">
                    <textarea autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCard(l.id); } }} rows={2} placeholder="عنوان البطاقة..." className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className="flex gap-1">
                      <button onClick={() => addCard(l.id)} className="rounded-lg bg-mynet-blue px-3 py-1 text-sm font-semibold text-white">إضافة</button>
                      <button onClick={() => { setAddingTo(null); setCardText(""); }} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200">✕</button>
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

            <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيف</label>
            <div className="mb-3 flex gap-1.5">
              {LABELS.map((lb) => (
                <button key={lb.key} onClick={() => saveCard({ label: sel.label === lb.key ? null : lb.key })} title={lb.name} className={`h-7 flex-1 rounded ${lb.cls} ${sel.label === lb.key ? "ring-2 ring-slate-800 ring-offset-1" : "opacity-70"}`} />
              ))}
            </div>

            <label className="mb-1 block text-xs font-semibold text-slate-500">الفني المسؤول</label>
            {technicians.length > 0 ? (
              <select
                value={technicians.some((t) => t.name === sel.assignee) ? (sel.assignee ?? "") : ""}
                onChange={(e) => saveCard({ assignee: e.target.value || null })}
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— بدون فني —</option>
                {technicians.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            ) : (
              <div className="mb-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
                لا يوجد فنيون لهذا المكتب بعد{canManage ? " — أضِفهم من زر «الفنيون» بالأعلى" : ""}.
              </div>
            )}

            <label className="mb-1 block text-xs font-semibold text-slate-500">تاريخ الاستحقاق</label>
            <input type="date" value={sel.dueDate ? sel.dueDate.slice(0, 10) : ""} onChange={(e) => saveCard({ dueDate: e.target.value || null })} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />

            <label className="mb-1 block text-xs font-semibold text-slate-500">الوصف / التفاصيل</label>
            <textarea value={sel.description ?? ""} onChange={(e) => setSel({ ...sel, description: e.target.value })} onBlur={() => saveCard({ description: sel.description })} rows={4} placeholder="تفاصيل الطلب / الصيانة / التنصيب..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={sel.done} onChange={(e) => saveCard({ done: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                منجزة
              </label>
              <button onClick={deleteCard} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">🗑️ حذف البطاقة</button>
            </div>
          </div>
        </div>
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
