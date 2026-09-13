import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";
const pexec = promisify(execFile);

// خدماتٌ مسموحٌ بقراءة سجلّها فقط (لا مدخلاتٍ حرّة)
const ALLOWED = new Set(["mynet-web", "mynet-web-test", "postgresql", "mynet-backup"]);

// سجلّ خدمةٍ (للمالك، عرض فقط): آخر ٣٠٠ سطر من journalctl لخدمةٍ مسموحة
export async function GET(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const svc = new URL(request.url).searchParams.get("service") ?? "mynet-web-test";
  if (!ALLOWED.has(svc)) return NextResponse.json({ error: "خدمة غير مسموحة" }, { status: 400 });
  try {
    const { stdout } = await pexec("journalctl", ["-u", svc, "-n", "300", "--no-pager", "-o", "short-iso"], {
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return NextResponse.json({ service: svc, lines: stdout.split("\n").filter(Boolean).slice(-300) });
  } catch {
    return NextResponse.json({
      service: svc,
      lines: [],
      error: "تعذّرت قراءة السجلّ — قد يلزم إضافة مستخدم الخدمة لمجموعة systemd-journal مرّةً واحدة",
    });
  }
}
