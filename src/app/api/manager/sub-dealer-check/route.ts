import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { encryptSecret, decryptSecret } from "@/lib/secretbox";
import { runSubDealerScan, type ScanErrCode } from "@/lib/subDealerJob";

export const dynamic = "force-dynamic";

// حارسٌ موحّد: صلاحيّةُ حسابات المدير + عَلَمُ «فحص سب-ديلر» على الوكيل (لا الواجهةُ وحدها)
async function gate() {
  const g = await guard("manager.accounts");
  if (g.error) return { error: g.error };
  const agentId = g.session.agentId;
  if (agentId == null) return { error: NextResponse.json({ error: "لا وكيل" }, { status: 403 }) };
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { subDealerCheck: true, subDealerSasUser: true, subDealerSasPass: true, subDealerPanelId: true } });
  if (!agent?.subDealerCheck) return { error: NextResponse.json({ error: "الميزة غير مفعّلة لحسابك" }, { status: 403 }) };
  return { agentId, agent };
}

// لوحاتُ ساس الوكيل (للاختيار) + حالةُ اعتماد الموحّد المحفوظ + آخرُ فحصٍ تلقائيّ محفوظ
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
  // آخرُ فحصٍ تلقائيٍّ (ليليّ) لعرضه في اللوحة
  const lastAutoRow = await prisma.subDealerScan.findFirst({
    where: { agentId: gr.agentId, source: "auto" },
    orderBy: { createdAt: "desc" },
    select: { id: true, panelId: true, rangeFrom: true, rangeTo: true, mineCount: true, unifiedCount: true, inRangeCount: true, suspectCount: true, suspects: true, createdAt: true },
  });
  const lastAuto = lastAutoRow
    ? {
        id: lastAutoRow.id, panelId: lastAutoRow.panelId,
        from: lastAutoRow.rangeFrom.toISOString(), to: lastAutoRow.rangeTo.toISOString(),
        counts: { mine: lastAutoRow.mineCount, unified: lastAutoRow.unifiedCount, inRange: lastAutoRow.inRangeCount, suspects: lastAutoRow.suspectCount },
        candidates: safeParse(lastAutoRow.suspects),
        at: lastAutoRow.createdAt.toISOString(),
      }
    : null;
  return NextResponse.json({
    panels: panels.map((p) => ({ id: p.id, label: p.label ?? towerName.get(p.towerId) ?? `#${p.id}`, username: p.username })),
    savedUnifiedUser: gr.agent.subDealerSasUser ?? null,
    savedPanelId: gr.agent.subDealerPanelId ?? null,
    lastAuto,
  });
}

function safeParse(s: string | null): unknown[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// خريطةُ رمزِ الخطأ ← رمزُ HTTP ورسالةٌ عربيّة
const ERRS: Record<ScanErrCode, { status: number; msg: string }> = {
  creds: { status: 400, msg: "أدخل اعتمادَ الساس الموحّد" },
  panel: { status: 403, msg: "اللوحة لا تتبع حسابك" },
  ssrf: { status: 400, msg: "خادمُ الساس غير مسموح" },
  "login-mine": { status: 502, msg: "تعذّر الدخول لساسك (تحقّق من اللوحة)" },
  "login-uni": { status: 502, msg: "تعذّر الدخول للساس الموحّد (تحقّق من اليوزر/الباسورد)" },
  fetch: { status: 502, msg: "تعذّر جلبُ المشتركين من الساس" },
};

// الفحص اليدويّ: يدخل ساسي (لوحةٌ محفوظة) + الساس الموحّد (اعتمادٌ يدويّ/محفوظ) ⇒ قائمةُ المشتبَهين + حفظُ الفحص.
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

  const nowMs = Date.now();
  const from = b?.from ? new Date(b.from) : new Date(nowMs - 90 * 24 * 60 * 60 * 1000); // افتراضُ ٣ أشهر
  const to = b?.to ? new Date(b.to) : new Date(nowMs);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return NextResponse.json({ error: "تاريخٌ غير صالح" }, { status: 400 });

  const res = await runSubDealerScan({
    agentId: gr.agentId, panelId: myPanelId, uniUser, uniPass, from, to,
    threshold: Number(b?.threshold) || 45, source: "manual", persist: true,
  });
  if (!res.ok) { const e = ERRS[res.code ?? "fetch"]; return NextResponse.json({ error: e.msg }, { status: e.status }); }

  // حفظُ الاعتماد + اللوحة (مشفَّراً) للفحص التلقائيّ ولاحقاً — عند طلب الحفظ فقط
  if (save) {
    const data: { subDealerPanelId: number; subDealerSasUser?: string; subDealerSasPass?: string } = { subDealerPanelId: myPanelId };
    if (typeof b?.unifiedUser === "string" && b.unifiedUser.trim() && typeof b?.unifiedPass === "string" && b.unifiedPass.trim()) {
      data.subDealerSasUser = uniUser;
      data.subDealerSasPass = encryptSecret(uniPass) ?? undefined;
    }
    await prisma.agent.update({ where: { id: gr.agentId }, data }).catch(() => {});
  }

  return NextResponse.json({
    counts: res.counts, from: res.from.toISOString(), to: res.to.toISOString(),
    candidates: res.candidates.slice(0, 500),
  });
}
