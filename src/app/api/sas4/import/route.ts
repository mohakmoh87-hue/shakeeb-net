import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, ownsTower } from "@/lib/guard";
import { getSession } from "@/lib/auth";

const schema = z.object({
  towerId: z.coerce.number(),
  users: z
    .array(
      z.object({
        sasId: z.coerce.number(),
        username: z.string(),
        name: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        days: z.coerce.number().default(0),
        expiration: z.string().nullable().optional(), // تاريخ الانتهاء الحقيقي من SAS4
        packageName: z.string().nullable().optional(),
      }),
    )
    .min(1, "لم يتم اختيار أي مشترك"),
});

// استيراد المشتركين المختارين من SAS4 إلى قاعدة البيانات
export async function POST(request: Request) {
  const g = await guard("subscribers.manage");
  if (g.error) return g.error;
  const session = await getSession();

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }
  const { towerId, users } = parsed.data;

  // عزل المستأجر: لا يُستورَد إلا إلى مكتب يتبع وكيل المستخدم
  if (!(await ownsTower(g.session, towerId))) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  // المستوردون سابقاً (لتفادي التكرار)
  const existing = await prisma.subscriber.findMany({
    where: { sasId: { in: users.map((u) => u.sasId) } },
    select: { sasId: true },
  });
  const existingIds = new Set(existing.map((e) => e.sasId));

  // سحب فئات SAS4 كباقات: إنشاء أي فئة غير موجودة وربطها بالاسم
  const tierNames = [
    ...new Set(users.map((u) => u.packageName?.trim()).filter(Boolean) as string[]),
  ];
  // الربط بفئة موجودة مسبقاً فقط (لا يُنشئ فئات تلقائياً — الفئات تُضاف يدوياً)
  const existingPkgs = await prisma.package.findMany({
    where: { isDeleted: false, name: { in: tierNames }, agentId: g.session?.agentId ?? -1 }, // عزل: باقات الوكيل فقط
    select: { id: true, name: true },
  });
  const pkgMap = new Map(existingPkgs.map((p) => [p.name, p.id]));

  const now = new Date();
  let created = 0;
  let skipped = 0;

  const toCreate = users
    .filter((u) => !existingIds.has(u.sasId))
    .map((u) => {
      // تاريخ الانتهاء الحقيقي من SAS4 (يعرض السالب للمنتهين)، أو حساب من الأيام
      let dateTo: Date | null = null;
      if (u.expiration) dateTo = new Date(u.expiration);
      else if (u.days) { dateTo = new Date(now); dateTo.setDate(dateTo.getDate() + u.days); }
      const pkgId = u.packageName?.trim() ? pkgMap.get(u.packageName.trim()) ?? null : null;
      return {
        name: u.name?.trim() || u.username,
        phone: u.phone?.trim() || null,
        netUser: u.username,
        sasId: u.sasId,
        towerId,
        packageId: pkgId, // يُربط بفئة موجودة فقط
        dateTo,
        dateFrom: now,
        createdByUser: session?.username,
        createdByName: session?.fullName,
      };
    });
  skipped = users.length - toCreate.length;

  // إدراج بدفعات
  for (let i = 0; i < toCreate.length; i += 500) {
    const chunk = toCreate.slice(i, i + 500);
    const res = await prisma.subscriber.createMany({ data: chunk });
    created += res.count;
  }

  await prisma.auditLog.create({
    data: {
      userId: session?.userId,
      action: "IMPORT_SAS4",
      entity: "subscriber",
      details: `استيراد ${created} من SAS4 (تخطّي ${skipped})`,
    },
  });

  return NextResponse.json({ ok: true, created, skipped });
}
