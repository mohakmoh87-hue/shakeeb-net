"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

// تنقّل الهاتف: ترويسة علوية ملتصقة + قائمة منزلقة (drawer). تظهر على الهاتف فقط (md:hidden).
const NAV: { section: string; items: { label: string; icon: string; href: string; external?: boolean }[] }[] = [
  { section: "الرئيسية", items: [{ label: "الشاشة الرئيسية", icon: "🏠", href: "/dashboard" }, { label: "إدارة الفنيين", icon: "🛠️", href: "/field-management" }] },
  {
    section: "العمليات",
    items: [
      { label: "المشتركين", icon: "👤", href: "/subscribers" },
      { label: "فاتورة مبيع", icon: "🛒", href: "/invoices" },
      { label: "ديون المشتركين", icon: "📑", href: "/debts" },
      { label: "إرسال رسالة للكل", icon: "💬", href: "/messages/compose" },
      { label: "الصندوق", icon: "🧮", href: "/cashbox" },
      { label: "حسابات المدير", icon: "🧾", href: "/manager-accounts" },
      { label: "سجلّ المكافآت", icon: "🎁", href: "/rewards" },
    ],
  },
  {
    section: "التقارير",
    items: [
      { label: "تقرير تفصيلي", icon: "📄", href: "/reports/detailed" },
      { label: "تقرير الفواتير", icon: "📋", href: "/reports/invoices" },
      { label: "التقرير الإجمالي", icon: "📊", href: "/reports/overall" },
    ],
  },
  {
    section: "المخزن",
    items: [
      { label: "المخزن", icon: "📦", href: "/inventory" },
      { label: "كروت التفعيل", icon: "💳", href: "/cards" },
    ],
  },
  {
    section: "الإعدادات",
    items: [
      { label: "الباقات", icon: "🏷️", href: "/packages" },
      { label: "المكاتب", icon: "📡", href: "/towers" },
      { label: "المستخدمون", icon: "🔑", href: "/users" },
      { label: "إعدادات المكتب", icon: "⚙️", href: "/settings" },
      { label: "قالب الوصل المطبوع", icon: "🧾", href: "/receipt-template" },
      { label: "قوالب الرسائل", icon: "📝", href: "/sms-templates" },
    ],
  },
  {
    section: "المصاريف والنظام",
    items: [
      { label: "إنشاء حساب مصروفات", icon: "🗂️", href: "/accounts" },
      { label: "التذاكر", icon: "🎫", href: "/tickets" },
      { label: "سجل التدقيق", icon: "🛡️", href: "/audit" },
      { label: "نسخة احتياطية", icon: "🗄️", href: "/api/backup/export", external: true },
    ],
  },
];

export default function MobileNav({ brand, fullName, roleLabel }: { brand?: string; fullName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  function go(href: string, external?: boolean) {
    setOpen(false);
    if (external) window.open(href, "_blank");
    else router.push(href);
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      {/* الترويسة العلوية (هاتف فقط) */}
      <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur md:hidden">
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2">
          <img src="/icons/logo.png" alt="SHAKEEB" className="h-9 w-9 rounded-lg shadow" />
          <span className="text-base font-bold text-slate-800">{brand ?? "SHAKEEB"}</span>
        </button>
        <button
          onClick={() => setOpen(true)}
          aria-label="القائمة"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl leading-none text-slate-700 transition hover:bg-slate-100"
        >
          ☰
        </button>
      </header>

      {/* القائمة المنزلقة */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
          <nav
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex w-[82%] max-w-[330px] flex-col bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-l from-mynet-blue to-blue-600 px-4 py-4 text-white">
              <div className="leading-tight">
                <div className="text-base font-bold">{fullName}</div>
                <div className="text-xs text-white/80">{roleLabel}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {NAV.map((sec) => (
                <div key={sec.section} className="mb-1">
                  <div className="px-3 pb-1 pt-3 text-[11px] font-bold text-slate-400">{sec.section}</div>
                  {sec.items.map((it) => {
                    const active = pathname === it.href;
                    return (
                      <button
                        key={it.label}
                        onClick={() => go(it.href, it.external)}
                        className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                          active ? "bg-mynet-blue font-semibold text-white shadow" : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-lg">{it.icon}</span>
                        <span className="flex-1 text-right">{it.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <button
              onClick={logout}
              className="m-3 rounded-lg bg-red-50 py-3 font-semibold text-red-600 transition hover:bg-red-100"
            >
              تسجيل الخروج
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
