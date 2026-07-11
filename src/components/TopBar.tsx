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
  fullName,
  roleLabel,
}: {
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
    <header className="no-print hidden border-b border-slate-300 bg-gradient-to-b from-slate-50 to-slate-200 shadow-sm md:block">
      <div className="flex items-stretch justify-between px-3 py-1.5">
        {/* الشعار والمستخدم */}
        <div className="flex items-center gap-3 border-l border-slate-300 pl-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-mynet-blue font-bold text-white shadow">
            نت
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold text-slate-800">{fullName}</div>
            <div className="text-xs text-slate-500">{roleLabel}</div>
          </div>
        </div>

        {/* مجموعات الأزرار */}
        <div className="flex flex-1 items-stretch gap-2 px-4">
          {GROUPS.map((g) => (
            <div
              key={g.title}
              className="flex flex-col rounded-md border border-slate-300/70 bg-white/50 px-2 pb-4 pt-1"
            >
              <div className="flex gap-1">
                {g.items.map((it) => (
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
                    className={`flex w-16 flex-col items-center gap-1 rounded px-1 py-1 text-center text-[11px] transition ${
                      it.enabled
                        ? "text-slate-700 hover:bg-blue-50"
                        : "cursor-not-allowed text-slate-400"
                    }`}
                  >
                    <span className="text-xl">{it.icon}</span>
                    <span className="leading-tight">{it.label}</span>
                  </button>
                ))}
              </div>
              <span className="mt-auto text-center text-[10px] text-slate-400">
                {g.title}
              </span>
            </div>
          ))}
        </div>

        {/* خروج */}
        <div className="flex items-center gap-3 border-r border-slate-300 pr-4">
          <button
            onClick={logout}
            className="rounded-lg bg-slate-200 px-3 py-2 text-xs text-slate-700 transition hover:bg-red-100 hover:text-red-600"
          >
            خروج
          </button>
        </div>
      </div>
    </header>
  );
}
