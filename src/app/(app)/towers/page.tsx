"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";
import { localSasBase } from "@/lib/localSas";

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
  reminderTime: string | null;
  lat: number | null;
  lng: number | null;
  geoRadius: number | null;
  geoEnabled: boolean | null;
};
type MapArea = { code: string; count: number };

const empty: Partial<Office> = { activationMode: "month", silent: "1", waEnabled: "1" };

export default function OfficesPage() {
  const { can, me } = usePermission();
  const isManager = can("offices.manage");
  // مكاتب المستخدم لوضع "ربط الواتساب فقط" (لمن لا يملك صلاحية إدارة المكاتب)
  const [waOnly, setWaOnly] = useState<{ id: number; name: string | null }[]>([]);

  const [offices, setOffices] = useState<Office[]>([]);
  const [sel, setSel] = useState<Office | null>(null);
  const [form, setForm] = useState<Partial<Office>>(empty);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [areas, setAreas] = useState<MapArea[]>([]); // مناطق الخريطة المتاحة

  const load = useCallback(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setOffices)));
  }, []);
  useEffect(() => { if (isManager) load(); }, [load, isManager]);
  useEffect(() => {
    if (isManager) fetch("/api/map/areas").then((r) => r.ok ? r.json() : null).then((d) => d && setAreas(d.areas ?? []));
  }, [isManager]);

  // وضع QR فقط: جلب مكتب المستخدم دائماً للربط (متاح بلا صلاحية إدارة)
  useEffect(() => {
    if (me && !isManager) {
      fetch("/api/whatsapp/my-offices").then((r) => void (r.ok && r.json().then((d) => setWaOnly(d.offices ?? []))));
    }
  }, [me, isManager]);

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;

  // وضع "ربط الواتساب فقط" لغير المخوّلين بإدارة المكاتب
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

  function pick(o: Office) { setSel(o); setForm({ ...o }); setEditing(false); setMsg(""); }
  function addNew() { setSel(null); setForm({ ...empty }); setEditing(true); setMsg(""); }
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
      body: JSON.stringify(form),
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

  async function remove(o: Office) {
    if (!window.confirm(`حذف المكتب "${o.name}"؟`)) return;
    const res = await fetch(`/api/towers/${o.id}`, { method: "DELETE" });
    if (res.ok) { if (sel?.id === o.id) { setSel(null); setForm(empty); } load(); }
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
                <button onClick={() => remove(o)} className="text-xs text-red-400 hover:text-red-600">حذف</button>
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
                  {sel && !editing && <button onClick={() => setEditing(true)} className="rounded-lg bg-slate-100 px-3 py-1 text-sm text-slate-600 hover:bg-slate-200">تعديل</button>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <F label="اسم المكتب"><I v={form.name} on={(v) => set("name", v)} ro={ro} /></F>
                  <F label="رقم مدير المكتب (للتقرير)"><I v={form.managerPhone} on={(v) => set("managerPhone", v)} ro={ro} dir="ltr" /></F>
                  <F label="رابط لوحة SAS"><I v={form.loginUrl} on={(v) => set("loginUrl", v)} ro={ro} dir="ltr" ph="82.129.22.22" /></F>
                  <F label="هاتف المكتب"><I v={form.phone} on={(v) => set("phone", v)} ro={ro} dir="ltr" /></F>
                  <F label="يوزر SAS"><I v={form.username} on={(v) => set("username", v)} ro={ro} dir="ltr" /></F>
                  <F label="باسورد SAS"><I v={form.password} on={(v) => set("password", v)} ro={ro} dir="ltr" /></F>
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
                    <input type="checkbox" disabled={ro} checked={form.rewardsEnabled === "1"} onChange={(e) => set("rewardsEnabled", e.target.checked ? "1" : "0")} className="h-4 w-4 accent-fuchsia-600" />
                    🎁 تفعيل نظام مكافآت المشتركين
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
                {msg && <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
                {(editing || !sel) && (
                  <button onClick={save} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700">حفظ المكتب</button>
                )}
              </div>

              {/* واتساب هذا المكتب */}
              {sel && !editing && <OfficeWhatsApp officeId={sel.id} />}

              {/* مزامنة الاشتراكات */}
              {sel && !editing && <OfficeSync officeId={sel.id} />}
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
  const [st, setSt] = useState<{ state: string; qrImage: string | null; error: string | null }>({ state: "disconnected", qrImage: null, error: null });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const r = await fetch(`/api/whatsapp/status?officeId=${officeId}`);
    if (r.ok) setSt(await r.json());
  }, [officeId]);

  useEffect(() => {
    poll();
    timer.current = setInterval(poll, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [poll]);

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
      {st.error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{st.error}</div>}
      {ready && <button onClick={logout} className="w-full rounded-lg bg-slate-100 py-2 text-sm text-slate-600 hover:bg-slate-200">فصل / ربط حساب آخر</button>}
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
};

const SCENARIO_LABEL: Record<number, string> = {
  1: "🔴 تفعيل وهمي (راجعه في حسابات المدير)",
  2: "🔁 تفعيل متكرّر في SAS",
  3: "🟡 تحديث كارت إلى مستخدم",
  6: "⚠️ كارت خارجي",
  7: "🆕 مشترك جديد مستورد",
};

function OfficeSync({ officeId }: { officeId: number }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SyncRes | null>(null);

  async function sync() {
    setBusy(true); setRes(null);
    // العامل المحلي (حاسبة المكتب، قرب SAS) أسرع؛ وإلا Vercel
    const base = await localSasBase();
    const r = base
      ? await fetch(`${base}/sas4/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ towerId: officeId }) })
      : await fetch(`/api/offices/${officeId}/sync`, { method: "POST" });
    setBusy(false);
    const d = await r.json().catch(() => ({ error: "تعذّر الاتصال" }));
    setRes(d);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold text-slate-800">مزامنة الاشتراكات (مرحلتان: كروت الأمس + تصحيح التواريخ)</h3>
        <button onClick={sync} disabled={busy} className="rounded-lg bg-mynet-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
          {busy ? "جاري المزامنة..." : "🔄 مزامنة الآن"}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">المرحلة 1: فحص كروت وتفعيلات الأمس ومعالجة الحالات الاستثنائية. المرحلة 2: تصحيح تواريخ الانتهاء لكل المشتركين بصمت. ثم تقرير صامت للمدير.</p>

      {res?.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{res.error}</div>}
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
            {res.reportSent === false && <span className="rounded bg-orange-100 px-2 py-1 text-orange-700">التقرير مؤجّل (واتساب مقطوع)</span>}
          </div>
          {res.phase2.failed && <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">⚠️ تعذّر إكمال تصحيح التواريخ (تعثّر SAS في المرحلة 2)</div>}
          {res.events.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr><th className="p-2">الحالة</th><th className="p-2">المشترك</th><th className="p-2">البِن</th><th className="p-2">التفاصيل</th></tr>
                </thead>
                <tbody>
                  {res.events.map((e, i) => (
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
