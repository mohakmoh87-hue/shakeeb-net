"use client";

import { useCallback, useEffect, useState } from "react";
import GuardFigure, { type GuardMood } from "@/components/GuardFigure";

// ═════ 🪖 «حارسُ المال» (طلب محمد 2026-08-12 · وأُعيد تسميتُه من «سلامة المال» 2026-08-14) ═════
// «يكون في حسابات المدير **سلامة المال**، وعند الضغط عليه تُفتح صفحةٌ فيها الحالاتُ الموجودة
// **ولا تكرارَ فيها أبداً**، وكلُّ حالةٍ فيها تفاصيلُها وطريقةُ حلّها… ويمكنه ضغط **تجاهل** فلا
// تُعاد له مرّةً أخرى. **ولا داعيَ لتنبيهٍ بالإيميل ولا أيّ شيءٍ آخر** — فالوكيلُ عندما يرى خللاً
// ماليّاً يتوجّه إلى هذه الصفحة ليرى كلّ شيء.»
//
// ⚠️ وأمّا «الحلُّ بضغطة زر»: أكثرُ الحالات **قراراتُ مالٍ لا صيانةَ بيانات**
// (أيُبطَل القيدُ أم يُعاد الوصل؟ أيُردُّ الرصيدُ نقداً أم يبقى؟). وزرٌّ يُقرّر عن محمد في مالٍ
// خطرٌ لا خدمة — فالبرنامجُ **لا يُخمّن في مال**. فلكلّ حالةٍ **طريقةُ حلٍّ مكتوبةٌ بالضبط** وزرٌّ
// يأخذه إلى الشاشة الصحيحة، و«تجاهل» لِما راجعه وأقرّه.

