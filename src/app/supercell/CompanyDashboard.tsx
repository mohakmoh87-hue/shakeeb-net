"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdsEditor, { type AppContentT } from "@/components/AdsEditor";
import AgentPerfTab from "./AgentPerfTab";
import CompanyCardsTab from "./CompanyCardsTab";

type OtpInfo = { instanceId: string; tokenSet: boolean };
type Ticket = { id: number; name: string; phone: string; area: string | null; note: string | null; lat: number | null; lng: number | null; nearestPole: string | null; poleDistanceM: number | null; agentId: number | null; towerId: number | null; type: string | null; status: string; createdAt: string; source: string | null };
type Employee = { id: number; username: string; password: string | null; createdAt: string };
type Sub = { id: number; name: string | null; phone: string | null; office: string | null; package: string | null; expiry: string; state: string; daysExpired: number };
type Role = "manager" | "employee";

const STATE_LABEL: Record<string, string> = { active: "فعّال", grace: "مهلة", expired: "منتهٍ" };

export default function CompanyDashboard({ username, role }: { username: string; role: Role }) {
  const isManager = role === "manager";
  const tabs = useMemo(() => (isManager
    ? [
        { k: "perf", label: "📊 أداء الوكلاء" },
        { k: "cards", label: "🗂️ بطاقات الشركة" },
        { k: "tickets", label: "📱 الطلبات" },
        { k: "employees", label: "🧑‍💼 الموظفون" },
        { k: "ads", label: "📣 الإعلانات" },
        { k: "otp", label: "🔗 واتساب OTP" },
        { k: "subs", label: "👥 مشتركو الوكلاء" },
      ]
    : [{ k: "tickets", label: "📱 الطلبات" }]), [isManager]);
  const [tab, setTab] = useState("tickets");

  // ── الطلبات (للجميع) ──
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [agentName, setAgentName] = useState<Record<string, string>>({});
  const [allAgents, setAllAgents] = useState<{ id: number; name: string }[]>([]);
  const [ticketDest, setTicketDest] = useState<string>("both");
  const [tFilter, setTFilter] = useState<"all" | "company" | "agent">("all");
  // ── الإعلانات + OTP (للمدير) ──
  const [content, setContent] = useState<AppContentT | null>(null);
  const [otp, setOtp] = useState<OtpInfo | null>(null);
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // ── الموظفون (للمدير) ──
  const [emps, setEmps] = useState<Employee[]>([]);
  const [empU, setEmpU] = useState("");
  const [empP, setEmpP] = useState("");
  const [empMsg, setEmpMsg] = useState("");
  // ── مشتركو الوكلاء (للمدير) ──
  const [subsEnabled, setSubsEnabled] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<{ id: number; name: string }[]>([]);
  const [selAgent, setSelAgent] = useState<number | "">("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [subsTotal, setSubsTotal] = useState(0);
  const [subsPage, setSubsPage] = useState(1);
  const [subsPages, setSubsPages] = useState(0);
  const [subsQ, setSubsQ] = useState("");
  const [subsLoading, setSubsLoading] = useState(false);

  const loadTickets = useCallback(() => {
    fetch("/api/company/tickets").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setTickets(Array.isArray(d.tickets) ? d.tickets : []); setAgentName(d.agentName ?? {}); setAllAgents(Array.isArray(d.allAgents) ? d.allAgents : []); setTicketDest(d.dest ?? "both"); }
    }).catch(() => {});
  }, []);
  const loadEmployees = useCallback(() => {
    fetch("/api/company/employees").then((r) => (r.ok ? r.json() : [])).then((d) => setEmps(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  const loadAgents = useCallback(() => {
    fetch("/api/company/agents").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setSubsEnabled(!!d.enabled); setAgents(Array.isArray(d.agents) ? d.agents : []); }
    }).catch(() => {});
  }, []);
  const loadSubs = useCallback((agentId: number, page: number, q: string) => {
    setSubsLoading(true);
    fetch(`/api/company/subscribers?agentId=${agentId}&page=${page}&q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d && Array.isArray(d.subscribers)) { setSubs(d.subscribers); setSubsTotal(d.total ?? 0); setSubsPage(d.page ?? 1); setSubsPages(d.pages ?? 0); }
        else { setSubs([]); setSubsTotal(0); setSubsPages(0); }
      }).catch(() => {}).finally(() => setSubsLoading(false));
  }, []);
  useEffect(() => {
    loadTickets();
    if (isManager) {
      fetch("/api/company/config").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setContent(d); });
      fetch("/api/company/otp-wa").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setOtp(d); setInstanceId(d.instanceId ?? ""); setToken(""); } });
      loadEmployees();
      loadAgents();
    }
    const iv = setInterval(loadTickets, 20_000); // تحديثُ الطلبات تلقائيّاً
    return () => clearInterval(iv);
  }, [isManager, loadTickets, loadEmployees, loadAgents]);

  function pickAgent(id: number) { setSelAgent(id); setSubsQ(""); loadSubs(id, 1, ""); }
  async function patchTicket(id: number, status: string) {
    try { await fetch("/api/company/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) }); loadTickets(); } catch { /* */ }
  }
  async function assignTicket(id: number, agentId: number) {
    try { await fetch("/api/company/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, agentId }) }); loadTickets(); } catch { /* */ }
  }
  async function saveAds() {
    if (!content) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/company/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      setMsg(r.ok ? "✓ حُفِظت الإعلانات — تظهرُ في التطبيق حيّاً" : "فشل الحفظ");
    } catch { setMsg("تعذّر الاتصال"); } finally { setSaving(false); }
  }
  async function saveOtp() {
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/company/otp-wa", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instanceId, token }) });
      if (r.ok) { setMsg("✓ حُفِظ ربطُ الواتساب"); const d = await r.json().catch(() => null); if (d) { setOtp(d); setToken(""); } }
      else setMsg("فشل الحفظ");
    } catch { setMsg("تعذّر الاتصال"); } finally { setSaving(false); }
  }
  async function test() {
    if (!testPhone.trim()) { setTestMsg("أدخِل رقمَ الاختبار"); return; }
    setTestMsg("جارٍ الإرسال...");
    try {
      const res = await fetch("/api/company/otp-wa/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: testPhone }) });
      const d = await res.json().catch(() => ({}));
      setTestMsg(res.ok && d.ok ? `وصلت رسالةُ الاختبار إلى ${testPhone} ✓` : (d.error ?? "فشل الإرسال"));
    } catch { setTestMsg("خطأُ شبكة"); }
  }
  async function createEmp() {
    setEmpMsg("");
    try {
      const r = await fetch("/api/company/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: empU.trim(), password: empP }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEmpMsg(d.error ?? "تعذّر الإنشاء"); return; }
      setEmpU(""); setEmpP(""); setEmpMsg("✓ أُنشئ الموظف"); loadEmployees();
    } catch { setEmpMsg("تعذّر الاتصال"); }
  }
  async function resetEmp(id: number) {
    const np = prompt("كلمة المرور الجديدة (٨ أحرف على الأقل):");
    if (!np) return;
    const r = await fetch(`/api/company/employees/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: np }) });
    if (r.ok) loadEmployees(); else { const d = await r.json().catch(() => ({})); alert(d.error ?? "تعذّر التصفير"); }
  }
  async function deleteEmp(id: number, u: string) {
    if (!confirm(`حذفُ الموظف «${u}»؟`)) return;
    const r = await fetch(`/api/company/employees/${id}`, { method: "DELETE" });
    if (r.ok) loadEmployees(); else alert("تعذّر الحذف");
  }
  async function logout() { await fetch("/api/company/logout", { method: "POST" }); window.location.reload(); }

  // «الطلبات» = تذاكرُ المشتركين فقط؛ بطاقاتُ الشركة (source=company) لها تبويبُها المستقلّ
  const subReq = tickets.filter((t) => t.source !== "company");
  const newCount = subReq.filter((t) => t.status === "new").length;
  const assignedCount = subReq.filter((t) => t.agentId != null).length;
  const unassignedCount = subReq.filter((t) => t.agentId == null).length;
  const shownTickets = subReq.filter((t) =>
    tFilter === "all" ? true : tFilter === "agent" ? t.agentId != null : t.agentId == null);

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-slate-100 text-slate-800">
      {/* رأسٌ بحريٌّ داكن + شعارٌ ذهبيّ */}
      <header className="bg-gradient-to-l from-[#16213e] to-[#26375f] text-white shadow-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 text-2xl font-black text-[#16213e] shadow">ش</span>
            <div>
              <div className="text-base font-extrabold">بوّابة سوبر سيل</div>
              <div className="text-[11px] text-slate-300">متابعةُ الطلبات وإدارةُ التطبيق</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-white/10 px-3 py-1.5 text-right">
              <div className="text-xs font-bold" dir="ltr">{username}</div>
              <div className="text-[10px] text-amber-300">{isManager ? "مدير" : "موظف — متابعة الطلبات"}</div>
            </div>
            <button onClick={logout} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20">خروج</button>
          </div>
        </div>
        {/* تبويبات */}
        <div className="mx-auto max-w-5xl px-3">
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`rounded-t-xl px-4 py-2.5 text-sm font-bold transition ${tab === t.k ? "bg-slate-100 text-[#16213e]" : "text-slate-300 hover:bg-white/10"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        {/* ═════ أداء الوكلاء (مدير) ═════ */}
        {isManager && tab === "perf" && <AgentPerfTab />}

        {/* ═════ بطاقات الشركة (مدير) ═════ */}
        {isManager && tab === "cards" && <CompanyCardsTab isManager={isManager} />}

        {/* ═════ الطلبات ═════ */}
        {tab === "tickets" && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon="📥" label="إجمالي الطلبات" value={subReq.length} />
              <StatCard icon="🆕" label="جديدة" value={newCount} tone={newCount > 0 ? "emerald" : "slate"} />
              <StatCard icon="✅" label="مُسنَدة لوكيل" value={assignedCount} />
              <StatCard icon="⏳" label="بلا وكيل" value={unassignedCount} tone={unassignedCount > 0 ? "amber" : "slate"} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-base font-extrabold text-slate-800">طلبات تطبيق المشتركين</div>
                  <div className="text-[11px] text-slate-500">تصلُ مباشرةً من «كابينة» · تحديثٌ تلقائيّ · المعروض {shownTickets.length}</div>
                </div>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
                  {([["all", "الكل"], ["agent", "لوكيل"], ["company", "بلا وكيل"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTFilter(k)}
                      className={`rounded-lg px-3 py-1.5 transition ${tFilter === k ? "bg-[#16213e] text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
                  ))}
                </div>
              </div>
              {ticketDest === "agent" && <div className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">التوجيهُ «الوكيل فقط» — هذه طلباتٌ تعذّر توجيهُها لوكيلٍ (منطقةٌ مشتركةٌ أو بلا مكتب).</div>}
              {shownTickets.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">لا طلبات</div>
              ) : (
                <div className="space-y-2">
                  {shownTickets.map((t) => {
                    const dist = t.poleDistanceM == null ? null : t.poleDistanceM >= 1000 ? `${(t.poleDistanceM / 1000).toFixed(1)}كم` : `${t.poleDistanceM}م`;
                    const done = t.status === "done", rej = t.status === "rejected";
                    return (
                      <div key={t.id} className={`rounded-xl border border-slate-100 bg-slate-50/70 p-3 ${done ? "opacity-60" : rej ? "opacity-50" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-slate-800">{t.name}</span>
                            {t.type && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: t.type === "صيانة" ? "#d97706" : t.type === "توصيل" ? "#2563eb" : "#059669" }}>{t.type === "صيانة" ? "🔧 صيانة" : t.type === "توصيل" ? "🚚 توصيل" : "🆕 اشتراك"}</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600" dir="ltr">{t.phone}</span>
                            {t.status !== "new" && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : rej ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{t.status === "contacted" ? "تواصلت" : done ? "أُنجز" : "رُفض"}</span>}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                          {t.area && <span>🗺️ {t.area}</span>}
                          <span>🏢 {t.agentId != null ? (agentName[String(t.agentId)] ?? `وكيل ${t.agentId}`) : "بلا وكيل"}</span>
                          {t.nearestPole && <span>📍 {t.nearestPole}{dist ? ` · يبعد ${dist}` : ""}</span>}
                          {t.lat != null && t.lng != null && <a href={`https://www.google.com/maps?q=${t.lat},${t.lng}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 hover:underline">🧭 موقع التنصيب</a>}
                        </div>
                        {t.note && <div className="mt-1 rounded bg-white p-1.5 text-[11px] text-slate-600">{t.note}</div>}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.status !== "contacted" && !done && !rej && <button onClick={() => void patchTicket(t.id, "contacted")} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200">تواصلت</button>}
                          {!done && <button onClick={() => void patchTicket(t.id, "done")} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200">✓ أُنجز</button>}
                          {!rej && <button onClick={() => void patchTicket(t.id, "rejected")} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">✕ رفض</button>}
                          {(done || rej) && <button onClick={() => void patchTicket(t.id, "new")} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">↩ إرجاع</button>}
                          {allAgents.length > 0 && (
                            <select value="" onChange={(e) => { const v = Number(e.target.value); if (v) void assignTicket(t.id, v); }}
                              className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100">
                              <option value="">{t.agentId != null ? "↪ أعِد الإسناد" : "↪ أسنِد لوكيل"}</option>
                              {allAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═════ الموظفون (مدير) ═════ */}
        {isManager && tab === "employees" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 text-base font-extrabold text-slate-800">🧑‍💼 موظفو الشركة</div>
            <div className="mb-3 text-[11px] text-slate-500">موظّفٌ مهمتُه متابعةُ الطلبات وإسنادُها فقط — يدخلُ من نفس صفحة الدخول بحسابه.</div>
            <div className="space-y-1.5">
              {emps.length === 0 && <div className="text-xs text-slate-400">لا موظفين بعد.</div>}
              {emps.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold text-slate-700" dir="ltr">{e.username}</span>
                    {e.password && <span className="mr-2 text-[11px] text-slate-400" dir="ltr">🔑 {e.password}</span>}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => resetEmp(e.id)} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-200">تصفير</button>
                    <button onClick={() => deleteEmp(e.id, e.username)} className="rounded bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-200">حذف</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="text-xs font-semibold text-slate-600">اسم المستخدم
                <input value={empU} onChange={(e) => setEmpU(e.target.value)} dir="ltr" placeholder="employee" className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-600">كلمة المرور
                <input value={empP} onChange={(e) => setEmpP(e.target.value)} dir="ltr" placeholder="٨ أحرف على الأقل" className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <button onClick={() => void createEmp()} disabled={!empU.trim() || empP.length < 8} className="rounded-lg bg-[#16213e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#26375f] disabled:opacity-50">➕ إنشاء</button>
              {empMsg && <span className="text-xs text-slate-600">{empMsg}</span>}
            </div>
          </div>
        )}

        {/* ═════ الإعلانات (مدير) ═════ */}
        {isManager && tab === "ads" && content && (
          <div className="space-y-3">
            <AdsEditor content={content} onChange={(c) => setContent(c)} />
            <div className="flex items-center justify-end gap-3">
              {msg && <span className="text-sm text-slate-600">{msg}</span>}
              <button onClick={saveAds} disabled={saving} className="rounded-lg bg-amber-500 px-6 py-2 font-semibold text-white hover:bg-amber-600 disabled:opacity-60">{saving ? "..." : "حفظ الإعلانات"}</button>
            </div>
          </div>
        )}

        {/* ═════ واتساب OTP (مدير) ═════ */}
        {isManager && tab === "otp" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 text-base font-extrabold text-slate-800">🔗 واتساب رموز الدخول (OTP)</div>
            <div className="mb-3 text-[11px] text-slate-500">رقمُ UltraMsg مركزيٌّ يُرسِلُ رموزَ التحقّق للمشتركين. أدخِل Instance ID والToken من لوحة UltraMsg.</div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-slate-600">Instance ID
                <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} dir="ltr" placeholder="instance000000" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Token
                <input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder={otp?.tokenSet ? "••••••••  (محفوظٌ — اتركه فارغاً للإبقاء)" : "الصق التوكِن"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-end gap-2">
                  <label className="text-xs font-semibold text-slate-600">رقمُ الاختبار
                    <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} dir="ltr" placeholder="07XXXXXXXXX" className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <button onClick={() => void test()} className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-200">📤 اختبار</button>
                </div>
                <button onClick={saveOtp} disabled={saving} className="rounded-lg bg-amber-500 px-6 py-2 font-semibold text-white hover:bg-amber-600 disabled:opacity-60">{saving ? "..." : "حفظ الربط"}</button>
              </div>
              {testMsg && <span className="text-xs text-slate-600">{testMsg}</span>}
              {msg && <span className="text-xs text-slate-600">{msg}</span>}
              <p className="text-[11px] text-slate-400">احفظ أوّلاً ثمّ اختبر.</p>
            </div>
          </div>
        )}

        {/* ═════ مشتركو الوكلاء (مدير) ═════ */}
        {isManager && tab === "subs" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-base font-extrabold text-slate-800">👥 مشتركو الوكلاء</div>
            {subsEnabled === false ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">الكشفُ مُطفأٌ من مالك النظام.</div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {agents.map((a) => (
                    <button key={a.id} onClick={() => pickAgent(a.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${selAgent === a.id ? "bg-[#16213e] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{a.name}</button>
                  ))}
                </div>
                {selAgent !== "" && (
                  <>
                    <div className="mb-2 flex gap-2">
                      <input value={subsQ} onChange={(e) => setSubsQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadSubs(selAgent, 1, subsQ); }} placeholder="بحثٌ بالاسم أو الهاتف…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      <button onClick={() => loadSubs(selAgent, 1, subsQ)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">🔍</button>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">{subsLoading ? "جارٍ التحميل…" : `المجموع: ${subsTotal}`}</div>
                    <div className="divide-y divide-slate-100">
                      {subs.map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-700">{sub.name || "—"}</div>
                            <div className="text-[11px] text-slate-500" dir="ltr">{sub.phone || "—"}{sub.office ? ` · ${sub.office}` : ""}{sub.package ? ` · ${sub.package}` : ""}</div>
                          </div>
                          <div className="shrink-0 text-left text-[11px]">
                            <div className={sub.state === "expired" ? "font-bold text-rose-600" : sub.state === "grace" ? "text-amber-600" : "text-emerald-600"}>{STATE_LABEL[sub.state] ?? sub.state}</div>
                            <div className="text-slate-400">{sub.expiry}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {subsPages > 1 && (
                      <div className="mt-3 flex items-center justify-center gap-2 text-sm">
                        <button disabled={subsPage <= 1} onClick={() => loadSubs(selAgent, subsPage - 1, subsQ)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">‹</button>
                        <span className="text-slate-500">{subsPage} / {subsPages}</span>
                        <button disabled={subsPage >= subsPages} onClick={() => loadSubs(selAgent, subsPage + 1, subsQ)} className="rounded-lg bg-slate-100 px-3 py-1 disabled:opacity-40">›</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, tone = "slate" }: { icon: string; label: string; value: number; tone?: "slate" | "emerald" | "amber" }) {
  const c = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-lg">{icon}</span>
        <span className={`text-2xl font-extrabold ${c}`} dir="ltr">{value.toLocaleString("en-US")}</span>
      </div>
      <div className="mt-1 text-[11px] font-semibold text-slate-500">{label}</div>
    </div>
  );
}
