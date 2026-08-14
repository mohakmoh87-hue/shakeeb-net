"use client";

import { useState } from "react";
import { localSasBase, useLocalSasBase } from "@/lib/localSas";

// زر طباعة فورية: يرسل أمر الطباعة الصامتة مباشرة (بلا فتح أي صفحة أو تاب).
// ═════ محليٌّ أوّلاً (طلب محمد 2026-08-14): «٥ ثوانٍ كبيرةٌ جدّاً» ═════
// على حاسبة المكتب يُرسَل إلى العامل المحليّ (47615) **لحظيّاً** فيطبع فوراً؛ وإن غاب
// العاملُ أو لم تكن هذه الحاسبةُ مالكةَ مكتبِ الوصل (409) ارتدّ للطابور السحابيّ كما كان —
// فتلتقطه مالكتُه خلال ≤٥ ثوانٍ. ومنعُ الازدواج (٢٠ث + التقاطٌ ذرّيّ) يحمي لو تداخلا.
export default function PrintNowButton({
  kind, id, className = "",
}: { kind: "subscription" | "invoice" | "debt"; id: number; className?: string }) {
  const [st, setSt] = useState<"idle" | "busy" | "ok" | "printed" | "off" | "err">("idle");
  // 🔁 جسٌّ مستمرٌّ بالخلفيّة: يلتقط العاملَ فورَ عودته (بعد أيّ نشرة) فلا تنتظر الطباعةُ
  //    تحديثَ الصفحة يدويّاً. والضغطةُ نفسُها تجسّ أيضاً (سطرُ `localSasBase` أدناه) —
  //    فأيُّهما سبق يكفي، والنتيجةُ مخزونةٌ داخلَ الوحدة فلا يتكرّر النداءُ الشبكيّ.
  const warmBase = useLocalSasBase();

  async function go(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    if (st === "busy") return;
    setSt("busy");

    // ١) المحليّ: إرسالٌ لحظيّ وطباعةٌ مباشرة — والردُّ يعود بعد الطبع الفعليّ
    const base = warmBase || (await localSasBase().catch(() => ""));
    if (base) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25_000); // مهلةُ اكتمال الطبع (تصيير PDF + الطابعة)
        const r = await fetch(`${base}/print`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id }), signal: ctrl.signal,
        });
        clearTimeout(t);
        const d = await r.json().catch(() => null);
        if (r.ok && d?.ok) { setSt("printed"); setTimeout(() => setSt("idle"), 4000); return; }
        // 409 = لسنا حاسبةَ هذا المكتب ⇒ يُكمل للسحابيّ. وغيرُه فشلُ طبعٍ محليّ — السحابيُّ
        // لن يزيد (نفسُ الحاسبة ستلتقطه غالباً) لكنّ dedup يحمي، ويُعرَض خطؤه إن فشل أيضاً.
      } catch { /* العاملُ لم يُجب — يُكمل للسحابيّ */ }
    }

    // ٢) السحابيّ: طابورُ print_jobs كما كان (لأيّ جهازٍ ليس حاسبةَ المكتب — هاتف/بيت)
    const r = await fetch("/api/print", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (r?.ok && d?.ok) setSt(d.workerOnline ? "ok" : "off");
    else setSt("err");
    setTimeout(() => setSt("idle"), 4000);
  }

  const looks: Record<typeof st, [string, string]> = {
    idle: ["🖨 طباعة", "bg-blue-50 text-blue-600 hover:bg-blue-100"],
    busy: ["⏳ ...", "bg-slate-100 text-slate-500"],
    printed: ["✓ طُبع", "bg-emerald-50 text-emerald-700"],
    ok: ["✓ أُرسل للطابعة", "bg-emerald-50 text-emerald-700"],
    off: ["⚠ حاسبة المكتب غير متصلة", "bg-amber-50 text-amber-700"],
    err: ["✖ فشل الإرسال", "bg-red-50 text-red-600"],
  };
  const [label, cls] = looks[st];
  return (
    <button onClick={go} title="طباعة فورية على طابعة المكتب (محليّاً إن أمكن، وإلا عبر الطابور)"
      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${cls} ${className}`}>
      {label}
    </button>
  );
}