type Case = {
  checkKey: string; rowKey: string; title: string; detail: string; how: string;
  severity: "critical" | "warn" | "info"; amount?: number; at?: string; noDismiss?: boolean;
};
type Check = { key: string; name: string; ok: boolean; cases: Case[]; note?: string; hiddenCount?: number };
type Assignment = {
  id: number; key: string; toName: string | null; isTech: boolean;
  note: string | null; assignedBy: string | null; assignedAt: string; doneAt: string | null;
};
type Person = { id: number; name: string; isAdmin?: boolean; office: string | null };
type Health = {
  healthy: boolean; openCases: number; critical: number;
  checks: Check[]; summary: Record<string, number>; ignoredCount: number;
  assignments?: Assignment[];
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

  // ═══ 🎯 التكليف: اختيارٌ متعدّدٌ ثمّ مُكلَّفٌ واحد (طلبُ محمد 2026-08-14) ═══
  const [sel, setSel] = useState<Map<string, Case>>(new Map());
  const [people, setPeople] = useState<{ users: Person[]; technicians: Person[] } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [toWhom, setToWhom] = useState(""); // "u:12" للمستخدم · "t:5" للفنيّ
  const [assignNote, setAssignNote] = useState("");

  const load = useCallback(() => {
    fetch("/api/money-health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setH(d); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const asgMap = new Map<string, Assignment>((h?.assignments ?? []).map((a) => [a.key, a] as const));
  const toggle = (key: string, c: Case) => setSel((m) => {
    const n = new Map(m);
    if (n.has(key)) n.delete(key); else n.set(key, c);
    return n;
  });

  async function openAssign() {
    setAssignOpen(true); setMsg("");
    if (!people) {
      const r = await fetch("/api/money-health/assign", { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r) setPeople({ users: r.users ?? [], technicians: r.technicians ?? [] });
    }
  }

  async function assignAction(action: "done" | "unassign", id: number) {
    const note = action === "done" ? (window.prompt("ملاحظةٌ على الختم (اختياريّة):") ?? "") : "";
    const r = await fetch("/api/money-health/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, note }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); setMsg(e.error ?? "تعذّر الإجراء"); return; }
    setMsg(action === "done" ? "خُتمت المراجعة ✓" : "سُحب التكليف ✓");
    load();
  }

  async function doAssign() {
    const cases = [...sel.values()];
    if (!cases.length || !toWhom) { setMsg("اختر الحالاتِ والمُكلَّف"); return; }
    const [kind, idStr] = toWhom.split(":");
    const r = await fetch("/api/money-health/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign", note: assignNote.trim(),
        ...(kind === "u" ? { toUserId: Number(idStr) } : { toTechnicianId: Number(idStr) }),
        cases: cases.map((c) => ({ checkKey: c.checkKey, rowKey: c.rowKey, title: c.title, detail: c.detail, how: c.how })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error ?? "تعذّر التكليف"); return; }
    setMsg(`🎯 كُلِّف ${j.toName ?? ""} بـ${j.assigned} حالة`
      + (j.skipped ? ` (${j.skipped} مُكلَّفةٌ سابقاً)` : "")
      + (j.taskCardId ? " · ووُضعت بطاقةٌ في عمود «👮 حارس المال» بلوحته" : ""));
    setSel(new Map()); setAssignOpen(false); setAssignNote(""); setToWhom("");
    load();
  }

  // ═══ إجراءُ كارتٍ محذوف — من **هذه الصفحة** لا من قسمٍ منفصل (طلبُ محمد 2026-08-14:
  //     «لا أريد الخيارَ الجديد… فيكفي وجودُه في صفحة حارس المال: التنبيهُ مع السيريال
  //      وشرحُ الحالة») ═══
  async function cardAction(c: Case, action: "restore-stock" | "restore-linked" | "recheck") {
    const id = Number(c.rowKey.split(":")[1]) || 0;
    if (!id) return;
    if (action !== "recheck" && !window.confirm(
      `${action === "restore-linked" ? "إرجاعُ الكارت مستخدَماً ومربوطاً بمشتركه" : "إرجاعُ الكارت للمخزن"}:
${c.detail}

متأكّد؟`)) return;
    setBusy(c.rowKey); setMsg("");
    const r = await fetch("/api/manager/card-guard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setMsg(j.error ?? "تعذّر الإجراء"); return; }
    setMsg(j.already ? "الكارتُ موجودٌ سلفاً في المخزن ✓"
      : j.cardId ? `✅ رجع الكارتُ للمخزن برقم #${j.cardId}`
      : `🔍 أُعيد الفحص: ${j.verdict ?? ""}`);
    load();
  }

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

  // ═════ حالةُ الحارس الثلاثيّة (طلبُ محمد 2026-08-14) ═════
  // «إيموجي يلبس خوذةَ عسكريٍّ وسلاحٌ بيده: لا حالاتٌ ⇒ **مرتاحٌ** والمربّعُ أخضر ·
  //  حالةٌ غيرُ حرجة ⇒ **عصبيٌّ قليلاً/متوسّطاً** والمربّعُ برتقاليّ · حالةٌ حرجة ⇒
  //  **غاضبٌ ومستعدٌّ** والمربّعُ أحمرُ **يتوهّج يخفت ويعلو**.»
  //
  // والشخصيّةُ نفسُها في `GuardFigure` — رُوجعت مع محمد حتى أقرّها: ضابطٌ برأسٍ أصفرَ
  // وقبّعةٍ بنجمةٍ ونظّارةٍ سوداء، مرتاحٌ ثمّ منتبِهٌ بيدٍ على سمّاعته ثمّ غاضبٌ يُصوّب
  // مسدّسَه بكلتا يديه. وهنا **الألوانُ والنصوصُ** فقط.
  const mood: GuardMood = h.healthy ? "calm" : h.critical > 0 ? "critical" : "warn";
  const GUARD = {
    calm: { box: "border-emerald-300 bg-emerald-50", text: "text-emerald-700", glow: "",
      label: "الحارس مرتاح", hint: "لا خللَ في دفترك" },
    warn: { box: "border-orange-300 bg-orange-50", text: "text-orange-700", glow: "",
      label: "الحارس منتبه", hint: "حالاتٌ غيرُ حرجة" },
    critical: { box: "border-red-400 bg-red-50", text: "text-red-700", glow: "guard-alarm",
      label: "الحارس غاضب ومستعدّ", hint: "حالةٌ حرجةٌ تنتظرك" },
  }[mood];

  return (
    <>
      {/* البطاقةُ في حسابات المدير — مكشوفةٌ دائماً (لا تحت قائمةٍ منسدلة).
          🧭 والتوزيعُ بطلب محمد: **الشخصُ يساراً والكتابةُ يميناً** «لتستطيع تكبيرَ الشخص»
             — فالصفُّ الأفقيُّ يُعطيه ٥٦ نقطةً بلا أن يزيد ارتفاعُ البطاقة عن جيرانها. */}
      <div onClick={() => setOpen(true)}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-4 shadow-sm transition hover:shadow ${GUARD.box} ${GUARD.glow}`}>
        <div className="min-w-0 text-right">
          <div className="text-sm font-bold text-slate-600">حارسُ المال</div>
          <div className={`text-2xl font-extrabold leading-tight ${GUARD.text}`}>
            {h.healthy ? "سليم" : `${fmt(h.openCases)} حالة`}
          </div>
          <div className={`truncate text-xs ${h.healthy ? "text-emerald-600" : GUARD.text}`}>
            {h.healthy ? GUARD.hint : `منها ${fmt(h.critical)} حرجة`} ↗
          </div>
        </div>
        <GuardFigure mood={mood} size={56} label={GUARD.label} />
      </div>

      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-extrabold text-slate-800">
                  <GuardFigure mood={mood} size={34} />
                  حارسُ المال
                </h3>
                <div className="mt-1 text-sm text-slate-500">
                  {h.healthy ? "كلُّ الحقائق سليمة — لا خللَ في دفترك (الحارسُ مرتاح)" : `${fmt(h.openCases)} حالةٌ مفتوحة · منها ${fmt(h.critical)} حرجة`}
                  {h.ignoredCount > 0 && <> · <span className="text-slate-400">مُتجاهَلةٌ سابقاً: {fmt(h.ignoredCount)}</span></>}
                </div>
              </div>
              {/* الإغلاقُ بعلامةٍ واضحةٍ — لا بالضغط على الفراغ */}
              <button onClick={() => setOpen(false)} aria-label="إغلاق"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 hover:bg-slate-200">✕</button>
            </div>

            {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

            {/* ═════ 🎯 شريطُ التكليف — يظهر حين تُحدَّد حالةٌ أو أكثر ═════
                «إرسالُ أيّ حالةٍ أو مجموعةِ حالاتٍ إلى أيّ فنيٍّ أو مديرٍ أو مستخدمٍ فتظهر
                 له بالإشعارات لديه من أجل تكليفه بمراجعتها.» */}
            {sel.size > 0 && (
              <div className="mb-3 rounded-xl border border-mynet-blue/40 bg-mynet-blue/5 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-700">
                  <span>🎯 حُدِّدت {fmt(sel.size)} حالة</span>
                  <button onClick={() => setSel(new Map())} className="text-[12px] font-normal text-slate-500 underline">إلغاءُ التحديد</button>
                  {!assignOpen && (
                    <button onClick={() => void openAssign()}
                      className="ms-auto rounded-lg bg-mynet-blue px-3 py-1.5 text-sm font-bold text-white">
                      تكليفُ شخصٍ بمراجعتها
                    </button>
                  )}
                </div>
                {assignOpen && (
                  <div className="space-y-2">
                    <select value={toWhom} onChange={(e) => setToWhom(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                      <option value="">— اختر المُكلَّف —</option>
                      {people?.users?.length ? (
                        <optgroup label="مدراء ومستخدمون (يصلهم إشعارٌ خاصٌّ بهم)">
                          {people.users.map((u) => (
                            <option key={`u${u.id}`} value={`u:${u.id}`}>
                              {u.name}{u.isAdmin ? " · مدير" : ""}{u.office ? ` · ${u.office}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {people?.technicians?.length ? (
                        <optgroup label="فنيّون (تصلهم بطاقةٌ في عمود «👮 حارس المال» بلوحتهم)">
                          {people.technicians.map((t) => (
                            <option key={`t${t.id}`} value={`t:${t.id}`}>{t.name}{t.office ? ` · ${t.office}` : ""}</option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    <input value={assignNote} onChange={(e) => setAssignNote(e.target.value)}
                      placeholder="ما تطلبه منه (اختياريّ) — يظهر في أوّل التكت"
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={() => void doAssign()} disabled={!toWhom}
                        className="rounded-lg bg-mynet-blue px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                        إرسالُ التكليف
                      </button>
                      <button onClick={() => setAssignOpen(false)} className="text-sm text-slate-500">إلغاء</button>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      🔒 عنوانُ التكت «حالاتٌ حرجةٌ من المدير يجب اتّخاذُ إجراءٍ بها»، وفيه تفاصيلُ كلّ حالةٍ
                      وطريقةُ حلّها. ولا يراه إلّا أنت والمُكلَّفُ نفسُه — والعمودُ يختفي من لوحته إذا خلا.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═════ الحالاتُ **وحدَها** (طلبُ محمد 2026-08-14) ═════
                «أريد في القائمة تظهر **فقط الحالات**، وليس مثلَ الآن يظهر صحٌّ أخضرُ لِما ليس
                 به شذوذٌ ومن ضمنها الحالات، فتكون الصفحةُ مزدحمة.»
                فالسليمُ صار **سطراً واحداً** أسفلَ القائمة بعددِه (لا صفّاً لكلّ حقيقة)،
                والمساحةُ كلُّها للحالات. ولا يُحذَف الرقمُ من الشاشة — يُختصَر مكانُه. */}
            <div className="mb-4 space-y-3">
              {h.checks.filter((c) => !c.ok && c.cases.length > 0).map((c) => (
                <div key={c.key}>
                  <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
                    <span>🔴</span>
                    <span className="min-w-0 flex-1">{c.name}</span>
                    <span className="rounded bg-white px-1.5 py-0.5 text-xs">{c.cases.length}</span>
                    {(c.hiddenCount ?? 0) > 0 && <span className="text-[11px] font-normal text-slate-400">({c.hiddenCount} مُتجاهَلة)</span>}
                  </div>
                  {c.note && <div className="mt-1 px-3 text-[11px] text-amber-700">{c.note}</div>}

                  {c.cases.map((x) => {
                    const key = `${x.checkKey}|${x.rowKey}`;
                    const asg = asgMap.get(key);
                    const picked = sel.has(key);
                    return (
                      <div key={x.rowKey} className={`mt-2 rounded-xl border p-3.5 ${TONE[x.severity].box} ${picked ? "ring-2 ring-mynet-blue" : ""}`}>
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          {/* اختيارٌ متعدّد: حالةٌ أو مجموعةُ حالاتٍ في تكليفٍ واحد */}
                          <input type="checkbox" checked={picked} onChange={() => toggle(key, x)}
                            className="h-4 w-4 accent-mynet-blue" aria-label="تحديد الحالة" />
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TONE[x.severity].chip}`}>{TONE[x.severity].label}</span>
                          <span className="text-base font-bold text-slate-800">{x.title}</span>
                          {x.amount ? <span className="text-base font-extrabold text-slate-900">{fmt(x.amount)} د.ع</span> : null}
                        </div>
                        <div className="mb-2 text-sm text-slate-700">{x.detail}</div>
                        <div className="mb-2.5 rounded-lg bg-white/70 p-2.5 text-sm text-slate-600">
                          <b className="text-slate-700">طريقةُ الحلّ:</b> {x.how}
                        </div>
                        {/* التكليفُ القائمُ ظاهرٌ على الحالة — فلا تُكلَّف مرّتَين ولا يُنسى مَن كُلِّف */}
                        {asg && (
                          <div className="mb-2 rounded-lg bg-mynet-blue/10 px-2.5 py-1.5 text-[12px] font-bold text-mynet-blue">
                            🎯 مُكلَّفٌ به: {asg.toName ?? "؟"}{asg.isTech ? " (فنّي)" : ""}
                            {asg.doneAt ? " · ✔ راجعها" : " · لم يُختَم بعد"}
                            {asg.note ? <span className="font-normal"> · «{asg.note}»</span> : null}
                            <button onClick={() => void assignAction("unassign", asg.id)}
                              className="ms-2 font-normal underline">سحبُ التكليف</button>
                            {!asg.doneAt && (
                              <button onClick={() => void assignAction("done", asg.id)}
                                className="ms-2 font-normal underline">ختمُ «راجعها»</button>
                            )}
                          </div>
                        )}
                        {x.rowKey.startsWith("dcard:") && (
                          <span className="me-2 inline-flex flex-wrap gap-2">
                            <button onClick={() => void cardAction(x, "restore-stock")} disabled={busy === x.rowKey}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                              📦 أعِدْه للمخزن
                            </button>
                            <button onClick={() => void cardAction(x, "restore-linked")} disabled={busy === x.rowKey}
                              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 disabled:opacity-50">
                              ↩ أعِدْه مربوطاً بمشتركه
                            </button>
                            <button onClick={() => void cardAction(x, "recheck")} disabled={busy === x.rowKey}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 disabled:opacity-50">
                              🔍 أعِد الفحص
                            </button>
                          </span>
                        )}
                        {x.noDismiss ? (
                          <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] font-bold text-rose-700">🔒 لا يُتجاهَل — يُغلَق وحدَه فور ظهور الوصل</span>
                        ) : (
                          <button onClick={() => void ignore(x)} disabled={busy === x.rowKey}
                            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-100 disabled:opacity-50">
                            {busy === x.rowKey ? "..." : "🙈 تجاهل — لا تُعِدها"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {/* السليمُ في سطرٍ واحدٍ — لا يزدحم به الوجه */}
              {h.checks.some((c) => c.ok) && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-700">
                  ✅ {fmt(h.checks.filter((c) => c.ok).length)} حقيقةً سليمةً لا شذوذَ فيها
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
              <b>أرقامُ إحاطة:</b> قيودٌ حيّة {fmt(h.summary.tx_live ?? 0)} · محذوفةٌ ناعماً {fmt(h.summary.tx_deleted ?? 0)} ·
              كشوفُ رواتب {fmt(h.summary.statements ?? 0)} · مدينون {fmt(h.summary.debtors ?? 0)} بمجموع {fmt(h.summary.debt_total ?? 0)}
              <div className="mt-1.5 text-[11px] text-slate-500">
                🪖 الحارسُ يعمل ٢٤ ساعةً ويلتقط الحالةَ فورَ وقوعها، وخاملٌ حين لا يقع شيء.
                و**التجاهلُ خيارٌ من خياراته**: يُسقط الحالةَ بلا إجراءٍ فلا تُعاد. أمّا ما كان
                **قرارَ مالٍ** (أيُبطَل القيدُ أم يُعاد الوصل؟) فلا زرَّ آليّاً له عن قصد —
                والبرنامجُ لا يُخمّن في مالك. ولا يُرسَل بريدٌ: هذه الصفحةُ هي مكانُها.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
