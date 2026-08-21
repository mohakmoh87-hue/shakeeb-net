import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSyncAutoMsgFlags, setSyncAutoMsgFlag, sendSyncLogMessage } from "@/lib/syncAutoMsg";
import { fingerprint } from "@/lib/syncLog";

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
        // 🎴 «card» = تفعيلٌ بكارتٍ خارج المخزن — بيتُه **حارسُ المال** (إملاءُ محمد
        //    2026-08-21) لا هذه النافذة، فلا يُرسَل هنا أصلاً.
        where: { towerId: { in: towers }, status: "pending", kind: { in: ["info", "install", "self", "sas"] } },
        orderBy: { id: "desc" }, take: 2000,
      }),
      prisma.tower.findMany({ where: { id: { in: towers } }, select: { id: true, name: true } }),
    ]);
    // اسم باقة البرنامج الحاليّة للمعروضين (للمقارنة البصريّة في الواجهة)
    const subIds = [...new Set(rows.map((r) => r.subscriberId).filter((v): v is number => v != null))];
    const subs = subIds.length
      ? await prisma.subscriber.findMany({
          where: { id: { in: subIds } },
          select: { id: true, phone: true, packageId: true, dateTo: true, sasId: true },
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
          note: r.note,
          createdAt: r.createdAt,
          oursPhone: s?.phone ?? null,
          oursSasId: s?.sasId ?? null,
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
    action: z.enum(["apply", "ignore", "activate", "debt", "message", "replace"]),
  }),
  // جيك بوكس «إرسال رسائل تلقائي» — لكلّ تبويبٍ علَمُه، والافتراضيُّ إيقاف (قرار محمد)
  z.object({
    action: z.literal("autoMsg"),
    kind: z.enum(["self", "install"]),
    on: z.boolean(),
  }),
]);

