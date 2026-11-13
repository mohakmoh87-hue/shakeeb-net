import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { ensureMarketTable } from "./market";
import { grantReward } from "./rewards";

// ═════ 👤 حساباتُ التجريب في التطبيق — سجلٌّ بلا جدولٍ ولا عمود (طلبُ محمد 2026-11-04) ═════
//
// أربعةُ أصنافٍ يدخلها محمد بأسماءٍ لا بأرقامِ هواتف: مشتركٌ فعّال · منتهٍ أقلَّ من شهر ·
// منتهٍ منذ سنة · مسجَّلٌ غيرُ مشترك. السجلُّ صفٌّ واحدٌ في `system_settings` يربط الاسمَ
// بمعرّف الصفّ ⇒ لا `ALTER` على الإنتاج ولا RLS ولا GRANT (درسُ العمود الكسول).
//
// ⚖️ وحرّاسُه:
//   · أرقامُها `070000000X`: مقبولةٌ صيغةً عند `phoneCore` لكنْ بادئةُ `70` غيرُ مخصَّصةٍ
//     لأيّ مشغّلٍ عراقيّ ⇒ لا تصادمَ ممكنٌ مع رقمِ إنسانٍ حقيقيّ.
//   · `waEnabled=false` ⇒ تذكيرُ الانتهاء ورسائلُ «المنتهون منذ N يوم» والديونُ كلُّها
//     تسحب بشرط `waEnabled: true`، فلا رسالةَ واتساب تخرج لها أبداً.
//   · بلا دَينٍ ولا موقعٍ ولا `sasId` ⇒ لا تمسُّ مالاً ولا خريطةً ولا مزامنة.
//   · ومعرّفاتُها تُستثنى من قوائم مشتركي المكتب (طلبُ محمد: «لا يظهر في مشتركين المكتب»).

const KEY = "appTestUsers";
const CACHE_MS = 30_000;

export type TestUser = { user: string; subscriberId?: number; accountId?: number };

let cache: { at: number; list: TestUser[] } | null = null;

export function normalizeTestUser(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export async function getTestUsers(): Promise<TestUser[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  let list: TestUser[] = [];
  try {
    const row = await prisma.systemSetting.findFirst({ where: { type: KEY }, orderBy: { id: "desc" }, select: { value: true } });
    const parsed = row?.value ? JSON.parse(row.value) : null;
    if (Array.isArray(parsed)) {
      list = parsed
        .map((e) => ({
          user: normalizeTestUser((e as TestUser)?.user),
          subscriberId: Number((e as TestUser)?.subscriberId) || undefined,
          accountId: Number((e as TestUser)?.accountId) || undefined,
        }))
        .filter((e) => e.user && (e.subscriberId != null || e.accountId != null));
    }
  } catch { /* نصٌّ فاسدٌ أو جدولٌ غائب — لا حساباتَ تجريب */ }
  cache = { at: Date.now(), list };
  return list;
}

async function saveTestUsers(list: TestUser[]): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { type: KEY } });
  await prisma.systemSetting.create({ data: { type: KEY, value: JSON.stringify(list) } });
  cache = { at: Date.now(), list };
}

export async function resolveTestUser(raw: unknown): Promise<TestUser | null> {
  const user = normalizeTestUser(raw);
  if (!user) return null;
  const list = await getTestUsers();
  return list.find((e) => e.user === user) ?? null;
}

export async function testSubscriberIds(): Promise<number[]> {
  const list = await getTestUsers();
  return list.map((e) => e.subscriberId).filter((x): x is number => typeof x === "number");
}

// ═════ المنشئ — إنشاءٌ أوّلَ مرّةٍ وتحديثُ تواريخَ بعدَه (لا تكرار) ═════

const PASSWORD = "123456";
const SPEC = [
  { user: "test1", phone: "07000000001", core: "7000000001", name: "مشترك تجريبي فعال", netUser: "test1", days: 25, fromDays: -5 },
  { user: "test2", phone: "07000000002", core: "7000000002", name: "مشترك تجريبي منتهي حديثا", netUser: "test2", days: -10, fromDays: -40 },
  { user: "test3", phone: "07000000003", core: "7000000003", name: "مشترك تجريبي منتهي قديم", netUser: "test3", days: -365, fromDays: -395 },
];
const ACCOUNT = { user: "test4", phone: "07000000004", core: "7000000004", name: "مسجل تجريبي غير مشترك", area: "تجريبي" };

