"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Tpl = { type: string; text: string; enable: string };

const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "expiring", label: "قرب الانتهاء", hint: "تذكير المشترك بقرب انتهاء اشتراكه" },
  { key: "activation", label: "التفعيل", hint: "رسالة عند تفعيل/تجديد الاشتراك" },
  { key: "debts", label: "الديون", hint: "مطالبة المشترك بتسديد الدين" },
  { key: "maintenance", label: "الصيانة/التنصيب", hint: "رسالة تُرسل للمشترك عند إنجاز الفني للصيانة/التنصيب" },
  { key: "reward", label: "المكافأة", hint: "رسالة عند منح مكافأة التفعيل (الكود + الرصيد). المتغيّرات: {code} {balance} {granted}" },
  { key: "rewardUsed", label: "استخدام المكافأة", hint: "رسالة تأكيد عند خصم/استخدام كود المكافأة. المتغيّرات: {amount} {balance}" },
  { key: "other", label: "أخرى", hint: "رسائل عامة" },
];

// المتغيّرات الثابتة المتاحة (مع بيانات معاينة نموذجية)
const VARS: { token: string; label: string; sample: string }[] = [
  { token: "{name}", label: "الاسم", sample: "أحمد محمد" },
  { token: "{netUser}", label: "اسم المستخدم", sample: "ahmed77" },
  { token: "{package}", label: "نوع الباقة", sample: "Hero 50Mbps" },
  { token: "{card}", label: "رقم البطاقة", sample: "116" },
  { token: "{price}", label: "مبلغ الاشتراك", sample: "25,000" },
  { token: "{remaining}", label: "المبلغ المتبقّي (من هذا الوصل)", sample: "0" },
  { token: "{delivery}", label: "مبلغ التوصيل", sample: "1,000" },
  { token: "{total}", label: "الإجمالي (اشتراك+توصيل)", sample: "26,000" },
  { token: "{deliveryLine}", label: "سطر التوصيل (يظهر عند وجوده)", sample: "التوصيل: 1000 د.ع" },
  { token: "{paid}", label: "المبلغ الواصل", sample: "20,000" },
  { token: "{dateTo}", label: "تاريخ الانتهاء", sample: "10/07/2026" },
  { token: "{carry}", label: "الدين المتبقّي", sample: "5,000" },
  { token: "{office}", label: "اسم المكتب", sample: "شكيب نت" },
  { token: "{kind}", label: "نوع العمل (صيانة/تنصيب) — للصيانة", sample: "صيانة" },
  { token: "{details}", label: "تفاصيل الصيانة — للصيانة", sample: "تبديل مقوّي" },
  { token: "{technician}", label: "اسم الفني — للصيانة", sample: "علي" },
  { token: "{date}", label: "تاريخ العملية — للصيانة", sample: "12/07/2026" },
  { token: "{code}", label: "كود المكافأة — للمكافأة", sample: "K7M2QP9A" },
  { token: "{balance}", label: "رصيد المكافأة — للمكافأة", sample: "30,000" },
  { token: "{granted}", label: "مبلغ المكافأة الممنوح — للمكافأة", sample: "15,000" },
  { token: "{amount}", label: "المبلغ المخصوم — لاستخدام المكافأة", sample: "10,000" },
];

function renderPreview(text: string): string {
  let out = text;
  for (const v of VARS) out = out.split(v.token).join(v.sample);
  return out;
}

export default function SmsTemplatesPage() {
  const { can, me } = usePermission();
  const [tpls, setTpls] = useState<Record<string, Tpl>>({});
  const [active, setActive] = useState("expiring");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/sms-templates/bulk").then((r) => void (r.ok && r.json().then((rows: Tpl[]) => {
      const m: Record<string, Tpl> = {};
      for (const t of rows) m[t.type] = t;
      setTpls(m);
    })));
  }, []);

  const cur = tpls[active] ?? { type: active, text: "", enable: "1" };

  const setText = (text: string) => setTpls((m) => ({ ...m, [active]: { ...cur, type: active, text } }));
  const setEnable = (on: boolean) => setTpls((m) => ({ ...m, [active]: { ...cur, type: active, enable: on ? "1" : "0" } }));

  // إدراج/إزالة متغيّر عبر مربع الاختيار
  const toggleVar = (token: string) => {
    if (cur.text.includes(token)) {
      setText(cur.text.split(token).join("").replace(/\s{2,}/g, " ").trim());
    } else {
      setText((cur.text ? cur.text + " " : "") + token);
    }
  };

  async function save() {
    setSaving(true);
    setSaved(false);
    const templates = CATEGORIES.map((c) => {
      const t = tpls[c.key] ?? { type: c.key, text: "", enable: "1" };
      return { type: c.key, text: t.text ?? "", enable: t.enable ?? "1" };
    });
    const res = await fetch("/api/sms-templates/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates }),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  }

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("templates.manage")) {
    return <div className="p-6"><PageHeader title="قوالب الرسائل" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إدارة قوالب الرسائل.</div></div>;
  }

  return (
    <div className="p-6">
      <PageHeader title="قوالب الرسائل" subtitle="قوالب مصنّفة بمتغيّرات قابلة للإدراج مع معاينة" />

      {/* تبويبات التصنيفات */}
      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setActive(c.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${active === c.key ? "bg-mynet-blue text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        {/* المحرّر */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-slate-500">{CATEGORIES.find((c) => c.key === active)?.hint}</div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={cur.enable !== "0"} onChange={(e) => setEnable(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              مفعّل
            </label>
          </div>

          <textarea
            value={cur.text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="اكتب نص الرسالة، وأدرج المتغيّرات من القائمة أدناه..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mynet-blue"
          />

          {/* المتغيّرات بمربعات اختيار */}
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-slate-500">المتغيّرات (فعّل لإدراجه في النص):</div>
            <div className="flex flex-wrap gap-2">
              {VARS.map((v) => {
                const on = cur.text.includes(v.token);
                return (
                  <label key={v.token} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${on ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleVar(v.token)} className="h-3.5 w-3.5 accent-emerald-600" />
                    {v.label}
                    <code className="text-[10px] text-slate-400" dir="ltr">{v.token}</code>
                  </label>
                );
              })}
            </div>
          </div>

          {saved && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ تم حفظ القوالب</div>}
          <button onClick={save} disabled={saving} className="mt-4 w-full rounded-lg bg-mynet-blue py-2.5 font-semibold text-white hover:bg-mynet-blue-dark disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ القوالب"}
          </button>
        </div>

        {/* المعاينة */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">معاينة الرسالة</div>
          <div className="min-h-[140px] whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-800" dir="rtl">
            {cur.text ? renderPreview(cur.text) : <span className="text-slate-400">لا يوجد نص بعد</span>}
          </div>
          <div className="mt-2 text-xs text-slate-400">القيم أعلاه نموذجية للتوضيح فقط، وتُستبدل ببيانات كل مشترك عند الإرسال.</div>
        </div>
      </div>
    </div>
  );
}
