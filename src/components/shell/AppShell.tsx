"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePermission } from "@/lib/usePermission";
import type { Permission } from "@/lib/rbac";

// غلاف الطراز الجديد (ب1): شريط جانبي لاجورد (حاسبة) + شريط علوي ودرج منزلق
// وشريط سفلي (هاتف). كل عناصر الغلاف داخل حاويات data-site-chrome حتى تختفي
// في التطبيق المثبّت (standalone) ويبقى تطبيق الفنيين كما هو حرفياً.

type NavItem = { label: string; href: string; perm?: Permission; external?: boolean };
type NavEntry =
  | { kind: "link"; icon: string; label: string; href: string; perm?: Permission }
  | { kind: "group"; icon: string; label: string; items: NavItem[] };

const NAV: NavEntry[] = [
  { kind: "link", icon: "🏠", label: "الشاشة الرئيسية", href: "/dashboard" },
  { kind: "link", icon: "🧾", label: "حسابات المدير", href: "/manager-accounts", perm: "manager.accounts" },
  {
    kind: "group", icon: "📊", label: "التقارير",
    items: [
      { label: "تقرير الفواتير", href: "/reports/invoices", perm: "reports.view" },
      { label: "تقرير تفصيلي", href: "/reports/detailed", perm: "reports.view" },
      { label: "التقرير الاجمالي", href: "/reports/overall", perm: "reports.view" },
    ],
  },
  {
    kind: "group", icon: "📦", label: "المخزن",
    items: [
      { label: "المخزن", href: "/inventory", perm: "inventory.manage" },
      { label: "كروت التفعيل", href: "/cards", perm: "inventory.manage" },
    ],
  },
  {
    kind: "group", icon: "💵", label: "المصاريف",
    items: [
      { label: "انشاء حساب مصروفات", href: "/accounts", perm: "accounts.manage" },
      { label: "سجلّ المكافآت", href: "/rewards", perm: "rewards.config" },
    ],
  },
  {
    kind: "group", icon: "⚙️", label: "الإعدادات",
    items: [
      { label: "الباقات", href: "/packages", perm: "packages.manage" },
      { label: "المكاتب", href: "/towers" }, // بلا صلاحية: الصفحة تتكيّف (تعديل/مزامنة/ربط QR فقط)
      { label: "المستخدمون", href: "/users", perm: "users.manage" },
      { label: "إعدادات المكتب", href: "/settings", perm: "settings.manage" },
      { label: "قالب الوصل المطبوع", href: "/receipt-template", perm: "receipt.template" },
    ],
  },
  {
    kind: "group", icon: "🛡️", label: "النظام",
    items: [
      { label: "التذاكر", href: "/tickets", perm: "tickets.manage" },
      { label: "قوالب الرسائل", href: "/sms-templates", perm: "templates.manage" },
      { label: "سجل التدقيق", href: "/audit", perm: "audit.view" },
      { label: "نسخة احتياطية", href: "/api/backup/export", perm: "backup.manage", external: true },
    ],
  },
];

