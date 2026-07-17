"use client";

import { useRouter, usePathname } from "next/navigation";

// أزرار شريط الأدوات العلوي (مجموعات كما في البرنامج الأصلي)
const GROUPS: {
  title: string;
  items: { label: string; icon: string; href?: string; enabled?: boolean }[];
}[] = [
  {
    title: "الإعدادات",
    items: [
      { label: "الباقات", icon: "📦", href: "/packages", enabled: true },
      { label: "المكاتب", icon: "📡", href: "/towers", enabled: true },
      { label: "المستخدمون", icon: "🔑", href: "/users", enabled: true },
      { label: "إعدادات المكتب", icon: "⚙️", href: "/settings", enabled: true },
      { label: "قالب الوصل المطبوع", icon: "🧾", href: "/receipt-template", enabled: true },
    ],
  },
  {
    title: "المخزن",
    items: [
      { label: "المخزن", icon: "📦", href: "/inventory", enabled: true },
      { label: "كروت التفعيل", icon: "💳", href: "/cards", enabled: true },
    ],
  },
  {
    title: "المصاريف",
    items: [
      { label: "الصندوق", icon: "🧮", href: "/cashbox", enabled: true },
      { label: "انشاء حساب مصروفات", icon: "🗂️", href: "/accounts", enabled: true },
      { label: "المصروفات والمقبوضات", icon: "💵", href: "/cashbox", enabled: true },
      { label: "سجلّ المكافآت", icon: "🎁", href: "/rewards", enabled: true },
    ],
  },
  {
    title: "النظام",
    items: [
      { label: "التذاكر", icon: "🎫", href: "/tickets", enabled: true },
      { label: "قوالب الرسائل", icon: "📝", href: "/sms-templates", enabled: true },
      { label: "سجل التدقيق", icon: "🛡️", href: "/audit", enabled: true },
      { label: "نسخة احتياطية", icon: "🗄️", href: "/api/backup", enabled: true },
    ],
  },
];

export default function TopBar({
  brand,
  fullName,
  roleLabel,
}: {
  brand?: string;
  fullName: string;
  roleLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // إعادة تحميل كاملة لتصفير كل حالة العميل (كاش الصلاحيات وغيره)
    window.location.href = "/login";
  }

  // يظهر الشريط العلوي في الصفحة الرئيسية فقط
  if (pathname !== "/dashboard") return null;

  return (
    <header className="no-print hidden border-b border-slate-200 bg-gradient-to-b from-white to-slate-100 shadow-sm md:block">
      <div className="flex items-stretch justify-between gap-3 px-4 py-2.5">
        {/* الشعار والمستخدم */}
        <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mynet-blue text-lg font-extrabold text-white shadow-md">
            نت
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold text-mynet-blue">{brand ?? "شكيب نت"}</div>
            <div className="text-xs font-medium text-slate-500">{fullName} — {roleLabel}</div>
          </div>
        </div>

        {/* مجموعات الأزرار */}
        <div className="flex flex-1 items-stretch justify-center gap-2.5">
          {GROUPS.map((g) => (
            <div
              key={g.title}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white px-2.5 pb-1.5 pt-2 shadow-sm"
            >
              <div className="flex flex-1 items-stretch gap-1">
                {g.items.map((it) => {
                  const active = it.href === pathname;
                  return (
                    <button
                      key={it.label}
                      disabled={!it.enabled}
                      onClick={() =>
                        it.href &&
                        (it.href.startsWith("/api/")
                          ? window.open(it.href, "_blank")
                          : router.push(it.href))
                      }
                      title={it.enabled ? it.label : "قريباً"}
                      className={`flex w-[74px] flex-col items-center justify-start gap-1.5 rounded-xl px-1 py-2 text-center text-xs font-medium transition ${
                        !it.enabled
                          ? "cursor-not-allowed text-slate-300"
                          : active
                          ? "bg-blue-100 text-mynet-blue"
                          : "text-slate-700 hover:-translate-y-0.5 hover:bg-blue-50 hover:text-mynet-blue"
                      }`}
                    >
                      <span className="text-[26px] leading-none">{it.icon}</span>
                      <span className="leading-tight">{it.label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 rounded-full bg-slate-100 py-0.5 text-center text-[11px] font-semibold text-slate-500">
                {g.title}
              </span>
            </div>
          ))}
        </div>

        {/* خروج */}
        <div className="flex items-center border-r border-slate-200 pr-4">
          <button
            onClick={logout}
            className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-red-100 hover:text-red-600"
          >
            🚪 خروج
          </button>
        </div>
      </div>
    </header>
  );
}
