import { prisma } from "@/lib/prisma";
import { sasBaseUrl, sasLogin, sasFetchUserOnline } from "@/lib/sas4";

// 🔌 «متّصلٌ الآن؟» لمشترك — من لوحة الساس التي يتبعها مكتبُه (طلبُ محمد 2026-10-26:
// «متصل إن كان فعّالاً أونلاين · غير متصل إن كان فعّالاً وليس أونلاين»).
// 🔑 كاشَان لأنّ هذا يُسأل عند كلّ فتحةِ تطبيق: توكنُ اللوحة (دقائق) ونتيجةُ اليوزر
//    (دقيقة). بلا ذلك يُسجَّل دخولٌ إلى الساس مع كلّ طلب — بطءٌ وضغطٌ بلا طائل.
// وnull تعني **لم نتحقّق** (لوحةٌ متعذّرةٌ أو بحثٌ غيرُ حاسم) لا «غيرُ متّصل».

type Cached<T> = { v: T; exp: number };
const tokenCache = new Map<number, Cached<{ base: string; token: string }>>();
const onlineCache = new Map<string, Cached<boolean | null>>();
const TOKEN_TTL = 8 * 60_000;
const ONLINE_TTL = 60_000;

async function towerSession(towerId: number): Promise<{ base: string; token: string } | null> {
  const hit = tokenCache.get(towerId);
  if (hit && hit.exp > Date.now()) return hit.v;
  // اللوحةُ الأساسيّةُ للمكتب إن وُجدت، وإلّا بياناتُ المكتب نفسِه (نفسُ ترتيب cardSasCheck)
  const panel = await prisma.sasPanel.findFirst({
    where: { towerId, isDeleted: false },
    select: { loginUrl: true, username: true, password: true },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  const tower = panel ?? (await prisma.tower.findUnique({
    where: { id: towerId },
    select: { loginUrl: true, username: true, password: true },
  }));
  if (!tower?.loginUrl || !tower.username || !tower.password) return null;
  try {
    const base = sasBaseUrl(tower.loginUrl);
    const token = await sasLogin(base, tower.username, tower.password);
    const v = { base, token };
    tokenCache.set(towerId, { v, exp: Date.now() + TOKEN_TTL });
    return v;
  } catch {
    return null; // لوحةٌ متعذّرة — لا نجزم بشيء
  }
}

export async function subscriberOnline(subscriberId: number): Promise<boolean | null> {
  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { netUser: true, towerId: true },
  });
  const user = (sub?.netUser ?? "").trim();
  if (!user || sub?.towerId == null) return null;

  const key = `${sub.towerId}:${user.toLowerCase()}`;
  const hit = onlineCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;

  const s = await towerSession(sub.towerId);
  if (!s) return null;
  let v: boolean | null = null;
  try {
    v = await sasFetchUserOnline(s.base, s.token, user);
  } catch {
    v = null;
  }
  onlineCache.set(key, { v, exp: Date.now() + ONLINE_TTL });
  return v;
}
