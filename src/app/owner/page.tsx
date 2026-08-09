"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePolling } from "@/lib/usePolling";

type Manager = { id: number; username: string; plainPassword: string | null };
type DbSize = { dbHost?: string; dbName?: string; usedMB: number; freeMB?: number; limitMB: number; percent: number; totalRows?: number; tableCount?: number; level: "ok" | "warn" | "danger"; connUsed?: number; connApp?: number; connMax?: number; connLevel?: "ok" | "warn" | "danger"; topTables: { table: string; mb: number; rows: number }[] };
type Metric = { used: number; limit: number; freePct: number; remaining?: number };
type HostUsage = { hasData: boolean; month: string; updatedAt: string | null; requests: Metric; vcpuSeconds: Metric | null; gibSeconds: Metric | null };
type Agent = {
  id: number; name: string; officeCap: number; planExpiry: string | null;
  maxManagers: number; maxUsers: number; maxTechnicians: number; maxSubscribers: number;
  isTrial: boolean; approved: boolean; officeCount: number; userCount: number;
  managerCount: number; techCount: number; subscriberCount: number;
  manager: Manager | null; expired: boolean;
  managerPhones: string[]; backupEmail: string | null;
  odooSlaSendAllowed: boolean; // إذن «رسائل أودو التلقائيّة» (الميزة ٢) — بلا هذا الإذن لا يراها الوكيل
};

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "بلا انتهاء";