const dayShift = (days: number): Date => new Date(Date.now() + days * 86_400_000);

async function agentNames(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const list = [...new Set(ids.filter((n): n is number => typeof n === "number"))];
  if (!list.length) return new Map();
  const rows = await prisma.agent.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((a) => [a.id, a.name ?? `وكيل #${a.id}`]));
}

export async function testOfficeCandidates(): Promise<{ id: number; name: string; agentName: string | null; rewardsOn: boolean }[]> {
  // 🔴 الاسمُ وحدَه لا يميّز: مكاتبُ عدّةِ وكلاءَ تحمل «المواصلات» — فيُعرَض الوكيلُ
  //    وحالةُ المكافآت مع كلّ مرشّح، وإلّا زُرعت الحساباتُ في مكتبٍ وفُتحت المكافآتُ في آخر.
  const rows = await prisma.tower.findMany({
    where: { isDeleted: false, name: { contains: "المواصلات" } },
    select: { id: true, name: true, rewardsEnabled: true, agentId: true },
    orderBy: { id: "asc" },
  });
  const agents = await agentNames(rows.map((t) => t.agentId));
  return rows.map((t) => ({
    id: t.id,
    name: t.name ?? `مكتب ${t.id}`,
    agentName: (t.agentId != null ? agents.get(t.agentId) : null) ?? null,
    rewardsOn: t.rewardsEnabled === "1",
  }));
}

export async function seedTestUsers(officeId?: number): Promise<{ ok: boolean; error?: string; officeName?: string; users?: string[] }> {
  const candidates = await testOfficeCandidates();
  if (!candidates.length) return { ok: false, error: "لا مكتبَ اسمُه يحوي «المواصلات»" };
  const office = officeId != null ? candidates.find((c) => c.id === officeId) : (candidates.length === 1 ? candidates[0] : undefined);
  if (!office) return { ok: false, error: "اختر المكتبَ — أكثرُ من مكتبٍ يحوي «المواصلات»" };

  await ensureMarketTable();
  const existing = await getTestUsers();
  // 🔒 رقمٌ تجريبيٌّ يملكه صفٌّ ليس من السجلّ ⇒ توقّفٌ تامّ: لا نلمس صفَّ إنسان.
  const cores = [...SPEC.map((s) => s.core), ACCOUNT.core];
  const clash = await prisma.subscriber.findMany({
    where: { isDeleted: false, purgedAt: null, OR: cores.map((c) => ({ phone: { endsWith: c } })) },
    select: { id: true },
  });
  const mine = new Set(existing.map((e) => e.subscriberId).filter((x): x is number => typeof x === "number"));
  if (clash.some((c) => !mine.has(Number(c.id)))) return { ok: false, error: "أحدُ الأرقام التجريبيّة مستعملٌ لمشتركٍ حقيقيّ — أبلِغ كلود" };

  const top = await prisma.subscriber.groupBy({
    by: ["packageId"],
    where: { towerId: office.id, isDeleted: false, packageId: { not: null } },
    _count: { packageId: true },
    orderBy: { _count: { packageId: "desc" } },
    take: 1,
  });
  const packageId = top[0]?.packageId ?? null;
  const passHash = await hashPassword(PASSWORD);
  const list: TestUser[] = [];

  for (const s of SPEC) {
    const prev = existing.find((e) => e.user === s.user)?.subscriberId;
    const data = {
      name: s.name, phone: s.phone, netUser: s.netUser, packageId, towerId: office.id,
      address: `${office.name} — تجريبي`, dateFrom: dayShift(s.fromDays), dateTo: dayShift(s.days),
      carry: 0, waEnabled: false, appBanned: false, isDeleted: false,
      appPasswordHash: passHash, createdByUser: "test", createdByName: "حسابات التجريب",
    };
    const row = prev != null ? await prisma.subscriber.update({ where: { id: prev }, data }).catch(() => null) : null;
    const id = row?.id ?? (await prisma.subscriber.create({ data })).id;
    list.push({ user: s.user, subscriberId: id });
  }

  const acc = await prisma.appAccount.upsert({
    where: { phoneCore: ACCOUNT.core },
    update: { name: ACCOUNT.name, area: ACCOUNT.area, passHash, isBanned: false },
    create: { phoneCore: ACCOUNT.core, phone: ACCOUNT.phone, name: ACCOUNT.name, area: ACCOUNT.area, passHash },
  });
  list.push({ user: ACCOUNT.user, accountId: acc.id });

  await saveTestUsers(list);
  return { ok: true, officeName: `${office.name}${office.agentName ? ` — ${office.agentName}` : ""}`, users: list.map((e) => e.user) };
}

