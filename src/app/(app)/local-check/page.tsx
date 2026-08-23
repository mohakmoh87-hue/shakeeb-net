"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

// ═════ 🩺 فحصُ الاتصال بحاسبة المكتب (طلبُ محمد 2026-08-23) ═════
//
// 🔴 **السببُ الذي وُلدت منه**: كروم أضاف في تحديثاته الأخيرة حارسَ «الوصول إلى الشبكة
//   المحلّيّة» (Local Network Access)، فصار يمنع صفحةَ `https://shakeebnet.com` من نداء
//   `http://127.0.0.1:47615` — أي **يمنع الموقعَ من رؤية عامل المكتب** وإن كان يعمل.
//   ونصُّ المنع مقيسٌ على حاسبة الشهداء:
//     «blocked by CORS policy: Permission was denied for this request
//      to access the `loopback` address space»
//   والنتيجةُ: لوحةُ الساس تُحمَّل من أمريكا (٨ ميغا لكلّ فتحة) بدل الحاسبة المجاورة.
//
// 🎯 وهذه الصفحةُ تُجيب عن سؤالٍ واحدٍ بلا Console ولا أدوات مطوّرين: **أيُّ نوعٍ من
//   الطلبات يمنعه كروم على هذه الحاسبة؟** فإن كان يمنع `fetch` ويسمح بالإطار، فالعلاجُ
//   كودٌ في الموقع وحدَه. وإن منع الاثنين فلا مفرَّ من سياسةٍ تُكتَب بصلاحيّة مسؤول.
//
// ✋ قراءةٌ محضة: لا قاعدةَ ولا مالَ ولا كتابةَ — ثلاثةُ فحوصٍ في المتصفّح وحدَه.
// 📍 وليست في القائمة الجانبيّة عمداً: أداةُ تشخيصٍ تُفتح برابطها عند الحاجة.

const BASE = "http://127.0.0.1:47615";
const TIMEOUT_MS = 4000;

type Verdict = "wait" | "ok" | "fail";

