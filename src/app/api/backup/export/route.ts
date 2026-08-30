import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { exportAgentBackupTo } from "@/lib/backup";

export const dynamic = "force-dynamic";

// تنزيل نسخة احتياطية كاملة لبيانات الوكيل الحالي (ملف gzip) — **بثّاً** لتفادي بناء سلسلةٍ
// عملاقةٍ في الذاكرة (كان يُرمى RangeError ⇒ 500 لوكيلٍ كبير) ولإبقاء اتصال Railway حيّاً.
export async function GET() {
  const g = await guard("backup.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  if (agentId == null) return NextResponse.json({ error: "لا وكيل مرتبط بحسابك" }, { status: 403 });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `backup-agent-${agentId}-${stamp}.json.gz`; // اسمٌ مبدئيّ في الترويسة (يُعرَف الاسمُ الدقيق بعد الجلب)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      exportAgentBackupTo(agentId, (chunk) => controller.enqueue(new Uint8Array(chunk)))
        .then((r) => {
          console.log(`[backup] 📤 بُثّت نسخة الوكيل ${agentId} للتنزيل (${r.tableCount} جدولاً، ${r.rowCount} صفّاً)`);
          controller.close();
        })
        .catch((e) => {
          // قطعُ البثّ يُفشل التنزيلَ (gzip -t يرفض الملفَّ المبتور) بدل تسليم نسخةٍ ناقصةٍ صامتة
          console.error(`[backup] 🔴 فشل بثُّ نسخة الوكيل ${agentId}: ${e instanceof Error ? e.message : e}`);
          controller.error(e);
        });
    },
  });
  return new NextResponse(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
