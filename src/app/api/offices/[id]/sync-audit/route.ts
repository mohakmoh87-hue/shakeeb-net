import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";
import { getSession } from "@/lib/auth";
import { panelsOfTower, credsFromPanel, credsOfTower, type SasCreds } from "@/lib/sasPanel";
import { sasBaseUrl, sasLogin, sasFetchAllUsers, type SasUser } from "@/lib/sas4";

export const dynamic = "force-dynamic";

// ═════════ أ-٢١ · سجلُّ تدقيق المزامنة: ما تغيّر في الساس — بمراجعةٍ وقرار ═════════
//
// طلبُ محمد: «سجلُّ تدقيقٍ يظهر عند المزامنة… أنّ مشتركين عددَ كذا تغيّرت أرقامُ هواتفهم —
//  بالأسماء والأرقام، سطرٌ لكلّ مشترك — ويمكن وضعُ علامةِ صحٍّ لاختيار إهمالٍ أو تحديث.»
//
// فالمزامنةُ اليومَ **لا تتبع الساسَ** في الاسم والهاتف واليوزر إطلاقاً (تُكتب عند الاستيراد
// الأوّل وحدَه) — وهذا مقصودٌ: التغييرُ التلقائيُّ خطر. هذا السجلُّ هو الوسط: **يرصد ولا
// يُطبّق**، والمديرُ يُعلّم ويقرّر — نمطُ «الكروت الوهمية» بعينه.
//
// 🔑 والبنيةُ خفيفة: الفروقُ تُحسَب **حيّاً** عند الطلب (مقارنةُ ما عندنا بما في الساس عبر
//   كلّ لوحات المكتب) ⇒ ما طُبِّق يختفي من نفسه، ولا يُخزَّن إلّا **الإهمال** — بمفتاحٍ يشمل
//   **قيمةَ الساس نفسَها** `(subscriberId, field, sasValue)`: فلو أهمل هاتفاً ثمّ غيّره الساسُ
//   لرقمٍ آخرَ ظهر التغييرُ الجديد (مفتاحٌ ناقصٌ كان سيحجبه صامتاً إلى الأبد).
// 🔒 والعزل: عينُ حرسِ مسار المزامنة — `offices.sync` + المكتبُ من مكاتب الوكيل.

const FIELDS = ["name", "phone", "netUser"] as const;
type DiffField = (typeof FIELDS)[number];
const FIELD_LABEL: Record<DiffField, string> = { name: "الاسم", phone: "الهاتف", netUser: "اليوزر" };

async function guardOffice(id: string) {
  const g = await guard("offices.sync");
  if (g.error) return { error: g.error };
  const towerId = Number(id);
  const mine = await agentTowerIds(g.session ?? null);
  if (!mine.includes(towerId)) return { error: NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 }) };
  return { towerId, session: g.session };
}

const ignoreKey = (subscriberId: number, field: string, sasValue: string) => `${subscriberId}|${field}|${sasValue}`;
const ignoreType = (towerId: number) => `syncAudit:ignore:${towerId}`;

async function readIgnores(towerId: number): Promise<Set<string>> {
  const row = await prisma.systemSetting.findFirst({ where: { type: ignoreType(towerId) }, select: { text: true } });
  try {
    const arr = row?.text ? (JSON.parse(row.text) as { subscriberId: number; field: string; sasValue: string }[]) : [];
    return new Set(arr.map((x) => ignoreKey(x.subscriberId, x.field, x.sasValue)));
  } catch { return new Set(); }
}

/** مشتركو الساس لكلّ لوحات المكتب — خريطة sasId ← بيانات الساس */
async function sasUsersOfOffice(towerId: number): Promise<Map<number, SasUser>> {
  const scopes: SasCreds[] = [];
  for (const p of await panelsOfTower(towerId)) { const c = credsFromPanel(p); if (c) scopes.push(c); }
  if (!scopes.length) { const f = await credsOfTower(towerId); if (f) scopes.push(f); }
  if (!scopes.length) throw new Error("المكتب لا يحتوي بيانات SAS كاملة");
  const map = new Map<number, SasUser>();
  for (const sc of scopes) {
    const base = sasBaseUrl(sc.loginUrl);
    const token = await sasLogin(base, sc.username, sc.password);
    for (const u of await sasFetchAllUsers(base, token, 500, 700, 30)) {
      if (!map.has(u.sasId)) map.set(u.sasId, u);
    }
  }
  return map;
}

