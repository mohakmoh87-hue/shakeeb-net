import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCardActor, appendCardHistory } from "@/lib/field";

export const dynamic = "force-dynamic";

// PATCH: كتابة/تعديل «ملاحظة الفني» على البطاقة — يقبل الفني (على بطاقته المسندة إليه)
// والمستخدم/المدير (على بطاقات مكتبه)، مع عزل الوكيل عبر resolveCardActor.
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => null);
  const cardId = Number(b?.id);
  if (!cardId) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });

  const r = await resolveCardActor(cardId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const techNote = (b?.techNote == null ? "" : String(b.techNote)).trim().slice(0, 1000) || null;
  const updated = await prisma.taskCard.update({ where: { id: cardId }, data: { techNote } });
  await appendCardHistory(cardId, r.actor.name, techNote ? `ملاحظة: ${techNote}` : "مسح الملاحظة");
  return NextResponse.json({ ok: true, techNote: updated.techNote });
}
