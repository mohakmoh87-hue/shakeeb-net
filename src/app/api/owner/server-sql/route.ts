import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOwner } from "@/lib/guard";

export const dynamic = "force-dynamic";

// وحدةُ استعلام SQL للقراءة فقط (للمالك): تُنفَّذ داخل معاملةٍ READ ONLY فيرفض المحرّكُ
// أيَّ كتابةٍ أو DDL على مستوى القاعدة نفسها (لا اعتماد على تخمين الكلمات). استعلامٌ واحد.
export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;
  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
  const raw = typeof body.query === "string" ? body.query.trim() : "";
  if (!raw) return NextResponse.json({ error: "استعلامٌ فارغ" }, { status: 400 });
  const q = raw.replace(/;\s*$/, "");
  if (q.includes(";")) return NextResponse.json({ error: "استعلامٌ واحدٌ فقط (بلا فاصلة منقوطة)" }, { status: 400 });

  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 15000");
      return tx.$queryRawUnsafe<Record<string, unknown>[]>(q);
    });
    const capped = rows.slice(0, 500).map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
      ),
    );
    await prisma.auditLog
      .create({ data: { userId: g.session.userId, action: "OWNER_SQL_READ", entity: "database", details: q.slice(0, 500) } })
      .catch(() => {});
    return NextResponse.json({ rows: capped, count: rows.length, truncated: rows.length > 500 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.slice(0, 600) ?? "فشل الاستعلام" }, { status: 400 });
  }
}
