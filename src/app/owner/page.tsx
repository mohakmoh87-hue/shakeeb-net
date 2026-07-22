"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Manager = { id: number; username: string; plainPassword: string | null };
type DbSize = { dbHost?: string; dbName?: string; usedMB: number; limitMB: number; percent: number; level: "ok" | "warn" | "danger"; topTables: { table: string; mb: number; rows: number }[] };
type Agent = {
  id: number; name: string; officeCap: number; planExpiry: string | null;
  isTrial: boolean; approved: boolean; officeCount: number; userCount: number; subscriberCount: number;
  manager: Manager | null; expired: boolean;
};

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "بلا انتهاء";

export default function OwnerPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  // نموذج إضافة وكيل
  const [f, setF] = useState({ name: "", officeCap: 1, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" });
  const [credAgent, setCredAgent] = useState<Agent | null>(null); // تعديل بيانات دخول مدير وكيل
  const [showAccount, setShowAccount] = useState(false); // إعدادات حساب المالك
  const [dbSize, setDbSize] = useState<DbSize | null>(null); // مؤشّر حجم قاعدة البيانات
  const [dbSizeAt, setDbSizeAt] = useState<Date | null>(null); // وقت آخر قراءة للحجم
  const [showDbDetail, setShowDbDetail] = useState(false);

  const load = useCallback(() => {
    fetch("/api/owner/agents").then((r) => r.ok ? r.json() : { agents: [] }).then((d) => { setAgents(d.agents ?? []); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);
  // قراءة الحجم حيّةً (بلا كاش) + تحديث تلقائي كل دقيقة
  const loadDbSize = useCallback(() => {
    fetch("/api/owner/db-size", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setDbSize(d); setDbSizeAt(new Date()); } });
  }, []);
  useEffect(() => {
    loadDbSize();
    const t = setInterval(loadDbSize, 60_000);
    return () => clearInterval(t);
  }, [loadDbSize]);

  async function addAgent() {
    setMsg("");
    const r = await fetch("/api/owner/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setAdding(false); setF({ name: "", officeCap: 1, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" }); load(); }
    else setMsg(d.error ?? "تعذّرت الإضافة");
  }
  async function patch(id: number, body: Record<string, unknown>) {
    const r = await fetch(`/api/owner/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر التعديل"); }
  }
  async function remove(a: Agent) {
    if (!confirm(`حذف الوكيل «${a.name}» نهائياً؟\nسيُمحى كل شيء: ${a.officeCount} مكتب، ${a.userCount} مستخدم، وكل المشتركين والحسابات والكروت. لا يمكن التراجع.`)) return;
    // عملية حساسة: تأكيد بكلمة سر السوبر أدمن (تُتحقّق في الخادم)
    const ownerPassword = prompt("🔒 أدخل كلمة سر السوبر أدمن لتأكيد الحذف النهائي:");
    if (!ownerPassword) return;
    const r = await fetch(`/api/owner/agents/${a.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerPassword }),
    });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر الحذف"); }
  }
  // إعادة توليد مفتاح قاعدة بيانات الوكيل (عند الشك بتسريب) — تفقد الحواسيب اتصالها حتى تُجدَّد تنصيباتها
  async function regenKey(a: Agent) {
    if (!confirm(`إعادة توليد مفتاح قاعدة بيانات الوكيل «${a.name}»؟\nستتوقف حواسيب مكاتبه المُنصَّبة عن الاتصال حتى تُعيد تنصيبها برمز جديد من «حسابات المدير». استخدمها عند الشك بتسريب المفتاح فقط.`)) return;
    // عملية حساسة: تأكيد بكلمة سر السوبر أدمن (تُتحقّق في الخادم)
    const ownerPassword = prompt("🔒 أدخل كلمة سر السوبر أدمن لتأكيد تغيير مفتاح القاعدة:");
    if (!ownerPassword) return;
    const r = await fetch(`/api/owner/agents/${a.id}/db-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerPassword }),
    });
    if (r.ok) alert("✓ أُعيد توليد المفتاح. جدّد تنصيب حواسيب هذا الوكيل برموز جديدة.");
    else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّرت العملية"); }
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">👑 لوحة مالك النظام</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowAccount(true)} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200">⚙️ حسابي</button>
          <button onClick={() => setAdding(true)} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700">➕ وكيل جديد</button>
          <button onClick={logout} className="rounded-xl bg-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-300">خروج</button>
        </div>
      </div>

      {/* مؤشّر حجم قاعدة البيانات — تنبيه عند 60% و80% */}
      {dbSize && (
        <div
          onClick={() => setShowDbDetail((v) => !v)}
          className={`mb-5 cursor-pointer rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${
            dbSize.level === "danger" ? "border-red-300 bg-red-50" : dbSize.level === "warn" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-800">
              🗄️ حجم قاعدة البيانات
              {dbSize.level === "danger" && <span className="mr-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">تحذير: تجاوز 80%!</span>}
              {dbSize.level === "warn" && <span className="mr-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">تنبيه: تجاوز 60%</span>}
              {dbSize.dbHost && (
                <div className="mt-0.5 text-[11px] font-semibold text-slate-500" dir="ltr" title="القاعدة التي يتصل بها الموقع فعلياً الآن">
                  {dbSize.dbHost}{dbSize.dbName ? ` / ${dbSize.dbName}` : ""}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">
                {dbSize.usedMB} MB / {dbSize.limitMB} MB <span className={`${dbSize.level === "danger" ? "text-red-600" : dbSize.level === "warn" ? "text-amber-600" : "text-emerald-600"}`}>({dbSize.percent}%)</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); loadDbSize(); }}
                className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200"
                title="إعادة قراءة الحجم من القاعدة الآن"
              >
                🔄 تحديث
              </button>
            </div>
          </div>
          {dbSizeAt && (
            <div className="mt-1 text-[10px] text-slate-400">
              آخر قراءة: {dbSizeAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · تُقرأ حيّةً من القاعدة وتتحدّث تلقائياً كل دقيقة · أعداد الصفوف تقديرية (إحصاءات Postgres)
            </div>
          )}
          {/* شريط الامتلاء */}
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200" dir="ltr">
            <div
              className={`h-full rounded-full transition-all ${dbSize.level === "danger" ? "bg-red-500" : dbSize.level === "warn" ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, Math.max(1, dbSize.percent))}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-400">اضغط لعرض أكبر الجداول {showDbDetail ? "▲" : "▼"}</div>
          {showDbDetail && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4" onClick={(e) => e.stopPropagation()}>
              {dbSize.topTables.map((t) => (
                <div key={t.table} className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                  <div className="truncate font-semibold text-slate-700" dir="ltr">{t.table}</div>
                  <div className="text-slate-500" dir="ltr">{t.mb} MB · {t.rows.toLocaleString("en-US")} صف</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-400">جاري التحميل…</div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">لا يوجد وكلاء بعد — أضف أول وكيل.</div>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-800">
                    {a.name}
                    {a.isTrial && <span className="mr-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">تجريبي</span>}
                    {!a.approved && <span className="mr-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">بانتظار الموافقة</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">🏢 {a.officeCount}/{a.officeCap} مكتب · 👤 {a.userCount} مستخدم · 👥 {a.subscriberCount} مشترك · 📅 ينتهي: <span className={a.expired ? "font-bold text-red-600" : "text-slate-600"}>{fmtDate(a.planExpiry)}{a.expired ? " (منتهٍ)" : ""}</span></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!a.approved && <button onClick={() => patch(a.id, { approve: true })} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700">✓ موافقة وتفعيل</button>}
                  <button onClick={() => setCredAgent(a)} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">🔑 بيانات الدخول</button>
                  <button onClick={() => regenKey(a)} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100" title="إعادة توليد مفتاح قاعدة بيانات الوكيل (عند الشك بتسريب)">🔐 مفتاح القاعدة</button>
                  <label className="flex items-center gap-1 text-xs text-slate-600">سقف المكاتب
                    <input type="number" min={0} defaultValue={a.officeCap} onBlur={(e) => { const v = Number(e.target.value); if (v !== a.officeCap) patch(a.id, { officeCap: v }); }} className="w-16 rounded border border-slate-300 px-2 py-1 text-center" />
                  </label>
                  <button onClick={() => patch(a.id, { addMonths: 1 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+شهر</button>
                  <button onClick={() => patch(a.id, { addMonths: 12 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+سنة</button>
                  <button onClick={() => { const m = prompt("تمديد بعدد أشهر:"); if (m) patch(a.id, { addMonths: Number(m) }); }} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">تمديد…</button>
                  <button onClick={() => patch(a.id, { clearExpiry: true })} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">بلا انتهاء</button>
                  <button onClick={() => remove(a)} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">🗑 حذف</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdding(false)}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-center text-lg font-bold text-slate-800">➕ وكيل جديد</h3>
            {msg && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-center text-sm text-red-600">{msg}</div>}
            <div className="space-y-2">
              <Field label="اسم الوكيل (العلامة)"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="inp" /></Field>
              <div className="flex gap-2">
                <Field label="سقف المكاتب"><input type="number" min={0} value={f.officeCap} onChange={(e) => setF({ ...f, officeCap: Number(e.target.value) })} className="inp" /></Field>
                <Field label="مدة الاشتراك (أشهر، 0=دائم)"><input type="number" min={0} value={f.planMonths} onChange={(e) => setF({ ...f, planMonths: Number(e.target.value) })} className="inp" /></Field>
              </div>
              <hr className="my-2" />
              <div className="text-xs font-semibold text-slate-500">حساب مدير الوكيل الأول</div>
              <Field label="الاسم الكامل"><input value={f.managerFullName} onChange={(e) => setF({ ...f, managerFullName: e.target.value })} className="inp" /></Field>
              <Field label="اسم المستخدم"><input dir="ltr" value={f.managerUsername} onChange={(e) => setF({ ...f, managerUsername: e.target.value })} className="inp" /></Field>
              <Field label="كلمة السر"><input dir="ltr" value={f.managerPassword} onChange={(e) => setF({ ...f, managerPassword: e.target.value })} className="inp" /></Field>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={addAgent} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700">إنشاء</button>
              <button onClick={() => setAdding(false)} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إلغاء</button>
            </div>
          </div>
        </div>
      )}
      {credAgent && <CredModal agent={credAgent} onClose={() => setCredAgent(null)} onSaved={() => { setCredAgent(null); load(); }} />}
      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}

      <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.4rem .6rem;font-size:.9rem}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-xs font-semibold text-slate-500">{label}</span>{children}</label>;
}

// تعديل بيانات دخول مدير وكيل (عرض النسخة القابلة للعرض + تعديل)
function CredModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(agent.manager?.username ?? "");
  const [password, setPassword] = useState(agent.manager?.plainPassword ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setMsg("");
    const body: Record<string, unknown> = {};
    if (username.trim() && username !== agent.manager?.username) body.managerUsername = username.trim();
    if (password.trim() && password !== agent.manager?.plainPassword) body.managerPassword = password.trim();
    if (Object.keys(body).length === 0) { setBusy(false); onClose(); return; }
    const r = await fetch(`/api/owner/agents/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) onSaved(); else { const d = await r.json().catch(() => ({})); setMsg(d.error ?? "تعذّر الحفظ"); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-center text-lg font-bold text-slate-800">🔑 بيانات دخول مدير «{agent.name}»</h3>
        <p className="mb-4 text-center text-xs text-slate-500">يمكنك عرضها وتعديلها. الباسورد المعروض متاح فقط إن ضبطتَه من هنا سابقاً.</p>
        {msg && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-center text-sm text-red-600">{msg}</div>}
        <div className="space-y-2">
          <Field label="اسم المستخدم"><input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} className="inp" /></Field>
          <Field label="كلمة السر"><input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={agent.manager?.plainPassword ? "" : "غير متاحة — اكتب كلمة جديدة لتعيينها"} className="inp" /></Field>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? "جارٍ…" : "حفظ"}</button>
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إغلاق</button>
        </div>
      </div>
    </div>
  );
}

// إعدادات حساب المالك: يوزر/باسورد/إيميل استرجاع + رقم التواصل العام
function AccountModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/owner/account").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setUsername(d.username ?? ""); setPassword(d.plainPassword ?? ""); setRecoveryEmail(d.recoveryEmail ?? ""); setOwnerPhone(d.ownerPhone ?? "");
    });
  }, []);

  async function save() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/owner/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() || undefined, password: password.trim() || undefined, recoveryEmail: recoveryEmail.trim() || null, ownerPhone: ownerPhone.trim() }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMsg("✓ تم الحفظ"); else setMsg(d.error ?? "تعذّر الحفظ");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-center text-lg font-bold text-slate-800">⚙️ حساب المالك</h3>
        {msg && <div className="mb-3 rounded bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">{msg}</div>}
        <div className="space-y-2">
          <Field label="اسم المستخدم"><input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} className="inp" /></Field>
          <Field label="كلمة السر"><input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className="inp" /></Field>
          <Field label="إيميل استرجاع كلمة السر"><input dir="ltr" type="email" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} placeholder="you@gmail.com" className="inp" /></Field>
          <Field label="رقم التواصل (يظهر بصفحة الدخول)"><input dir="ltr" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="07XXXXXXXXX" className="inp" /></Field>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "جارٍ…" : "حفظ"}</button>
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