// ═════ 🎁 رصيدُ مكافأةٍ تجريبيٌّ (طلبُ محمد 2026-11-04 لتجربةِ خصمِ المكافأة في المتجر) ═════
// 🔒 لا يُمنَح إلّا لصفٍّ **مسجَّلٍ في سجلّ التجريب** — فلا يُلمَس رصيدُ إنسانٍ أبداً.
// 🔑 والمنحُ بالمسار المحروس `grantReward` نفسِه ⇒ يُقيَّد في `reward_log` فيبقى
//    «المنوحُ − المسحوب = الرصيد» في سجلّ المكافآت، ولا رصيدَ من فراغ.
// وإعادةُ الضغط تُرجعه إلى ٥٠٠٠ بالضبط (`hadGap` يصفّر القاعدةَ قبل المنح) لا تُراكِم.
export const TEST_REWARD = 5000;

export async function grantTestReward(user = "test1"): Promise<{
  ok: boolean; error?: string; balance?: number; code?: string; officeName?: string; rewardsEnabled?: boolean;
}> {
  // الرسالةُ تُسمّي المكتبَ ووكيلَه دائماً — فمكاتبُ وكلاءَ كثيرين تحمل الاسمَ نفسَه
  const entry = await resolveTestUser(user);
  if (entry?.subscriberId == null) return { ok: false, error: "لا حسابَ تجريبيٍّ بهذا الاسم — اضغط «إنشاء / تحديث» أوّلاً" };
  const sub = await prisma.subscriber.findUnique({
    where: { id: entry.subscriberId },
    select: { id: true, name: true, towerId: true, rewardBalance: true, isDeleted: true },
  });
  if (!sub || sub.isDeleted) return { ok: false, error: "الحسابُ التجريبيُّ موقوفٌ أو مفقود — اضغط «إنشاء / تحديث»" };
  const office = sub.towerId
    ? await prisma.tower.findUnique({ where: { id: sub.towerId }, select: { name: true, agentId: true, rewardsEnabled: true, isDeleted: true } })
    : null;
  const officeAgent = office?.agentId != null ? (await agentNames([office.agentId])).get(office.agentId) ?? null : null;
  const r = await prisma.$transaction(async (tx) =>
    grantReward(tx, {
      subscriberId: sub.id, towerId: sub.towerId, agentId: office?.agentId ?? null, subscriberName: sub.name,
      currentBalance: sub.rewardBalance ?? 0, hadGap: true, rewardAmount: TEST_REWARD, months: 1,
      createdByUser: "test", createdByName: "حسابات التجريب",
    }),
  );
  if (!r) return { ok: false, error: "تعذّر المنح" };
  return {
    ok: true, balance: r.balance, code: r.code,
    officeName: `${office?.name ?? "بلا مكتب"}${office?.isDeleted ? " (محذوف)" : ""}${officeAgent ? ` — ${officeAgent}` : ""}`,
    rewardsEnabled: office?.rewardsEnabled === "1",
  };
}

