"use client";

import { useCallback, useEffect, useState } from "react";

// ===== أ-٢٣ · إدارةُ لوحات الساس/أودو لمكتب (طلب محمد 2026-08-12/13) =====
// «مكتبٌ واحدٌ بساسَين»: المكتبُ يبقى وحدةَ عملٍ واحدة (مشتركون · مال · مخزن · فنيّون · تقرير ·
// واتساب · وصل)، واللوحةُ تُحدّد **مُخدِّمَ الساس/أودو** الذي يُفعَّل عليه كلُّ مشترك.
//
// 🔒 والزرُّ لا يظهر إلّا إن أذِن مالكُ النظام بحصّةٍ (`multiSasOffices` > 0) — والحصّةُ تُفحَص
//    في الخادم أيضاً (`canAddPanel`) فلا يكفي إخفاءُ زرٍّ.

type Panel = {
  id: number; label: string | null; loginUrl: string | null; username: string | null;
  hasPassword: boolean; odooEnabled: string | null; odooUser: string | null; hasOdooPass: boolean;
  // القروضُ تتبع اللوحة (طلبُ محمد 2026-08-13): حسابُ الديلر على سوبر سيل
  loanUser: string | null; hasLoanPass: boolean;
};
type Quota = { quota: number; used: number; remaining: number; usedTowerIds: number[] };

