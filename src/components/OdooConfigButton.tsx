"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

// زرّ «ربط أودو» في ترويسة صفحة إدارة الفنيين — للمدير والمستخدم (لمكتبٍ محدَّد).
// شارةٌ ديناميّة (مفعّل أخضر / غير مفعّل أحمر تعكس آخر دخولٍ ناجح) + نافذة إعداد (يوزر/باسورد/اختبار/حفظ).
type OdooStatus = {
  odooEnabled: string; hasOdooCreds: boolean; odooUser: string | null; odooUrl: string | null;
  odooLastOk: string | null; odooLastError: string | null;
  // مهلة سوبر سيل — الميزة ١ (إنذارات) للكلّ، والميزة ٢ (إرسال) بإذن مالك النظام
  odooSlaAlarm?: string | null; odooSlaAlarmMin?: number | null; odooSlaTechText?: string | null;
  odooSlaSendAllowed?: boolean;
  odooSlaAuto?: string | null; odooSlaArmedAt?: string | null;
  odooSlaSendMin?: number | null; odooSlaNote?: string | null; odooSlaWaText?: string | null;
};

export default function OdooConfigButton({ officeId, officeName, panelId = null, onChange }: { officeId: number | null; officeName: string; panelId?: number | null; onChange?: () => void }) {
  // أ-٢٣ · لوحةُ الساس التي يُدير هذا الزرُّ بوّابةَ أودو الخاصّة بها. فارغٌ = أعمدةُ المكتب
  // (السلوكُ القديم بالضبط) — فمكتبُ اللوحةِ الواحدةِ لا يرى فرقاً.
  const q = panelId != null ? `?panelId=${panelId}` : "";
  const [odoo, setOdoo] = useState<OdooStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ odooUser: "", odooPass: "", odooUrl: "" });
  const [enabledForm, setEnabledForm] = useState(true);
  // مهلة سوبر سيل: مفتاحا الميزتين + العتبتان + النصوص الثلاثة
  const [sla, setSla] = useState({ alarm: false, alarmMin: "60", techText: "", auto: false, sendMin: "90", note: "", waText: "" });
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (officeId == null) { setOdoo(null); return; }
    fetch(`/api/towers/${officeId}/odoo${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !d.error) setOdoo(d); }).catch(() => {});
  }, [officeId, q]);
  useEffect(() => { load(); }, [load]);

  if (officeId == null) return null;
  const on = odoo?.odooEnabled === "1" && !!odoo?.odooLastOk;

  async function testOdoo() {
    if (officeId == null) return;
    setBusy(true); setTest("جارٍ الاختبار…");
    try {
      const r = await fetch(`/api/towers/${officeId}/odoo-test${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      setTest(`${d.ok ? "✓" : "✗"} ${d.message ?? d.error ?? "تعذّر الاختبار"}`);
    } catch { setTest("✗ تعذّر الاتصال بالخادم"); }
    setBusy(false);
  }
  async function save() {
    if (officeId == null) return;
    setBusy(true); setTest("");
    try {
      const r = await fetch(`/api/towers/${officeId}/odoo${q}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, odooEnabled: enabledForm ? "1" : "0",
          odooSlaAlarm: sla.alarm ? "1" : "0", odooSlaAlarmMin: sla.alarmMin, odooSlaTechText: sla.techText,
          odooSlaAuto: sla.auto ? "1" : "0", odooSlaSendMin: sla.sendMin,
          odooSlaNote: sla.note, odooSlaWaText: sla.waText,
        }),
      });
      const d = await r.json().catch(() => ({}));
      setBusy(false);
      if (r.ok) { load(); setOpen(false); onChange?.(); }
      else setTest(`✗ ${d.error ?? "تعذّر الحفظ"}`);
    } catch { setBusy(false); setTest("✗ تعذّر الاتصال بالخادم"); }
  }

  return (
    <>
      <button
        onClick={() => {
          setForm({ odooUser: odoo?.odooUser ?? "", odooPass: "", odooUrl: odoo?.odooUrl ?? "" });
          setEnabledForm((odoo?.odooEnabled ?? "0") === "1");
          setSla({
            alarm: (odoo?.odooSlaAlarm ?? "0") === "1",
            alarmMin: String(odoo?.odooSlaAlarmMin ?? 60),
            techText: odoo?.odooSlaTechText ?? "",
            auto: (odoo?.odooSlaAuto ?? "0") === "1",
            sendMin: String(odoo?.odooSlaSendMin ?? 90),
            note: odoo?.odooSlaNote ?? "",
            waText: odoo?.odooSlaWaText ?? "",
          });
          setTest(""); setOpen(true);
        }}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-white shadow-sm active:scale-95"
        style={{ background: on ? "#16a34a" : "#dc2626" }}
        title={on ? "ربط أودو مفعّل — اضغط للإعداد" : "ربط أودو غير مفعّل — اضغط للإعداد"}
      >
        🔗 أودو · {on ? "مفعّل" : "غير مفعّل"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center text-lg font-extrabold">🔗 ربط أودو — {officeName}</div>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2.5">
              <input type="checkbox" checked={enabledForm} onChange={(e) => setEnabledForm(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              <span className="text-sm font-bold text-slate-700">تفعيل ربط أودو لهذا المكتب</span>
            </label>
            <div className="space-y-2">
              <Field label="اسم المستخدم (أودو)">
                <input value={form.odooUser} onChange={(e) => setForm((f) => ({ ...f, odooUser: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
              <Field label={odoo?.hasOdooCreds ? "كلمة المرور (اتركها فارغة لإبقائها)" : "كلمة المرور"}>
                <input type="password" value={form.odooPass} onChange={(e) => setForm((f) => ({ ...f, odooPass: e.target.value }))} dir="ltr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
              <Field label="رابط أودو (اختياري)">
                <input value={form.odooUrl} onChange={(e) => setForm((f) => ({ ...f, odooUrl: e.target.value }))} dir="ltr" placeholder="https://odoo.supercell.iq" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
              </Field>
            </div>
            <button onClick={testOdoo} disabled={busy} className="mt-3 w-full rounded-lg border border-blue-500 bg-blue-50 py-2 text-sm font-bold text-blue-600 hover:bg-blue-100 disabled:opacity-60">🔌 اختبار الاتصال</button>

            {/* ===== مهلة أودو — ميزتان بمفتاحين (طلب محمد 2026-08-09) ===== */}
            {/* الميزة ١: الإنذارات — لكلّ الوكلاء بلا إذن */}
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-rose-200 bg-white p-2.5">
                <input type="checkbox" checked={sla.alarm} onChange={(e) => setSla((s) => ({ ...s, alarm: e.target.checked, auto: e.target.checked ? s.auto : false }))} className="h-4 w-4 accent-rose-600" />
                <span className="text-xs font-extrabold text-slate-800">⏳ تفعيل إنذارات أودو</span>
              </label>
              {sla.alarm && (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] leading-5 text-slate-600">
                    العدّاد يمشي <b>١٠:٠٠ص ← ١٢:٠٠ منتصف الليل</b> فقط، ومرجعه <b>زمن التذكرة في أودو</b>
                    (وما قبل العاشرة يُحتسب من العاشرة). عند العتبة: يومض مربّع الرئيسيّة والبطاقة،
                    ويصل إشعارٌ للمدير في الجرس، ويُنبَّه الفنيّ صاحب البطاقة كلّ ١٥ دقيقة حتى إنجازها أو إلغائها.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="عتبة الإنذار (دقيقة)">
                      <input value={sla.alarmMin} onChange={(e) => setSla((s) => ({ ...s, alarmMin: e.target.value.replace(/[^\d]/g, "") }))} dir="ltr" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                    </Field>
                  </div>
                  <Field label="نصّ تنبيه الفنيّ (كلّ ١٥ دقيقة)">
                    <textarea value={sla.techText} onChange={(e) => setSla((s) => ({ ...s, techText: e.target.value }))} rows={2} placeholder="تذكرة أودو {التذكرة} تأخّرت — أنجزها أو ألغِها أو أجّلها" className="w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                  </Field>
                </div>
              )}
            </div>

            {/* الميزة ٢: الإرسال — لا تظهر إطلاقاً بلا إذن مالك النظام */}
            {odoo?.odooSlaSendAllowed && (
              <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                <label className={`flex items-center gap-2 rounded-lg border border-violet-200 bg-white p-2.5 ${sla.alarm ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                  <input type="checkbox" checked={sla.auto} disabled={!sla.alarm} onChange={(e) => setSla((s) => ({ ...s, auto: e.target.checked }))} className="h-4 w-4 accent-violet-600" />
                  <span className="text-xs font-extrabold text-slate-800">📨 تفعيل إرسال رسائل أودو والمشتركين</span>
                </label>
                {!sla.alarm && <div className="mt-1 text-[11px] font-semibold text-violet-700">شغّل «إنذارات أودو» أوّلاً — الإرسال مبنيٌّ على حسابها.</div>}
                {sla.alarm && sla.auto && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] leading-5 text-slate-600">
                      عند العتبة يُبلَّغ <b>أودو أوّلاً</b> بملاحظة التأجيل، ثمّ تُرسَل رسالة المشترك من واتساب مكتبه
                      (تُؤرشَف إن كانت حاسبته مطفأة وتُرسَل حين تفتح، وتُلغى بعد يوم). وما سُحب <b>قبل</b> تشعيل هذا
                      المفتاح لا يُرسَل له تلقائيّاً أبداً.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="عتبة الإرسال (دقيقة)">
                        <input value={sla.sendMin} onChange={(e) => setSla((s) => ({ ...s, sendMin: e.target.value.replace(/[^\d]/g, "") }))} dir="ltr" inputMode="numeric" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-violet-500" />
                      </Field>
                    </div>
                    <Field label="ملاحظة أودو (تُكتَب على التذكرة)">
                      <textarea value={sla.note} onChange={(e) => setSla((s) => ({ ...s, note: e.target.value }))} rows={2} placeholder="تم التأجيل بطلب من المشترك" className="w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-violet-500" />
                    </Field>
                    <Field label="رسالة واتساب المشترك">
                      <textarea value={sla.waText} onChange={(e) => setSla((s) => ({ ...s, waText: e.target.value }))} rows={3} placeholder="عزيزنا المشترك، نعتذر عن التأخير — تمّ تأجيل موعد زيارة الفنيّ…" className="w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-violet-500" />
                    </Field>
                  </div>
                )}
                <div className="mt-2 text-[11px] text-slate-500">متغيّرات: {"{المكتب}"} · {"{التذكرة}"} · {"{الهاتف}"} · {"{اليوزر}"} — والفراغ يعني النصّ الافتراضيّ.</div>
              </div>
            )}
            {test && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-700">{test}</div>}
            {!test && odoo?.odooLastError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">آخر خطأ: {odoo.odooLastError}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={busy} className="flex-1 rounded-lg bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "..." : "حفظ"}</button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-600">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (<label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>{children}</label>);
}