// 🔴 **البصمةُ تُستورَد من محرّك السجلّ** ولا تُكتب هنا ثانيةً: كانت نسخةً بخمسة حقولٍ
// بينما المزامنةُ تحسبها بستّة (أُضيف اليوزر 2026-08-21) ⇒ لا تتطابقان أبداً ⇒ **كلُّ
// صفٍّ يُتجاهَل يعود في أوّل مزامنة** (بلاغُ محمد). دالّةٌ واحدةٌ لا نسختان.

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

        if (action === "replace" && !(r.subscriberId != null && r.sasId != null && (r.kind === "info" || r.kind === "install"))) {
          rejected.push(`سطر #${r.id}: الاستبدالُ يحتاج مشتركاً قائماً ورقمَ ساسٍ جديد`); continue;
        }
        if (action === "apply" || action === "replace") {
          // 🏷️ **«تحديث» على صفّ حدثٍ = «اعتُبر معالَجاً» فقط** (مراجعة 2026-08-21): كان
          // يمرّ في مسار «تطبيق بيانات على مشتركٍ قائم» فيكتب اسمَ الساس فوق اسمك بلا
          // داعٍ — والحدثُ ليس تغييرَ معلوماتٍ بل واقعةُ تفعيلٍ تُقرَّر لا تُنسَخ.
          if (r.kind === "self" || r.kind === "sas") {
            await prisma.syncLog.update({
              where: { id: r.id },
              data: { status: "done", note: `اعتُبر معالَجاً — ${who}`, handledBy: who, handledAt: new Date() },
            });
            done++; continue;
          }
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
            const { matcherForOffice } = await import("@/lib/packageMatch");
            const matcher = await matcherForOffice(r.towerId);
            const pkgId = matcher.match(r.packageName);
            const old = await prisma.subscriber.findUnique({
              where: { id: r.subscriberId },
              select: {
                id: true, name: true, netUser: true, note: true, sasId: true, sasPanelId: true,
                groupId: true, packageId: true, address: true, sector: true, towerId: true, isDeleted: true,
                wifiUser: true, wifiPass: true, userNano: true, passNano: true, ipNano: true,
                ftth: true, mac: true, subPassword: true, cardCode: true,
              },
            });
            if (!old || old.isDeleted || old.towerId !== r.towerId) { rejected.push(`مشترك سطر #${r.id} غير موجود`); continue; }
            // 🏷️ تنصيبٌ على يوزرِ تاركِ خدمةٍ (حسابُ ساسٍ جديدٌ على يوزرٍ قائم) ⇒ **استبدالُ
            // مشتركٍ كامل** بنفس دلالة خاصيّة «↔️ استبدال المشترك» حرفيّاً (قرار محمد 2026-08-21):
            // القديم أرشيفٌ حيٌّ كاملُ التاريخ ودينُه يبقى عليه، يوزرُه يوسم «#سابق» وربطُ
            // الساس يُفكّ، وواتسابُه يبقى مفعّلاً عمداً (حملات الاسترجاع)؛ والجديدُ يأخذ
            // اليوزرَ النظيفَ ولوحةَ ومكانَ وجهازَ السابق وماليّةً نظيفة.
            // ↔️ **الاستبدالُ فعلٌ صريحٌ بزرِّه** (بلاغُ محمد 2026-08-21): كان يقع تلقائيّاً
            // لمجرّد اختلاف رقم الساس — وهي الحالةُ الشائعةُ حين تُعيد الشركةُ إنشاءَ
            // الحساب — فيؤرشف صفَّك الصحيحَ ويُنشئ صفّاً ثانياً ⇒ **مكرَّرٌ جديدٌ بيدك**.
            const isReplace = action === "replace";
            if (isReplace) {
              const cleanUser = (old.netUser ?? "").trim();
              if (!cleanUser) { rejected.push(`«${old.name ?? r.netUser}» بلا يوزر — لا يصحّ الاستبدال`); continue; }
              const iq = new Date(Date.now() + 3 * 60 * 60 * 1000);
              const stamp = `${iq.getUTCFullYear()}${String(iq.getUTCMonth() + 1).padStart(2, "0")}${String(iq.getUTCDate()).padStart(2, "0")}-${String(iq.getUTCHours()).padStart(2, "0")}${String(iq.getUTCMinutes()).padStart(2, "0")}`;
              const day = `${String(iq.getUTCDate()).padStart(2, "0")}/${String(iq.getUTCMonth() + 1).padStart(2, "0")}/${iq.getUTCFullYear()}`;
              await prisma.$transaction([
                prisma.subscriber.update({
                  where: { id: old.id },
                  data: {
                    netUser: `${cleanUser}#سابق-${stamp}`,
                    sasId: null,
                    state: "سابق",
                    note: `${old.note ? `${old.note}\n` : ""}[استبدال ${day} — سجلّ المزامنة] ترك الخدمة وحلّ محله «${r.name ?? "مشترك جديد"}» على اليوزر «${cleanUser}»`,
                  },
                }),
                prisma.subscriber.create({
                  data: {
                    name: r.name ?? "مشترك جديد", phone: r.phone,
                    netUser: cleanUser, sasId: r.sasId, towerId: old.towerId,
                    sasPanelId: old.sasPanelId, groupId: old.groupId,
                    packageId: pkgId ?? old.packageId,
                    dateTo: r.sasDateTo, dateFrom: new Date(),
                    address: old.address, sector: old.sector,
                    wifiUser: old.wifiUser, wifiPass: old.wifiPass,
                    userNano: old.userNano, passNano: old.passNano, ipNano: old.ipNano,
                    ftth: old.ftth, mac: old.mac, subPassword: old.subPassword, cardCode: old.cardCode,
                    waEnabled: true, carry: 0, rewardBalance: 0, rewardGrantCount: 0,
                    createdByUser: session.username, createdByName: session.fullName,
                    note: `استبدال ${day} (سجلّ المزامنة): أخذ اليوزر «${cleanUser}» من المشترك السابق «${old.name ?? "—"}»`,
                  },
                }),
                prisma.auditLog.create({
                  data: {
                    userId: session.userId, action: "REPLACE_SUBSCRIBER", entity: "subscriber", entityId: String(old.id),
                    details: `سجلّ المزامنة: استبدال على اليوزر «${cleanUser}» — السابق «${old.name ?? "—"}» (بقي بسجله ودينه) ← الجديد «${r.name ?? "—"}» (هاتف ${r.phone ?? "—"}، باقة ${r.packageName ?? "—"}، انتهاء ${r.sasDateTo ? r.sasDateTo.toISOString().slice(0, 10) : "—"})`,
                  },
                }),
              ]);
            } else {
              // تطبيقُ بيانات الساس على القائم — الباقةُ المعروفة تُربَط، والمجهولةُ لا تمسّ باقتَه
              // 📅 وفرقُ الأيّام (زيادةً أو نقصاً — قرار محمد 2026-08-21): يُطبَّق فقط إن كان
              // مرصوداً في تغييرات الصفّ، وبحارس قرضٍ لحظةَ التطبيق (قد اقترض بعد الرصد —
              // وأيّامُ القرض الوهميّةُ لا يجوز أن يدهسها تاريخُ الساس)
              const flagged = new Set<string>();
              try {
                for (const c of (r.changes ? (JSON.parse(r.changes) as { f?: string }[]) : [])) if (c.f) flagged.add(c.f);
              } catch { /* تغييراتٌ غيرُ مقروءة ⇒ لا يُطبَّق شيء */ }
              let applyDate = r.sasDateTo != null && flagged.has("dateTo");
              if (applyDate) {
                const loan = await prisma.loanDebt.findFirst({
                  where: { subscriberId: r.subscriberId, isDeleted: false }, select: { id: true },
                });
                if (loan) applyDate = false;
              }
              // 🔴 تغيّرُ اليوزر في الساس ⇒ **إعادةُ تسميةٍ للصفّ نفسِه** (قرار محمد
              // 2026-08-21): اليوزرُ هو الفيصل، فيُصحَّح اسمُ صفّنا ليطابق الساسَ —
              // وبحارس تكرارٍ صارم: لو كان الاسمُ الجديد يخصّ صفّاً حيّاً آخرَ رُفض
              // الصفُّ كلُّه (لا نصنع مكرَّراً جديداً ونحن نُصلح مكرَّراً قديماً).
              let renameTo: string | null = null;
              try {
                const chs = r.changes ? (JSON.parse(r.changes) as { f?: string; new?: string }[]) : [];
                const nu = chs.find((c) => c.f === "netUser")?.new?.trim();
                if (nu && nu.toLowerCase() !== (old.netUser ?? "").trim().toLowerCase()) renameTo = nu;
              } catch { /* تغييراتٌ غيرُ مقروءة ⇒ لا إعادةَ تسمية */ }
              if (renameTo) {
                const clash = await prisma.subscriber.findFirst({
                  where: { towerId: r.towerId, isDeleted: false, netUser: renameTo, id: { not: old.id } },
                  select: { id: true },
                });
                if (clash) { rejected.push(`«${old.netUser}» ← «${renameTo}»: اليوزر الجديد يخصّ مشتركاً آخرَ (#${clash.id}) — يحتاج قرارك`); continue; }
              }
              // ✍️ **لا يُكتَب إلّا ما رُصد** (مراجعة 2026-08-21): كان يكتب الاسمَ والهاتفَ
              // والعنوانَ من الساس **دائماً** وإن لم تكن في التغييرات — فصفٌّ اسمُه عندك
              // «فلان تحويل لا تفعل» (ولا يُرصَد له فرقٌ منذ إصلاح الأمس) كان «تحديث»
              // على باقته **يمحو ملاحظتَك**. الآن الزرُّ أمينٌ حرفيّاً على ما يعرضه.
              const has = (f: string) => flagged.has(f);
              await prisma.subscriber.update({
                where: { id: r.subscriberId },
                data: {
                  ...(renameTo ? { netUser: renameTo } : {}),
                  ...(has("phone") && r.phone?.trim() ? { phone: r.phone } : {}),
                  ...(has("name") && r.name?.trim() ? { name: r.name } : {}),
                  ...(has("address") && r.address?.trim() ? { address: r.address } : {}),
                  ...(has("package") && pkgId != null ? { packageId: pkgId } : {}),
                  // 🔗 ربطُ رقم الساس الجديد بصفّك القائم (بديلُ الاستبدال الكاذب)
                  ...(has("sasLink") && r.sasId != null ? { sasId: r.sasId } : {}),
                  ...(applyDate ? { dateTo: r.sasDateTo, expiredNoticeAt: null } : {}),
                },
              });
              if (renameTo) {
                await prisma.auditLog.create({
                  data: {
                    userId: session.userId, action: "SYNC_LOG_RENAME_USER", entity: "subscriber", entityId: String(old.id),
                    details: `سجلّ المزامنة: تصحيحُ يوزرٍ من الساس «${old.netUser}» ← «${renameTo}» (sasId=${r.sasId})`,
                  },
                }).catch(() => {});
              }
              await prisma.auditLog.create({ data: { userId: session.userId, action: "SYNC_LOG_APPLY", entity: "subscriber", entityId: String(r.subscriberId), details: `سجلّ المزامنة: تحديث بيانات «${r.name ?? r.netUser}» من الساس — ${r.changes ?? ""}` } }).catch(() => {});
            }
          }
          await prisma.syncLog.update({ where: { id: r.id }, data: { status: "done", handledBy: who, handledAt: new Date() } });
          done++; continue;
        }

        // activate | debt — تبويب «تفعيلات ساس» حصراً، والمبلغُ سعرُ باقة البرنامج (قرار محمد)
        if (r.kind !== "sas" || r.subscriberId == null) { rejected.push(`سطر #${r.id} ليس تفعيلَ ساس`); continue; }
        // 💸 **القرضُ ليس بيعاً** (تصنيف محمد ٤ — مراجعة 2026-08-21): تفعيلةٌ بمبلغ صفرٍ
        // وبلا كارتٍ هي قرض؛ صناعةُ وصلِ بيعٍ لها بسعر الباقة تُدخل مالاً لم يُقبَض.
        if (action === "activate" && (r.note ?? "").startsWith("💸 قرض")) {
          rejected.push(`«${r.name ?? r.netUser}»: تفعيلةُ قرضٍ (صفر بلا كارت) — لا يُصنع لها وصلُ بيع`);
          continue;
        }
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
