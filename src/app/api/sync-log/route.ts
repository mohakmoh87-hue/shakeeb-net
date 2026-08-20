import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSyncAutoMsgFlags, setSyncAutoMsgFlag, sendSyncLogMessage } from "@/lib/syncAutoMsg";

export const dynamic = "force-dynamic";

// ═════ 📋 سجلّ المزامنة الموحَّد — القراءة والأفعال (2026-08-20) ═════
// GET: لكلّ مستخدمٍ مسجَّل (مديرٍ أو مستخدمِ مكتب) — يرى صفوفَ مكاتبه فقط.
// POST: بصلاحيّة «تحديث سجل المزامنة» (syncLog.update — ضمن المال) حصراً.
// 🔒 العزل بالمعرّفات في SQL دائماً: towerId ضمن مكاتب وكيل الجلسة.
// P2021 (الجدول لم يُنشأ بعد): فراغٌ هادئ — الميزةُ خامدةٌ حتى لصق محمد الـSQL.

const tableMissing = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e && (e as { code?: string }).code === "P2021";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "غير مسجّل دخول" }, { status: 401 });
  const towers = await agentTowerIds(session);
  if (!towers.length) return NextResponse.json({ rows: [], towers: [], canEdit: false });
  try {
    const [rows, towerRows] = await Promise.all([
      prisma.syncLog.findMany({
        where: { towerId: { in: towers }, status: "pending" },
        orderBy: { id: "desc" }, take: 2000,
      }),
      prisma.tower.findMany({ where: { id: { in: towers } }, select: { id: true, name: true } }),
    ]);
    // اسم باقة البرنامج الحاليّة للمعروضين (للمقارنة البصريّة في الواجهة)
    const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((v): v is number => v != null))];
    const subs = subIds.length
      ? await prisma.subscriber.findMany({
          where: { id: { in: subIds } },
          select: { id: true, phone: true, packageId: true, dateTo: true },
        })
      : [];
    const subById = new Map(subs.map((s) => [s.id, s]));
    const pkgIds = [...new Set(subs.map((s) => s.packageId).filter((v): v is number => v != null))];
    const pkgs = pkgIds.length
      ? await prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true, priceDinar: true } })
      : [];
    const pkgById = new Map(pkgs.map((p) => [p.id, p]));
    // صلاحيّة التعديل — تُبلَّغ للواجهة لتُظهر/تُخفي الأزرار (والخادمُ يحرسها في POST حكماً)
    const g = await guard("syncLog.update");
    const canEdit = !g.error;
    // جيك بوكسا «إرسال رسائل تلقائي» (تبويبا التنصيب والتفعيل الخارجيَّين)
    const autoMsg = await getSyncAutoMsgFlags(session.agentId ?? null);
    const tName = new Map(towerRows.map((t) => [t.id, t.name ?? `#${t.id}`]));
    return NextResponse.json({
      canEdit,
      autoMsg,
      towers: towerRows,
      rows: rows.map((r) => {
        const s = r.subscriberId != null ? subById.get(r.subscriberId) : undefined;
        return {
          id: r.id, kind: r.kind, towerId: r.towerId, towerName: tName.get(r.towerId) ?? `#${r.towerId}`,
          subscriberId: r.subscriberId, sasId: r.sasId, netUser: r.netUser, name: r.name,
          phone: r.phone, address: r.address, packageName: r.packageName,
          sasDateTo: r.sasDateTo, amount: r.amount, activatedAt: r.activatedAt,
          changes: r.changes ? (JSON.parse(r.changes) as unknown) : null,
          createdAt: r.createdAt,
          oursPhone: s?.phone ?? null,
          oursPackage: s?.packageId != null ? (pkgById.get(s.packageId)?.name ?? null) : null,
          oursPrice: s?.packageId != null ? (pkgById.get(s.packageId)?.priceDinar ?? null) : null,
          oursDateTo: s?.dateTo ?? null,
        };
      }),
    });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ rows: [], towers: [], canEdit: false, dormant: true });
    throw e;
  }
}

const postSchema = z.union([
  z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1, "لم تُحدَّد سطور"),
    action: z.enum(["apply", "ignore", "activate", "debt", "message"]),
  }),
  // جيك بوكس «إرسال رسائل تلقائي» — لكلّ تبويبٍ علَمُه، والافتراضيُّ إيقاف (قرار محمد)
  z.object({
    action: z.literal("autoMsg"),
    kind: z.enum(["self", "install"]),
    on: z.boolean(),
  }),
]);

function fingerprint(r: { name: string | null; phone: string | null; address: string | null; packageName: string | null; sasDateTo: Date | null }): string {
  return JSON.stringify([r.name ?? "", r.phone ?? "", r.address ?? "", r.packageName ?? "", r.sasDateTo ? r.sasDateTo.toISOString().slice(0, 10) : ""]);
}

