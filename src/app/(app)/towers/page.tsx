"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import SasPanelsButton from "@/components/SasPanelsButton";
import { usePermission } from "@/lib/usePermission";
import { usePolling } from "@/lib/usePolling";

type Office = {
  id: number;
  name: string | null;
  loginUrl: string | null;
  username: string | null;
  password: string | null;
  address: string | null;
  phone: string | null;
  managerPhone: string | null;
  mapArea: string | null;
  rewardsEnabled: string | null;
  activationMode: string | null;
  silent: string | null;
  waEnabled: string | null;
  syncTime: string | null;
  syncEnabled: string | null;
  debtReminderEnabled: string | null;
  debtReminderTime: string | null;
  autoAssignEnabled?: boolean;
  reminderTime: string | null;
  reminderDays: number | null; // أيام تذكير الانتهاء — فارغ = يومان
  // البند ٤-أ · «المنتهون منذ N يوم» — رسالةٌ واحدةٌ لكلّ انتهاء (مُطفأةٌ افتراضاً)
  expiredNoticeEnabled: string | null;
  expiredNoticeDays: number | null;
  expiredNoticeTime: string | null;
  lat: number | null;
  lng: number | null;
  geoRadius: number | null;
  geoEnabled: boolean | null;
  loanEnabled: string | null; // 1 = تفعيل قروض سوبر سيل
  loanUser: string | null; // اسم مستخدم القروض (مدير فقط)
  loanPass: string | null; // كلمة مرور القروض (مفكوكة للمدير)
  loanMode: string | null; // activation | normal (طريقة القرض)
  hasLoanCreds?: boolean;
};
type MapArea = { code: string; count: number };

const empty: Partial<Office> = { activationMode: "month", silent: "1", waEnabled: "1" };

