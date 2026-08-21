import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, guardAny, agentTowerIds } from "@/lib/guard";
import { EXPIRING_BY_PKG, expiringPkgType } from "@/lib/smsTemplates";
import type { SessionPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ═════ 📦 قوالبُ «تذكير قبل الانتهاء حسب الباقة» (طلبُ محمد 2026-08-21) ═════
// «قالبٌ لكلّ باقةٍ موجودة، وأيُّ باقةٍ تُضاف مستقبلاً يصير لها قالبٌ فيه».
// ⇒ القائمةُ تُبنى من **جدول الباقات لحظةَ الفتح** لا من قائمةٍ في الكود — فالباقةُ
//   الجديدةُ تظهر بمحرِّرٍ فارغٍ من نفسها بلا أن يلمس أحدٌ سطراً.
// ولماذا مسارٌ مستقلّ ولم يُوسَّع `bulk`؟ لأنّ ذاك يتحقّق من `z.enum(EVENT_TYPES)` وقائمةٍ
// ثابتةٍ من الأنواع — وأنواعُ الباقات **ديناميكيّةٌ بعددها** (`expiringPkg:{id}`). فتوسيعُه
// كان سيفتح بابَ نوعٍ حرٍّ على كلّ القوالب؛ والفصلُ يُبقي القديمَ على حاله حرفيّاً.
// 🔒 العزلُ كما هو: قوالبُ وكيل الجلسة، ومكتبٌ من مكاتبه أو «عام»، ومستخدمُ المكتب مُقيَّدٌ بمكتبه.
const IMAGE_MAX_CHARS = 400_000; // نفسُ سقف الصورة في `bulk` (≈٣٠٠ ك.ب ملفّاً أصليّاً)

const schema = z.object({
  officeId: z.coerce.number().int().positive().nullable().optional(),
  // مفتاحُ الوضع: تفعيلُ «حسب الباقة» يُطفئ القالبَ القديمَ حكماً (وأدناه العكس)
  master: z.boolean().optional(),
  packages: z
    .array(
      z.object({
        packageId: z.coerce.number().int().positive(),
        text: z.string().default(""),
        enable: z.string().default("1"),
        reset: z.boolean().optional(), // مع مكتب: حذفُ تخصيص المكتب لهذه الباقة
        image: z.string().max(IMAGE_MAX_CHARS, "الصورة أكبر من المسموح (٣٠٠ كيلوبايت)").nullable().optional(),
      }),
    )
    .optional(),
});

async function resolveOffice(session: SessionPayload, requested: number | null): Promise<number | null | undefined> {
  if (!session.isAdmin && session.towerId != null) return session.towerId;
  if (requested == null) return null;
  const towers = await agentTowerIds(session);
  return towers.includes(requested) ? requested : undefined;
}

export async function GET(request: Request) {
  const g = await guardAny("templates.manage", "messaging.manage");
  if (g.error) return g.error;
  const agentId = g.session?.agentId ?? null;
  const reqOffice = Number(new URL(request.url).searchParams.get("officeId")) || null;
  const officeId = await resolveOffice(g.session!, reqOffice);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const packages = await prisma.package.findMany({
    where: { agentId: agentId ?? -1, isDeleted: false },
    select: { id: true, name: true, priceDinar: true },
    orderBy: [{ name: "asc" }],
  });
  const types = packages.map((p) => expiringPkgType(p.id));
  const rows = await prisma.smsTemplate.findMany({
    where: {
      agentId: agentId ?? -1,
      type: { in: [...types, EXPIRING_BY_PKG] },
      OR: [{ towerId: null }, ...(officeId != null ? [{ towerId: officeId }] : [])],
    },
  });
  const agentMap = new Map(rows.filter((r) => r.towerId == null).map((r) => [r.type, r]));
  const officeMap = new Map(rows.filter((r) => r.towerId === officeId && officeId != null).map((r) => [r.type, r]));

  // 🔛 وضعُ «حسب الباقة»: صفُّ المكتب يغلب صفَّ الوكيل (كسلَّم النصّ نفسِه)
  const mo = officeId != null ? officeMap.get(EXPIRING_BY_PKG) : undefined;
  const ma = agentMap.get(EXPIRING_BY_PKG);
  const master = (mo ?? ma)?.enable === "1";

  // 🔒 وحالةُ القالب القديم — تُعرَض للواجهة لتُظهر القفلَ المتبادل بلا نداءٍ ثانٍ
  const oldRow = await prisma.smsTemplate.findFirst({
    where: { type: "expiring", agentId: agentId ?? -1, towerId: officeId ?? null },
    select: { enable: true },
  });
  const oldAgent = officeId != null
    ? await prisma.smsTemplate.findFirst({ where: { type: "expiring", agentId: agentId ?? -1, towerId: null }, select: { enable: true } })
    : null;

  return NextResponse.json({
    officeId,
    master,
    oldEnabled: (oldRow ?? oldAgent)?.enable !== "0",
    packages: packages.map((p) => {
      const t = expiringPkgType(p.id);
      const o = officeId != null ? officeMap.get(t) : undefined;
      const a = agentMap.get(t);
      const own = o ? (o.image?.trim() || null) : (a?.image?.trim() || null);
      const shown = own ?? (o ? (a?.image?.trim() || null) : null);
      const src = o ?? a;
      return {
        packageId: p.id, name: p.name ?? `#${p.id}`, price: p.priceDinar ?? 0,
        text: src?.text ?? "",
        enable: src?.enable ?? "1",
        officeCustom: !!o,
        image: shown, imageOwn: own != null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }
  const agentId = g.session?.agentId ?? null;
  const officeId = await resolveOffice(g.session!, parsed.data.officeId ?? null);
  if (officeId === undefined) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  // ١· قوالبُ الباقات
  for (const t of parsed.data.packages ?? []) {
    const type = expiringPkgType(t.packageId);
    // الباقةُ يجب أن تكون لوكيل الجلسة — فلا يُكتَب قالبٌ لباقة وكيلٍ آخر
    const pkg = await prisma.package.findFirst({ where: { id: t.packageId, agentId: agentId ?? -1 }, select: { id: true } });
    if (!pkg) continue;
    if (officeId != null && t.reset) {
      await prisma.smsTemplate.deleteMany({ where: { type, agentId: agentId ?? -1, towerId: officeId } });
      continue;
    }
    const existing = await prisma.smsTemplate.findFirst({
      where: { type, agentId: agentId ?? -1, towerId: officeId ?? null },
    });
    if (existing) {
      await prisma.smsTemplate.update({
        where: { id: existing.id },
        data: { text: t.text, enable: t.enable, ...(t.image === undefined ? {} : { image: t.image?.trim() || null }) },
      });
    } else {
      await prisma.smsTemplate.create({
        data: { type, text: t.text, enable: t.enable, image: t.image?.trim() || null, agentId, towerId: officeId ?? null },
      });
    }
  }

  // ٢· مفتاحُ الوضع + القفلُ المتبادل — **على الخادم** فلا يجتمع القالبان أبداً
  if (parsed.data.master !== undefined) {
    const on = parsed.data.master;
    const setRow = async (type: string, enable: string) => {
      const row = await prisma.smsTemplate.findFirst({ where: { type, agentId: agentId ?? -1, towerId: officeId ?? null } });
      if (row) await prisma.smsTemplate.update({ where: { id: row.id }, data: { enable } });
      else await prisma.smsTemplate.create({ data: { type, text: "", enable, agentId, towerId: officeId ?? null } });
    };
    await setRow(EXPIRING_BY_PKG, on ? "1" : "0");
    // تفعيلُ الجديد يُطفئ القديمَ في **نفس النطاق**؛ وإطفاؤه يُعيد القديمَ للعمل
    await setRow("expiring", on ? "0" : "1");
  }

  return NextResponse.json({ ok: true });
}