export default function OwnerPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  // نموذج إضافة وكيل
  const [f, setF] = useState({ name: "", officeCap: 1, maxManagers: 1, maxUsers: 1, maxTechnicians: 3, maxSubscribers: 3000, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" });
  const [credAgent, setCredAgent] = useState<Agent | null>(null); // تعديل بيانات دخول مدير وكيل
  const [showAccount, setShowAccount] = useState(false); // إعدادات حساب المالك
  const [dbSize, setDbSize] = useState<DbSize | null>(null); // مؤشّر حجم قاعدة البيانات
  const [dbSizeAt, setDbSizeAt] = useState<Date | null>(null); // وقت آخر قراءة للحجم
  const [showDbDetail, setShowDbDetail] = useState(false);
  const [host, setHost] = useState<HostUsage | null>(null); // استخدام الاستضافة (Azure)

  const load = useCallback(() => {
    fetch("/api/owner/agents").then((r) => r.ok ? r.json() : { agents: [] }).then((d) => { setAgents(d.agents ?? []); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);
  // قراءة الحجم حيّةً (بلا كاش) + تحديث تلقائي كل دقيقة
  const loadDbSize = useCallback(() => {
    fetch("/api/owner/db-size", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setDbSize(d); setDbSizeAt(new Date()); } });
  }, []);
  // تحديث حجم القاعدة كل دقيقة — يصمت عند الإخفاء أو الخمول (حمية يقظة Azure)
  usePolling(loadDbSize, 60_000);
  // استخدام الاستضافة (Azure) — يُحدَّث يومياً من مهمة مجدولة؛ نقرؤه عند الفتح فقط
  useEffect(() => {
    fetch("/api/owner/hosting-usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setHost(d); })
      .catch(() => {});
  }, []);

  async function addAgent() {
    setMsg("");
    const r = await fetch("/api/owner/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setAdding(false); setF({ name: "", officeCap: 1, maxManagers: 1, maxUsers: 1, maxTechnicians: 3, maxSubscribers: 3000, planMonths: 0, managerFullName: "", managerUsername: "", managerPassword: "" }); load(); }
    else setMsg(d.error ?? "تعذّرت الإضافة");
  }
  async function patch(id: number, body: Record<string, unknown>) {
    const r = await fetch(`/api/owner/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر التعديل"); }
  }

  // رسالة المالك للوكلاء بالإيميل — فرديّة (وكيل واحد) أو جماعيّة (الكل)
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [mailBusy, setMailBusy] = useState(false);
  const [mailMsg, setMailMsg] = useState("");
  async function sendMailTo(agentIds: number[]) {
    if (!mailSubject.trim() || !mailBody.trim()) { setMailMsg("اكتب العنوان والنص أولاً"); return; }
    if (agentIds.length === 0) { setMailMsg("لا يوجد وكلاء للإرسال إليهم"); return; }
    if (agentIds.length > 1 && !confirm(`إرسال الرسالة إلى ${agentIds.length} وكيل؟`)) return;
    setMailBusy(true); setMailMsg("");
    const r = await fetch("/api/owner/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: mailSubject.trim(), body: mailBody.trim(), agentIds }),
    });
    const d = await r.json().catch(() => ({}));
    setMailBusy(false);
    if (r.ok) {
      let m = `✓ أُرسلت إلى ${d.sent} وكيل`;
      if (d.noEmail?.length) m += ` · بلا بريد (${d.noEmail.length}): ${d.noEmail.join("، ")}`;
      if (d.failed?.length) m += ` · فشل: ${d.failed.join("، ")}`;
      setMailMsg(m);
    } else setMailMsg(d.error ?? "تعذّر الإرسال");
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
          {/* تفصيل: مستخدم · متبقٍّ · إجمالي الصفوف والجداول */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className="rounded-lg bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">مستخدم</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">{dbSize.usedMB} MB</div>
            </div>
            <div className="rounded-lg bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">المتبقي</div>
              <div className={`text-sm font-extrabold ${dbSize.level === "danger" ? "text-red-600" : dbSize.level === "warn" ? "text-amber-600" : "text-emerald-600"}`} dir="ltr">
                {dbSize.freeMB != null ? `${dbSize.freeMB} MB` : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">إجمالي الصفوف</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">{dbSize.totalRows != null ? dbSize.totalRows.toLocaleString("en-US") : "—"}</div>
            </div>
            <div className="rounded-lg bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">عدد الجداول</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">{dbSize.tableCount ?? "—"}</div>
            </div>
          </div>
          {/* اتصالات القاعدة (client backends المحسوبة على الحدّ) — عمليات نظام Aiven الخلفية لا تُحسب */}
          {dbSize.connMax != null && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] ring-1 ring-slate-200">
              <span className="text-slate-400">اتصالات القاعدة</span>
              <span className={`font-extrabold ${dbSize.connLevel === "danger" ? "text-red-600" : dbSize.connLevel === "warn" ? "text-amber-600" : "text-emerald-600"}`} dir="ltr">{dbSize.connUsed}/{dbSize.connMax}</span>
              <span className="text-slate-400">تطبيقك والمكاتب: <b className="text-slate-600">{dbSize.connApp ?? 0}</b></span>
              <span className="text-[10px] text-slate-300">(الباقي مراقبة/نظام Aiven)</span>
            </div>
          )}
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

      {/* مؤشّر استخدام الاستضافة (Azure) مقابل المنحة المجانية الشهرية */}
      {host && (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-800">☁️ استخدام الاستضافة (Azure)
              <span className="mr-2 text-[11px] font-normal text-slate-400">آخر 24 ساعة · من المنحة الشهرية المجانية</span>
            </div>
            <div className="text-sm font-extrabold text-emerald-600" dir="ltr">
              {host.requests.used.toLocaleString("en-US")} / {(host.requests.limit / 1_000_000)}M طلب
              <span className="text-slate-400"> ({host.requests.freePct}%)</span>
            </div>
          </div>
          {!host.hasData && (
            <div className="mt-1 text-[11px] text-amber-600">لم يصل قياس بعد — يُحدَّث تلقائياً يومياً من Azure.</div>
          )}
          {/* شريط الطلبات */}
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200" dir="ltr">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.max(host.requests.used > 0 ? 1 : 0, host.requests.freePct))}%` }} />
          </div>
          {/* خانات: الطلبات المتبقية + المعالج + الذاكرة */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">الطلبات المتبقية</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">{(host.requests.remaining ?? 0).toLocaleString("en-US")}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">ثواني المعالج</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">
                {host.vcpuSeconds ? `${host.vcpuSeconds.used.toLocaleString("en-US")} / ${(host.vcpuSeconds.limit / 1000)}K` : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
              <div className="text-[10px] text-slate-400">ذاكرة (GiB·ث)</div>
              <div className="text-sm font-extrabold text-slate-700" dir="ltr">
                {host.gibSeconds ? `${host.gibSeconds.used.toLocaleString("en-US")} / ${(host.gibSeconds.limit / 1000)}K` : "—"}
              </div>
            </div>
          </div>
          {host.updatedAt && (
            <div className="mt-1 text-[10px] text-slate-400">آخر تحديث من Azure: {new Date(host.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
          )}
        </div>
      )}

      {/* رفع خريطة الأعمدة — كانت تُدخَل يدوياً على القاعدة خارج البرنامج (طلب محمد) */}
      <MapImport />

      {/* رسالة للوكلاء بالإيميل: عنوان + نصّ، ثم «إرسال للكل» هنا أو «✉️» بجانب وكيلٍ بعينه */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 font-bold text-slate-800">✉️ رسالة للوكلاء (بريد إلكتروني)
          <span className="mr-2 text-[11px] font-normal text-slate-400">تصل بريد الوكيل (backupEmail) — للكل أو لوكيلٍ بزرّ «✉️» بجانبه</span>
        </div>
        <div className="space-y-2">
          <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)} placeholder="عنوان الرسالة" className="inp" />
          <textarea value={mailBody} onChange={(e) => setMailBody(e.target.value)} placeholder="نصّ الرسالة…" rows={4} className="inp" />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => sendMailTo(agents.map((a) => a.id))} disabled={mailBusy} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              {mailBusy ? "جارٍ الإرسال…" : `📢 إرسال للكل (${agents.length})`}
            </button>
            <span className="text-[11px] text-slate-400">أو اضغط «✉️» بجانب وكيلٍ لإرساله له وحده.</span>
          </div>
          {mailMsg && <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${mailMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{mailMsg}</div>}
        </div>
      </div>

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
                  <div className="mt-1 text-xs text-slate-500">🏢 {a.officeCount}/{a.officeCap} مكتب · 👔 {a.managerCount}/{a.maxManagers} مدير · 👤 {a.userCount}/{a.maxUsers} مستخدم · 🔧 {a.techCount}/{a.maxTechnicians} فني · 👥 {a.subscriberCount}/{a.maxSubscribers} مشترك · 📅 ينتهي: <span className={a.expired ? "font-bold text-red-600" : "text-slate-600"}>{fmtDate(a.planExpiry)}{a.expired ? " (منتهٍ)" : ""}</span></div>
                  <div className="mt-1 text-xs text-slate-500">
                    📞 {a.managerPhones.length ? <span dir="ltr" className="font-semibold text-slate-600">{a.managerPhones.join("، ")}</span> : <span className="text-slate-400">لا رقم مدير</span>}
                    {" · "}✉️ {a.backupEmail ? <span dir="ltr" className="font-semibold text-slate-600">{a.backupEmail}</span> : <span className="text-amber-600">لا بريد</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!a.approved && <button onClick={() => patch(a.id, { approve: true })} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700">✓ موافقة وتفعيل</button>}
                  {/* تعديل اسم الوكيل (العلامة) — للمالك حصراً؛ المدير لا يعدّله بنفسه (قرار محمد 2026-08-09).
                      وكيلٌ كتب اسمه خطأً («صفء» بدل «صفاء») يصلّحه المالك من هنا. */}
                  <NameEdit value={a.name} onSave={(v) => { if (v && v !== a.name) patch(a.id, { name: v }); }} />
                  <button onClick={() => setCredAgent(a)} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">🔑 بيانات الدخول</button>
                  {/* إذن «رسائل أودو التلقائيّة» (الميزة ٢ من مهلة أودو): بلا هذا الإذن لا يظهر للوكيل
                      مفتاحُها إطلاقاً. والإذن يجعلها متاحةً لا مفروضة — يشعلها لكلّ مكتب كما يشاء. */}
                  <button
                    onClick={() => patch(a.id, { odooSlaSendAllowed: !a.odooSlaSendAllowed })}
                    title={a.odooSlaSendAllowed
                      ? "مسموحٌ له تشغيل إرسال رسائل أودو والمشتركين — اضغط للمنع"
                      : "ممنوعٌ — لا يظهر له مفتاح إرسال رسائل أودو والمشتركين. اضغط للسماح"}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${a.odooSlaSendAllowed ? "bg-violet-600 text-white hover:bg-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    📨 رسائل أودو {a.odooSlaSendAllowed ? "مسموحة" : "ممنوعة"}
                  </button>
                  <button onClick={() => regenKey(a)} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100" title="إعادة توليد مفتاح قاعدة بيانات الوكيل (عند الشك بتسريب)">🔐 مفتاح القاعدة</button>
                  <LimitInput label="مكاتب" value={a.officeCap} onSave={(v) => { if (v !== a.officeCap) patch(a.id, { officeCap: v }); }} />
                  <LimitInput label="مدراء" value={a.maxManagers} onSave={(v) => { if (v !== a.maxManagers) patch(a.id, { maxManagers: v }); }} />
                  <LimitInput label="مستخدمين" value={a.maxUsers} onSave={(v) => { if (v !== a.maxUsers) patch(a.id, { maxUsers: v }); }} />
                  <LimitInput label="فنيين" value={a.maxTechnicians} onSave={(v) => { if (v !== a.maxTechnicians) patch(a.id, { maxTechnicians: v }); }} />
                  <LimitInput label="مشتركين" value={a.maxSubscribers} onSave={(v) => { if (v !== a.maxSubscribers) patch(a.id, { maxSubscribers: v }); }} />
                  <button onClick={() => sendMailTo([a.id])} disabled={!a.backupEmail || mailBusy} title={a.backupEmail ? "إرسال رسالة (العنوان والنصّ من الأعلى) لهذا الوكيل" : "لا بريد لهذا الوكيل — اطلب منه ضبط بريده"} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">✉️ إرسال</button>
                  <button onClick={() => patch(a.id, { addMonths: 1 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+شهر</button>
                  <button onClick={() => patch(a.id, { addMonths: 12 })} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">+سنة</button>
                  <ExtendDate onApply={(dt) => patch(a.id, { setExpiry: dt })} />
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
              <div className="text-xs font-semibold text-slate-500">الحدود القصوى</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="أقصى مدراء"><input type="number" min={1} value={f.maxManagers} onChange={(e) => setF({ ...f, maxManagers: Number(e.target.value) })} className="inp" /></Field>
                <Field label="أقصى مستخدمين"><input type="number" min={0} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: Number(e.target.value) })} className="inp" /></Field>
                <Field label="أقصى فنيين"><input type="number" min={0} value={f.maxTechnicians} onChange={(e) => setF({ ...f, maxTechnicians: Number(e.target.value) })} className="inp" /></Field>
                <Field label="أقصى مشتركين"><input type="number" min={0} value={f.maxSubscribers} onChange={(e) => setF({ ...f, maxSubscribers: Number(e.target.value) })} className="inp" /></Field>
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

/* ===== رفع خريطة الأعمدة (KML) =====
   كل تحديث خريطة كان يحتاج إدخالاً يدوياً على القاعدة من خارج البرنامج. الآن: اختر الملف
   فيُقرأ **قبل الكتابة** ويُقال لك ماذا سيتغيّر (جديد/تحرّك/بلا تغيير)، ثم تعتمده بضغطة.
   ولا يُحذف شيء أبداً: الرفع يُضيف ويُحدّث فقط — خريطة ناقصة أهون من خريطة تُمحى بالخطأ. */
type MapPreview = { points: number; added: number; overTech: number; keptKml: number; skipped: number; areas: string[]; sample?: string[]; techNames?: string[] };
function MapImport() {
  const [areas, setAreas] = useState<{ code: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [kml, setKml] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadAreas = useCallback(() => {
    fetch("/api/owner/map-import").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setAreas(d.areas ?? []); setTotal(d.total ?? 0); }
    }).catch(() => {});
  }, []);
  useEffect(() => { if (open) loadAreas(); }, [open, loadAreas]);

  async function pick(file: File) {
    setMsg(""); setPreview(null); setFileName(file.name);
    const text = await file.text();
    setKml(text);
    setBusy(true);
    const r = await fetch("/api/owner/map-import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kml: text, dryRun: true }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّرت قراءة الملف"); setKml(""); return; }
    setPreview(d);
  }

  async function apply() {
    if (!kml) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/owner/map-import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kml }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "تعذّر الرفع"); return; }
    setMsg(`✓ رُفعت ${d.points} نقطة — جديدة ${d.added} · حلّت محلّ نقاط فنيّين ${d.overTech} · مكرّرة تُركت ${d.keptKml}. مجموع نقاط الخريطة الآن ${Number(d.total).toLocaleString("en-US")}`);
    setPreview(null); setKml(""); setFileName("");
    loadAreas();
  }

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-slate-800">🗺️ خريطة الأعمدة (KML)
          <span className="mr-2 text-[11px] font-normal text-slate-400">ارفع منطقة جديدة أو حدّث موجودة</span>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200">
          {open ? "▲ إخفاء" : "▼ فتح"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {areas.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] text-slate-400">الموجود الآن ({Number(total).toLocaleString("en-US")} نقطة):</div>
              <div className="flex flex-wrap gap-1.5">
                {areas.map((a) => (
                  <span key={a.code} className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200" dir="ltr">
                    {a.code} · {a.count.toLocaleString("en-US")}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center hover:border-sky-400 hover:bg-sky-50">
            <input type="file" accept=".kml,application/vnd.google-earth.kml+xml,text/xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.currentTarget.value = ""; }} />
            <div className="text-2xl">📂</div>
            <div className="mt-1 text-sm font-bold text-slate-700">{fileName || "اختر ملف KML"}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">يُقرأ الملف ويُعرض أثره قبل الكتابة — لا شيء يُحفظ قبل ضغطك «اعتماد»</div>
            <div className="mt-0.5 text-[11px] text-slate-400">المكرّر يُترك كما هو · وما أضافه فنيّ يحلّ ملفُّك محلّه</div>
          </label>

          {busy && <div className="mt-2 text-center text-xs text-slate-400">جاري القراءة…</div>}

          {preview && (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
              <div className="mb-1 text-sm font-bold text-sky-800">ماذا سيتغيّر؟</div>
              <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                <Box label="نقاط الملف" v={preview.points} />
                <Box label="جديدة تُضاف" v={preview.added} good />
                <Box label="تحلّ محلّ نقاط الفنيين" v={preview.overTech} />
                <Box label="مكرّرة تُترك كما هي" v={preview.keptKml} />
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                المناطق: <b dir="ltr">{preview.areas.join("، ")}</b>
                {preview.skipped > 0 && <> · علامات متجاهَلة (خطوط أو أسماء غير مفهومة): <b>{preview.skipped}</b></>}
              </div>
              {preview.sample?.length ? (
                <div className="mt-1 text-[11px] text-slate-400" dir="ltr">{preview.sample.join(" · ")}…</div>
              ) : null}
              {preview.overTech > 0 && (
                <div className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  ستحلّ محلّ <b>{preview.overTech}</b> نقطة أضافها فنيّون من الأرض (الأولوية لملفّك):
                  <span dir="ltr"> {preview.techNames?.join("، ")}</span>
                </div>
              )}
              <div className="mt-1.5 text-[11px] font-semibold text-emerald-700">
                لا تُحذف أي نقطة، ولا يُمَسّ ما ثبت من ملفٍ سابق — المكرّر يُترك كما هو.
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={apply} disabled={busy} className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
                  {busy ? "…" : `اعتماد ورفع ${preview.points} نقطة`}
                </button>
                <button onClick={() => { setPreview(null); setKml(""); setFileName(""); }} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-500 ring-1 ring-slate-200">إلغاء</button>
              </div>
            </div>
          )}

          {msg && <div className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
function Box({ label, v, good }: { label: string; v: number; good?: boolean }) {
  return (
    <div className="rounded-lg bg-white/80 px-2.5 py-1.5 ring-1 ring-slate-200">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`text-sm font-extrabold ${good && v > 0 ? "text-emerald-600" : "text-slate-700"}`} dir="ltr">{v.toLocaleString("en-US")}</div>
    </div>
  );
}

// حقل تعديل حدٍّ للوكيل (يُحفظ عند مغادرة الحقل) — key={value} يعيد ضبط القيمة بعد الحفظ
function LimitInput({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-600">{label}
      <input type="number" min={0} defaultValue={value} key={value} onBlur={(e) => onSave(Number(e.target.value))} className="w-16 rounded border border-slate-300 px-2 py-1 text-center" />
    </label>
  );
}

// تعديل اسم الوكيل (العلامة) داخل صفّه — يظهر الحقل بالضغط على «✏️ الاسم» ويُحفظ بزرٍّ صريح
function NameEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  if (!open) {
    return (
      <button onClick={() => { setV(value); setOpen(true); }} title="تعديل اسم الوكيل (العلامة) — للمالك فقط"
        className="rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100">✏️ الاسم</button>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-lg bg-purple-50 px-2 py-1 text-xs">
      <input value={v} onChange={(e) => setV(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onSave(v.trim()); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
        className="w-40 rounded border border-purple-200 bg-white px-1.5 py-0.5 text-xs" />
      <button onClick={() => { if (v.trim()) { onSave(v.trim()); setOpen(false); } }} disabled={!v.trim()} className="font-bold text-purple-700 disabled:opacity-40">حفظ ✓</button>
      <button onClick={() => setOpen(false)} className="text-slate-400">✕</button>
    </span>
  );
}

// تمديد الاشتراك إلى تاريخ محدَّد يختاره المالك (بدل عدد الأشهر فقط)
function ExtendDate({ onApply }: { onApply: (date: string) => void }) {
  const [d, setD] = useState("");
  return (
    <span className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs" title="تمديد إلى تاريخ محدَّد">
      <input type="date" value={d} min={todayStr()} onChange={(e) => setD(e.target.value)} className="rounded border border-blue-200 bg-white px-1 py-0.5 text-xs text-blue-700" />
      <button onClick={() => { if (d) { onApply(d); setD(""); } }} disabled={!d} className="font-semibold text-blue-700 disabled:opacity-40">لتاريخ ✓</button>
    </span>
  );
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
  const [ownerBackupEmail, setOwnerBackupEmail] = useState("");
  const [ownerBackupTime, setOwnerBackupTime] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // شعار صفحة الدخول (يبدّله السوبر أدمن حصراً — يظهر لكل من يفتح /login)
  const [loginLogo, setLoginLogo] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/owner/account").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setUsername(d.username ?? ""); setPassword(d.plainPassword ?? ""); setRecoveryEmail(d.recoveryEmail ?? ""); setOwnerPhone(d.ownerPhone ?? ""); setOwnerBackupEmail(d.ownerBackupEmail ?? ""); setOwnerBackupTime(d.ownerBackupTime ?? "");
    });
    fetch("/api/public/login-logo").then((r) => (r.ok ? r.json() : null)).then((d) => setLoginLogo(d?.logo ?? null)).catch(() => {});
  }, []);

  // تصغير الصورة إلى 256px (كانفس) ثم حفظها فوراً — نفس أسلوب شعار الوكالة
  function pickLoginLogo(file: File) {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement("canvas");
      const s = Math.min(1, 256 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/png");
      setBusy(true); setMsg("");
      const r = await fetch("/api/public/login-logo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }),
      }).catch(() => null);
      setBusy(false);
      if (r?.ok) { setLoginLogo(dataUrl); setMsg("✓ حُفظ شعار صفحة الدخول"); }
      else setMsg((await r?.json().catch(() => null))?.error ?? "فشل حفظ الشعار");
    };
    img.onerror = () => setMsg("تعذّرت قراءة الصورة");
    img.src = URL.createObjectURL(file);
  }

  async function removeLoginLogo() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/public/login-logo", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setLoginLogo(null); setMsg("✓ أُزيل — تعود صفحة الدخول للشعار الافتراضي"); }
  }

  async function save() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/owner/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() || undefined, password: password.trim() || undefined, recoveryEmail: recoveryEmail.trim() || null, ownerPhone: ownerPhone.trim(), ownerBackupEmail: ownerBackupEmail.trim(), ownerBackupTime: ownerBackupTime.trim() }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMsg("✓ تم الحفظ"); else setMsg(d.error ?? "تعذّر الحفظ");
  }

  // استعادة نسخة النظام الكاملة (تستبدل كل شيء) — تأكيد مزدوج + كلمة سر المالك
  async function restoreFull(file: File) {
    if (!confirm("⚠️ تحذير: ستُستبدل كل بيانات النظام الحالية بمحتوى هذا الملف (كل الوكلاء وحساباتهم). العملية لا رجعة فيها. هل تريد المتابعة؟")) return;
    const pw = prompt("اكتب كلمة سر المالك للتأكيد:");
    if (!pw) return;
    setBusy(true); setMsg("جارٍ الاستعادة… لا تغلق الصفحة");
    const fd = new FormData();
    fd.append("file", file); fd.append("password", pw);
    const r = await fetch("/api/owner/restore-full", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ اكتملت الاستعادة (${d.tables} جدول، ${d.rows} صف)` : (d.error ?? "فشلت الاستعادة"));
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
          <Field label="📦 إيميل النسخة الكاملة (نسخة كل الوكلاء يومياً)"><input dir="ltr" type="email" value={ownerBackupEmail} onChange={(e) => setOwnerBackupEmail(e.target.value)} placeholder="backup@gmail.com" className="inp" /></Field>
          <Field label="🕘 وقت إرسال النسخة الكاملة يومياً (بغداد)"><input dir="ltr" type="time" value={ownerBackupTime} onChange={(e) => setOwnerBackupTime(e.target.value)} className="inp" /></Field>
        </div>

        {/* شعار صفحة الدخول — يظهر لكل من يفتح /login؛ تبديله للسوبر أدمن حصراً (طلب محمد) */}
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="mb-2 text-xs font-bold text-slate-600">🖼️ شعار صفحة تسجيل الدخول</div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loginLogo ?? "/icons/logo.png"} alt="شعار الدخول" className="h-14 w-14 rounded-xl object-cover shadow ring-1 ring-slate-200" />
            <div className="flex flex-col gap-1.5">
              <button onClick={() => logoRef.current?.click()} disabled={busy} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">📷 اختيار صورة</button>
              {loginLogo && (
                <button onClick={removeLoginLogo} disabled={busy} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60">إزالة (العودة للافتراضي)</button>
              )}
            </div>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLoginLogo(f); e.target.value = ""; }} />
          <div className="mt-1.5 text-[11px] text-slate-500">يظهر أعلى نافذة تسجيل الدخول لكل من يفتح الموقع — يُحفظ فور اختيار الصورة.</div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "جارٍ…" : "حفظ"}</button>
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600">إغلاق</button>
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="mb-1 text-xs font-bold text-rose-600">⚠️ استعادة نسخة كاملة (تستبدل كل بيانات النظام)</div>
          <div className="mb-2 text-[11px] text-slate-500">ارفع ملف نسخة النظام الكاملة (shakeeb-full-*.json.gz). يعود كل الوكلاء تماماً كما وقت النسخ.</div>
          <input type="file" accept=".gz,.json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreFull(f); e.target.value = ""; }} className="w-full text-xs" />
        </div>
      </div>
    </div>
  );
}