export default function OfficesPage() {
  const { can, me } = usePermission();
  const isManager = can("offices.edit"); // تعديل المكتب (الإنشاء والتعديل — بلا حذف)
  const canDelete = can("offices.delete"); // حذف المكتب — صلاحية مستقلة تماماً
  const canSync = can("offices.sync"); // مزامنة فقط (بلا تعديل/حذف المكتب)
  // مكاتب المستخدم لوضع "ربط الواتساب فقط" (لمن لا يملك صلاحية إدارة المكاتب)
  const [waOnly, setWaOnly] = useState<{ id: number; name: string | null }[]>([]);

  const [offices, setOffices] = useState<Office[]>([]);
  const [sel, setSel] = useState<Office | null>(null);
  // 🔴 بلاغ محمد 2026-08-19: مكتبُ الساس الواحد فقد حقولَه («لا يمكن رؤيتها لتعديلها»)
  // لأنّ زرَّ اللوحات يُخفي نفسَه له والنموذجُ يُحيل عليه. فالزرُّ يُبلغ ظهورَه الفعليّ
  // (onVisibleChange) والحقولُ القديمة تعود **حين لا زرَّ** — محرِّرٌ واحدٌ ظاهرٌ دائماً.
  const [panelsUi, setPanelsUi] = useState(false);
  const [form, setForm] = useState<Partial<Office>>(empty);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [areas, setAreas] = useState<MapArea[]>([]); // مناطق الخريطة المتاحة
  const [loanTest, setLoanTest] = useState(""); // نتيجة اختبار اتصال القروض
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setOffices)));
  }, []);
  useEffect(() => { if (isManager || canSync) load(); }, [load, isManager, canSync]);
  useEffect(() => {
    if (isManager) fetch("/api/map/areas").then((r) => r.ok ? r.json() : null).then((d) => d && setAreas(d.areas ?? []));
  }, [isManager]);

  // وضع QR: جلب مكاتب المستخدم للربط لكل من لا يدير المكاتب — **بمن فيهم صاحب صلاحية
  // المزامنة**. كان الشرط يستثنيه (canSync)، فسقط ربط الواتساب عن مستخدم مكتب الرسالة
  // وحده: صلاحياته sync بلا edit ⇒ صفحته «المزامنة فقط» ولا صندوق واتساب فيها إطلاقاً.
  useEffect(() => {
    if (me && !isManager) {
      fetch("/api/whatsapp/my-offices").then((r) => void (r.ok && r.json().then((d) => setWaOnly(d.offices ?? []))));
    }
  }, [me, isManager]);

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  // وضع "المزامنة فقط": من يملك offices.sync دون offices.edit — قائمة مكاتب مع زر مزامنة، بلا تعديل/حذف/أسرار
  if (!isManager && canSync) {
    return (
      <div className="p-6">
        <PageHeader title="مكتبي: المزامنة وربط الواتساب" subtitle="زامن اشتراكاتك من SAS واربط واتساب مكتبك — بلا تعديل بيانات المكتب" />
        {offices.length === 0 ? (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">لا توجد مكاتب مرتبطة بحسابك.</div>
        ) : (
          <div className="grid max-w-2xl gap-4">
            {offices.map((o) => (
              <div key={o.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-2 font-bold text-slate-800">🏢 {o.name ?? `مكتب ${o.id}`}</h3>
                <OfficeSync officeId={o.id} />
                {/* ربط الواتساب هنا أيضاً — كان الغائب الوحيد عن هذه الشاشة */}
                <div className="mt-4">
                  <OfficeWhatsApp officeId={o.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // وضع "ربط الواتساب فقط" لغير المخوّلين بإدارة المكاتب أو المزامنة
  if (!isManager) {
    return (
      <div className="p-6">
        <PageHeader title="ربط واتساب المكتب" subtitle="اربط رقم واتساب مكتبك بمسح رمز QR" />
        {waOnly.length === 0 ? (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">لا يوجد مكتب مرتبط بحسابك لربط واتساب له.</div>
        ) : (
          <div className="grid max-w-md gap-5">
            {waOnly.map((o) => (
              <div key={o.id}>
                <div className="mb-1 font-bold text-slate-800">{o.name ?? `مكتب ${o.id}`}</div>
                <OfficeWhatsApp officeId={o.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function pick(o: Office) { setSel(o); setForm({ ...o }); setEditing(false); setMsg(""); setPanelsUi(false); }
  function addNew() { setSel(null); setForm({ ...empty }); setEditing(true); setMsg(""); setPanelsUi(false); }
  const set = (k: keyof Office, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  // التقاط موقع المكتب من موقع الجهاز الحالي (يُفتح من الهاتف عند المكتب)
  function captureLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { setMsg("جهازك لا يدعم تحديد الموقع"); return; }
    setMsg("جارٍ تحديد الموقع…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setForm((f) => ({ ...f, lat: p.coords.latitude, lng: p.coords.longitude })); setMsg("تم تحديد الموقع ✓ — لا تنسَ الحفظ"); },
      (e) => setMsg(e.code === 1 ? "رُفض إذن الموقع — فعّله من إعدادات المتصفح" : "تعذّر تحديد الموقع — فعّل GPS وحاول ثانيةً"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  async function save() {
    if (!form.name?.trim()) { setMsg("اسم المكتب مطلوب"); return; }
    const res = await fetch(sel ? `/api/towers/${sel.id}` : "/api/towers", {
      method: sel ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      // حين تُحرَّر اللوحاتُ من نافذتها (panelsUi): تُحذف حقولُ الساس/الديلر من الحمولة —
      // إرسالُ قيمها القديمة العالقة كان سيطمس ما حُفظ للتوّ هناك (عائلةُ علّة المرآة).
      // وحين لا نافذةَ (مكتبُ ساسٍ واحد): تُرسَل كاملةً كما كانت دائماً — فهي محرِّرُها الوحيد.
      body: JSON.stringify(panelsUi
        ? Object.fromEntries(Object.entries(form).filter(([k]) => !["loginUrl", "username", "password", "loanUser", "loanPass"].includes(k)))
        : form),
    });
    if (res.ok) {
      const saved = await res.json();
      setMsg("✓ تم الحفظ");
      setEditing(false);
      setSel(saved);
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "فشل الحفظ");
    }
  }

  // اختبار اتصال قروض سوبر سيل — للمكتب المحفوظ حصراً (يحتاج towerId لعزله والتحقّق من ملكيّته)
  async function testLoan() {
    if (!sel) { setLoanTest("احفظ المكتب أولاً ثم اختبر"); return; }
    setTesting(true); setLoanTest("جارٍ الاختبار…");
    try {
      const res = await fetch(`/api/towers/${sel.id}/loan-test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // مع نافذة اللوحات: بلا بيانات فيُختبر الحسابُ المخزون. وبلا نافذةٍ (ساسٌ واحد):
        // تُرسَل قيمُ الحقلَين الظاهرَين — فيُختبر ما يراه المستخدمُ أمامه قبل الحفظ.
        body: JSON.stringify(panelsUi ? {} : { loanUser: form.loanUser, loanPass: form.loanPass }),
      }).then((r) => r.json());
      setLoanTest(res ? `${res.ok ? "✓" : "✗"} ${res.message ?? ""}` : "تعذّر الاختبار");
    } catch { setLoanTest("تعذّر الاختبار"); }
    setTesting(false);
  }

  async function remove(o: Office) {
    if (!window.confirm(`حذف المكتب "${o.name}"؟`)) return;
    const res = await fetch(`/api/towers/${o.id}`, { method: "DELETE" });
    if (res.ok) { if (sel?.id === o.id) { setSel(null); setForm(empty); } load(); }
    // متوسّط(٣٧) · رفضُ الخادم (403 عزلٌ/صلاحية) كان يُبتلَع — نقرةٌ بلا أثرٍ ولا سبب
    else { const d = await res.json().catch(() => ({})); setMsg(d.error ?? "تعذّر حذفُ المكتب"); }
  }

  const ro = !!sel && !editing;

  return (
    <div className="p-6">
      <PageHeader title="المكاتب" subtitle="كل مكتب مستقل: مشتركون، SAS، واتساب، مدير، وحسابات خاصة" />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* قائمة المكاتب */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {me?.officeCap != null && (
            <div className="mb-2 rounded-lg bg-slate-50 px-3 py-1.5 text-center text-xs font-semibold text-slate-600">
              المكاتب: {offices.length} / {me.officeCap}
              {offices.length >= me.officeCap && <span className="text-red-600"> — بلغت الحد</span>}
            </div>
          )}
          <button onClick={addNew} disabled={me?.officeCap != null && offices.length >= me.officeCap} className="mb-3 w-full rounded-lg bg-mynet-blue py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:cursor-not-allowed disabled:opacity-40">+ إضافة مكتب</button>
          <div className="space-y-1">
            {offices.map((o) => (
              <div key={o.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${sel?.id === o.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                <button onClick={() => pick(o)} className="flex-1 text-right font-medium text-slate-700">{o.name}</button>
                {canDelete && <button onClick={() => remove(o)} className="text-xs text-red-400 hover:text-red-600">حذف</button>}
              </div>
            ))}
            {offices.length === 0 && <div className="p-4 text-center text-sm text-slate-400">لا توجد مكاتب</div>}
          </div>
        </div>

        {/* تفاصيل المكتب */}
        <div className="space-y-5">
          {(sel || editing) ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">{sel ? (editing ? "تعديل المكتب" : sel.name) : "مكتب جديد"}</h3>
                  <div className="flex items-center gap-2">
                    {/* أ-٢٣ · لوحاتُ الساس/أودو لهذا المكتب — والمكوّنُ **يُخفي نفسَه** إن لم يكن
                        لهذا المكتبِ لوحتان ولا حصّةٌ متبقّية، فلا يراه وكيلٌ بلا إذنٍ ولا يظهر
                        على مكاتبَ أُخرى بعد أن يستهلك مكتبٌ الحصّة (شرط محمد 2026-08-13). */}
                    {sel && !editing && <SasPanelsButton towerId={sel.id} towerName={sel.name ?? "المكتب"} onChange={load} onVisibleChange={setPanelsUi} />}
                    {sel && !editing && <button onClick={() => setEditing(true)} className="rounded-lg bg-slate-100 px-3 py-1 text-sm text-slate-600 hover:bg-slate-200">تعديل</button>}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <F label="اسم المكتب"><I v={form.name} on={(v) => set("name", v)} ro={ro} /></F>
                  <F label="رقم مدير المكتب (للتقرير)"><I v={form.managerPhone} on={(v) => set("managerPhone", v)} ro={ro} dir="ltr" /></F>
                  <F label="هاتف المكتب"><I v={form.phone} on={(v) => set("phone", v)} ro={ro} dir="ltr" /></F>
                  {/* ═════ إزالةُ الازدواج (قرارُ محمد 2026-08-19) ═════
                      كانت بياناتُ الساس تُدخَل هنا **وأيضاً** في نافذة «لوحات الساس»
                      لنفس اللوحة الأولى — محرِّران لجسدٍ واحدٍ ومرآةٌ بينهما ناقصة،
                      وهو أصلُ كلّ أعطال «المكتب بساسَين». صار لها محرِّرٌ واحد. */}
                  {/* 🔴 بلاغ 2026-08-19: الإحالةُ على الزرّ صحيحةٌ فقط حين يكون الزرُّ موجوداً.
                      مكتبُ الساس الواحد (بلا حصّةِ لوحةٍ ثانية) لا زرَّ له ⇒ تعود حقولُه
                      القديمةُ كما كانت حرفيّاً — «المكتب بساس واحد لا يتغيّر به شيء». */}
                  {panelsUi ? (
                    <div className="sm:col-span-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs leading-6 text-slate-600">
                      🛰️ بياناتُ دخول الساس (الرابط · اليوزر · الباسورد){sel ? <> — الحاليّ: <b dir="ltr">{sel.loginUrl ?? "—"}</b> · <b dir="ltr">{sel.username ?? "—"}</b></> : null}
                      <br />تُعدَّل من زرّ <b>«🛰️ لوحات الساس · أودو»</b> أعلاه — مكانٌ واحدٌ لكلّ اللوحات، الأولى والثانية.
                    </div>
                  ) : (
                    <>
                      <F label="رابط لوحة SAS"><I v={form.loginUrl} on={(v) => set("loginUrl", v)} ro={ro} dir="ltr" ph="82.129.22.22" /></F>
                      <F label="يوزر SAS"><I v={form.username} on={(v) => set("username", v)} ro={ro} dir="ltr" /></F>
                      <F label="باسورد SAS"><I v={form.password} on={(v) => set("password", v)} ro={ro} dir="ltr" /></F>
                    </>
                  )}
                  <F label="نظام التفعيل">
                    <select value={form.activationMode ?? "month"} disabled={ro} onChange={(e) => set("activationMode", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50">
                      <option value="month">شهر ميلادي</option>
                      <option value="days30">30 يوماً</option>
                    </select>
                  </F>
                  <F label="العنوان"><I v={form.address} on={(v) => set("address", v)} ro={ro} /></F>
                  <F label="وقت مزامنة الاشتراكات (يومياً)"><input type="time" value={form.syncTime ?? ""} disabled={ro} onChange={(e) => set("syncTime", e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" /></F>
                  {/* وقت تذكير الانتهاء خاص بكل مكتب: مرتبط بوقت تشغيل حاسبته (مكتب يفتح 12:00 وآخر 2:00) */}
                  <F label="وقت تذكير انتهاء الاشتراك (يومياً) — بحسب وقت فتح هذا المكتب">
                    <input type="time" value={form.reminderTime ?? ""} disabled={ro} onChange={(e) => set("reminderTime", e.target.value)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
                    <span className="mt-0.5 block text-[11px] text-slate-400">فارغ = الوقت العام (13:00). يُرسل التذكير حين تكون حاسبة هذا المكتب مشغّلة.</span>
                  </F>
                  {/* عدد أيام التذكير لهذا المكتب — كان يومين ثابتاً (طلب محمد 2026-08-09) */}
                  <F label="أيام تذكير الانتهاء (يُرسَل لمن ينتهي خلالها)">
                    <input type="number" min={1} max={60} value={form.reminderDays ?? ""} disabled={ro}
                      onChange={(e) => set("reminderDays", e.target.value === "" ? null : Number(e.target.value))}
                      dir="ltr" placeholder="2" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
                    <span className="mt-0.5 block text-[11px] text-slate-400">فارغ = يومان. مثال: 3 ⇒ يُذكَّر من ينتهي اشتراكه خلال ٣ أيام.</span>
                  </F>
                  <F label="منطقة الخريطة (لتحديد مواقع المشتركين)">
                    <select value={form.mapArea ?? ""} disabled={ro} onChange={(e) => set("mapArea", e.target.value || null)} dir="ltr" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50">
                      <option value="">— بدون / غير محدّدة —</option>
                      {areas.map((a) => <option key={a.code} value={a.code}>{a.code} ({a.count})</option>)}
                      {/* إبقاء القيمة الحالية ظاهرةً حتى لو لم تَعُد ضمن القائمة */}
                      {form.mapArea && !areas.some((a) => a.code === form.mapArea) && <option value={form.mapArea}>{form.mapArea}</option>}
                    </select>
                  </F>
                </div>
                <p className="mt-1 text-xs text-slate-500">اختر منطقة هذا المكتب على الخريطة ليظهر موقع كل مشترك بدقّة عند الضغط على «خريطة». الرقم بين القوسين = عدد النقاط في تلك المنطقة.</p>
                <div className="mt-3 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.waEnabled !== "0"} onChange={(e) => set("waEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-emerald-600" />
                    تفعيل واتساب المكتب
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.silent !== "0"} onChange={(e) => set("silent", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-emerald-600" />
                    إرسال صامت (بلا تأكيد)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.syncEnabled === "1"} onChange={(e) => set("syncEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-emerald-600" />
                    تفعيل المزامنة اليومية (بالوقت المحدّد)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.debtReminderEnabled === "1"} onChange={(e) => set("debtReminderEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-amber-600" />
                    💳 إرسال رسائل يومية للديون (قالب «مطالبة بالديون»)
                  </label>
                  {form.debtReminderEnabled === "1" && (
                    <div className="ms-6 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>🕐 وقت رسائل الديون:</span>
                      <input type="time" value={form.debtReminderTime ?? ""} disabled={ro} onChange={(e) => set("debtReminderTime", e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
                      <span className="text-xs text-slate-400">فارغ = يتبع وقت تذكير الانتهاء</span>
                    </div>
                  )}
                  {/* البند ٤-أ · «المنتهون منذ N يوم» — قالبُ «انتهى الاشتراك» بأيّامٍ ووقتٍ خاصّين */}
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.expiredNoticeEnabled === "1"} onChange={(e) => set("expiredNoticeEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4" />
                    ⌛ إرسال رسالة للمنتهين (قالب «انتهى الاشتراك») — مرّةً واحدةً لكلّ انتهاء
                  </label>
                  {form.expiredNoticeEnabled === "1" && (
                    <div className="ms-6 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>بعد كم يوم من الانتهاء:</span>
                      <input type="number" min={1} max={60} value={form.expiredNoticeDays ?? ""} disabled={ro}
                        onChange={(e) => set("expiredNoticeDays", e.target.value === "" ? null : Number(e.target.value))}
                        dir="ltr" placeholder="1" className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50" />
                      <span>🕐 وقت الإرسال:</span>
                      <input type="time" value={form.expiredNoticeTime ?? ""} disabled={ro} onChange={(e) => set("expiredNoticeTime", e.target.value)} dir="ltr" className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50" />
                      <span className="text-xs text-slate-400">فارغ = يومٌ واحد · ويتبع وقتَ تذكير الانتهاء</span>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.rewardsEnabled === "1"} onChange={(e) => set("rewardsEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-fuchsia-600" />
                    🎁 تفعيل نظام مكافآت المشتركين
                  </label>
                  {/* بوّابة المكتب للتوزيع التلقائي — تعمل مع خانة «توزيع تلقائي» بالنوع (الأنواع والأوقات).
                      بوّابتان معاً: النوع مملوك للوكيل، فبدونها كان التفعيل يسري على كل مكاتب الوكيل. */}
                  <label className="flex items-start gap-2 text-sm text-slate-600">
                    <input type="checkbox" disabled={ro} checked={form.autoAssignEnabled === true}
                      onChange={(e) => setForm((f) => ({ ...f, autoAssignEnabled: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 accent-sky-600" />
                    <span>🎯 التوزيع التلقائي لبطاقات هذا المكتب
                      <span className="block text-[11px] text-slate-400">تُسنَد البطاقة الجديدة لصاحب العمل الأقل بين فنيي المكتب الحاضرين — ويلزم تفعيل «توزيع تلقائي» للنوع أيضاً</span>
                    </span>
                  </label>
                </div>

                {/* موقع المكتب للبصمة الجغرافية — لا يبصم الفني إلا داخل النطاق */}
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" disabled={ro} checked={!!form.geoEnabled} onChange={(e) => set("geoEnabled", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                    📍 بصمة الفنيين بالموقع (لا يبصم إلا من داخل المكتب)
                  </label>
                  {form.geoEnabled && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={ro} onClick={captureLocation} className="rounded-lg bg-mynet-blue px-3 py-2 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-50">📍 تحديد موقعي الآن (كن عند المكتب)</button>
                        {form.lat != null && form.lng != null ? (
                          <span className="text-xs text-emerald-700" dir="ltr">✓ {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</span>
                        ) : (
                          <span className="text-xs text-amber-600">لم يُحدَّد الموقع بعد</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-600">النطاق المسموح (متر):</span>
                        <input type="number" min={20} max={5000} disabled={ro} value={form.geoRadius ?? 200} onChange={(e) => set("geoRadius", Number(e.target.value) || 200)} dir="ltr" className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100" />
                      </div>
                      <p className="text-xs text-slate-500">افتح هذه الصفحة من هاتفك <b>وأنت عند المكتب</b> ثم اضغط «تحديد موقعي الآن». يمكن تعديله لاحقاً. النطاق الافتراضي 200 متر يراعي دقّة الـ GPS.</p>
                    </div>
                  )}
                </div>

                {/* قروض سوبر سيل — إعداد للمدير حصراً. إطفاء الخانة يُخفي الميزة ويحفظ البيانات */}
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <input type="checkbox" disabled={ro} checked={form.loanEnabled === "1"} onChange={(e) => set("loanEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-amber-600" />
                    💳 تفعيل قروض سوبر سيل (فزعة)
                  </label>
                  {form.loanEnabled === "1" && (
                    <div className="mt-2 space-y-2">
                      {/* حسابُ الديلر بياناتُ دخولِ مُخدِّمٍ ⇒ يتبع اللوحةَ لا المكتب — يُدخَل
                          من «لوحات الساس» (لكلّ لوحةٍ ديلرُها). والمفتاحُ أعلاه سياسةُ مكتبٍ فيبقى هنا. */}
                      {panelsUi ? (
                        <div className="rounded-lg bg-amber-100/60 px-3 py-2 text-xs leading-6 text-amber-900">
                          حسابُ الديلر (اليوزر والكلمة) يُدخَل من زرّ <b>«🛰️ لوحات الساس · أودو»</b> — لكلّ لوحةٍ حسابُها المستقلّ.
                          {sel?.loanUser ? <> الحاليّ للّوحة الأولى: <b dir="ltr">{sel.loanUser}</b></> : null}
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <F label="اسم مستخدم قروض سوبر سيل"><I v={form.loanUser} on={(v) => set("loanUser", v)} ro={ro} dir="ltr" /></F>
                          <F label="كلمة مرور القروض"><I v={form.loanPass} on={(v) => set("loanPass", v)} ro={ro} dir="ltr" /></F>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={testing} onClick={testLoan} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">🔌 اختبار الاتصال</button>
                        {loanTest && <span className={`text-xs ${loanTest.startsWith("✓") ? "text-emerald-700" : loanTest.startsWith("✗") ? "text-red-600" : "text-slate-500"}`}>{loanTest}</span>}
                      </div>

                      {/* طريقة القرض — تُعمَّم على كلّ مشتركي المكتب (طلب محمد 2026-08-07) */}
                      <div className="rounded-lg border border-amber-200 bg-white/70 p-2">
                        <div className="mb-1 text-xs font-bold text-slate-600">طريقة القرض لكلّ مشتركي هذا المكتب:</div>
                        <label className="flex items-start gap-2 py-1 text-sm text-slate-700">
                          <input type="radio" name={`loanMode-${sel?.id ?? "new"}`} disabled={ro} checked={(form.loanMode ?? "activation") === "activation"} onChange={() => set("loanMode", "activation")} className="mt-1 h-4 w-4 accent-amber-600" />
                          <span>💳 <b>قرض كتفعيل</b>
                            <span className="block text-[11px] font-normal text-slate-500">يُمدَّد المشترك ٣٠ يوماً، ويُسجَّل عليه دَينٌ بمبلغ اشتراكه في «ديون القروض»، وتصله رسالة — ويُمحى الدَين عند تفعيله عاديّاً.</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 py-1 text-sm text-slate-700">
                          <input type="radio" name={`loanMode-${sel?.id ?? "new"}`} disabled={ro} checked={(form.loanMode ?? "activation") === "normal"} onChange={() => set("loanMode", "normal")} className="mt-1 h-4 w-4 accent-amber-600" />
                          <span>⚡ <b>قرض عادي</b>
                            <span className="block text-[11px] font-normal text-slate-500">يُمدَّد المشترك ٣٠ يوماً فقط — بلا أيّ دَين ولا رسالة ولا ظهورٍ في «ديون القروض»، مجرّد فزعة.</span>
                          </span>
                        </label>
                      </div>

                      <p className="text-xs text-slate-500">بيانات لوحة القروض خاصّة بهذا المكتب وحده. إطفاء الخانة يُخفي الميزة بكلّ آثارها ويحفظ البيانات لإعادة التفعيل.</p>
                    </div>
                  )}
                </div>
                {msg && <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
                {(editing || !sel) && (
                  <button onClick={save} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700">حفظ المكتب</button>
                )}
              </div>

              {/* واتساب هذا المكتب */}
              {sel && !editing && <OfficeWhatsApp officeId={sel.id} />}

              {/* مزامنة الاشتراكات — بصلاحيتها المستقلة (offices.edit وحدها لا تكفي) */}
              {sel && !editing && canSync && <OfficeSync officeId={sel.id} />}
            </>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">اختر مكتباً أو أضِف مكتباً جديداً</div>
          )}
        </div>
      </div>
    </div>
  );
}

const WA_LABEL: Record<string, string> = { disconnected: "غير متصل", starting: "جاري البدء...", qr: "بانتظار مسح QR", authenticated: "تم التوثيق...", ready: "متصل ✓", error: "خطأ" };

function OfficeWhatsApp({ officeId }: { officeId: number }) {
  const { can } = usePermission();
  const canConnect = can("whatsapp.connect"); // فصل الواتساب بصلاحية (سدّ ثغرة logout)
  type WaSt = {
    state: string; qrImage: string | null; error: string | null;
    hint?: string | null; machine?: { name: string | null; online: boolean; minutesAgo: number | null } | null;
  };
  const [st, setSt] = useState<WaSt>({ state: "disconnected", qrImage: null, error: null });
  const poll = useCallback(async () => {
    const r = await fetch(`/api/whatsapp/status?officeId=${officeId}`);
    if (r.ok) setSt(await r.json());
  }, [officeId]);

  // ═════ ب-٦ · الفاصلُ يتبع الحالةَ لا رقماً ثابتاً (2026-08-13) ═════
  // ٣ ثوانٍ **حيث ينتظر المستخدمُ تغيُّراً**: رمزُ QR يُولَّد على حاسبة المكتب وينتهي
  // بعد ثوانٍ فيُستبدَل، فالتأخيرُ هنا يُفشِل المسحَ فعلاً. أمّا `ready` (الحالُ الغالبُ:
  // سبعةُ مكاتبَ مربوطةٌ) و`disconnected` فلا شيءَ يتغيّر فيهما من تلقاء نفسه ⇒ ١٠ ثوانٍ.
  // وكلُّ استطلاعٍ يقرأ `wa_sessions` من قاعدةِ السحابة، فالفارقُ حقيقيٌّ لا تجميليّ.
  // 🔑 ولا يُطال الفاصلُ أكثرَ من ذلك: لا زرَّ ربطٍ في هذه الصفحة — الجلسةُ تبدأ على
  //   العامل وحدَه، فالانتقالُ إلى `qr` يقع **بلا فعلٍ من المستخدم** ولا شيءَ يُنبّهنا
  //   إليه. فـ١٠ ثوانٍ أقصى ما يُحتمَل انتظارُه أمام شاشةٍ يُراقبها. و`logout()` تستطلع
  //   فوراً بعدها فلا تنتظر دورةً. و`usePolling` يُعيد التركيبَ عند تغيّر الفاصل
  //   (`intervalMs` في قائمة اعتماديّاته) ⇒ العودةُ إلى ٣ث تحدث في أوّل دورةٍ بعد `qr`.
  const waitingForChange = st.state === "qr" || st.state === "starting" || st.state === "connecting";
  // تحديث حالة الواتساب — يصمت عند الإخفاء أو الخمول (حمية يقظة Azure)، ويُستأنف عند العودة
  usePolling(poll, waitingForChange ? 3000 : 10000);

  async function logout() {
    await fetch("/api/whatsapp/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeId }) });
    poll();
  }

  const ready = st.state === "ready";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-1 font-bold text-slate-800">واتساب المكتب</h3>
      <p className="mb-3 text-xs text-slate-500">اربط رقم واتساب خاص بهذا المكتب لإرسال رسائله وتقاريره. امسح QR مرة واحدة.</p>
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-block h-3 w-3 rounded-full ${ready ? "bg-emerald-500" : st.state === "qr" ? "bg-amber-500" : st.state === "error" ? "bg-red-500" : "bg-slate-300"}`} />
        <span className="text-sm font-semibold text-slate-700">{WA_LABEL[st.state] ?? st.state}</span>
      </div>
      {st.state === "qr" && st.qrImage && (
        <div className="mb-3 flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={st.qrImage} alt="QR" className="h-56 w-56" />
          <div className="mt-2 text-xs text-slate-500">واتساب ← الأجهزة المرتبطة ← ربط جهاز</div>
        </div>
      )}
      {/* لماذا لا يظهر رمز؟ — الصمت كان أسوأ من العطل: المستخدم يرى شاشةً خالية بلا سبب.
          الرمز لا يولد إلا على حاسبة المكتب، فإن كانت مطفأة تُقال العلّة والعلاج صراحةً. */}
      {st.hint && (
        <div className={`mb-2 rounded-lg px-3 py-2 text-xs leading-5 ${st.state === "qr" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-800"}`}>
          {st.hint}
          {st.machine && !st.machine.online && st.machine.minutesAgo != null && (
            <span className="mt-1 block text-[11px] text-amber-700">
              آخر ظهور للحاسبة: قبل {st.machine.minutesAgo < 60 ? `${st.machine.minutesAgo} دقيقة` : `${Math.round(st.machine.minutesAgo / 60)} ساعة`}
            </span>
          )}
        </div>
      )}
      {st.error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{st.error}</div>}
      {/* ═════ 🔴 الزرُّ كان غائباً بالضبط حين يُحتاج (بلاغُ الشدن 2026-08-15) ═════
          كان الشرطُ `ready &&` — أي أنّ «فصل الواتساب» لا يظهر إلّا والاتصالُ سليم.
          فمكتبٌ عالقٌ على «خطأ» أو على رمزٍ لا يُمسَح **لا يملك صاحبُه أيَّ وسيلةٍ
          لإعادة ضبطه**، وهو حالُ الشدن حرفيّاً: «لا يظهر لي فك ربط، فقط جاري البدء
          ثمّ الخطأ ويعيد نفسه».
          وفكُّ الربط هو ما يمسح ملفَّ الجلسة التالف من قرص الحاسبة — أي أنّه
          **العلاجُ نفسُه** الذي حُجب عن الحالة التي تحتاجه.
          فصار يظهر دائماً (بصلاحية whatsapp.connect)، ويتبدّل نصُّه بحسب الحال:
          «فصل» حين يعمل، و«إعادة ضبط» حين يكون عالقاً — فلا يُخيفه أنّه يقطع اتّصالاً
          قائماً وهو لا يقطع شيئاً. */}
      {canConnect && (
        <button
          onClick={() => {
            if (ready && !confirm("فصلُ واتساب هذا المكتب؟ ستحتاج مسحَ رمزٍ جديدٍ لإعادة ربطه.")) return;
            void logout();
          }}
          className={`w-full rounded-lg py-2 text-sm ${ready ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-amber-50 text-amber-800 hover:bg-amber-100 font-semibold"}`}
        >
          {ready ? "فصل / ربط حساب آخر" : "♻️ إعادة ضبط الجلسة (تمسح الجلسة العالقة وتبدأ من جديد)"}
        </button>
      )}
    </div>
  );
}

type SyncEvent = { scenario: 1 | 2 | 3 | 6 | 7; subscriber: string | null; pin?: string | null; detail?: string };
type SyncRes = {
  office: string;
  phase1: { activations: number; internal: number; external: number; phantom: number; markedUsed: number; duplicates: number; imported: number; verifiedReal?: number };
  phase2: { checked: number; dateFixed: number; imported: number; failed: boolean };
  events: SyncEvent[];
  reportSent: boolean | null;
  error?: string;
  // سطرٌ لكلّ لوحةِ ساس — الجوابُ على «هل مرّت على الساسَين؟»
  panels?: { panelId: number | null; label: string; ok: boolean; activations: number; imported: number; checked: number; dateFixed: number; error?: string }[];
};
// نتيجة فحص الكروت الشامل (كل المخزون مقابل SAS)
type CardsRes = {
  checkedAvailable: number; markedUsed: number; checkedUsed: number;
  verifiedReal: number; phantom: number; errors: number; aborted: boolean;
  skippedOld: number; windowDays: number;
  events: SyncEvent[]; error?: string;
};
type SyncStatus = {
  state: "idle" | "running" | "done" | "error";
  step?: "sync" | "cards" | "report";
  progress?: { label: string; done: number; total: number };
  sync?: SyncRes; cards?: CardsRes | null; error?: string;
};

const SCENARIO_LABEL: Record<number, string> = {
  1: "🔴 تفعيل وهمي (راجعه في حسابات المدير)",
  2: "🔁 تفعيل متكرّر في SAS",
  3: "🟡 تحديث كارت إلى مستخدم",
  6: "⚠️ كارت خارجي",
  7: "🆕 مشترك جديد مستورد",
};

const STEP_LABEL: Record<string, string> = {
  sync: "جاري المزامنة...",
  cards: "جاري فحص كل الكروت في SAS...",
  report: "جاري إرسال التقرير للمدير...",
};

// (أ-٢١ «سجلّ تدقيق المزامنة» أُزيل 2026-08-20 — حلّ محلَّه «سجلّ المزامنة»
// الموحَّدُ في الرئيسيّة بتبويباته الأربعة، مخزَّناً لا محسوباً حيّاً من الساس.)

function OfficeSync({ officeId }: { officeId: number }) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("sync");
  const [prog, setProg] = useState<{ label: string; done: number; total: number } | null>(null);
  const [res, setRes] = useState<SyncRes | null>(null);
  const [cards, setCards] = useState<CardsRes | null>(null);
  const alive = useRef(true); // يوقف المتابعة عند مغادرة الصفحة

  const fetchStatus = useCallback(
    (): Promise<SyncStatus | null> =>
      fetch(`/api/offices/${officeId}/sync`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    [officeId],
  );

  // متابعة الحالة كل 4 ثوانٍ حتى الانتهاء — المزامنة تعمل بالخلفية على الخادم،
  // فتستمر ولو أُغلقت الصفحة، وتُستأنف المتابعة عند فتحها من جديد
  const follow = useCallback(async () => {
    for (;;) {
      if (!alive.current) return;
      const st = await fetchStatus();
      if (!alive.current) return;
      if (st?.state === "running") {
        setBusy(true);
        if (st.step) setStep(st.step);
        setProg(st.progress ?? null);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      if (st?.state === "done") { setRes(st.sync ?? null); setCards(st.cards ?? null); }
      else if (st?.state === "error") { setRes({ error: st.error ?? "فشلت المزامنة" } as SyncRes); setCards(null); }
      setProg(null);
      setBusy(false);
      return;
    }
  }, [fetchStatus]);

  // عند فتح الصفحة: إن كانت مزامنة جارية لهذا المكتب نلتحق بمتابعتها تلقائياً
  useEffect(() => {
    alive.current = true;
    void (async () => {
      const st = await fetchStatus();
      if (st?.state === "running" && alive.current) await follow();
    })();
    return () => { alive.current = false; };
  }, [fetchStatus, follow]);

  async function sync() {
    setBusy(true); setStep("sync"); setProg(null); setRes(null); setCards(null);
    const d = await fetch(`/api/offices/${officeId}/sync`, { method: "POST" })
      .then((r) => r.json()).catch(() => null);
    if (!d?.started) {
      setRes({ error: d?.error ?? "تعذّر بدء المزامنة" } as SyncRes);
      setBusy(false);
      return;
    }
    void follow();
  }

  async function cancelSync() {
    await fetch(`/api/offices/${officeId}/sync`, { method: "DELETE" }).catch(() => null);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold text-slate-800">مزامنة الاشتراكات (شاملة: كروت الأمس + تصحيح التواريخ + فحص كل الكروت)</h3>
        <div className="flex items-center gap-2">
          {/* (زرّ سجلّ التدقيق أُزيل — ما ترصده المزامنةُ يظهر في «سجلّ المزامنة» بالرئيسيّة) */}
          <button onClick={sync} disabled={busy} className="rounded-lg bg-mynet-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {busy ? STEP_LABEL[step] ?? "جاري المزامنة..." : "🔄 مزامنة الآن"}
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">المرحلة 1: فحص كروت وتفعيلات الأمس. المرحلة 2: تصحيح تواريخ الانتهاء لكل المشتركين. المرحلة 3: فحص كل مخزون الكروت في SAS — المتاح المستخدم فعلاً يُعلَّم مستخدماً، والمستخدم بلا تفعيل يُدرج بالكروت الوهمية. ثم تقرير كامل للمدير واتساب.</p>

      {busy && (
        <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <span className="flex-1">
              {STEP_LABEL[step] ?? "جاري المزامنة..."}
              {prog && <span className="mr-1 font-semibold">— {prog.label}: {prog.done} من {prog.total}</span>}
            </span>
            <button onClick={cancelSync} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">⏹ إيقاف</button>
          </div>
          {prog && prog.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.min(100, Math.round((prog.done / prog.total) * 100))}%` }} />
            </div>
          )}
          <div className="mt-1 text-xs text-sky-600">تعمل بالخلفية — تستمر ولو أغلقت الصفحة، وستظهر النتائج هنا فور الانتهاء.</div>
        </div>
      )}

      {res?.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{res.error}</div>}

      {/* سؤالُ محمد: «كيف أتأكّد أنّها مرّت على الساسَين؟» — كانت النتائجُ تُجمَع في
          رقمٍ واحدٍ ويُنزَع اسمُ اللوحة، فالنجاحُ صامتٌ: لا يُميّز «صفرٌ من الثانية»
          عن «الثانيةُ لم تُمَسّ». فيُعرَض الآن سطرٌ لكلّ لوحةٍ باسمها — ونجاحاً وفشلاً،
          ويُعرَض **مع الخطأ أيضاً** لأنّ لوحةً قد تنجح وأخرى تسقط. */}
      {res?.panels && res.panels.length > 0 && (() => {
        const okCount = res.panels.filter((p) => p.ok).length;
        const all = res.panels.length;
        const complete = okCount === all;
        return (
          <div className={`mb-3 rounded-xl border px-3 py-2 ${complete ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            <div className={`mb-1 text-xs font-extrabold ${complete ? "text-emerald-800" : "text-amber-800"}`}>
              🖥️ لوحاتُ الساس: {okCount}/{all} {complete ? "✓ مرّت المزامنةُ على كلّ اللوحات" : "⚠️ لوحةٌ لم تُزامَن"}
            </div>
            <div className="space-y-1">
              {res.panels.map((p, i) => (
                <div key={p.panelId ?? `i${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={`font-bold ${p.ok ? "text-emerald-700" : "text-red-700"}`}>{p.ok ? "✅" : "⛔"} {p.label}</span>
                  {p.ok ? (
                    <>
                      <span className="rounded bg-white px-1.5 py-0.5 text-slate-600">تفعيلات <b>{p.activations}</b></span>
                      <span className="rounded bg-white px-1.5 py-0.5 text-slate-600">مستوردون <b>{p.imported}</b></span>
                      <span className="rounded bg-white px-1.5 py-0.5 text-slate-600">فُحص <b>{p.checked}</b></span>
                      <span className="rounded bg-white px-1.5 py-0.5 text-slate-600">صُحِّح <b>{p.dateFixed}</b></span>
                    </>
                  ) : (
                    <span className="text-red-600">{p.error ?? "لم تُزامَن"}</span>
                  )}
                </div>
              ))}
            </div>
            {!complete && <div className="mt-1 text-[11px] font-semibold text-amber-800">أعِد المزامنةَ بعد إصلاح سببِ اللوحة الساقطة.</div>}
          </div>
        );
      })()}
      {res && !res.error && (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-slate-100 px-2 py-1">تفعيلات الأمس: <b>{res.phase1.activations}</b></span>
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">كروت البرنامج: <b>{res.phase1.internal}</b></span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-700">خارجي: <b>{res.phase1.external}</b></span>
            <span className="rounded bg-rose-50 px-2 py-1 text-rose-700">وهمي: <b>{res.phase1.phantom}</b></span>
            <span className="rounded bg-yellow-50 px-2 py-1 text-yellow-700">حُدّث كارت: <b>{res.phase1.markedUsed}</b></span>
            <span className="rounded bg-purple-50 px-2 py-1 text-purple-700">متكرّر: <b>{res.phase1.duplicates}</b></span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">مستورد: <b>{res.phase1.imported}</b></span>
            <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">تصحيح تواريخ: <b>{res.phase2.dateFixed}</b>/{res.phase2.checked}</span>
            <span className="rounded bg-green-50 px-2 py-1 text-green-700">استيراد شامل: <b>{res.phase2.imported}</b></span>
            {res.reportSent === true && <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">📨 أُرسل التقرير للمدير</span>}
            {res.reportSent === false && <span className="rounded bg-orange-100 px-2 py-1 text-orange-700">التقرير لم يُرسل (واتساب مقطوع)</span>}
          </div>
          {/* 🔴 السببُ يُعرَض لا يُخفى (بلاغُ صميم 2026-08-13): كانت الرسالةُ «تعثّر SAS»
              بلا سببٍ، والعلّةُ الحقيقيّةُ كانت **رابطَ لوحةٍ خطأً** — فبقي الوكيلُ يُخمّن
              حتى حذف ٢١٧٢ مشتركاً ظنّاً أنّ البياناتَ هي العلّة. */}
          {res.phase2.failed && (
            <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
              ⚠️ تعذّر إكمال المرحلة 2 (تصحيحُ التواريخ والاستيرادُ الشامل)
              {res.error && <div className="mt-1 font-mono text-[10px] text-amber-900" dir="ltr">{res.error}</div>}
              {res.phase1.activations === 0 && res.phase2.checked === 0 && (
                <div className="mt-1 font-semibold">
                  ولم يُقرأ من الساس شيءٌ إطلاقاً ⇒ راجِع <b>رابطَ لوحة الساس واسمَ المستخدم وكلمةَ المرور</b> من زرّ «لوحات الساس» — لا المشتركين.
                </div>
              )}
            </div>
          )}
          {cards && (
            <div className="mb-2">
              <div className="mb-1 text-xs font-bold text-slate-600">📇 فحص الكروت الشامل (كل المخزون مقابل SAS)</div>
              {cards.error ? (
                <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">⚠️ تعذّر الفحص: {cards.error}</div>
              ) : (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-1">متاح فُحص: <b>{cards.checkedAvailable}</b></span>
                  <span className="rounded bg-yellow-50 px-2 py-1 text-yellow-700">حُدّث إلى مستخدم: <b>{cards.markedUsed}</b></span>
                  <span className="rounded bg-slate-100 px-2 py-1">مستخدم فُحص: <b>{cards.checkedUsed}</b></span>
                  <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">سليم: <b>{cards.verifiedReal}</b></span>
                  <span className="rounded bg-rose-50 px-2 py-1 text-rose-700">وهمي جديد: <b>{cards.phantom}</b></span>
                  {cards.skippedOld > 0 && <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">أقدم من {cards.windowDays} يوماً (بلا حكم): <b>{cards.skippedOld}</b></span>}
                  {cards.errors > 0 && <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">تعذّر الحكم: <b>{cards.errors}</b></span>}
                  {cards.aborted && <span className="rounded bg-slate-200 px-2 py-1 text-slate-600">⏹ أُوقف بطلبك</span>}
                </div>
              )}
              {cards.phantom > 0 && <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">🛡️ الكروت الوهمية الجديدة تظهر في «الكروت الوهمية» بحسابات المدير لاتخاذ الإجراء.</div>}
            </div>
          )}
          {(res.events.length > 0 || (cards?.events.length ?? 0) > 0) ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr><th className="p-2">الحالة</th><th className="p-2">المشترك</th><th className="p-2">البِن</th><th className="p-2">التفاصيل</th></tr>
                </thead>
                <tbody>
                  {[...res.events, ...(cards?.events ?? [])].map((e, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-2 font-medium whitespace-nowrap">{SCENARIO_LABEL[e.scenario] ?? e.scenario}</td>
                      <td className="p-2">{e.subscriber ?? "—"}</td>
                      <td className="p-2" dir="ltr">{e.pin ?? "—"}</td>
                      <td className="p-2 text-slate-500">{e.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-sm text-slate-400">لا ملاحظات تستحق الإبلاغ</div>}
        </>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>;
}
function I({ v, on, ro, dir, ph }: { v?: string | null; on: (s: string) => void; ro?: boolean; dir?: string; ph?: string }) {
  return <input value={v ?? ""} dir={dir} placeholder={ph} disabled={ro} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue disabled:bg-slate-50 disabled:text-slate-500" />;
}
