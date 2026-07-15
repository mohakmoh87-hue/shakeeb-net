import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// تنزيل مُنصِّب وكيل شكيب نت (الخيار ب): ملف .bat يعمل بنقرة مزدوجة،
// يشغّل سكربت PowerShell (/api/hybrid/setup.ps1) الذي يؤتمت الإعداد بالكامل.
export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return new Response("غير مصرّح", { status: 401 });

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const bat =
    "@echo off\r\n" +
    "chcp 65001 >nul\r\n" +
    "echo ===== مُنصِّب وكيل شكيب نت =====\r\n" +
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing '${origin}/api/hybrid/setup.ps1' | iex"\r\n` +
    "pause\r\n";

  return new Response(bat, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="setup-shakeebnet.bat"',
    },
  });
}
