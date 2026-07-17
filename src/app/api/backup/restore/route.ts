import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBackupFile, importAgentBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

// استرجاع كامل (استبدال): يرفع الوكيل ملف نسخته فتُستبدل بياناته الحالية بالكامل.
// يُرسَل الملف كجسم خام (application/octet-stream) — يقبل gzip أو JSON.
export async function POST(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });

  const ab = await request.arrayBuffer();
  if (!ab || ab.byteLength === 0) return NextResponse.json({ error: "لم يُرفع أي ملف" }, { status: 400 });

  let backup;
  try {
    backup = parseBackupFile(Buffer.from(ab));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ملف غير صالح" }, { status: 400 });
  }

  try {
    const res = await importAgentBackup(agentId, backup);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { error: "تعذّر الاسترجاع: " + (e instanceof Error ? e.message : "خطأ غير معروف") },
      { status: 500 },
    );
  }
}
