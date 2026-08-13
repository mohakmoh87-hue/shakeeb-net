"use client";

import { useState } from "react";

type CardType = { id: number; name: string; deliveryOnly: boolean; autoAssign?: boolean; execMinutes?: number | null; overrunDeduction?: number | null;
  // نقاطُ الإنجاز: `achievementWeight` ما ضبطه المديرُ (فارغٌ = غيرُ مضبوط، 0 = لا تُحتسَب)،
  // و`builtinWeight` الوزنُ المبنيُّ الذي يُحسَب في الخادم ويُعرَض كقيمةٍ حاليّة.
  achievementWeight?: number | null; builtinWeight?: number };

// إدارة أنواع البطاقات وأوقاتها المسموحة (للمدير): وقت الإنجاز + خصم دقيقة التجاوز.
// التوصيل مُستثنى من الوقت (لا «بدء» ولا خصم).
export default function CardTypeManager({ types, colors, onColor, onClose, onChange }: { types: CardType[]; colors: Record<string, string>; onColor: (name: string, color: string) => void; onClose: () => void; onChange: () => void }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newDelivery, setNewDelivery] = useState(false);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id); setMsg("");
    const r = await fetch("/api/field/card-types", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { setMsg(d.error ?? "تعذّر الحفظ"); return; }
    onChange();
  }
  async function addType() {
    const name = newName.trim();
    if (!name) return;
    setMsg("");
    const r = await fetch("/api/field/card-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, deliveryOnly: newDelivery }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error ?? "تعذّرت الإضافة"); return; }
    setNewName(""); setNewDelivery(false); onChange();
  }
  async function del(t: CardType) {
    if (!confirm(`حذف النوع «${t.name}»؟`)) return;
    const r = await fetch(`/api/field/card-types?id=${t.id}`, { method: "DELETE" });
    if (r.ok) onChange(); else alert("تعذّر الحذف");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">⏱ أنواع البطاقات وأوقاتها</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">✕</button>
        </div>
        <p className="mb-3 text-[11px] text-slate-500">الوقت المسموح + خصم دقيقة التجاوز يُطبَّقان على الأعمدة «المحسوبة بالوقت» فقط. التوصيل مُستثنى.</p>
        {msg && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div>}

        <ul className="mb-4 space-y-2">
          {types.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800">{t.deliveryOnly ? "🚚" : "🔧"} {t.name}</span>
                <div className="flex items-center gap-2">
                  {/* لون النوع: يلوّن رأس عموده وشارته على البطاقات (طلب محمد) */}
                  <input
                    type="color"
                    value={colors[t.name] ?? "#2a5480"}
                    onChange={(e) => onColor(t.name, e.target.value)}
                    title="لون النوع — رأس العمود وشارة البطاقة"
                    className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                  />
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                    <input type="checkbox" checked={t.deliveryOnly} onChange={(e) => patch(t.id, { deliveryOnly: e.target.checked })} /> توصيل
                  </label>
                  {/* توزيع تلقائي: بوّابة النوع — لا تعمل إلا مع مفتاح «التوزيع التلقائي» للمكتب (صفحة المكاتب) */}
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-sky-600"
                    title="تُسنَد بطاقات هذا النوع تلقائياً لصاحب العمل الأقل بين فنيي المكتب الحاضرين — ويلزم تفعيل التوزيع للمكتب أيضاً">
                    <input type="checkbox" checked={!!t.autoAssign} onChange={(e) => patch(t.id, { autoAssign: e.target.checked })} /> 🎯 توزيع تلقائي
                  </label>
                  <button onClick={() => del(t)} className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">حذف</button>
                </div>
              </div>
              {!t.deliveryOnly && (
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="الوقت المسموح (دقيقة)" value={t.execMinutes} disabled={busyId === t.id} onSave={(v) => patch(t.id, { execMinutes: v })} />
                  <NumField label="خصم دقيقة التجاوز" value={t.overrunDeduction} disabled={busyId === t.id} onSave={(v) => patch(t.id, { overrunDeduction: v })} />
                </div>
              )}
              {/* ===== نقاطُ الإنجاز (طلب محمد 2026-08-13) =====
                  «يُعطي المديرُ نقاطاً لكلّ فئةٍ حسب ما يرغب، **ويمكن أن يكون صفراً**،
                   لمتابعة إنجازات الفنيّين.»
                  ⚠️ ويظهر **لكلّ فئةٍ بلا استثناء** — خلافاً للحقلَين أعلاه المحجوبَين عن
                  «التوصيل»: فالتوصيلُ **هو** صاحبُ الوزن الكسريّ (٠٫٢٥) وأوّلُ ما قد يُصفَّر. */}
              <PointsField
                value={t.achievementWeight} builtin={t.builtinWeight ?? 1} disabled={busyId === t.id}
                onSave={(v) => patch(t.id, { achievementWeight: v })}
              />
            </li>
          ))}
        </ul>

        {/* إضافة نوع */}
        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <div className="mb-2 text-sm font-bold text-slate-700">➕ نوع جديد</div>
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addType()} placeholder="اسم النوع" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue" />
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              <input type="checkbox" checked={newDelivery} onChange={(e) => setNewDelivery(e.target.checked)} /> توصيل
            </label>
            <button onClick={addType} className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-bold text-white hover:bg-mynet-blue-dark">إضافة</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// حقل رقمي يحفظ عند الخروج (blur) أو Enter
// ===== حقلُ نقاط الفئة — ولا يصلح `NumField` له =====
// (١) `NumField` يُقرِّب بـ`Math.floor` فيمحو الكسورَ (٠٫٢٥ ← ٠) — والتوصيلُ كسرٌ أصلاً.
// (٢) والفرقُ بين «فارغ» و«صفر» هنا **معنىً لا شكل**، فيلزم بيانُه للمدير بالنصّ لا بالفراغ:
//     فارغٌ = المبنيُّ (يُعرَض رقمُه) · صفرٌ = لا تُحتسَب.
function PointsField({ value, builtin, disabled, onSave }: { value: number | null | undefined; builtin: number; disabled?: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const commit = () => {
    const raw = v.trim();
    const parsed = raw === "" ? null : Number(raw);
    const clean = parsed == null || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
    if ((value ?? null) !== clean) onSave(clean);
  };
  const isZero = (value ?? null) === 0;
  return (
    <label className="mt-2 block">
      <span className="mb-0.5 block text-[11px] font-semibold text-indigo-600">
        🏆 نقاطُ الإنجاز لهذه الفئة
        {isZero
          ? <span className="mr-1 font-normal text-rose-600">— صفر: لا تُحتسَب في الترتيب</span>
          : value == null
            ? <span className="mr-1 font-normal text-slate-400">— غيرُ مضبوطة، تُحسَب بـ{builtin}</span>
            : null}
      </span>
      <input type="number" min={0} step={0.25} value={v} disabled={disabled}
        placeholder={String(builtin)}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        dir="ltr" title="اتركه فارغاً لاستعمال النقاط المبنيّة · واكتب 0 كي لا تُحتسَب هذه الفئةُ إطلاقاً"
        className="w-full rounded-lg border border-indigo-200 px-2.5 py-1.5 text-sm outline-none focus:border-mynet-blue disabled:opacity-50" />
    </label>
  );
}

function NumField({ label, value, disabled, onSave }: { label: string; value: number | null | undefined; disabled?: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const commit = () => { const parsed = v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))); if ((value ?? null) !== parsed) onSave(Number.isNaN(parsed as number) ? null : parsed); };
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold text-slate-500">{label}</span>
      <input type="number" min={0} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-mynet-blue disabled:opacity-50" />
    </label>
  );
}
