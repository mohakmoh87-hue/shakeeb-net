"use client";

import { useCallback, useEffect, useState } from "react";

// ===== «سلامة المال» (طلب محمد 2026-08-12) =====
// «يكون في حسابات المدير **سلامة المال**، وعند الضغط عليه تُفتح صفحةٌ فيها الحالاتُ الموجودة
// **ولا تكرارَ فيها أبداً**، وكلُّ حالةٍ فيها تفاصيلُها وطريقةُ حلّها… ويمكنه ضغط **تجاهل** فلا
// تُعاد له مرّةً أخرى. **ولا داعيَ لتنبيهٍ بالإيميل ولا أيّ شيءٍ آخر** — فالوكيلُ عندما يرى خللاً
// ماليّاً يتوجّه إلى هذه الصفحة ليرى كلّ شيء.»
//
// ⚠️ وأمّا «الحلُّ بضغطة زر»: الحالاتُ الستُّ الحاليّةُ **كلُّها قراراتُ مالٍ لا صيانةَ بيانات**
// (أيُبطَل القيدُ أم يُعاد الوصل؟ أيُردُّ الرصيدُ نقداً أم يبقى؟). وزرٌّ يُقرّر عن محمد في مالٍ
// خطرٌ لا خدمة — فالبرنامجُ **لا يُخمّن في مال**. فلكلّ حالةٍ **طريقةُ حلٍّ مكتوبةٌ بالضبط** وزرٌّ
// يأخذه إلى الشاشة الصحيحة، و«تجاهل» لِما راجعه وأقرّه.

type Case = {
  checkKey: string; rowKey: string; title: string; detail: string; how: string;
  severity: "critical" | "warn" | "info"; amount?: number; at?: string;
};
type Check = { key: string; name: string; ok: boolean; cases: Case[]; note?: string; hiddenCount?: number };
type Health = {
  healthy: boolean; openCases: number; critical: number;
  checks: Check[]; summary: Record<string, number>; ignoredCount: number;
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");

const TONE: Record<Case["severity"], { box: string; chip: string; label: string }> = {
  critical: { box: "border-red-300 bg-red-50", chip: "bg-red-600 text-white", label: "حرِج" },
  warn: { box: "border-amber-300 bg-amber-50", chip: "bg-amber-500 text-white", label: "تنبيه" },
  info: { box: "border-slate-300 bg-slate-50", chip: "bg-slate-500 text-white", label: "للعلم" },
};

export default function MoneyHealthButton() {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState<Health | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/money-health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setH(d); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ignore(c: Case) {
    const note = window.prompt(`تجاهُلُ هذه الحالة فلا تُعاد:\n${c.title}\n\nسببُ التجاهل (اختياريّ):`);
    if (note === null) return; // أُلغي
    setBusy(c.rowKey); setMsg("");
    const r = await fetch("/api/money-health", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkKey: c.checkKey, rowKey: c.rowKey, note: note || undefined }),
    });
    setBusy(null);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? "تعذّر التجاهل"); return; }
    setMsg("تُجوهلت الحالةُ — ولن تُعاد ✓");
    load();
  }

  if (!h) return null;

  return (
    <>
      {/* البطاقةُ في حسابات المدير — مكشوفةٌ دائماً (لا تحت قائمةٍ منسدلة) */}
      <div onClick={() => setOpen(true)}
        className={`cursor-pointer rounded-xl border p-4 text-center shadow-sm transition hover:shadow ${h.healthy ? "border-emerald-200 bg-emerald-50" : (h.critical > 0 ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50")}`}>
        <div className="text-sm text-slate-600">🛡️ سلامة المال</div>
        <div className={`text-2xl font-extrabold ${h.healthy ? "text-emerald-700" : (h.critical > 0 ? "text-red-700" : "text-amber-700")}`}>
          {h.healthy ? "سليم" : `${fmt(h.openCases)} حالة`}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-mynet-blue">{h.healthy ? "لا خللَ في دفترك" : `منها ${fmt(h.critical)} حرجة`} ↗</span>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-extrabold text-slate-800">🛡️ سلامة المال</h3>
                <div className="mt-1 text-sm text-slate-500">
                  {h.healthy ? "كلُّ الحقائق سليمة — لا خللَ في دفترك" : `${fmt(h.openCases)} حالةٌ مفتوحة · منها ${fmt(h.critical)} حرجة`}
                  {h.ignoredCount > 0 && <> · <span className="text-slate-400">مُتجاهَلةٌ سابقاً: {fmt(h.ignoredCount)}</span></>}
                </div>
              </div>
              {/* الإغلاقُ بعلامةٍ واضحةٍ — لا بالضغط على الفراغ */}
              <button onClick={() => setOpen(false)} aria-label="إغلاق"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 hover:bg-slate-200">✕</button>
            </div>

            {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

            {/* الحقائقُ السبع: السليمُ سطرٌ أخضرُ مختصر، وذاتُ الحالاتِ مفصَّلة */}
            <div className="mb-4 space-y-3">
              {h.checks.map((c) => (
                <div key={c.key}>
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${c.ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                    <span>{c.ok ? "✅" : "🔴"}</span>
                    <span className="min-w-0 flex-1">{c.name}</span>
                    {!c.ok && <span className="rounded bg-white px-1.5 py-0.5 text-xs">{c.cases.length}</span>}
                    {(c.hiddenCount ?? 0) > 0 && <span className="text-[11px] font-normal text-slate-400">({c.hiddenCount} مُتجاهَلة)</span>}
                  </div>
                  {c.note && <div className="mt-1 px-3 text-[11px] text-amber-700">{c.note}</div>}

                  {c.cases.map((x) => (
                    <div key={x.rowKey} className={`mt-2 rounded-xl border p-3.5 ${TONE[x.severity].box}`}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TONE[x.severity].chip}`}>{TONE[x.severity].label}</span>
                        <span className="text-base font-bold text-slate-800">{x.title}</span>
                        {x.amount ? <span className="text-base font-extrabold text-slate-900">{fmt(x.amount)} د.ع</span> : null}
                      </div>
                      <div className="mb-2 text-sm text-slate-700">{x.detail}</div>
                      <div className="mb-2.5 rounded-lg bg-white/70 p-2.5 text-sm text-slate-600">
                        <b className="text-slate-700">طريقةُ الحلّ:</b> {x.how}
                      </div>
                      <button onClick={() => void ignore(x)} disabled={busy === x.rowKey}
                        className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-100 disabled:opacity-50">
                        {busy === x.rowKey ? "..." : "🙈 تجاهل — لا تُعِدها"}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
              <b>أرقامُ إحاطة:</b> قيودٌ حيّة {fmt(h.summary.tx_live ?? 0)} · محذوفةٌ ناعماً {fmt(h.summary.tx_deleted ?? 0)} ·
              كشوفُ رواتب {fmt(h.summary.statements ?? 0)} · مدينون {fmt(h.summary.debtors ?? 0)} بمجموع {fmt(h.summary.debt_total ?? 0)}
              <div className="mt-1.5 text-[11px] text-slate-500">
                ⚠️ لا حلَّ آليّاً لهذه الحالات عن قصد: كلُّها **قراراتُ مالٍ** (أيُبطَل القيدُ أم يُعاد الوصل؟)،
                والبرنامجُ لا يُخمّن في مالك. ولا يُرسَل عنها بريدٌ ولا تنبيه — هذه الصفحةُ هي مكانُها.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
