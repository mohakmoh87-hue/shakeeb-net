"use client";

import { useCallback, useEffect, useState } from "react";
import SalaryModal from "./SalaryModal";
import TrackModal from "./TrackModal";

type Tech = {
  id: number; name: string; phone: string | null; username: string | null; plainCode?: string | null;
  towerId?: number | null; extraTowerIds?: number[]; isSupport?: boolean; isExtra?: boolean;
  salary?: number | null; shiftStart?: string | null; shiftEnd?: string | null; ownCardsOnly?: boolean; seeDeliveryCards?: boolean; canAddCards?: boolean;
  entryGraceMin?: number | null; exitGraceMin?: number | null; lateRatePerMin?: number | null; overtimeRatePerMin?: number | null; paidLeavesPerMonth?: number | null; missedCheckoutPenalty?: number | null;
  autoCheckoutTime?: string | null;
};
type Form = Record<string, string>;
const EMPTY: Form = { name: "", username: "", code: "", phone: "", salary: "", ownCardsOnly: "", seeDeliveryCards: "", canAddCards: "1", shiftStart: "", shiftEnd: "", entryGraceMin: "0", exitGraceMin: "0", lateRatePerMin: "0", overtimeRatePerMin: "0", paidLeavesPerMonth: "0", missedCheckoutPenalty: "0", autoCheckoutTime: "00:15" };

