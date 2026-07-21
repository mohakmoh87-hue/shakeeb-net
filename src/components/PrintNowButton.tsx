"use client";

import { useState } from "react";

// زر طباعة فورية: يرسل أمر الطباعة الصامتة مباشرة (بلا فتح أي صفحة أو تاب) —
// حاسبة مكتب الوصل تلتقطه وتطبع على طابعتها. تغذية راجعة مصغّرة على الزر نفسه.
export default function PrintNowButton({
  kind, id, className = "",
}: { kind: "subscription" | "invoice"; id: number; className?: string }) {
  const [st, setSt] = useState<"idle" | "busy" | "ok" | "off" | "err">("idle");

  async function go(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    if (st === "busy") return;
    setSt("busy");
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
    ok: ["✓ أُرسل للطابعة", "bg-emerald-50 text-emerald-700"],
    off: ["⚠ حاسبة المكتب غير متصلة", "bg-amber-50 text-amber-700"],
    err: ["✖ فشل الإرسال", "bg-red-50 text-red-600"],
  };
  const [label, cls] = looks[st];
  return (
    <button onClick={go} title="طباعة فورية على طابعة المكتب (بلا فتح صفحة)"
      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${cls} ${className}`}>
      {label}
    </button>
  );
}
