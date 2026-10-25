import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { ensureMarketTable, cleanPhoto } from "@/lib/market";

export const dynamic = "force-dynamic";

const AUDIENCES = ["all", "subs", "guests"] as const;

// 🪟 إدارةُ النوافذ المنبثقة — لأدمن التطبيق وحدَه (من /app-admin أو من الهاتف:
// نفسُ المسار يخدم الاثنين، كما أراد محمد). ولا حذفَ نهائيّ — أرشفةٌ بعلَم.
async function guardAdmin() {
  const admin = await getAppAdminSession();
  if (!admin) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  await ensureMarketTable();
  return null;
}

export async function GET() {
  const bad = await guardAdmin();
  if (bad) return bad;
  const items = await prisma.appPopup.findMany({
    where: { isDeleted: false },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    select: { id: true, text: true, image: true, audience: true, sort: true, status: true, createdAt: true },
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const bad = await guardAdmin();
  if (bad) return bad;
  const b = await request.json().catch(() => null);
  const text = typeof b?.text === "string" ? b.text.trim().slice(0, 600) : "";
  const image = cleanPhoto(b?.image);
  if (!text && !image) return NextResponse.json({ error: "اكتب نصّاً أو أضِف صورة" }, { status: 400 });
  const audience = AUDIENCES.includes(b?.audience) ? b.audience : "all";
  const sortRaw = Number(b?.sort);
  const sort = Number.isFinite(sortRaw) ? Math.max(0, Math.min(999, Math.round(sortRaw))) : 0;
  const created = await prisma.appPopup.create({
    data: { text: text || null, image, audience, sort, status: "visible" },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const bad = await guardAdmin();
  if (bad) return bad;
  const b = await request.json().catch(() => null);
  const id = Number(b?.id) || 0;
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });
  const own = await prisma.appPopup.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
  if (!own) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  if (b?.archive === true) {
    await prisma.appPopup.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json({ ok: true, archived: true });
  }
  const data: { status?: string; audience?: string; sort?: number; text?: string | null; image?: string | null } = {};
  if (b?.status === "hidden" || b?.status === "visible") data.status = b.status;
  if (AUDIENCES.includes(b?.audience)) data.audience = b.audience;
  if (Number.isFinite(Number(b?.sort))) data.sort = Math.max(0, Math.min(999, Math.round(Number(b.sort))));
  if (typeof b?.text === "string") data.text = b.text.trim().slice(0, 600) || null;
  if (b?.image === null) data.image = null;
  else if (typeof b?.image === "string") data.image = cleanPhoto(b.image);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.appPopup.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