// إدارة الفنيين للمدير: إضافة/تعديل بكل الإعدادات + حذف نهائي + بصمة خروج يدوية.
export default function TechnicianManager({ officeId, officeName, onClose, onChange }: { officeId: number | null; officeName: string; onClose: () => void; onChange: () => void }) {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [f, setF] = useState<Form>(EMPTY);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [salaryTech, setSalaryTech] = useState<Tech | null>(null);
  const [isManager, setIsManager] = useState(true); // مستخدم المكتب يرى القائمة والتتبع فقط
  const [trackIds, setTrackIds] = useState<number[] | null>(null); // فتح نافذة التتبع بفنيين محدّدين
  // المكاتب الإضافية الدائمة (يضبطها المدير): كل مكاتب الوكيل عدا مكتب الفني الأصلي
  const [allOffices, setAllOffices] = useState<{ id: number; name: string | null }[]>([]);
  const [extraSel, setExtraSel] = useState<Set<number>>(new Set());
  const [editHome, setEditHome] = useState<number | null>(null); // مكتب الفني الأصلي (للاستبعاد)
  useEffect(() => {
    fetch("/api/towers").then((r) => (r.ok ? r.json() : [])).then((d) => setAllOffices(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    fetch(`/api/field/technicians${officeId != null ? `?officeId=${officeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setTechs(d.technicians ?? []); setIsManager(d.isManager !== false); } });
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  function startAdd() { setEditId(null); setF(EMPTY); setExtraSel(new Set()); setEditHome(officeId); setOpenForm(true); setMsg(""); }
  function startEdit(t: Tech) {
    setEditId(t.id);
    setF({
      name: t.name ?? "", username: t.username ?? "", code: "", phone: t.phone ?? "",
      salary: String(t.salary ?? ""), shiftStart: t.shiftStart ?? "", shiftEnd: t.shiftEnd ?? "", ownCardsOnly: t.ownCardsOnly ? "1" : "",
      seeDeliveryCards: t.seeDeliveryCards ? "1" : "",
      canAddCards: t.canAddCards === false ? "" : "1", // الغياب/القديم = مسموح
      entryGraceMin: String(t.entryGraceMin ?? 0), exitGraceMin: String(t.exitGraceMin ?? 0),
      lateRatePerMin: String(t.lateRatePerMin ?? 0), overtimeRatePerMin: String(t.overtimeRatePerMin ?? 0), paidLeavesPerMonth: String(t.paidLeavesPerMonth ?? 0),
      missedCheckoutPenalty: String(t.missedCheckoutPenalty ?? 0),
      autoCheckoutTime: t.autoCheckoutTime ?? "00:15",
    });
    setExtraSel(new Set(t.extraTowerIds ?? []));
    setEditHome(t.towerId ?? officeId);
    setOpenForm(true); setMsg("");
  }

  async function save() {
    setBusy(true); setMsg("");
    const body: Record<string, unknown> = { ...f, officeId };
    if (editId) { body.id = editId; body.extraTowerIds = [...extraSel]; if (editHome != null) body.towerId = editHome; }
    const r = await fetch("/api/field/technicians", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setOpenForm(false); setF(EMPTY); setEditId(null); load(); onChange(); }
    else setMsg(d.error ?? "تعذّر الحفظ");
  }
  async function del(t: Tech) {
    if (!confirm(`حذف الفني «${t.name}» نهائياً من قاعدة البيانات؟ لا يمكن التراجع.`)) return;
    const r = await fetch(`/api/field/technicians?id=${t.id}`, { method: "DELETE" });
    if (r.ok) { load(); onChange(); } else alert("تعذّر الحذف");
  }
  // مسح بصمة الفني: يزيل تسجيله ليُطلب منه تسجيل بصمة جديدة على جهازه عند أول استخدام
  async function clearBio() {
    if (editId == null) return;
    if (!confirm("مسح بصمة هذا الفني؟ سيُطلب منه تسجيل بصمة جديدة على جهازه عند أول تثبيت حضور.")) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/field/biometric?technicianId=${editId}`, { method: "DELETE" });
    setBusy(false);
    setMsg(r.ok ? "مُسحت بصمة الفني ✓ — سيسجّل واحدة جديدة" : "تعذّر مسح البصمة");
  }
  // مسح بصمات جميع الفنيين دفعةً واحدة — يعيد كلٌّ تسجيل بصمته على هاتفه عند أول حضور
  async function clearAllBio() {
    if (!confirm("مسح بصمات جميع الفنيين؟ سيُطلب من كل فني تسجيل بصمته من جديد على هاتفه عند أول تثبيت حضور. (لا يمسّ سجلّ الحضور اليومي.)")) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/field/biometric?all=1", { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `مُسحت بصمات ${d.cleared ?? 0} فني ✓ — سيسجّلون من جديد` : (d.error ?? "تعذّر المسح"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">👷 فنيّو {officeName}</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm hover:bg-slate-100">✕</button>
        </div>

        {!openForm && isManager && (
          <button onClick={startAdd} className="mb-3 w-full rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 py-3.5 text-base font-extrabold text-white shadow-md active:scale-[0.99]">➕ إضافة فني جديد</button>
        )}
        {!openForm && isManager && techs.length > 0 && (
          <button onClick={clearAllBio} disabled={busy} className="mb-3 w-full rounded-2xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-60">🧬 مسح بصمات جميع الفنيين (تسجيل جديد)</button>
        )}
        {!openForm && techs.length > 0 && (
          <button onClick={() => setTrackIds(techs.map((t) => t.id))} className="mb-4 w-full rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 py-3 text-base font-extrabold text-white shadow-md active:scale-[0.99]">📍 تتبع موقع الجميع</button>
        )}

        {openForm && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-bold text-slate-700">{editId ? "تعديل فني" : "فني جديد"}</div>
            {msg && <div className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{msg}</div>}
            <div className="grid grid-cols-2 gap-2">
              <L label="اسم الفني"><I v={f.name} on={(v) => set("name", v)} /></L>
              <L label="الهاتف (اختياري)"><I v={f.phone} on={(v) => set("phone", v)} ltr /></L>
              <L label="اسم المستخدم (فريد)"><I v={f.username} on={(v) => set("username", v)} ltr /></L>
              <L label={editId ? "رمز الدخول (اتركه فارغاً لإبقائه)" : "رمز الدخول"}><I v={f.code} on={(v) => set("code", v)} ltr /></L>
              <L label="الراتب الشهري"><I v={f.salary} on={(v) => set("salary", v)} num /></L>
              <L label="عدد إجازات الراتب/شهر"><I v={f.paidLeavesPerMonth} on={(v) => set("paidLeavesPerMonth", v)} num /></L>
              <L label="بداية الدوام"><I v={f.shiftStart} on={(v) => set("shiftStart", v)} time /></L>
              <L label="نهاية الدوام"><I v={f.shiftEnd} on={(v) => set("shiftEnd", v)} time /></L>
              <L label="سماحية الدخول (دقيقة)"><I v={f.entryGraceMin} on={(v) => set("entryGraceMin", v)} num /></L>
              <L label="سماحية الخروج (دقيقة)"><I v={f.exitGraceMin} on={(v) => set("exitGraceMin", v)} num /></L>
              <L label="سعر دقيقة الخصم"><I v={f.lateRatePerMin} on={(v) => set("lateRatePerMin", v)} num /></L>
              <L label="سعر دقيقة الإضافي"><I v={f.overtimeRatePerMin} on={(v) => set("overtimeRatePerMin", v)} num /></L>
              <L label="غرامة نسيان الخروج"><I v={f.missedCheckoutPenalty} on={(v) => set("missedCheckoutPenalty", v)} num /></L>
              {/* وقتُ الخروج التلقائي لكلّ فنيّ (طلب محمد 2026-08-20) — يقبل ما بعد منتصف
                  الليل: القاعدة «أوّلُ حلولٍ للساعة بعد بصمة دخوله». المختومُ يبقى نهايةَ دوامه. */}
              <L label="وقت الخروج التلقائي"><I v={f.autoCheckoutTime} on={(v) => set("autoCheckoutTime", v)} time /></L>
            </div>

            {/* «رؤية بطاقاته فقط» — الخانة التي كانت ناقصة (تصحيح 2026-08-05).
                الميزة كانت مبنيّة كاملةً: العمود في القاعدة، وقبولها في الحفظ، وتطبيقها
                في لوحة الفني — إلا **الخانة نفسها**، فلم يكن لمحمد سبيل لتشغيلها إطلاقاً. */}
            <label className={`mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${f.ownCardsOnly === "1" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
              <input
                type="checkbox" checked={f.ownCardsOnly === "1"}
                onChange={(e) => set("ownCardsOnly", e.target.checked ? "1" : "")}
                className="mt-0.5 h-4 w-4 accent-amber-600"
              />
              <span>
                <span className="block text-xs font-bold text-slate-700">👁️ رؤية بطاقاته فقط</span>
                <span className="block text-[11px] leading-5 text-slate-500">لا يرى بطاقات زملائه ولا البطاقات غير الموجَّهة لأحد — يرى ما أُسند إليه وحده.</span>
              </span>
            </label>

            {/* الحالة الثالثة (طلب محمد 2026-08-09): بطاقاته **زائداً** بطاقات التوصيل ولو لم تُسنَد إليه.
                تظهر تحت «رؤية بطاقاته فقط» لأنّها تخفيفٌ لها لا خيارٌ مستقلّ — ومن يرى الكلّ لا يحتاجها. */}
            {f.ownCardsOnly === "1" && (
              <label className={`mt-2 ms-6 flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${f.seeDeliveryCards === "1" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                <input
                  type="checkbox" checked={f.seeDeliveryCards === "1"}
                  onChange={(e) => set("seeDeliveryCards", e.target.checked ? "1" : "")}
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                />
                <span>
                  <span className="block text-xs font-bold text-slate-700">🚚 رؤية بطاقات التوصيل</span>
                  <span className="block text-[11px] leading-5 text-slate-500">
                    يرى أيضاً كلّ بطاقةٍ من فئةٍ موسومةٍ بـ«توصيل» (كعمود «جباية» إن وُضع عليه صحّ التوصيل) ولو لم تُسنَد إليه.
                    رؤيةٌ فقط — الإسناد يبقى كما هو.
                  </span>
                </span>
              </label>
            )}

            {/* «إضافة بطاقات» (طلب محمد 2026-08-09): خيارٌ مستقلٌّ عن الرؤية — مسموحٌ افتراضيّاً
                كي لا يتأثّر عمل الوكلاء القائمين، وإطفاؤه يمنع الفنيّ من إنشاء بطاقةٍ من تطبيقه. */}
            <label className={`mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${f.canAddCards === "1" ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}>
              <input
                type="checkbox" checked={f.canAddCards === "1"}
                onChange={(e) => set("canAddCards", e.target.checked ? "1" : "")}
                className="mt-0.5 h-4 w-4 accent-sky-600"
              />
              <span>
                <span className="block text-xs font-bold text-slate-700">➕ إضافة بطاقات</span>
                <span className="block text-[11px] leading-5 text-slate-500">
                  يستطيع الفنيّ إنشاء بطاقةٍ جديدة من تطبيقه (تُسنَد إليه). بإطفائه يختفي الزرّ ويُرَدّ أيّ إنشاءٍ من الخادم.
                </span>
              </span>
            </label>

            {/* المكتب الأصلي (قابل للتغيير) + المكاتب الإضافية الدائمة — للمدير عند التعديل.
                تغيير الأصلي يُنقّيه من الإضافية تلقائياً، وكل بطاقة تُحسب لمكتبها */}
            {editId != null && allOffices.length > 0 && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
                <label className="mb-1 block text-xs font-bold text-indigo-800">🏢 المكتب الأصلي (يمكن تغييره)</label>
                <select
                  value={editHome ?? ""}
                  onChange={(e) => { const v = Number(e.target.value) || null; setEditHome(v); setExtraSel((s) => { const n = new Set(s); if (v != null) n.delete(v); return n; }); }}
                  className="mb-2 w-full rounded-lg border border-indigo-300 bg-white px-2 py-1.5 text-sm"
                >
                  {allOffices.map((o) => <option key={o.id} value={o.id}>{o.name ?? `مكتب ${o.id}`}</option>)}
                </select>
                {allOffices.filter((o) => o.id !== editHome).length > 0 && (<>
                {/* أ-١١ · صار الشرحُ يذكر **البصمة** (2026-08-13): الخانةُ كانت تعني اللوحاتَ
                    والذممَ وحدَها، ومسارُ البصمة لا يعرفها — فأُكمل في أ-١٠. والمديرُ يجب أن يعلم
                    أنّ إشارةً واحدةً صارت تُبيح البصمَ في المكتب أيضاً، وإلّا منح إذناً لا يقصده. */}
                <div className="mb-1.5 text-[11px] text-slate-600">
                  مكاتب إضافية — <b>يبصم فيها</b> ويشوف تكتاتها وينفذها ويأخذ ذمماً منها كأنه فني أصلي فيها
                  (كل بطاقة تُحسب لمكتبها):
                </div>
                <div className="mb-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
                  🗓️ وحضورُه ومالُه يبقيان على <b>مكتبه الأصليّ</b> أعلاه — يبصم من أيّ مكتبٍ منها
                  ويُحتسَب اليومُ لمكتبه، ويُسجَّل مكانُ بصمته في سجلّ حضوره.
                  <br />📍 وإن كان مكتبٌ منها <b>بلا موقعٍ محدَّد</b> فلن يُعرَف أنّه فيه — فحدِّد موقعَه
                  من صفحة المكاتب كي يستطيع البصمَ منه.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allOffices.filter((o) => o.id !== editHome).map((o) => {
                    const on = extraSel.has(o.id);
                    return (
                      <label key={o.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${on ? "border-indigo-400 bg-indigo-100 text-indigo-800" : "border-slate-200 bg-white text-slate-600"}`}>
                        <input
                          type="checkbox" checked={on}
                          onChange={() => setExtraSel((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })}
                          className="h-3.5 w-3.5 accent-indigo-600"
                        />
                        {o.name ?? `مكتب ${o.id}`}
                      </label>
                    );
                  })}
                </div>
                </>)}
              </div>
            )}

            {/* مسح البصمة: يُجبر الفني على تسجيل بصمة جديدة على جهازه (تبديل هاتف/إعادة ضبط) */}
            {editId != null && (
              <button onClick={clearBio} disabled={busy} className="mt-3 w-full rounded-lg border border-rose-200 bg-rose-50 py-2 text-sm font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-60">🧬 مسح بصمة الفني (يُعيد تسجيلها)</button>
            )}

            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={busy} className="flex-1 rounded-lg bg-mynet-blue py-2 font-bold text-white hover:bg-mynet-blue-dark disabled:opacity-60">{busy ? "..." : "حفظ"}</button>
              <button onClick={() => { setOpenForm(false); setEditId(null); }} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        )}

        {techs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">لا يوجد فنيون بعد</div>
        ) : (
          <ul className="space-y-3">
            {techs.map((t) => (
              <li key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {/* معلومات الفني */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl">👷</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-slate-800">{t.name}</div>
                    <div className="truncate text-xs text-slate-500" dir="ltr">👤 {t.username ?? "—"}{t.plainCode ? ` · 🔑 ${t.plainCode}` : ""}</div>
                    {isManager && <div className="mt-0.5 text-xs text-slate-500">{t.shiftStart && t.shiftEnd ? `⏰ ${t.shiftStart}–${t.shiftEnd}` : "بلا دوام"} · راتب {Number(t.salary ?? 0).toLocaleString("en-US")}</div>}
                  </div>
                </div>
                {/* الخيارات — مربعات واضحة (مستخدم المكتب: التتبع فقط) */}
                {isManager ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Act onClick={() => setTrackIds([t.id])} cls="bg-sky-50 text-sky-700" icon="📍" label="تتبع الموقع" />
                    <Act onClick={() => setSalaryTech(t)} cls="bg-emerald-50 text-emerald-700" icon="💰" label="الراتب" />
                    {/* ═════ الحضورُ كلُّه في زرّه المستقلّ (قرارُ محمد 2026-08-14) ═════
                        «أيُّ شيءٍ يتعلّق بحضور الفنيّين يجب أن يكون في الزرّ الجديد» — فنُقلت
                        ميزاتُ النافذة (السجلّ · حذفُ بصمة · الخروجُ اليدويّ · إضافةُ يومٍ كامل)
                        إلى صفحة «بصمات الحضور»، وهذا الزرُّ يقود إليها مفتوحةً على هذا الفنيّ.
                        فلا وظيفةَ تُفقَد ولا تعريفَ يُكرَّر في مكانَين. */}
                    <Act onClick={() => { window.location.href = `/attendance?tech=${t.id}`; }} cls="bg-amber-50 text-amber-700" icon="🗓️" label="الحضور" />
                    <Act onClick={() => startEdit(t)} cls="bg-slate-100 text-slate-600" icon="✏️" label="تعديل" />
                    <Act onClick={() => del(t)} cls="bg-rose-50 text-rose-600" icon="🗑️" label="حذف" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    <Act onClick={() => setTrackIds([t.id])} cls="bg-sky-50 text-sky-700" icon="📍" label="تتبع الموقع" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {salaryTech && (
        <SalaryModal technicianId={salaryTech.id} name={salaryTech.name} onClose={() => setSalaryTech(null)} onSettled={onChange} />
      )}
      {trackIds && (
        <TrackModal techs={techs.map((t) => ({ id: t.id, name: t.name }))} initialIds={trackIds} onClose={() => setTrackIds(null)} />
      )}

    </div>
  );
}

// زر إجراء كمربّع واضح (أيقونة فوق التسمية)
function Act({ onClick, cls, icon, label }: { onClick: () => void; cls: string; icon: string; label: string }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 rounded-xl py-2.5 font-bold transition active:scale-95 ${cls}`}>
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-slate-500">{label}</span>{children}</label>;
}
function I({ v, on, ltr, num, time }: { v: string; on: (s: string) => void; ltr?: boolean; num?: boolean; time?: boolean }) {
  return <input value={v} onChange={(e) => on(e.target.value)} dir={ltr || num || time ? "ltr" : undefined} type={num ? "number" : time ? "time" : "text"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-mynet-blue" />;
}