export default function AppShell({
  brand,
  fullName,
  roleLabel,
  children,
}: {
  brand: string;
  fullName: string;
  roleLabel: string;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="md:flex">
      {/* الشريط الجانبي (حاسبة) — لاصق بارتفاع الشاشة */}
      <div data-site-chrome>
        <aside className="no-print sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col overflow-y-auto text-white md:flex"
          style={{ background: "linear-gradient(170deg, var(--navy) 0%, var(--navy-2) 100%)" }}>
          <SideNav brand={brand} fullName={fullName} roleLabel={roleLabel} onNavigate={() => {}} />
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        {/* الشريط العلوي (الهاتف) */}
        <div data-site-chrome>
          <header className="no-print sticky top-0 z-40 flex items-center justify-between px-3 py-2 text-white shadow-md md:hidden"
            style={{ background: "linear-gradient(90deg, var(--navy) 0%, var(--navy-2) 100%)" }}>
            <div className="flex items-center gap-2">
              <BrandLogo brand={brand} size={34} />
              <span className="leading-tight">
                <b className="block text-sm font-extrabold">{brand}</b>
                <small className="block text-[10px] text-white/70">{fullName}</small>
              </span>
            </div>
            <button onClick={() => setDrawer(true)} title="القائمة" className="rounded-lg bg-white/10 px-3 py-1.5 text-lg leading-none">☰</button>
          </header>
        </div>

        {/* المحتوى — مساحة سفلية على الهاتف حتى لا يغطي الشريط السفلي آخر عنصر */}
        <main className="min-h-screen bg-ground pb-[84px] md:pb-0">{children}</main>

        {/* الدرج المنزلق (الهاتف) */}
        <div data-site-chrome>
          {drawer && (
            <div className="no-print fixed inset-0 z-[80] md:hidden">
              <div className="absolute inset-0 bg-black/55" onClick={() => setDrawer(false)} />
              <aside className="absolute inset-y-0 right-0 flex w-[272px] max-w-[86vw] flex-col overflow-y-auto text-white shadow-2xl"
                style={{ background: "linear-gradient(170deg, var(--navy) 0%, var(--navy-2) 100%)" }}>
                <SideNav brand={brand} fullName={fullName} roleLabel={roleLabel} onNavigate={() => setDrawer(false)} />
              </aside>
            </div>
          )}

          {/* شريط التنقّل السفلي (الهاتف) */}
          {/* بلا تكرار (طلب محمد): المشتركون ضمن الرئيسية نفسها، والدرج يُفتح من ☰ الأعلى فقط */}
          <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,.08)] md:hidden" aria-label="تنقّل سريع">
            <BottomItem icon="🏠" label="الرئيسية" href="/dashboard" />
            <BottomItem icon="📋" label="التقرير" href="/reports/overall" />
          </nav>
        </div>
      </div>
    </div>
  );
}

// عنصر الشريط السفلي
function BottomItem({ icon, label, href }: { icon: string; label: string; href: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const on = pathname === href;
  return (
    <button onClick={() => router.push(href)}
      className={`flex min-w-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold ${on ? "text-orange-d" : "text-ink-2"}`}>
      <span className="text-lg leading-none">{icon}</span>{label}
    </button>
  );
}

// شعار الوكالة الدائري (مع ارتداد للحرف الأول من العلامة)
function BrandLogo({ brand, size }: { brand: string; size: number }) {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/agent/logo").then((r) => (r.ok ? r.json() : null)).then((d) => d?.logo && setLogo(d.logo)).catch(() => {});
  }, []);
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt={brand} style={{ width: size, height: size }} className="rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size, background: "var(--orange)" }}
      className="flex items-center justify-center rounded-full text-sm font-extrabold text-white">
      {brand.trim().charAt(0) || "ش"}
    </span>
  );
}

