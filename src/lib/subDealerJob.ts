import { prisma } from "@/lib/prisma";
import { credsOfPanel } from "@/lib/sasPanel";
import { sasBaseUrl, sasLogin, sasFetchAllUsers, sasFetchActivationsSince, type SasUser } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { findSuspects, type SasSub, type MatchCandidate } from "@/lib/subDealerMatch";

// ═════ 🕵️ محرّكُ فحص «سب-ديلر» المشترَك — يناديه الزرُّ اليدويُّ والكرون الليليّ ═════
// مصدرٌ واحدٌ لتسلسل الدخول/الجلب/المطابقة (كان محشوّاً في route.ts). لا يفحص الصلاحيّة —
// ذلك على المُستدعي — لكنّه يفرض عزلَ اللوحة (agentId) وحجبَ SSRF بنفسه دفاعاً في العمق.

const toSub = (u: SasUser, activatedAt: string | null): SasSub => ({
  sasId: u.sasId, username: u.username, name: u.name, phone: u.phone,
  expiration: u.expiration, days: u.days, enabled: u.enabled, packageName: u.packageName, activatedAt,
});

export type ScanErrCode = "creds" | "panel" | "ssrf" | "login-mine" | "login-uni" | "fetch";

export type ScanResult = {
  ok: boolean;
  code?: ScanErrCode;
  scanId?: number;
  from: Date; to: Date;
  counts: { mine: number; unified: number; inRange: number; suspects: number };
  candidates: MatchCandidate[];
};

const EMPTY = { mine: 0, unified: 0, inRange: 0, suspects: 0 };

export async function runSubDealerScan(opts: {
  agentId: number;
  panelId: number;
  uniUser: string;
  uniPass: string;
  from: Date;
  to: Date;
  threshold?: number;
  source: "manual" | "auto";
  persist?: boolean;
}): Promise<ScanResult> {
  const { agentId, panelId, uniUser, uniPass, from, to, source } = opts;
  const fail = (code: ScanErrCode): ScanResult => ({ ok: false, code, from, to, counts: EMPTY, candidates: [] });
  if (!uniUser || !uniPass) return fail("creds");

  // 🔒 عزل: اللوحةُ يجب أن تتبع الوكيلَ نفسَه
  const mine = await credsOfPanel(panelId);
  if (!mine || mine.agentId !== agentId) return fail("panel");
  if (await sasHostBlocked(mine.loginUrl)) return fail("ssrf");

  const base = sasBaseUrl(mine.loginUrl); // نفسُ خادم سوبر سيل للحسابَين
  let tokenMine: string, tokenUni: string;
  try { tokenMine = await sasLogin(base, mine.username, mine.password); } catch { return fail("login-mine"); }
  try { tokenUni = await sasLogin(base, uniUser, uniPass); } catch { return fail("login-uni"); }

  let mineUsers: SasUser[], uniUsers: SasUser[];
  try { [mineUsers, uniUsers] = await Promise.all([sasFetchAllUsers(base, tokenMine), sasFetchAllUsers(base, tokenUni)]); }
  catch { return fail("fetch"); }

  // تفعيلاتُ الموحّد ضمن المدى ⇒ username→أحدثُ تفعيلٍ في [from,to]
  const actMap = new Map<string, string>();
  try {
    const { rows } = await sasFetchActivationsSince(base, tokenUni, from);
    for (const a of rows) {
      if (!a.username || !a.createdAt) continue;
      const t = new Date(a.createdAt).getTime();
      if (isNaN(t) || t > to.getTime()) continue;
      const key = a.username.trim().toLowerCase();
      const prev = actMap.get(key);
      if (!prev || t > new Date(prev).getTime()) actMap.set(key, a.createdAt);
    }
  } catch { /* بلا تواريخ ⇒ لا مرشّحين (المدى شرط) */ }

  const mineSubs = mineUsers.map((u) => toSub(u, null));
  const uniInRange = uniUsers
    .map((u) => toSub(u, actMap.get((u.username ?? "").trim().toLowerCase()) ?? null))
    .filter((u) => u.activatedAt != null);

  const candidates = findSuspects(mineSubs, uniInRange, opts.threshold || 45);
  const counts = { mine: mineUsers.length, unified: uniUsers.length, inRange: uniInRange.length, suspects: candidates.length };

  let scanId: number | undefined;
  if (opts.persist) {
    const row = await prisma.subDealerScan.create({
      data: {
        agentId, panelId, source, rangeFrom: from, rangeTo: to,
        mineCount: counts.mine, unifiedCount: counts.unified, inRangeCount: counts.inRange, suspectCount: counts.suspects,
        suspects: JSON.stringify(candidates.slice(0, 500)),
      },
      select: { id: true },
    }).catch(() => null);
    scanId = row?.id ?? undefined;
  }

  return { ok: true, scanId, from, to, counts, candidates };
}
