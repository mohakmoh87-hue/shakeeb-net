import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import AppModeInit from "@/components/AppModeInit";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "SHAKEEB - إدارة وكيل الانترنت",
  description: "نظام إدارة اشتراكات وحسابات وكيل الانترنت",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SHAKEEB", statusBarStyle: "default" },
  icons: { icon: "/icons/favicon-32.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f6fbf",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full antialiased`}>
      <head>
        {/* التقاط حدث تثبيت التطبيق مبكّراً جداً (قبل تحميل React) كي لا نفوّته على أندرويد */}
        <script
          dangerouslySetInnerHTML={{
            __html: "window.__bipEvent=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bipEvent=e;window.dispatchEvent(new Event('bip-ready'));});window.addEventListener('appinstalled',function(){window.__bipEvent=null;});",
          }}
        />
        {/* حارس إطار SAS: لوحة SAS تُعرض على نطاقنا تحت /sas/{المكتب}/، فانتقالها بعنوان مطلق
            كان يُحمّل شاشة البرنامج الرئيسية داخل الإطار فيخرج المستخدم من نافذة التفعيل قبل الحفظ
            (فيبقى الكارت محروقاً على SAS وغير مستهلك عندنا). هنا نُعيد الإطار إلى لوحة SAS فوراً. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(window.top!==window.self){var p=sessionStorage.getItem('sasFramePrefix');if(p&&location.pathname.indexOf(p)!==0){location.replace(p);}}}catch(e){}",
          }}
        />
        {/* وضع التطبيق مبكّراً (بلا وميض): PWA مثبّت أو التطبيق الأصلي (Capacitor) → ثيم وحصر إدارة الفنيين */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var w=window,n=navigator;if((w.matchMedia&&w.matchMedia('(display-mode: standalone)').matches)||n.standalone===true||(w.Capacitor&&w.Capacitor.isNativePlatform&&w.Capacitor.isNativePlatform())){document.documentElement.setAttribute('data-app-mode','');}}catch(e){}",
          }}
        />
        {/* 🧪 علَمُ تجربة الطراز مبكّراً (بلا وميض): كعكةُ trialSkin يضعها هاتفُ محمد وحدَه
            من صفحة /trial — لا جهازَ في الإنتاج يحملها فلا يتغيّر عندهم شيء (2026-08-19) */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(document.cookie.split('; ').indexOf('trialSkin=1')>-1){document.documentElement.setAttribute('data-app-trial','');}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <PwaRegister />
        <AppModeInit />
        {children}
      </body>
    </html>
  );
}