export default function SasPanelsButton({ towerId, towerName, onChange }: { towerId: number; towerName: string; onChange?: () => void }) {
  const [open, setOpen] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [form, setForm] = useState({ label: "", loginUrl: "", username: "", password: "", odooUser: "", odooPass: "", loanUser: "", loanPass: "" });
  // 🔴 بلاغُ محمد 2026-08-13: «ظهرت لوحةُ المكتب بساسَين لصميم ولكن **لا يمكن تعديلُ
  // الصفحتَين**، حيث يمكن فقط حذفُ الصفحة الثانية أمّا الأولى فلا تُعدَّل ولا تُمسَح.»
  // والعلّةُ **في الواجهة وحدَها**: مسارُ `PATCH` موجودٌ وكاملٌ ويعمل لأيّ لوحةٍ بما فيها
  // الأولى — ولم يُرسَم له نموذجٌ إطلاقاً. فصارت اللوحةُ تُنشأ ولا تُصحَّح، وخطأٌ في رابطٍ
  // أو كلمةِ مرورٍ يعني حذفَها وإعادةَ إنشائها — وهي **لا تُحذَف إن كان لها مشتركون**.
  // نتيجةُ اختبار قروض كلّ لوحةٍ على حدة (درسُ علّة الساس: يُسمّى ما اختُبر)
  const [loanTest, setLoanTest] = useState<Record<number, { ok: boolean; m: string } | undefined>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [ef, setEf] = useState({ label: "", loginUrl: "", username: "", password: "", odooUser: "", odooPass: "", loanUser: "", loanPass: "" });

  const load = useCallback(() => {
    fetch(`/api/towers/${towerId}/panels`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) { setPanels(d.panels ?? []); setQuota(d.quota ?? null); setCounts(d.counts ?? {}); } })
      .catch(() => {});
  }, [towerId]);
  useEffect(() => { if (open) load(); }, [open, load]);
  // الحصّةُ تُقرأ قبل الفتح كي لا يظهر الزرُّ لمن لا حصّةَ له
  useEffect(() => { load(); }, [load]);

  // 🔴 شرطُ محمد الحاكم (2026-08-13): «التعديلاتُ لا يظهر منها شيءٌ **إطلاقاً** لأيّ وكيلٍ لم
  // أُعطه مكتباً بساسَين، والوكيلُ الذي أُعطي أحدَ مكاتبه هذه الخاصّيّة تظهر له المميزاتُ **على
  // ذلك المكتب وحدَه لا على كلّ مكاتبه**».
  // ⇒ الزرُّ يظهر في حالتَين فقط:
  //   ١) هذا المكتبُ **له لوحتان فعلاً** (إدارةٌ لصاحبها).
  //   ٢) أو بقيت حصّةٌ **غيرُ مستهلكة** (ليختار المالكُ/المديرُ أيَّ مكتبٍ يُعطيه إيّاها).
  // فمتى استهلك مكتبٌ الحصّةَ، اختفى الزرُّ من بقيّة مكاتبه — وهو المطلوبُ حرفيّاً.
  // وبلا إذنِ المالك (الحصّةُ صفر) لا يظهر لأحدٍ أبداً — وهو حالُ كلّ الوكلاء افتراضيّاً.
  if (!quota) return null;
  if (panels.length <= 1 && quota.remaining <= 0) return null;

  async function add() {
    if (!form.loginUrl.trim() || !form.username.trim() || !form.password) {
      setMsg({ t: "err", m: "رابطُ الساس واسمُ المستخدم وكلمةُ المرور مطلوبة" });
      return;
    }
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/towers/${towerId}/panels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر الإنشاء" }); return; }
    setMsg({ t: "ok", m: "أُضيفت اللوحة ✓ — ووُسم مشتركو المكتب بلوحته الأولى تلقائياً" });
    setForm({ label: "", loginUrl: "", username: "", password: "", odooUser: "", odooPass: "", loanUser: "", loanPass: "" });
    load(); onChange?.();
  }

  function startEdit(p: Panel) {
    setEditId(p.id); setMsg(null);
    // كلمتا المرور تُتركان فارغتَين: الخادمُ يُبقي القديمة إن لم تُرسَل — فلا تُطمَس بالخطأ
    setEf({ label: p.label ?? "", loginUrl: p.loginUrl ?? "", username: p.username ?? "", password: "", odooUser: p.odooUser ?? "", odooPass: "", loanUser: p.loanUser ?? "", loanPass: "" });
  }

  /** يختبر حسابَ ديلرِ **هذه اللوحة** على مشتركٍ **منها** — والنتيجةُ تُسمّي ما اختُبر. */
  async function testLoan(panelId: number) {
    setBusy(true);
    setLoanTest((s) => ({ ...s, [panelId]: undefined }));
    try {
      const r = await fetch(`/api/towers/${towerId}/loan-test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // الحسابُ المخزَّنُ للّوحة يُستعمَل — ولا تُرسَل كلمةُ مرورٍ من النموذج
        // (لو أُرسلت فارغةً لَاختُبرت الفارغةُ بدل المحفوظة)
        body: JSON.stringify({ panelId }),
      });
      const d = await r.json().catch(() => ({}));
      const head = d.ok ? "✓ يعمل" : "✗ فشل";
      const detail = [d.message, d.testedUser ? `الحساب: ${d.testedUser}` : "", d.sampleFrom].filter(Boolean).join(" · ");
      setLoanTest((s) => ({ ...s, [panelId]: { ok: !!d.ok, m: `${head} — ${detail}` } }));
    } catch {
      setLoanTest((s) => ({ ...s, [panelId]: { ok: false, m: "تعذّر الاتصال بالخادم" } }));
    } finally { setBusy(false); }
  }

  async function saveEdit(panelId: number) {
    if (!ef.loginUrl.trim() || !ef.username.trim()) {
      setMsg({ t: "err", m: "رابطُ الساس واسمُ المستخدم لا يُفرَّغان" });
      return;
    }
    setBusy(true); setMsg(null);
    const body: Record<string, string> = { label: ef.label, loginUrl: ef.loginUrl, username: ef.username, odooUser: ef.odooUser, loanUser: ef.loanUser };
    if (ef.password) body.password = ef.password;
    if (ef.odooPass) body.odooPass = ef.odooPass;
    if (ef.loanPass) body.loanPass = ef.loanPass; // فارغةٌ = أبقِ القديمة
    const r = await fetch(`/api/towers/${towerId}/panels?panelId=${panelId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر الحفظ" }); return; }
    setMsg({ t: "ok", m: "حُفظت اللوحة ✓" });
    setEditId(null); load(); onChange?.();
  }

  async function del(p: Panel) {
    if (!confirm(`حذفُ لوحة «${p.label ?? "لوحة"}»؟`)) return;
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/towers/${towerId}/panels?panelId=${p.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ t: "err", m: d.error ?? "تعذّر الحذف" }); return; }
    setMsg({ t: "ok", m: "حُذفت اللوحة ✓" });
    load(); onChange?.();
  }

  const canAdd = quota.quota > 0 && (panels.length > 1 || quota.remaining > 0);

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="لوحاتُ الساس/أودو لهذا المكتب — مكتبٌ واحدٌ بأكثرَ من مُخدِّم ساس"
        className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${panels.length > 1 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
        🛰️ لوحات الساس {panels.length > 1 ? `(${panels.length})` : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-3" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">🛰️ لوحات الساس — {towerName}</h3>
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">✕</button>
            </div>

            <div className="mb-3 rounded-xl bg-slate-50 p-2.5 text-[12px] text-slate-600">
              حصّةُ مالك النظام: <b>{quota.quota}</b> مكتباً · المستهلَك <b>{quota.used}</b> · المتبقّي <b>{quota.remaining}</b>
              <div className="mt-1 text-[11px] text-slate-500">المكتبُ يبقى واحداً — المشتركون والمالُ والمخزنُ والفنيّون والتقريرُ والواتساب. واللوحةُ تُحدّد مُخدِّمَ الساس/أودو لكلّ مشترك.</div>
            </div>

            {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.t === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{msg.m}</div>}

            <div className="mb-3 space-y-2">
              {panels.map((p, i) => (
                <div key={p.id} className="rounded-xl border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-700">
                        {p.label || `لوحة ${i + 1}`} {i === 0 && <span className="text-[10px] font-normal text-slate-400">(الأولى)</span>}
                      </div>
                      <div className="truncate text-[11px] text-slate-500" dir="ltr">{p.loginUrl ?? "—"} · {p.username ?? "—"}</div>
                      <div className="text-[11px] text-slate-500">
                        مشتركوها <b>{counts[String(p.id)] ?? 0}</b> · أودو {p.odooEnabled === "1" ? "مُفعَّل" : "خامد"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {/* ✏️ التعديلُ متاحٌ **لكلّ لوحةٍ بما فيها الأولى** — وهي أوّلُ ما يحتاج
                          تصحيحاً لأنّها لوحةُ المكتب الأصليّة. */}
                      <button onClick={() => (editId === p.id ? setEditId(null) : startEdit(p))} disabled={busy}
                        className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50">
                        {editId === p.id ? "إغلاق" : "✏️ تعديل"}
                      </button>
                      {/* اللوحةُ الأولى لا تُحذف (هي لوحةُ المكتب). وذاتُ المشتركين **يرفضها
                          الخادم** — فكان الزرُّ يظهر ويُوعِد بما لا يقع (٨٤٠ و١٣٣٢ مشتركاً في
                          لوحتَي صميم مثلاً). فيُعطَّل بسببٍ مكتوبٍ بدل رسالةِ خطأٍ بعد الضغط. */}
                      {i > 0 && (
                        (counts[String(p.id)] ?? 0) > 0 ? (
                          <span title="لا تُحذَف ولها مشتركون — انقلهم إلى لوحةٍ أخرى أوّلاً"
                            className="cursor-not-allowed rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-300">حذف</span>
                        ) : (
                          <button onClick={() => del(p)} disabled={busy}
                            className="rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">حذف</button>
                        )
                      )}
                    </div>
                  </div>

                  {editId === p.id && (
                    <div className="mt-2.5 border-t border-slate-200 pt-2.5">
                      {([
                        ["label", "اسمُ اللوحة", false],
                        ["loginUrl", "رابط لوحة الساس", true],
                        ["username", "اسم مستخدم الساس", true],
                        ["password", p.hasPassword ? "كلمة مرور الساس (اتركها فارغة لتبقى)" : "كلمة مرور الساس", true],
                        ["odooUser", "مستخدم أودو (اختياريّ)", true],
                        ["loanUser", "مستخدم قروض سوبر سيل لهذه اللوحة (اختياريّ)", true],
                        ["odooPass", p.hasOdooPass ? "كلمة مرور أودو (اتركها فارغة لتبقى)" : "كلمة مرور أودو (اختياريّ)", true],
                      ] as [string, string, boolean][]).map(([k, ph, ltr]) => (
                        <input key={k} value={ef[k as keyof typeof ef]} placeholder={ph}
                          type={k.toLowerCase().includes("pass") ? "password" : "text"}
                          dir={ltr && !k.toLowerCase().includes("pass") ? "ltr" : undefined}
                          onChange={(e) => setEf((f) => ({ ...f, [k]: e.target.value }))}
                          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      ))}
                      <button onClick={() => void saveEdit(p.id)} disabled={busy}
                        className="w-full rounded-xl bg-slate-700 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
                        {busy ? "..." : "حفظ التعديل"}
                      </button>

                      {/* ═════ اختبارُ حسابِ ديلرِ **هذه اللوحة** (درسُ علّة الساس) ═════
                          بلا اختبارٍ لكلّ لوحةٍ يضبط المديرُ حساباً ولا يعرف أصحيحٌ هو إلّا
                          حين يفشل المنحُ أمام مشترك. والاختبارُ يُسمّي **ما اختبره** صريحاً —
                          فاختبارٌ لا يقول أيَّ حسابٍ جرّب هو ما جعل علّةَ الساس تمرّ صامتةً. */}
                      <button onClick={() => void testLoan(p.id)} disabled={busy}
                        className="mt-1.5 w-full rounded-xl border border-amber-300 bg-amber-50 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60">
                        🔌 اختبارُ قروض هذه اللوحة
                      </button>
                      {loanTest[p.id] && (
                        <div className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${loanTest[p.id]!.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                          {loanTest[p.id]!.m}
                        </div>
                      )}
                      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                        ⚠️ تغييرُ الرابط أو المستخدم يُحوِّل <b>{counts[String(p.id)] ?? 0}</b> مشتركاً
                        إلى المُخدِّم الجديد — فتأكّد قبل الحفظ. وكلمةُ المرور الفارغةُ تُبقي القديمة.
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canAdd ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                <div className="mb-2 text-sm font-bold text-slate-700">➕ إضافة لوحة</div>
                {[
                  ["label", "اسمُ اللوحة (مثل: عباس 2)"],
                  ["loginUrl", "رابط لوحة الساس"],
                  ["username", "اسم مستخدم الساس"],
                  ["password", "كلمة مرور الساس"],
                  ["odooUser", "مستخدم أودو (اختياريّ)"],
                  ["loanUser", "مستخدم قروض سوبر سيل لهذه اللوحة (اختياريّ)"],
                  ["loanPass", "كلمة مرور قروض هذه اللوحة (اختياريّ)"],
                  ["odooPass", "كلمة مرور أودو (اختياريّ)"],
                ].map(([k, ph]) => (
                  <input key={k} value={form[k as keyof typeof form]} placeholder={ph}
                    type={k.toLowerCase().includes("pass") ? "password" : "text"}
                    dir={k === "loginUrl" || k === "username" ? "ltr" : undefined}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                ))}
                <button onClick={add} disabled={busy}
                  className="w-full rounded-xl bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {busy ? "..." : "إضافة اللوحة"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 p-3 text-center text-[12px] font-bold text-amber-800">
                الحصّةُ مستهلكة ({quota.used} من {quota.quota}) — اطلب من مالك النظام زيادتَها، أو أزِل لوحةً من مكتبٍ آخر.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