export default function LocalCheckPage() {
  // ① الجسّ بـfetch — وهو ما يستعمله الموقعُ اليوم
  const [fetchState, setFetchState] = useState<Verdict>("wait");
  const [fetchNote, setFetchNote] = useState("");
  // ② الإطار — وهو ما تُحمَّل به لوحةُ الساس
  const [frameState, setFrameState] = useState<Verdict>("wait");
  // ③ حالةُ الإذن في المتصفّح (إن كان يدعم الاستعلام عنها)
  const [perm, setPerm] = useState("—");
  const [round, setRound] = useState(0); // إعادةُ الفحص تُعيد بناءَ الإطار

  const runFetch = useCallback(() => {
    setFetchState("wait"); setFetchNote("");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    fetch(`${BASE}/health`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        clearTimeout(t);
        const d = await r.json().catch(() => null);
        if (r.ok && d && typeof d.agentId === "number") {
          setFetchState("ok"); setFetchNote(`العامل يعمل — رقم الوكيل ${d.agentId}`);
        } else {
          setFetchState("fail"); setFetchNote(`ردَّ العاملُ بحالة ${r.status} أو بلا بصمةِ وكيل`);
        }
      })
      .catch((e) => {
        clearTimeout(t);
        setFetchState("fail");
        // نصُّ الخطأ هو الدليل: «loopback address space» = حارسُ كروم، وغيرُه = عاملٌ متوقّف
        setFetchNote(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const runAll = useCallback(() => {
    runFetch();
    setFrameState("wait");
    setRound((n) => n + 1);
    // استعلامُ الإذن — غيرُ مدعومٍ في كلّ الإصدارات، فيُحاط بحارس
    try {
      const p = (navigator as unknown as { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } }).permissions;
      p?.query({ name: "local-network-access" })
        .then((s) => setPerm(s.state))
        .catch(() => setPerm("غير مدعوم في هذا المتصفّح"));
    } catch { setPerm("غير مدعوم في هذا المتصفّح"); }
  }, [runFetch]);

  useEffect(() => {
    // التأجيلُ يُخرج نداءَ الحالة من جسم الأثر (قاعدة react-hooks/set-state-in-effect)
    const t = setTimeout(runAll, 50);
    return () => clearTimeout(t);
  }, [runAll]);

  // مهلةُ الإطار: إن لم يُبلّغ عن تحميلٍ خلال المهلة فهو ممنوعٌ أو متعثّر
  useEffect(() => {
    if (frameState !== "wait") return;
    const t = setTimeout(() => setFrameState((s) => (s === "wait" ? "fail" : s)), TIMEOUT_MS + 1500);
    return () => clearTimeout(t);
  }, [frameState, round]);

  const both = fetchState === "ok" && frameState === "ok";
  const onlyFrame = fetchState === "fail" && frameState === "ok";
  const neither = fetchState === "fail" && frameState === "fail";

  return (
    <div className="p-6">
      <PageHeader
        title="🩺 فحص الاتصال بحاسبة المكتب"
        subtitle="يُجرى في المتصفّح وحدَه — لا يكتب شيئاً ولا يمسّ بياناتك"
        action={
          <button onClick={runAll} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
            🔄 إعادة الفحص
          </button>
        }
      />

      {/* الخلاصةُ أوّلاً — سطرٌ واحدٌ يقرؤه أيُّ موظّف */}
      <div
        className={`mb-5 rounded-2xl p-5 text-lg font-extrabold ${
          both ? "bg-emerald-50 text-emerald-800"
            : onlyFrame ? "bg-amber-50 text-amber-800"
            : neither ? "bg-red-50 text-red-700"
            : "bg-slate-50 text-slate-600"
        }`}
      >
        {both && "✅ كلُّ شيءٍ سليم — الموقعُ يرى حاسبةَ المكتب، ولوحةُ الساس تُحمَّل منها."}
        {onlyFrame && "⚠️ كروم يمنع نداءَ الفحص، لكنّه يسمح بالإطار — العلاجُ في الموقع وحدَه (بلا لمسِ هذه الحاسبة)."}
        {neither && "⛔ كروم يمنع الاتصالَ بحاسبة المكتب تماماً — يلزم إصلاحٌ يُشغَّل على الحاسبة مرّةً واحدة."}
        {fetchState === "wait" && frameState === "wait" && "… جارٍ الفحص"}
        {fetchState === "ok" && frameState === "wait" && "… النداءُ نجح، بانتظار الإطار"}
        {fetchState === "wait" && frameState !== "wait" && "… بانتظار نتيجة النداء"}
        {fetchState === "ok" && frameState === "fail" && "🟡 النداءُ نجح والإطارُ تعثّر — أعد الفحص، وإن تكرّر أخبرني."}
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card title="① نداءُ الفحص (fetch)" state={fetchState}
          hint="هذا ما يستعمله الموقعُ ليعرف أنّ العامل موجود" note={fetchNote} />
        <Card title="② الإطار (iframe)" state={frameState}
          hint="وهذا ما تُحمَّل به لوحةُ الساس نفسُها"
          note={frameState === "ok" ? "الإطارُ حُمِّل من حاسبة المكتب" : frameState === "fail" ? "لم يُحمَّل خلال المهلة" : ""} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 text-sm font-bold text-slate-700">③ إذنُ الشبكة المحلّيّة</div>
          <div className="text-lg font-extrabold text-slate-800">{perm}</div>
          <div className="mt-1 text-xs text-slate-500">granted = مسموح · denied = ممنوع · prompt = يسأل</div>
        </div>
      </div>

      <div className="mb-2 text-sm font-bold text-slate-700">
        نافذةُ الإطار — إن ظهر فيها نصٌّ يبدأ بـ <span className="font-mono">{"{\"ok\":true"}</span> فالإطارُ مسموح:
      </div>
      <iframe
        key={round}
        src={`${BASE}/health?t=${round}`}
        onLoad={() => setFrameState("ok")}
        className="h-40 w-full rounded-xl border border-slate-300 bg-white"
        title="local-worker-health"
      />

      <p className="mt-4 text-xs text-slate-500">
        العنوانُ المفحوص: <span className="font-mono" dir="ltr">{BASE}/health</span> — وهو خادمُ العامل على هذه الحاسبة.
        فإن كنتَ تفتح هذه الصفحة من هاتفٍ أو حاسبةٍ أخرى فالنتيجةُ «ممنوع» **صحيحةٌ ومتوقّعة**، إذ لا عاملَ عليها أصلاً.
      </p>
    </div>
  );
}

function Card({ title, state, hint, note }: { title: string; state: Verdict; hint: string; note: string }) {
  const color = state === "ok" ? "text-emerald-700" : state === "fail" ? "text-red-600" : "text-slate-400";
  const label = state === "ok" ? "✅ يعمل" : state === "fail" ? "⛔ ممنوع" : "… جارٍ";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 text-sm font-bold text-slate-700">{title}</div>
      <div className={`text-lg font-extrabold ${color}`}>{label}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
      {note && <div className="mt-2 break-words rounded bg-slate-50 p-2 text-[11px] text-slate-600" dir="ltr">{note}</div>}
    </div>
  );
}
