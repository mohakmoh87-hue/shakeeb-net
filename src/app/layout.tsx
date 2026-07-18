import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "شكيب نت - إدارة وكيل الانترنت",
  description: "نظام إدارة اشتراكات وحسابات وكيل الانترنت",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "شكيب نت", statusBarStyle: "default" },
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
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