export async function POST(request: Request) {
  // الأفعالُ حصراً لصاحب «تحديث سجل المزامنة» (قرار محمد: العرضُ للجميع والتعديلُ بصلاحيّة)
  const g = await guard("syncLog.update");
  if (g.error) return g.error;
  const session = g.session!;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

  // ═══ جيك بوكس «إرسال رسائل تلقائي» — حفظُ علَم الوكيل (بلا سطور) ═══
  if (parsed.data.action === "autoMsg") {
    if (session.agentId == null) return NextResponse.json({ error: "لا وكيلَ للجلسة" }, { status: 400 });
    const flags = await setSyncAutoMsgFlag(session.agentId, parsed.data.kind, parsed.data.on);
    return NextResponse.json({ ok: true, autoMsg: flags });
  }

  const { ids, action } = parsed.data;
  const towers = await agentTowerIds(session);
  const who = session.fullName ?? session.username;

  try {
    // 🔒 صفوفُ مكاتب وكيل المستخدم حصراً — معرّفٌ غريبٌ يسقط ولا يُنفَّذ
    const rows = await prisma.syncLog.findMany({
      where: { id: { in: ids }, towerId: { in: towers.length ? towers : [-1] }, status: "pending" },
    });
    if (!rows.length) return NextResponse.json({ error: "لا سطورَ قابلةً للتنفيذ" }, { status: 404 });

    let done = 0;
    const rejected: string[] = [];

    for (const r of rows) {
      try {
        if (action === "ignore") {
          await prisma.syncLog.update({
            where: { id: r.id },
            data: { status: "ignored", snapshot: fingerprint(r), handledBy: who, handledAt: new Date() },
          });
          done++; continue;
        }

        // ═══ إرسالُ رسالة القالب يدويّاً (تبويبا التنصيب والتفعيل الخارجيَّين) ═══
        // لا يمسّ حالةَ الصفّ: يبقى معلّقاً حتى يُقرَّر (تحديث/تجاهل/تفعيل/دين)
        if (action === "message") {
          if (r.kind !== "self" && r.kind !== "install") { rejected.push(`سطر #${r.id} ليس تنصيباً ولا تفعيلاً خارجيّاً`); continue; }
          const res = await sendSyncLogMessage(r.kind, {
            towerId: r.towerId, sasId: r.sasId, activatedAt: r.activatedAt,
            subscriberId: r.subscriberId, phone: r.phone,
            netUser: r.netUser, name: r.name, packageName: r.packageName, sasDateTo: r.sasDateTo,
          });
          if (res === "sent" || res === "queued") {
            await prisma.syncLog.update({
              where: { id: r.id },
              data: { note: `📨 أُرسلت الرسالة${res === "queued" ? " (بالطابور حتى يتّصل واتساب المكتب)" : ""} — ${who}` },
            }).catch(() => {});
            done++;
          } else if (res === "duplicate") {
            // حارسُ التكرار الفيزيائيُّ صدّها — أُرسلت له سلفاً (أو في الطابور) عن نفس الحدث
            rejected.push(`«${r.name ?? r.netUser ?? `#${r.id}`}»: أُرسلت له سلفاً — مانعُ التكرار`);
          } else {
            rejected.push(`«${r.name ?? r.netUser ?? `#${r.id}`}»: ${res === "skipped" ? "القالبُ معطَّل أو واتساب المكتب/المشترك مُطفأ" : "لا رقمَ هاتفٍ له"}`);
          }
          continue;
        }

        if (action === "apply") {
          if (r.subscriberId == null) {
            // تنصيبٌ غير محفوظ («حفظ» في تبويب ٢ أو «تحديث» في تبويب ١ بعد تجاهل تنصيبه):
            // استيرادٌ كاملٌ **بلا وصل** (قرارا محمد ج٢ وج٣) — واليوزرُ الفيصل: لا صفَّ ثانياً
            if ((r.netUser ?? "").trim()) {
              const clash = await prisma.subscriber.findFirst({
                where: { towerId: r.towerId, isDeleted: false, netUser: r.netUser, id: { not: -1 } }, select: { id: true },
              });
              if (clash) { rejected.push(`«${r.netUser}» يوزرُه موجودٌ سلفاً (#${clash.id})`); continue; }
            }
            const { matcherForOffice } = await import("@/lib/packageMatch");
            const matcher = await matcherForOffice(r.towerId);
            const created = await prisma.subscriber.create({
              data: {
                name: r.name, netUser: r.netUser, phone: r.phone, address: r.address,
                sasId: r.sasId, towerId: r.towerId, dateTo: r.sasDateTo,
                packageId: matcher.match(r.packageName), createdByUser: who,
              },
            });
            await prisma.auditLog.create({ data: { userId: session.userId, action: "SYNC_LOG_IMPORT", entity: "subscriber", entityId: String(created.id), details: `سجلّ المزامنة: استيراد «${r.name ?? r.netUser}» (بلا وصل) — مكتب #${r.towerId}` } }).catch(() => {});
          } else {
            // تطبيقُ بيانات الساس على القائم — الباقةُ المعروفة تُربَط، والمجهولةُ لا تمسّ باقتَه
            const { matcherForOffice } = await import("@/lib/packageMatch");
            const matcher = await matcherForOffice(r.towerId);
            const pkgId = matcher.match(r.packageName);
            await prisma.subscriber.update({
              where: { id: r.subscriberId },
              data: {
                ...(r.phone?.trim() ? { phone: r.phone } : {}),
                ...(r.name?.trim() ? { name: r.name } : {}),
                ...(r.address?.trim() ? { address: r.address } : {}),
                ...(pkgId != null ? { packageId: pkgId } : {}),
              },
            });
            await prisma.auditLog.create({ data: { userId: session.userId, action: "SYNC_LOG_APPLY", entity: "subscriber", entityId: String(r.subscriberId), details: `سجلّ المزامنة: تحديث بيانات «${r.name ?? r.netUser}» من الساس — ${r.changes ?? ""}` } }).catch(() => {});
          }
          await prisma.syncLog.update({ where: { id: r.id }, data: { status: "done", handledBy: who, handledAt: new Date() } });
          done++; continue;
        }

        // activate | debt — تبويب «تفعيلات ساس» حصراً، والمبلغُ سعرُ باقة البرنامج (قرار محمد)
        if (r.kind !== "sas" || r.subscriberId == null) { rejected.push(`سطر #${r.id} ليس تفعيلَ ساس`); continue; }
        const sub = await prisma.subscriber.findUnique({
          where: { id: r.subscriberId },
          select: { id: true, name: true, netUser: true, carry: true, dateTo: true, towerId: true, packageId: true },
        });
        if (!sub || sub.towerId !== r.towerId) { rejected.push(`مشترك سطر #${r.id} غير موجود`); continue; }
        const pkg = sub.packageId != null
          ? await prisma.package.findUnique({ where: { id: sub.packageId }, select: { name: true, priceDinar: true } })
          : null;
        const price = Math.round(pkg?.priceDinar ?? 0);
        if (!pkg || price <= 0) { rejected.push(`«${sub.name ?? sub.netUser}»: حدّد باقتَه وسعرَها أوّلاً`); continue; }
        const now = new Date();
        // «يحدث أيّامُ المشترك»: تاريخُ الساس الأبعدُ يُعتمد (والمزامنةُ تمدّه أصلاً — أمانٌ مزدوج)
        const dateTo = r.sasDateTo && (!sub.dateTo || r.sasDateTo > sub.dateTo) ? r.sasDateTo : sub.dateTo;
        const isDebt = action === "debt";
        const newCarry = (sub.carry ?? 0) + (isDebt ? price : 0);
        await prisma.$transaction(async (tx) => {
          await tx.subscriber.update({
            where: { id: sub.id },
            data: { dateTo, wasel: isDebt ? 0 : price, carry: { increment: isDebt ? price : 0 }, expiredNoticeAt: null },
          });
          const entry = await tx.subscriptionEntry.create({
            data: {
              subscriberId: sub.id, date: now, dateFrom: now, dateTo, money: price,
              moneyIn: isDebt ? 0 : price, moneyCarry: newCarry, moneyType: 1, month: "1",
              cardType: pkg.name, towerId: r.towerId, createdByUser: session.username,
              userId: session.userId,
              notes: `سجلّ المزامنة — تفعيلُ ساسٍ ${isDebt ? "أُضيف ديناً" : "سُوّي بوصل"} (منجر الصفحة، ${r.activatedAt ? r.activatedAt.toISOString().slice(0, 10) : ""})`,
            },
          });
          if (!isDebt) {
            // «كأنّه تفعيلٌ عادي»: قبضٌ في صندوق اليوم الجاري (قرار محمد: يوم الضغط)
            await tx.moneyTx.create({
              data: {
                moneyIn: price, moneyOut: 0,
                notes: `تفعيل ${pkg.name} - ${sub.name ?? sub.id} (سجلّ المزامنة)`,
                date: now, serverDate: now, userId: session.userId,
                sourceType: "activation", sourceId: entry.id, towerId: r.towerId,
              },
            });
          }
          await tx.auditLog.create({
            data: {
              userId: session.userId, action: isDebt ? "SYNC_LOG_DEBT" : "SYNC_LOG_ACTIVATE", entity: "subscriber", entityId: String(sub.id),
              details: `سجلّ المزامنة: ${isDebt ? `دينٌ ${price} على` : `تفعيلٌ بوصل ${price} لـ`} «${sub.name ?? sub.netUser}» عن تفعيلة ساس ${r.activatedAt ? r.activatedAt.toISOString().slice(0, 10) : ""}`,
            },
          });
          await tx.syncLog.update({ where: { id: r.id }, data: { status: "done", note: isDebt ? `دين ${price}` : `وصل ${price}`, handledBy: who, handledAt: new Date() } });
        });
        done++;
      } catch (e) {
        rejected.push(`سطر #${r.id}: ${e instanceof Error ? e.message : "خطأ"}`);
      }
    }
    return NextResponse.json({ ok: true, done, rejected });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ error: "السجلّ لم يُهيّأ بعد" }, { status: 503 });
    throw e;
  }
}