// محتوى الشريط الجانبي (يُستعمل في الحاسبة والدرج معاً)
function SideNav({ brand, fullName, roleLabel, onNavigate }: {
  brand: string; fullName: string; roleLabel: string; onNavigate: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = usePermission();
  const [logoModal, setLogoModal] = useState(false);
  const canLogo = can("agent.settings");

  const go = useCallback((href: string, external?: boolean) => {
    onNavigate();
    if (external) window.open(href, "_blank");
    else router.push(href);
  }, [router, onNavigate]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // إعادة تحميل كاملة لتصفير كل حالة العميل (كاش الصلاحيات وغيره)
    window.location.href = "/login";
  }

  const visible = (it: NavItem) => !it.perm || can(it.perm);

  return (
    <>
      {/* الملف الشخصي + شعار الوكالة */}
      <div className="flex flex-col items-center gap-1.5 border-b border-white/10 px-4 py-5 text-center">
        <button
          onClick={() => canLogo && setLogoModal(true)}
          title={canLogo ? "اضغط لتغيير شعار الوكالة — يظهر في كل الصفحات" : brand}
          className={`group relative ${canLogo ? "cursor-pointer" : "cursor-default"}`}
        >
          <BrandLogo brand={brand} size={64} />
          {canLogo && (
            <span className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/55 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100">
              📷<span>تغيير الشعار</span>
            </span>
          )}
        </button>
        <div className="text-sm font-extrabold">{fullName}</div>
        <div className="text-[11px] text-white/60">{roleLabel} — {brand}</div>
      </div>

      {/* القائمة */}
      <nav className="flex-1 py-2" aria-label="أقسام البرنامج">
        {NAV.map((entry) => {
          if (entry.kind === "link") {
            if (entry.perm && !can(entry.perm)) return null;
            const on = pathname === entry.href;
            return (
              <button key={entry.label} onClick={() => go(entry.href)}
                className={`flex w-full items-center gap-3 border-r-[3px] px-5 py-2.5 text-[13px] transition ${
                  on ? "border-orange bg-orange/15 font-extrabold text-white" : "border-transparent text-[#d5e2ef] hover:bg-white/5 hover:text-white"
                }`}>
                <span className="w-5 text-center">{entry.icon}</span> {entry.label}
              </button>
            );
          }
          const items = entry.items.filter(visible);
          if (items.length === 0) return null;
          const activeInside = items.some((it) => pathname === it.href);
          return (
            <details key={entry.label} open={activeInside} className="group/g">
              <summary className="flex cursor-pointer list-none items-center gap-3 border-r-[3px] border-transparent px-5 py-2.5 text-[13px] text-[#d5e2ef] transition hover:bg-white/5 hover:text-white [&::-webkit-details-marker]:hidden">
                <span className="w-5 text-center">{entry.icon}</span> {entry.label}
                <span className="mr-auto text-[10px] opacity-60 transition group-open/g:rotate-180">▾</span>
              </summary>
              <div className="bg-black/15 py-1">
                {items.map((it) => {
                  const on = pathname === it.href;
                  return (
                    <button key={it.label} onClick={() => go(it.href, it.external)}
                      className={`flex w-full items-center border-r-[3px] py-2 pr-[52px] text-right text-xs transition ${
                        on ? "border-orange font-extrabold text-white" : "border-transparent text-[#bccbdc] hover:text-white"
                      }`}>
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </details>
          );
        })}

        <button onClick={logout}
          className="flex w-full items-center gap-3 border-r-[3px] border-transparent px-5 py-2.5 text-[13px] text-[#f3b9c1] transition hover:bg-white/5 hover:text-white">
          <span className="w-5 text-center">🚪</span> خروج
        </button>
      </nav>

      {logoModal && <LogoModal onClose={() => setLogoModal(false)} />}
    </>
  );
}

// نافذة شعار الوكالة: اختيار صورة (تُصغَّر إلى 256px) أو إزالة الشعار
function LogoModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/agent/logo").then((r) => (r.ok ? r.json() : null)).then((d) => d?.logo && setPreview(d.logo)).catch(() => {});
  }, []);

  // تصغير الصورة إلى 256px (كانفس) حتى تبقى خفيفة التخزين والعرض
  function pick(file: File) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const s = Math.min(1, 256 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setPreview(c.toDataURL("image/png"));
      setMsg("");
    };
    img.onerror = () => setMsg("تعذّرت قراءة الصورة");
    img.src = URL.createObjectURL(file);
  }

  async function save() {
    if (!preview) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/agent/logo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: preview }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) window.location.reload(); // تحديث الشعار في كل مكان
    else setMsg((await r?.json().catch(() => null))?.error ?? "فشل الحفظ");
  }

  async function remove() {
    setBusy(true);
    const r = await fetch("/api/agent/logo", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (r?.ok) window.location.reload();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-surface p-5 text-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-base font-extrabold">شعار الوكالة</div>
        <div className="mb-3 flex justify-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="الشعار" className="h-28 w-28 rounded-full border border-line object-cover" />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-line text-3xl text-muted">ش</div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} className="mb-2 w-full rounded-xl bg-navy py-2.5 text-sm font-bold text-white">📷 اختيار صورة</button>
        <p className="mb-3 text-center text-[11px] text-muted">يظهر الشعار بأعلى الشريط الجانبي وفي شريط الهاتف لكل مستخدمي وكالتك.</p>
        {msg && <div className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-center text-xs text-bad">{msg}</div>}
        <div className="flex gap-2">
          <button onClick={save} disabled={!preview || busy} className="flex-1 rounded-xl bg-ok py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "..." : "حفظ"}</button>
          <button onClick={remove} disabled={busy} className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-bad">إزالة</button>
          <button onClick={onClose} className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
