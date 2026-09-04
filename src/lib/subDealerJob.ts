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
  panelIds: number[]; // مكاتبُ الوكيل التي يغطّيها الموحّد — «طرفي» اتّحادُها
  uniUser: string;
  uniPass: string;
  from: Date;
  to: Date;
  threshold?: number;
  source: "manual" | "auto";
  persist?: boolean;
}): Promise<ScanResult> {
  const { agentId, uniUser, uniPass, from, to, source } = opts;
  const panelIds = [...new Set((opts.panelIds ?? []).filter((n) => Number.isFinite(n) && n > 0))];
  const fail = (code: ScanErrCode): ScanResult => ({ ok: false, code, from, to, counts: EMPTY, candidates: [] });
  if (!uniUser || !uniPass) return fail("creds");
  if (!panelIds.length) return fail("panel");

  // 🔒 عزل: لوحةٌ محذوفةٌ (credsOfPanel=null) **تُتجاوز** لا تُفشل الفحص (لئلّا يعلَق
  //    اختيارٌ قديمٌ بلا مخرج)؛ أمّا لوحةٌ **لوكيلٍ آخر** فخرقُ عزلٍ حقيقيٌّ ⇒ رفضٌ فوريّ.
  const panels = [];
  for (const pid of panelIds) {
    const p = await credsOfPanel(pid);
    if (!p) continue; // محذوفة/بلا اعتماد ⇒ تُتجاوز
    if (p.agentId !== agentId) return fail("panel"); // خرقُ عزل ⇒ رفض
    if (await sasHostBlocked(p.loginUrl)) return fail("ssrf");
    panels.push(p);
  }
  if (!panels.length) return fail("panel"); // لا لوحةَ حيّةٌ صالحة
  const base = sasBaseUrl(panels[0].loginUrl); // نفسُ خادم سوبر سيل للجميع (تأكيدُ محمد)

  // «طرفي» = اتّحادُ مشتركي كلّ لوحاتي (بإزالة تكرار اليوزر) — فمشتركو مكتبٍ آخرَ لي لا
  //   يظهرون كمشتبَهين. الموحّدُ يُجلَب مرّةً بحسابه.
  const mineMap = new Map<string, SasUser>();
  for (const p of panels) {
    const pbase = sasBaseUrl(p.loginUrl); // كلُّ لوحةٍ بحسابها على خادمها (نفسِه هنا)
    let token: string;
    try { token = await sasLogin(pbase, p.username, p.password); } catch { return fail("login-mine"); }
    let users: SasUser[];
    try { users = await sasFetchAllUsers(pbase, token); } catch { return fail("fetch"); }
    for (const u of users) { const k = (u.username ?? "").trim().toLowerCase(); if (k && !mineMap.has(k)) mineMap.set(k, u); }
  }
  let tokenUni: string;
  try { tokenUni = await sasLogin(base, uniUser, uniPass); } catch { return fail("login-uni"); }
  let uniUsers: SasUser[];
  try { uniUsers = await sasFetchAllUsers(base, tokenUni); } catch { return fail("fetch"); }
  const mineUsers = [...mineMap.values()];

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
        agentId, panelId: panelIds[0] ?? null, source, rangeFrom: from, rangeTo: to,
        mineCount: counts.mine, unifiedCount: counts.unified, inRangeCount: counts.inRange, suspectCount: counts.suspects,
        suspects: JSON.stringify(candidates.slice(0, 500)),
      },
      select: { id: true },
    }).catch(() => null);
    scanId = row?.id ?? undefined;
  }

  return { ok: true, scanId, from, to, counts, candidates };
}
