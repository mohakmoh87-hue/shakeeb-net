"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MapButton from "@/components/MapButton";
import TechOpsBar from "@/components/TechOpsBar";
import TechnicianManager from "@/components/TechnicianManager";
import LeaveReview from "@/components/LeaveReview";
import CardTypeManager from "@/components/CardTypeManager";
import DeductionReview from "@/components/DeductionReview";
import NotificationsBell from "@/components/NotificationsBell";
import FieldAppMenu from "@/components/FieldAppMenu";

type Board = { id: number; name: string };
type List = { id: number; name: string; position: number; timeTracked?: boolean };
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
type CardType = { id: number; name: string; deliveryOnly: boolean; execMinutes?: number | null; overrunDeduction?: number | null };

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
  const [canOperate, setCanOperate] = useState(true); // الكتابة على المكتب المعروض (الموظف: مكتبه فقط)
  const [myOfficeId, setMyOfficeId] = useState<number | null>(null);
  const [role, setRole] = useState<string>("");
  const [myName, setMyName] = useState("");
  const [myTechId, setMyTechId] = useState<number | null>(null); // معرّف الفني الحالي (للتحويل على نفسه)
  const [techModal, setTechModal] = useState(false);
  const [supportModal, setSupportModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leavePending, setLeavePending] = useState(0);
  const [typesModal, setTypesModal] = useState(false);
  const [dedModal, setDedModal] = useState(false);
  const [dedPending, setDedPending] = useState(0);

  const load = useCallback((office?: number | null) => {
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/board${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) {
        setBoard(d.board); setLists(d.lists); setCards(d.cards);
        setTechnicians(d.technicians ?? []); setOffices(d.offices ?? []);
        setCardTypes(d.cardTypes ?? []); setOfficeId(d.officeId ?? null);
        setIsManager(!!d.isManager); setCanManage(!!d.canManage); setRole(d.role ?? "");
        setCanOperate(d.canOperate !== false); setMyOfficeId(d.myOfficeId ?? null);
      }
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  // اسم الدور الحالي (للفني: اسمه ومعرّفه) — لعرضه في الشريط السفلي وللتحويل على نفسه
  useEffect(() => { fetch("/api/field/whoami").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.name) setMyName(d.name); if (d?.technicianId != null) setMyTechId(d.technicianId); }); }, []);

  // عدد طلبات الإجازة المعلّقة (للمدير) — بشارة على زر الإجازات
  const loadLeavePending = useCallback((office?: number | null) => {
    if (!canManage) return;
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/leaves${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLeavePending(d.pendingCount ?? 0));
  }, [canManage]);
  useEffect(() => { loadLeavePending(officeId); }, [loadLeavePending, officeId]);

  // عدد الخصومات المعلّقة (للمدير) — بشارة على زر الخصومات
  const loadDedPending = useCallback((office?: number | null) => {
    if (!canManage) return;
    const q = office != null ? `?officeId=${office}` : "";
    fetch(`/api/field/adjustments${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setDedPending(d.pendingCount ?? 0));
  }, [canManage]);
  useEffect(() => { loadDedPending(officeId); }, [loadDedPending, officeId]);

  // مبدّل «محسوب بالوقت» لعمود (للمدير)
  async function toggleTimeTracked(l: List) {
    const next = !l.timeTracked;
    setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, timeTracked: next } : x)));
    const r = await fetch("/api/field/lists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id, timeTracked: next }) });
    if (!r.ok) setLists((xs) => xs.map((x) => (x.id === l.id ? { ...x, timeTracked: !next } : x))); // تراجع عند الفشل
  }


  const isTech = role === "technician";
  async function techLogout() {
    await fetch("/api/field/tech-logout", { method: "POST" });
    router.replace("/login");
  }
  async function userLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  // تبديل المكتب — الموظف (غير المدير) يُؤكَّد له الانتقال لغير مكتبه (مشاهدة فقط)
  function switchOffice(id: number) {
    if (id === officeId) return;
    if (!canManage && myOfficeId != null && id !== myOfficeId) {
      const name = offices.find((o) => o.id === id)?.name ?? `مكتب ${id}`;
      if (!confirm(`ستنتقل إلى مكتب «${name}» — مشاهدة فقط بلا تعديل. متابعة؟`)) return;
    }
    setOfficeId(id); load(id);
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
    if (!canOperate) return;
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
    if (!canOperate) return;
    if (card.listId === toListId) return;
    const pos = cards.filter((c) => c.listId === toListId).length;
    setCards((x) => x.map((c) => (c.id === card.id ? { ...c, listId: toListId, position: pos } : c)));
    if (sel?.id === card.id) setSel({ ...sel, listId: toListId });
    await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card.id, listId: toListId, position: pos }) });
  }
  async function saveCard(patch: Partial<Card>) {
    if (!sel || !canOperate) return;
    const merged = { ...sel, ...patch };
    setSel(merged);
    setCards((x) => x.map((c) => (c.id === sel.id ? merged : c)));
    await fetch("/api/field/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel.id, ...patch }) });
  }
  async function startCard() {
    if (!sel || !canOperate) return;
    const r = await fetch("/api/field/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    if (r.ok) { const c = await r.json(); setSel(c); setCards((x) => x.map((y) => (y.id === c.id ? c : y))); }
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر البدء"); }
  }
  async function deleteCard() {
    if (!sel || !canOperate) return;
    if (!confirm("حذف هذه البطاقة؟")) return;
    setCards((x) => x.filter((c) => c.id !== sel.id));
    const id = sel.id; setSel(null);
    await fetch(`/api/field/cards?id=${id}`, { method: "DELETE" });
  }
  // الفني يحوّل بطاقةً على نفسه (كانت على فنيٍّ آخر في نفس مكتبه)
  async function claimCard() {
    if (!sel || myTechId == null) return;
    if (!confirm(`تحويل بطاقة «${sel.title}» عليك؟ ستصبح مسؤولاً عنها بدل ${sel.assignee ?? "الفني الحالي"}.`)) return;
    const r = await fetch("/api/field/claim-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: sel.id }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.card) {
      const c = { ...sel, technicianId: d.card.technicianId, assignee: d.card.assignee };
      setSel(c); setCards((x) => x.map((y) => (y.id === c.id ? c : y)));
    } else alert(d.error ?? "تعذّر التحويل");
  }

  const isDeliveryKind = (name: string) => cardTypes.find((t) => t.name === name)?.deliveryOnly ?? name === "توصيل";

  if (loading) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  return (
    <div data-app-fullheight className="field-canvas flex h-[calc(100dvh-52px)] flex-col md:h-screen">
      {/* ترويسة اللوحة */}
      <div data-app-safetop className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <span className="text-xl">🛠️</span>
          <div className="leading-tight">
            <h1 className="text-lg font-bold">إدارة الفنيين</h1>
            {offices.length > 0 && officeId != null && (
              <div data-app-only className="text-[11px] font-medium text-white/70">🏢 {offices.find((o) => o.id === officeId)?.name ?? `مكتب ${officeId}`}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <NotificationsBell />}
          {isTech ? (
            <button onClick={techLogout} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">خروج ⏻</button>
          ) : (
            <>
              {/* المتصفح: زر الرئيسية · التطبيق: زر خروج (تبديل عبر CSS بلا وميض) */}
              <button data-site-only onClick={() => router.push("/dashboard")} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">← الرئيسية</button>
              <button data-app-only onClick={userLogout} className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30">خروج ⏻</button>
            </>
          )}
        </div>
      </div>

      {/* الأعمدة */}
      <div data-empty={lists.length === 0 ? "1" : undefined} className="flex flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
        {/* حالة فارغة أنيقة (تظهر داخل التطبيق فقط عبر CSS) */}
        {lists.length === 0 && (
          <div data-app-only>
            <div className="flex flex-col items-center gap-3 text-center text-white/85">
              <div className="text-6xl">🗂️</div>
              <div className="text-lg font-bold">لا أعمدة بعد</div>
              <div className="max-w-[240px] text-sm text-white/60">{canManage ? "أضِف أول عمود لتبدأ بتنظيم بطاقات الفنيين" : "لم يُنشئ المدير أعمدة لهذا المكتب بعد"}</div>
            </div>
          </div>
        )}
        {lists.map((l) => {
          const listCards = cards.filter((c) => c.listId === l.id).sort((a, b) => a.position - b.position);
          return (
            <div
              key={l.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (!canOperate || isTech) return; const c = cards.find((x) => x.id === dragId); if (c) moveCard(c, l.id); setDragId(null); }}
              className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl bg-slate-100 shadow-lg"
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="font-bold text-slate-700">
                  {l.name} <span className="text-xs font-normal text-slate-400">({listCards.length})</span>
                  {l.timeTracked && <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-semibold text-sky-700" title="عمود محسوب بالوقت">⏱</span>}
                </span>
                {canManage && (
                  <div className="flex gap-1 text-slate-400">
                    <button onClick={() => toggleTimeTracked(l)} className={`rounded px-1 ${l.timeTracked ? "text-sky-600" : "hover:bg-slate-200"}`} title={l.timeTracked ? "إلغاء الاحتساب بالوقت" : "تفعيل الاحتساب بالوقت"}>⏱</button>
                    <button onClick={() => renameList(l)} className="rounded px-1 hover:bg-slate-200" title="إعادة تسمية">✏️</button>
                    <button onClick={() => deleteList(l)} className="rounded px-1 hover:bg-red-100" title="حذف">🗑️</button>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-2">
                {listCards.map((c) => (
                  <div
                    key={c.id}
                    draggable={canOperate && !isTech}
                    onDragStart={() => canOperate && !isTech && setDragId(c.id)}
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
                    <div className="mt-1.5">
                      <MapButton text={`${c.title}\n${c.description ?? ""}`} towerId={officeId} size="sm" />
                    </div>
                  </div>
                ))}
              </div>

              {/* إضافة بطاقة — للمكتب أو للفني (تُسنَد له تلقائياً) */}
              {canOperate && (
              <div className="p-2">
                {addingTo === l.id ? (
                  <div className="space-y-1.5 rounded-lg bg-white p-2 shadow-inner">
                    <textarea autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} rows={2} placeholder="عنوان البطاقة..." className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className={isTech ? "" : "grid grid-cols-2 gap-1.5"}>
                      <select value={cardKind} onChange={(e) => { if (e.target.value === "__new__") createType(); else setCardKind(e.target.value); }} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                        {cardTypes.map((t) => <option key={t.id} value={t.name}>{t.deliveryOnly ? "🚚" : "🔧"} {t.name}</option>)}
                        {canManage && <option value="__new__">➕ نوع جديد…</option>}
                      </select>
                      {/* الفني تُسنَد له البطاقة تلقائياً — لا يختار فنياً */}
                      {!isTech && (
                        <select value={cardTech} onChange={(e) => setCardTech(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">— بدون فني —</option>
                          {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isSupport ? " (دعم)" : ""}</option>)}
                        </select>
                      )}
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
              )}
            </div>
          );
        })}

        {/* إضافة عمود — للمدير فقط */}
        {canManage && (
          <div className="w-[280px] shrink-0 rounded-xl bg-white/20 p-2">
            <input value={newList} onChange={(e) => setNewList(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addList()} placeholder="+ إضافة عمود جديد" className="w-full rounded-lg bg-white/90 px-3 py-2 text-sm outline-none" />
            {newList.trim() && <button onClick={addList} className="mt-1 w-full rounded-lg bg-white py-1.5 text-sm font-semibold text-mynet-blue">إضافة العمود</button>}
          </div>
        )}
      </div>

      {/* شريط سفلي (صفحة النت فقط، يُخفى داخل التطبيق عبر CSS): المكاتب + الأدوات — تصميم الموقع كما هو */}
      {offices.length > 0 && (
        <div data-site-only className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/20 bg-black/25 px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
          {offices.map((o) => (
            <button
              key={o.id}
              onClick={() => switchOffice(o.id)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${officeId === o.id ? "bg-white text-mynet-blue shadow" : "bg-white/20 text-white hover:bg-white/35"}`}
            >
              {o.name ?? `مكتب ${o.id}`}
            </button>
          ))}
          {(canManage || (!isTech && canOperate)) && (
            <button onClick={() => setTechModal(true)} className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-emerald-600">
              👷 الفنيون ({technicians.length})
            </button>
          )}
          {canManage && (
            <button onClick={() => setLeaveModal(true)} className="relative rounded-lg bg-amber-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-amber-600">
              📅 الإجازات
              {leavePending > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-black/25">{leavePending}</span>}
            </button>
          )}
          {canManage && (
            <button onClick={() => setDedModal(true)} className="relative rounded-lg bg-rose-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-rose-600">
              💠 الخصومات
              {dedPending > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-700 px-1 text-[11px] font-bold text-white ring-2 ring-black/25">{dedPending}</span>}
            </button>
          )}
          {canManage && (
            <button onClick={() => setTypesModal(true)} className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-sky-700">
              ⏱ الأنواع والأوقات
            </button>
          )}
          {officeId != null && (
            <button onClick={() => setSupportModal(true)} className="rounded-lg bg-purple-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-purple-600">
              🤝 دعم مؤقت
            </button>
          )}
        </div>
      )}

      {/* قائمة التطبيق الأنيقة (تظهر داخل التطبيق فقط عبر CSS) — تجمع المكاتب والأدوات */}
      {offices.length > 0 && (
        <div data-app-only>
          <FieldAppMenu
            offices={offices}
            officeId={officeId}
            onSelectOffice={switchOffice}
            canManage={canManage}
            canTechs={canManage || (!isTech && canOperate)}
            techCount={technicians.length}
            leavePending={leavePending}
            dedPending={dedPending}
            onTechs={() => setTechModal(true)}
            onTypes={() => setTypesModal(true)}
            onLeaves={() => setLeaveModal(true)}
            onDeductions={() => setDedModal(true)}
            onSupport={() => setSupportModal(true)}
          />
        </div>
      )}

      {/* تفاصيل البطاقة */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={() => setSel(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <input value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} onBlur={() => saveCard({ title: sel.title })} className="flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-bold text-slate-800 hover:border-slate-200 focus:border-mynet-blue" />
              {/* زر الخريطة — يستخرج اليوزر من عنوان/وصف البطاقة (يدوية أو تلقائية) ويرشد الفني للموقع */}
              <MapButton text={`${sel.title}\n${sel.description ?? ""}`} towerId={officeId} />
              <button onClick={() => setSel(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            {!canOperate && (
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-700">👁️ مشاهدة فقط — بطاقة مكتب آخر (لا يمكنك التعديل)</div>
            )}

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
            {isTech ? (
              // الفني: يرى المسؤول، ويستطيع تحويل البطاقة على نفسه إن كانت على فنيٍّ آخر بمكتبه
              <div className="mb-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  👤 {sel.assignee ?? "بدون فني"}{sel.technicianId != null && sel.technicianId === myTechId ? " (أنت)" : ""}
                </div>
                {!sel.done && sel.technicianId != null && sel.technicianId !== myTechId && (
                  <button onClick={claimCard} className="mt-2 w-full rounded-lg bg-mynet-blue py-2.5 text-sm font-bold text-white hover:bg-mynet-blue-dark">↪️ حوّلها لي</button>
                )}
              </div>
            ) : technicians.length > 0 ? (
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

            {/* المحتوى: يُعرض دائماً (يشاهده الفني قبل البدء)؛ التعديل بعد «بدء» فقط، والبدء لا يزال شرطاً للإنجاز */}
            <label className="mb-1 block text-xs font-semibold text-slate-500">الوصف / التفاصيل</label>
            {(sel.startedAt || sel.done) ? (
              <textarea value={sel.description ?? ""} onChange={(e) => setSel({ ...sel, description: e.target.value })} onBlur={() => saveCard({ description: sel.description })} rows={4} placeholder="تفاصيل الطلب / الصيانة / التنصيب..." className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            ) : (
              <div className="mb-3 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                {sel.description?.trim() ? sel.description : <span className="text-slate-400">لا توجد تفاصيل</span>}
                {sel.postponedTo && <div className="mt-2 font-bold text-amber-600">📅 مؤجّلة إلى {fmtDateTime(sel.postponedTo)}</div>}
                {canOperate && <div className="mt-2 text-[11px] text-slate-400">اضغط «بدء العمل» لبدء احتساب الوقت والتمكّن من التعديل والإنجاز.</div>}
              </div>
            )}

            {/* تنبيه الوقت المسموح — عمود محسوب بالوقت ونوع غير توصيل له وقت */}
            {(() => {
              const lst = lists.find((l) => l.id === sel.listId);
              const ty = cardTypes.find((t) => t.name === sel.kind);
              if (!lst?.timeTracked || ty?.deliveryOnly || !ty?.execMinutes) return null;
              return (
                <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
                  ⏱ عمود محسوب بالوقت — الوقت المسموح لهذا النوع: <b>{ty.execMinutes} دقيقة</b>
                  {(ty.overrunDeduction ?? 0) > 0 && <> · خصم التجاوز <b>{ty.overrunDeduction}</b>/دقيقة</>}
                </div>
              );
            })()}

            {sel.done ? (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="mb-1 font-bold text-emerald-700">✓ منجزة (بانتظار التحصيل)</div>
                {sel.amount != null && <div className="text-slate-600">المبلغ: <b>{Number(sel.amount).toLocaleString("en-US")}</b> د.ع</div>}
                {sel.serviceDetails && <div className="text-slate-600">التفاصيل: {sel.serviceDetails}</div>}
                {sel.durationSec != null && <div className="text-slate-600">⏱ مدة الإنجاز: <b>{fmtDuration(sel.durationSec)}</b></div>}
                {sel.materialsInfo && (() => { try { const m = JSON.parse(sel.materialsInfo) as { name: string; qty: number }[]; return <div className="text-slate-600">المواد: {m.map((x) => `${x.name}×${x.qty}`).join("، ")}</div>; } catch { return null; } })()}
              </div>
            ) : !(canOperate && (!isTech || sel.technicianId === myTechId)) ? (
              // الفني يرى بطاقة زميله بلا أزرار عمل (يحوّلها لنفسه أولاً)
              isTech && sel.technicianId != null && sel.technicianId !== myTechId
                ? <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-400">هذه البطاقة على {sel.assignee ?? "فني آخر"} — حوّلها لك للعمل عليها.</div>
                : null
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
              {canOperate && !isTech && <button onClick={deleteCard} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">🗑️ حذف البطاقة</button>}
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
        <TechnicianManager
          officeId={officeId}
          officeName={isManager ? (offices.find((o) => o.id === officeId)?.name ?? "المكتب") : "المكتب"}
          onClose={() => setTechModal(false)}
          onChange={() => load(officeId)}
        />
      )}

      {leaveModal && (
        <LeaveReview
          officeId={officeId}
          officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"}
          onClose={() => setLeaveModal(false)}
          onChange={() => loadLeavePending(officeId)}
        />
      )}

      {dedModal && (
        <DeductionReview
          officeId={officeId}
          officeName={offices.find((o) => o.id === officeId)?.name ?? "المكتب"}
          onClose={() => setDedModal(false)}
          onChange={() => loadDedPending(officeId)}
        />
      )}

      {typesModal && (
        <CardTypeManager
          types={cardTypes}
          onClose={() => setTypesModal(false)}
          onChange={() => load(officeId)}
        />
      )}

      {/* شريط الفني السفلي: بصمة + عمليات */}
      {role === "technician" && <TechOpsBar techName={myName} />}
    </div>
  );
}

/* ========== نافذة الدعم المؤقّت (استعارة فني من مكتب آخر: بطاقات محدّدة أو يوم كامل) ========== */
type SupportTech = { id: number; name: string; homeOffice: string; supportKind?: string | null };
type SupportCard = { id: number; title: string; kind: string; assignee: string | null };
function SupportModal({ officeId, onClose, onChange }: { officeId: number; onClose: () => void; onChange: () => void }) {
  const [borrowed, setBorrowed] = useState<SupportTech[]>([]);
  const [candidates, setCandidates] = useState<SupportTech[]>([]);
  const [officeCards, setOfficeCards] = useState<SupportCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<SupportTech | null>(null); // الفني الجاري استعارته
  const [kind, setKind] = useState<"day" | "cards">("day");
  const [selCards, setSelCards] = useState<number[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch(`/api/field/support?officeId=${officeId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setBorrowed(d.borrowed ?? []); setCandidates(d.candidates ?? []); setOfficeCards(d.cards ?? []); }
    });
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  function startBorrow(t: SupportTech) { setPicking(t); setKind("day"); setSelCards([]); setMsg(""); }
  const toggleCard = (id: number) => setSelCards((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function confirmBorrow() {
    if (!picking) return;
    if (kind === "cards" && selCards.length === 0) { setMsg("اختر بطاقة واحدة على الأقل"); return; }
    setBusy(true); setMsg("");
    const r = await fetch("/api/field/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technicianId: picking.id, officeId, kind, cardIds: kind === "cards" ? selCards : undefined }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر طلب الدعم"); return; }
    setPicking(null); load(); onChange();
  }
  async function ret(id: number) {
    if (!confirm("إنهاء الدعم وإعادة الفني لمكتبه؟")) return;
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
        <p className="mb-3 text-xs text-slate-500">استعِر فنياً من مكتب آخر ليعمل مؤقتاً في هذا المكتب. تتحوّل بصمته لهذا المكتب، ويعود لمكتبه تلقائياً بإكمال بطاقات الدعم أو بنهاية دوامه بعد بصمة الخروج.</p>
        {msg && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div>}

        {/* اختيار نوع الدعم للفني الجاري استعارته */}
        {picking ? (
          <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
            <div className="mb-2 text-sm font-bold text-slate-800">دعم «{picking.name}» — من {picking.homeOffice}</div>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-white p-1">
              <button onClick={() => setKind("day")} className={`rounded-lg py-2 text-sm font-bold transition ${kind === "day" ? "bg-purple-600 text-white shadow" : "text-slate-500"}`}>دعم يوم كامل</button>
              <button onClick={() => setKind("cards")} className={`rounded-lg py-2 text-sm font-bold transition ${kind === "cards" ? "bg-purple-600 text-white shadow" : "text-slate-500"}`}>بطاقات محدّدة</button>
            </div>
            {kind === "cards" && (
              <div className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
                {officeCards.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-400">لا بطاقات غير منجزة في هذا المكتب</div>
                ) : officeCards.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={selCards.includes(c.id)} onChange={() => toggleCard(c.id)} className="h-4 w-4 accent-purple-600" />
                    <span className="flex-1 truncate text-slate-700">{c.title}</span>
                    <span className="text-[10px] text-slate-400">{c.kind}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={confirmBorrow} disabled={busy} className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60">{busy ? "..." : kind === "cards" ? `تأكيد الدعم (${selCards.length})` : "تأكيد دعم اليوم"}</button>
              <button onClick={() => setPicking(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        ) : (
          <>
            {borrowed.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-sm font-bold text-purple-700">المُعارون حالياً</div>
                <ul className="space-y-1.5">
                  {borrowed.map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                      <div><div className="text-sm font-semibold text-slate-700">{t.name}</div><div className="text-xs text-slate-400">من {t.homeOffice} · {t.supportKind === "cards" ? "بطاقات محدّدة" : "يوم كامل"}</div></div>
                      <button disabled={busy} onClick={() => ret(t.id)} className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100">↩ إنهاء الدعم</button>
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
                    <button disabled={busy} onClick={() => startBorrow(t)} className="rounded bg-purple-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-600">طلب دعم</button>
                  </li>
                ))}
              </ul>
            )}
          </>
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
  const [preparing, setPreparing] = useState(false); // جاري ضغط الصورة
  const [rewardsOn, setRewardsOn] = useState(false); // مكتب المشترك مفعّل للمكافآت
  const [reward, setReward] = useState<{ balance: number; name: string | null } | null>(null); // رصيد مكافأة المشترك (إن وُجد)
  const [rewardPulled, setRewardPulled] = useState(false); // سُحب الكود لهذا الإنجاز
  const [noCode, setNoCode] = useState(false); // «ليس لديه كود» عند السحب
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

  // رصيد مكافأة مشترك البطاقة (لسحبها خصماً) — للصيانة/التوصيل لا التحويل
  useEffect(() => {
    if (isTransfer) return;
    fetch(`/api/rewards/lookup?cardId=${card.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.found) return;
        setRewardsOn(!!d.rewardsEnabled);
        if (d.rewardsEnabled && (d.balance ?? 0) > 0) setReward({ balance: d.balance, name: d.name });
      });
  }, [card.id, isTransfer]);

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
    setErr(""); setPreparing(true);
    try { setPhoto(await compressImage(f)); } catch { setErr("تعذّر قراءة الصورة"); }
    finally { setPreparing(false); }
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
      body: JSON.stringify({ cardId: card.id, serviceDetails: details, amount: nAmount, newUser, photo, materials, useReward: rewardPulled }),
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

        {/* سحب كود مكافأة المشترك خصماً من المبلغ — يظهر دائماً عند تفعيل نظام المكافآت للمكتب */}
        {fullFields && rewardsOn && (
          <div className="mb-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-fuchsia-800">🎁 كود المكافأة</span>
              {!rewardPulled ? (
                <button type="button" onClick={() => { if (reward) setRewardPulled(true); else setNoCode(true); }} disabled={nAmount <= 0} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-700 disabled:opacity-50">سحب كود المكافأة</button>
              ) : (
                <button type="button" onClick={() => setRewardPulled(false)} className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-300">إلغاء السحب</button>
              )}
            </div>
            {noCode && !rewardPulled && <div className="mt-2 text-xs font-semibold text-slate-500">ليس لديه كود</div>}
            {rewardPulled && reward && (
              <div className="mt-2 text-xs text-fuchsia-700">
                خُصم <b>{Math.min(reward.balance, nAmount).toLocaleString("en-US")}</b> د.ع — المتبقّي على الزبون: <b>{Math.max(0, nAmount - reward.balance).toLocaleString("en-US")}</b> د.ع
                {reward.balance > nAmount && <span> (يبقى للمشترك {(reward.balance - nAmount).toLocaleString("en-US")} د.ع)</span>}
              </div>
            )}
          </div>
        )}

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
            <p className="mb-2 text-[11px] text-slate-400">أي حجم صورة مقبول — تُضغط تلقائياً (≤ 1.5MB) قبل الرفع.</p>
            {preparing && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">جاري ضغط الصورة…</div>}
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

// ضغط الصورة تلقائياً قبل الرفع: يقبل أي حجم، ويصغّره حتى يصبح ≤ 1.5MB
// بأعلى جودة ممكنة (بلا حاجة لأن يقلّص الفني الصورة يدوياً).
const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 ميغابايت
// حجم الـ dataURL (base64) بالبايت تقريباً
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // نبدأ بأبعاد كبيرة وجودة عالية، ثم نخفّض تدريجياً حتى ≤ 1.5MB
        const render = (maxDim: number, quality: number): string => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
            else { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no ctx");
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL("image/jpeg", quality);
        };
        try {
          let dim = 1920; // بُعد أقصى مبدئي (جودة عالية)
          let out = render(dim, 0.85);
          // 1) خفّض الجودة أولاً (يحافظ على الأبعاد)
          const qualities = [0.8, 0.72, 0.64, 0.55, 0.45];
          let qi = 0;
          while (dataUrlBytes(out) > MAX_UPLOAD_BYTES && qi < qualities.length) {
            out = render(dim, qualities[qi++]);
          }
          // 2) إن بقيت أكبر: صغّر الأبعاد تدريجياً بجودة ثابتة
          const dims = [1600, 1280, 1024, 800];
          let di = 0;
          while (dataUrlBytes(out) > MAX_UPLOAD_BYTES && di < dims.length) {
            dim = dims[di++];
            out = render(dim, 0.6);
          }
          resolve(out);
        } catch (e) { reject(e as Error); }
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
