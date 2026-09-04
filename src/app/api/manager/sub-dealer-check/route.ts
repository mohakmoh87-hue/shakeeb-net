import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { credsOfPanel } from "@/lib/sasPanel";
import { sasBaseUrl, sasLogin, sasFetchAllUsers, sasFetchActivationsSince, type SasUser } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";
import { findSuspects, type SasSub } from "@/lib/subDealerMatch";

export const dynamic = "force-dynamic";

// حارسٌ موحّد: صلاحيّةُ حسابات المدير + عَلَمُ «فحص سب-ديلر» على الوكيل (لا الواجهةُ وحدها)
async function gate() {
  const g = await guard("manager.accounts");
  if (g.error) return { error: g.error };
  const agentId = g.session.agentId;
  if (agentId == null) return { error: NextResponse.json({ error: "لا وكيل" }, { status: 403 }) };
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { subDealerCheck: true, subDealerSasUser: true, subDealerSasPass: true } });
  if (!agent?.subDealerCheck) return { error: NextResponse.json({ error: "الميزة غير مفعّلة لحسابك" }, { status: 403 }) };
  return { agentId, agent };
}

// لوحاتُ ساس الوكيل (للاختيار) + حالةُ اعتماد الموحّد المحفوظ
export async function GET() {
  const gr = await gate();
  if ("error" in gr) return gr.error;
  const towers = await prisma.tower.findMany({ where: { agentId: gr.agentId, isDeleted: false }, select: { id: true, name: true } });
  const towerName = new Map(towers.map((t) => [t.id, t.name] as const));
  const panels = await prisma.sasPanel.findMany({
    where: { isDeleted: false, towerId: { in: towers.length ? towers.map((t) => t.id) : [-1] } },
    select: { id: true, label: true, username: true, towerId: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({
    panels: panels.map((p) => ({ id: p.id, label: p.label ?? towerName.get(p.towerId) ?? `#${p.id}`, username: p.username })),
    savedUnifiedUser: gr.agent.subDealerSasUser ?? null,
  });
}

const toSub = (u: SasUser, activatedAt: string | null): SasSub => ({
  sasId: u.sasId, username: u.username, name: u.name, phone: u.phone,
  expiration: u.expiration, days: u.days, enabled: u.enabled, packageName: u.packageName, activatedAt,
});

// الفحص: يدخل ساسي (لوحةٌ محفوظة) + الساس الموحّد (اعتمادٌ يدويّ/محفوظ) ⇒ قائمةُ المشتبَهين.
export async function POST(request: Request) {
  const gr = await gate();
  if ("error" in gr) return gr.error;
  const b = await request.json().catch(() => null);
  const myPanelId = Number(b?.myPanelId) || 0;
  const uniUser = typeof b?.unifiedUser === "string" && b.unifiedUser.trim() ? b.unifiedUser.trim() : (gr.agent.subDealerSasUser ?? "");
  const uniPass = typeof b?.unifiedPass === "string" && b.unifiedPass.trim() ? b.unifiedPass.trim() : (decryptSecret(gr.agent.subDealerSasPass) ?? "");
  const save = b?.save === true;
  if (!myPanelId) return NextResponse.json({ error: "اختر لوحةَ ساسك" }, { status: 400 });
  if (!uniUser || !uniPass) return NextResponse.json({ error: "أدخل اعتمادَ الساس الموحّد" }, { status: 400 });

  // 🔒 عزل: اللوحةُ يجب أن تتبع وكيلَ الجلسة
  const mine = await credsOfPanel(myPanelId);
  if (!mine || mine.agentId !== gr.agentId) return NextResponse.json({ error: "اللوحة لا تتبع حسابك" }, { status: 403 });
  if (await sasHostBlocked(mine.loginUrl)) return NextResponse.json({ error: "خادمُ الساس غير مسموح" }, { status: 400 });

  const nowMs = Date.now();
  const from = b?.from ? new Date(b.from) : new Date(nowMs - 90 * 24 * 60 * 60 * 1000); // افتراضُ ٣ أشهر
  const to = b?.to ? new Date(b.to) : new Date(nowMs);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return NextResponse.json({ error: "تاريخٌ غير صالح" }, { status: 400 });

  const base = sasBaseUrl(mine.loginUrl); // نفسُ خادم سوبر سيل للحسابَين (تأكيدُ محمد)
  let tokenMine: string, tokenUni: string;
  try { tokenMine = await sasLogin(base, mine.username, mine.password); }
  catch { return NextResponse.json({ error: "تعذّر الدخول لساسك (تحقّق من اللوحة)" }, { status: 502 }); }
  try { tokenUni = await sasLogin(base, uniUser, uniPass); }
  catch { return NextResponse.json({ error: "تعذّر الدخول للساس الموحّد (تحقّق من اليوزر/الباسورد)" }, { status: 502 }); }

  let mineUsers: SasUser[], uniUsers: SasUser[];
  try {
    [mineUsers, uniUsers] = await Promise.all([sasFetchAllUsers(base, tokenMine), sasFetchAllUsers(base, tokenUni)]);
  } catch { return NextResponse.json({ error: "تعذّر جلبُ المشتركين من الساس" }, { status: 502 }); }

  // تفعيلاتُ الموحّد ضمن المدى ⇒ خريطةُ username→تاريخ تفعيلٍ (أحدثُ تفعيلٍ في المدى)
  const actMap = new Map<string, string>();
  try {
    const { rows } = await sasFetchActivationsSince(base, tokenUni, from);
    for (const a of rows) {
      if (!a.username || !a.createdAt) continue;
      const t = new Date(a.createdAt).getTime();
      if (isNaN(t) || t > to.getTime()) continue; // خارج المدى الأعلى
      const key = a.username.trim().toLowerCase();
      const prev = actMap.get(key);
      if (!prev || t > new Date(prev).getTime()) actMap.set(key, a.createdAt);
    }
  } catch { /* بلا تواريخ ⇒ لا مرشّحين (المدى شرط) */ }

  const mineSubs = mineUsers.map((u) => toSub(u, null));
  // الموحّد: نُبقي المفعَّلين في المدى فقط (لهم تفعيلٌ ضمن [from,to])
  const uniInRange = uniUsers
    .map((u) => toSub(u, actMap.get((u.username ?? "").trim().toLowerCase()) ?? null))
    .filter((u) => u.activatedAt != null);

  const candidates = findSuspects(mineSubs, uniInRange, Number(b?.threshold) || 45);

  if (save && b?.unifiedUser && b?.unifiedPass) {
    await prisma.agent.update({ where: { id: gr.agentId }, data: { subDealerSasUser: uniUser, subDealerSasPass: encryptSecret(uniPass) } }).catch(() => {});
  }

  return NextResponse.json({
    counts: { mine: mineUsers.length, unified: uniUsers.length, inRange: uniInRange.length, suspects: candidates.length },
    from: from.toISOString(), to: to.toISOString(),
    candidates: candidates.slice(0, 500),
  });
}