// الفروق الحيّة — سطرٌ لكلّ (مشترك، حقل)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardOffice(id);
  if ("error" in g) return g.error;
  const { towerId } = g;

  try {
    const [subs, sasUsers, ignores] = await Promise.all([
      prisma.subscriber.findMany({
        where: { towerId, isDeleted: false, sasId: { not: null } },
        select: { id: true, sasId: true, name: true, phone: true, netUser: true },
      }),
      sasUsersOfOffice(towerId),
      readIgnores(towerId),
    ]);

    const rows: { subscriberId: number; subName: string | null; netUser: string | null; field: DiffField; label: string; ours: string; sas: string }[] = [];
    for (const s of subs) {
      const u = s.sasId != null ? sasUsers.get(s.sasId) : undefined;
      if (!u) continue; // غائبٌ عن الساس — شأنُ ب-٤ (تكرار المعرّفات) لا شأنُ هذا السجلّ
      const pairs: [DiffField, string | null, string | null][] = [
        ["name", s.name, u.name], ["phone", s.phone, u.phone], ["netUser", s.netUser, u.username],
      ];
      for (const [field, ours, sas] of pairs) {
        const sv = (sas ?? "").trim();
        const ov = (ours ?? "").trim();
        // قيمةُ ساسٍ فارغةٌ لا تُقترح — لا نمسح بياناتنا بفراغ الساس
        if (!sv || sv === ov) continue;
        if (ignores.has(ignoreKey(s.id, field, sv))) continue;
        rows.push({ subscriberId: s.id, subName: s.name, netUser: s.netUser, field, label: FIELD_LABEL[field], ours: ov, sas: sv });
      }
    }
    // مجمَّعةٌ بنوع الحقل (نصُّ الطلب) — والعدُّ الكلّيُّ للزرّ
    const groups: Record<DiffField, typeof rows> = { name: [], phone: [], netUser: [] };
    for (const r of rows) groups[r.field].push(r);
    return NextResponse.json({ count: rows.length, groups });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر حساب الفروق" }, { status: 502 });
  }
}

const postSchema = z.object({
  action: z.enum(["apply", "ignore"]),
  items: z.array(z.object({
    subscriberId: z.coerce.number(),
    field: z.enum(FIELDS),
    sasValue: z.string().min(1),
  })).min(1, "لم تُحدَّد سطور"),
});

// [تحديث المحدَّد] أو [إهمال المحدَّد]
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardOffice(id);
  if ("error" in g) return g.error;
  const { towerId } = g;
  const session = await getSession();

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const { action, items } = parsed.data;

  // 🔒 كلُّ المشتركين من **هذا المكتب** حصراً — معرّفٌ غريبٌ يسقط بصمت لا يُنفَّذ
  const subs = await prisma.subscriber.findMany({
    where: { id: { in: items.map((x) => x.subscriberId) }, towerId, isDeleted: false },
    select: { id: true, name: true, phone: true, netUser: true },
  });
  const subById = new Map(subs.map((s) => [s.id, s]));

  if (action === "ignore") {
    const existing = await prisma.systemSetting.findFirst({ where: { type: ignoreType(towerId) }, select: { id: true, text: true } });
    let arr: { subscriberId: number; field: string; sasValue: string; at?: string }[] = [];
    try { arr = existing?.text ? JSON.parse(existing.text) : []; } catch { arr = []; }
    const have = new Set(arr.map((x) => ignoreKey(x.subscriberId, x.field, x.sasValue)));
    let added = 0;
    for (const it of items) {
      if (!subById.has(it.subscriberId)) continue;
      const k = ignoreKey(it.subscriberId, it.field, it.sasValue);
      if (have.has(k)) continue;
      arr.push({ subscriberId: it.subscriberId, field: it.field, sasValue: it.sasValue, at: new Date().toISOString().slice(0, 10) });
      have.add(k); added++;
    }
    const text = JSON.stringify(arr);
    if (existing) await prisma.systemSetting.update({ where: { id: existing.id }, data: { text } });
    else await prisma.systemSetting.create({ data: { type: ignoreType(towerId), text } });
    return NextResponse.json({ ok: true, ignored: added });
  }

  // apply — تحديثُ الحقل إلى قيمة الساس، بسجلِّ تدقيقٍ عكسيٍّ لكلّ سطر
  let applied = 0;
  const rejected: { subscriberId: number; reason: string }[] = [];
  for (const it of items) {
    const s = subById.get(it.subscriberId);
    if (!s) { rejected.push({ subscriberId: it.subscriberId, reason: "ليس من هذا المكتب" }); continue; }
    // 🛡️ حرسُ اليوزر (قرار محمد: لا مكرَّرات جديدة): تحديثُ اليوزر إلى قيمةٍ يحملها
    // مشتركٌ حيٌّ آخرُ في نفس المكتب يُرفض صراحةً — لا يُنشأ التكرارُ الذي جمّدنا قديمَه
    if (it.field === "netUser") {
      const clash = await prisma.subscriber.findFirst({
        where: { towerId, isDeleted: false, netUser: it.sasValue, id: { not: s.id } },
        select: { id: true },
      });
      if (clash) { rejected.push({ subscriberId: s.id, reason: `اليوزر «${it.sasValue}» يحمله مشترك آخر (#${clash.id})` }); continue; }
    }
    const before = (s as Record<string, unknown>)[it.field] ?? null;
    await prisma.subscriber.update({ where: { id: s.id }, data: { [it.field]: it.sasValue } });
    await prisma.auditLog.create({
      data: {
        userId: session?.userId, action: "SYNC_AUDIT_APPLY", entity: "subscriber", entityId: String(s.id),
        details: `سجلّ تدقيق المزامنة: تحديث ${FIELD_LABEL[it.field]} للمشترك ${s.name ?? s.netUser ?? s.id} من «${before ?? "—"}» إلى «${it.sasValue}» — مكتب #${towerId}`,
      },
    }).catch(() => {});
    applied++;
  }
  return NextResponse.json({ ok: true, applied, rejected });
}