// إيقافٌ ناعم: الصفوفُ تبقى (لا حذفَ نهائيّ) ويعيدها زرُّ الإنشاء كما كانت.
export async function disableTestUsers(): Promise<{ ok: boolean; count: number }> {
  const list = await getTestUsers();
  const subIds = list.map((e) => e.subscriberId).filter((x): x is number => typeof x === "number");
  const accIds = list.map((e) => e.accountId).filter((x): x is number => typeof x === "number");
  if (subIds.length) await prisma.subscriber.updateMany({ where: { id: { in: subIds } }, data: { isDeleted: true } });
  if (accIds.length) await prisma.appAccount.updateMany({ where: { id: { in: accIds } }, data: { isBanned: true } });
  return { ok: true, count: subIds.length + accIds.length };
}

export async function testUsersStatus(): Promise<{
  users: { user: string; name: string; state: string; officeName: string | null; rewardsOn: boolean | null; rewardBalance: number | null }[];
  offices: { id: number; name: string; agentName: string | null; rewardsOn: boolean }[];
}> {
  await ensureMarketTable();
  const list = await getTestUsers();
  const subIds = list.map((e) => e.subscriberId).filter((x): x is number => typeof x === "number");
  const subs = subIds.length
    ? await prisma.subscriber.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, dateTo: true, isDeleted: true, towerId: true, rewardBalance: true } })
    : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));
  // 🔑 مكتبُ الصفّ نفسِه وحالةُ مكافآته — فالزرُّ يقرأ هذا المكتبَ لا المكتبَ المتشابهَ اسمُه
  const subTowerIds = [...new Set(subs.map((s) => s.towerId).filter((t): t is number => t != null))];
  const subTowers = new Map(
    (subTowerIds.length
      ? await prisma.tower.findMany({ where: { id: { in: subTowerIds } }, select: { id: true, name: true, rewardsEnabled: true, agentId: true, isDeleted: true } })
      : []
    // 🗑️ والمكتبُ المحذوفُ يُوسَم: حسابٌ تجريبيٌّ زُرع يومَ كان حيّاً يبقى معلَّقاً به،
    //    فلا يظهر في المرشَّحين (isDeleted: false) ولا يُشعَل فيه شيءٌ — فيُلبِس التشخيص.
    ).map((t) => [t.id, { name: `${t.name ?? `مكتب ${t.id}`}${t.isDeleted ? " (محذوف)" : ""}`, agentId: t.agentId, rewardsOn: t.rewardsEnabled === "1" }]),
  );
  const subAgents = await agentNames([...subTowers.values()].map((t) => t.agentId));
  const accIds = list.map((e) => e.accountId).filter((x): x is number => typeof x === "number");
  const accs = accIds.length
    ? await prisma.appAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true, isBanned: true } })
    : [];
  const accMap = new Map(accs.map((a) => [a.id, a]));
  const users = list.map((e) => {
    if (e.subscriberId != null) {
      const s = subMap.get(e.subscriberId);
      if (!s) return { user: e.user, name: "—", state: "مفقود", officeName: null, rewardsOn: null, rewardBalance: null };
      const days = s.dateTo ? Math.round((new Date(s.dateTo).getTime() - Date.now()) / 86_400_000) : null;
      const state = s.isDeleted ? "موقوف" : days == null ? "بلا تاريخ" : days >= 0 ? `فعال (${days} يوما)` : `منتهٍ منذ ${-days} يوما`;
      const off = s.towerId != null ? subTowers.get(s.towerId) : undefined;
      return {
        user: e.user, name: s.name ?? "—", state,
        officeName: off ? `${off.name}${off.agentId != null && subAgents.get(off.agentId) ? ` — ${subAgents.get(off.agentId)}` : ""}` : null,
        rewardsOn: off?.rewardsOn ?? null, rewardBalance: s.rewardBalance ?? 0,
      };
    }
    const a = e.accountId != null ? accMap.get(e.accountId) : null;
    if (!a) return { user: e.user, name: "—", state: "مفقود", officeName: null, rewardsOn: null, rewardBalance: null };
    return { user: e.user, name: a.name, state: a.isBanned ? "موقوف" : "مسجل غير مشترك", officeName: null, rewardsOn: null, rewardBalance: null };
  });
  return { users, offices: await testOfficeCandidates() };
}
