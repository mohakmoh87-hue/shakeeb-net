import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { exportAgentBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

// تنزيل نسخة احتياطية كاملة لبيانات الوكيل الحالي (ملف gzip)
export async function GET() {
  const g = await guard("offices.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });

  const { gz, filename } = await exportAgentBackup(agentId);
  return new Response(new Uint8Array(gz), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(gz.length),
    },
  });
}
