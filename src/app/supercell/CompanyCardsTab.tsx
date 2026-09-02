"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Card = { id: number; name: string; phone: string; note: string | null; agentId: number | null; type: string | null; status: string; dueAt: string | null; createdAt: string; source?: string };
type Cfg = { categories: string[]; slaHours: number; agents: { id: number; name: string }[] };

const STATUS_LABEL: Record<string, string> = { new: "بانتظار الاستلام", contacted: "قيد التنفيذ", done: "منجزة", rejected: "مرفوضة" };
const isLate = (c: Card) => c.dueAt != null && c.status !== "done" && c.status !== "rejected" && new Date(c.dueAt).getTime() < Date.now();
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ar", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function CompanyCardsTab({ isManager }: { isManager: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [agentName, setAgentName] = useState<Record<string, string>>({});
  // نموذجُ الرفع
  const [agentId, setAgentId] = useState<number | "">("");
  const [category, setCategory] = useState("");
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [note, setNote] = useState("");
  const [sla, setSla] = useState(24);
  const [raising, setRaising] = useState(false);
  const [raiseMsg, setRaiseMsg] = useState("");
  // المتابعة
  const [filter, setFilter] = useState<"all" | "wait" | "run" | "done" | "late">("all");
  const [q, setQ] = useState("");
  // محرّرُ الفئات (للمدير)
  const [editCats, setEditCats] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [defSla, setDefSla] = useState(24);
  const [newCat, setNewCat] = useState("");
  const [catMsg, setCatMsg] = useState("");

  const loadCards = useCallback(() => {
    fetch("/api/company/tickets").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setCards((d.tickets || []).filter((t: Card) => t.source === "company")); setAgentName(d.agentName || {}); }
    }).catch(() => {});
  }, []);
  const loadCfg = useCallback(() => {
    fetch("/api/company/card-config").then((r) => (r.ok ? r.json() : null)).then((d: Cfg | null) => {
      if (d) { setCfg(d); setCats(d.categories || []); setDefSla(d.slaHours || 24); setSla(d.slaHours || 24); setCategory((c) => (d.categories?.includes(c) ? c : d.categories?.[0] || "")); }
    }).catch(() => {});
  }, []);
  useEffect(() => { loadCfg(); loadCards(); const iv = setInterval(loadCards, 20_000); return () => clearInterval(iv); }, [loadCfg, loadCards]);

  async function raise() {
    if (!agentId || !category) { setRaiseMsg("اختر الوكيل والفئة"); return; }
    setRaising(true); setRaiseMsg("");
    try {
      const r = await fetch("/api/company/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, category, customerName: cName, customerPhone: cPhone, note, slaHours: sla }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRaiseMsg(d.error ?? "فشل الرفع"); return; }
      setRaiseMsg("✓ رُفعت البطاقة — ستظهر في إدارة فنّيّي الوكيل فوراً"); setCName(""); setCPhone(""); setNote(""); loadCards();
    } catch { setRaiseMsg("تعذّر الاتصال"); } finally { setRaising(false); }
  }
  async function saveCats() {
    setCatMsg("");
    if (cats.length === 0) { setCatMsg("أضِف فئةً واحدةً على الأقل"); return; }
    const r = await fetch("/api/company/card-config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: cats, slaHours: defSla }) });
    if (r.ok) { setCatMsg("✓ حُفِظ"); loadCfg(); } else setCatMsg("فشل الحفظ");
  }

  const shown = useMemo(() => {
    let a = cards;
    if (filter === "wait") a = a.filter((c) => c.status === "new");
    else if (filter === "run") a = a.filter((c) => c.status === "contacted");
    else if (filter === "done") a = a.filter((c) => c.status === "done");
    else if (filter === "late") a = a.filter(isLate);
    const qq = q.trim();
    if (qq) a = a.filter((c) => (agentName[String(c.agentId)] || "").includes(qq) || (c.name || "").includes(qq));
    return a;
  }, [cards, filter, q, agentName]);

  const cWait = cards.filter((c) => c.status === "new").length;
  const cRun = cards.filter((c) => c.status === "contacted").length;
  const cDone = cards.filter((c) => c.status === "done").length;
  const cLate = cards.filter(isLate).length;
  const agents = cfg?.agents ?? [];

  return (
    <div className="space-y-4">
      {/* بطاقاتُ الحالة */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["📤", "بانتظار الاستلام", cWait, "slate"], ["⏳", "قيد التنفيذ", cRun, "slate"], ["✅", "منجزة", cDone, "emerald"], ["⚠️", "متجاوزة المهلة", cLate, cLate > 0 ? "rose" : "slate"]] as const).map(([ic, lb, v, tone]) => (
        <div key={lb} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-lg">{ic}</span>
            <span className={`text-2xl font-extrabold ${tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-slate-800"}`} dir="ltr">{v.toLocaleString("en-US")}</span>
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">{lb}</div>
        </div>
        ))}
      </div>

      {/* نموذجُ رفع بطاقة */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-base font-extrabold text-slate-800">📤 رفعُ بطاقةٍ لوكيل</div>
        <div className="mb-3 text-[11px] text-slate-500">تظهرُ فوراً في «تذاكر الشركة» بإدارة الفنيين لدى الوكيل، وتتابعُ حالتَها ومهلتَها هنا.</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">الوكيل
            <select value={agentId} onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : "")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">— اختر الوكيل —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">الفئة
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {(cfg?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">الزبون (اختياريّ)
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="اسمُ الزبون" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">هاتفُ الزبون (اختياريّ)
            <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} dir="ltr" placeholder="07XXXXXXXXX" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">ملاحظاتٌ للوكيل
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="وصفُ الحالة المطلوب معالجتها…" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">المهلة (ساعة)
            <input type="number" min={1} max={720} value={sla} onChange={(e) => setSla(Math.max(1, Math.min(720, Number(e.target.value) || 1)))} dir="ltr" className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => void raise()} disabled={raising || !agentId || !category} className="rounded-lg bg-[#16213e] px-6 py-2 text-sm font-semibold text-white hover:bg-[#26375f] disabled:opacity-50">{raising ? "..." : "📤 رفعُ البطاقة"}</button>
          {raiseMsg && <span className="text-xs text-slate-600">{raiseMsg}</span>}
        </div>
      </div>

      {/* محرّرُ الفئات + المهلة الافتراضيّة (للمدير) */}
      {isManager && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <button onClick={() => setEditCats((v) => !v)} className="text-sm font-bold text-slate-700">{editCats ? "▼" : "◀"} 🏷️ فئاتُ بطاقات الشركة والمهلة الافتراضيّة</button>
          {editCats && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{c}
                    <button onClick={() => setCats(cats.filter((x) => x !== c))} className="text-rose-500 hover:text-rose-700">✕</button>
                  </span>
                ))}
                {cats.length === 0 && <span className="text-xs text-slate-400">لا فئات — أضِف واحدة.</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} placeholder="فئةٌ جديدة" className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                <button onClick={() => { if (newCat.trim()) { setCats([...new Set([...cats, newCat.trim()])]); setNewCat(""); } }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">+ إضافة</button>
                <label className="text-xs font-semibold text-slate-600">المهلة الافتراضيّة (ساعة)
                  <input type="number" min={1} max={720} value={defSla} onChange={(e) => setDefSla(Math.max(1, Math.min(720, Number(e.target.value) || 1)))} dir="ltr" className="mr-1 w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <button onClick={() => void saveCats()} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">حفظ</button>
                {catMsg && <span className="text-xs text-slate-600">{catMsg}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* متابعةُ البطاقات */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-extrabold text-slate-800">🗂️ بطاقاتُ الشركة</div>
            <div className="text-[11px] text-slate-500">التي رفعتها الشركةُ — المعروض {shown.length}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 وكيل أو زبون…" className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-bold">
              {([["all", "الكل"], ["wait", "بانتظار"], ["run", "قيد التنفيذ"], ["done", "منجزة"], ["late", "متجاوزة"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-2.5 py-1 transition ${filter === k ? "bg-[#16213e] text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">لا بطاقات</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500">
                  <th className="p-2">#</th><th className="p-2">الوكيل</th><th className="p-2">الفئة</th><th className="p-2">الزبون</th><th className="p-2">رُفعت</th><th className="p-2">المهلة</th><th className="p-2 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const late = isLate(c);
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="p-2 text-[11px] text-slate-400" dir="ltr">{c.id}</td>
                      <td className="p-2 font-semibold text-slate-800">{agentName[String(c.agentId)] ?? (c.agentId != null ? `وكيل ${c.agentId}` : "—")}</td>
                      <td className="p-2 text-slate-700">{c.type ?? "—"}</td>
                      <td className="p-2 text-slate-600">{c.name && c.name !== c.type ? c.name : "—"}</td>
                      <td className="p-2 text-[11px] text-slate-500">{fmtDate(c.createdAt)}</td>
                      <td className={`p-2 text-[11px] font-semibold ${late ? "text-rose-600" : "text-slate-500"}`}>{fmtDate(c.dueAt)}{late ? " · متجاوَزة" : ""}</td>
                      <td className="p-2 text-center">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${c.status === "done" ? "bg-emerald-100 text-emerald-700" : c.status === "rejected" ? "bg-rose-100 text-rose-700" : late ? "bg-rose-100 text-rose-700" : c.status === "contacted" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                          {late && c.status !== "done" && c.status !== "rejected" ? "متجاوزة" : (STATUS_LABEL[c.status] ?? c.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
