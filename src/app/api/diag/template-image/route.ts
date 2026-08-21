import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, agentTowerIds } from "@/lib/guard";

export const dynamic = "force-dynamic";

// ═════ 🔬 مسبارُ «الصورة مع الرسالة» — قراءةٌ محضة (بلاغُ محمد 2026-08-21) ═════
// «الصورةُ لا تصل للمشترك، الرسالةُ وحدَها تصل». وسلسلةُ الصورة أربعُ حلقاتٍ لا تُرى
// أيُّها انقطعت: (١) أمحفوظةٌ في القالب؟ (٢) أيرثها المكتبُ من الوكيل؟ (٣) أخرجت مع
// الإرسال؟ (٤) أنفّذتها حاسبةُ المكتب أم تجاهلتها لأنّ نسختَها أقدمُ من الميزة؟
// هذا المسارُ يقرأ الحلقاتِ الأربعَ في نداءٍ واحدٍ ولا يكتب شيئاً ولا يُرسل رسالة.
// 🔒 بصلاحيّة «إدارة القوالب» وبعزل الوكيل: قوالبُ وكيله ومكاتبُه حصراً.
export async function GET(req: Request) {
  const g = await guard("templates.manage");
  if (g.error) return g.error;
  const session = g.session!;
  const agentId = session.agentId ?? -1;
  const towers = await agentTowerIds(session);
  const sp = new URL(req.url).searchParams;
  const officeId = Number(sp.get("officeId")) || null;
  if (officeId && !towers.includes(officeId)) {
    return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
  }

  // ١+٢· القوالبُ وصورُها: قالبُ الوكيل (towerId=null) وقالبُ المكتب — والوراثةُ بينهما
  const rows = await prisma.smsTemplate.findMany({
    where: { agentId, ...(officeId ? { OR: [{ towerId: null }, { towerId: officeId }] } : {}) },
    select: { id: true, type: true, towerId: true, enable: true, image: true, text: true },
    orderBy: [{ type: "asc" }, { towerId: "asc" }],
  });
  const kb = (s: string | null) => (s ? Math.round((s.length * 3) / 4 / 1024) : 0);
  const templates = rows.map((r) => ({
    type: r.type,
    scope: r.towerId == null ? "الوكيل" : `مكتب #${r.towerId}`,
    enabled: r.enable !== "0",
    hasImage: !!r.image?.trim(),
    imageKb: kb(r.image),
    imageHead: r.image ? r.image.slice(0, 30) : null, // صيغةُ الـdata URI — تكشف صورةً معطوبة
    textLen: (r.text ?? "").length,
  }));

  // ٣· آخرُ الرسائل: هل خرجت بصورةٍ أم لا، وما السببُ المكتوب
  const messages = await prisma.message.findMany({
    where: { agentId, ...(officeId ? {} : {}) },
    orderBy: { id: "desc" },
    take: 15,
    select: { id: true, phone: true, status: true, error: true, date: true, createdByUser: true },
  });

  // ٤· حاسباتُ المكاتب: أيُّ نسخةٍ تشغّل، ومتى نبضت آخرَ مرّة
  const workers = await prisma.hybridWorker.findMany({
    where: { agentId, blocked: false },
    select: { machineId: true, name: true, displayName: true, towerId: true, lastSeen: true, approved: true, lastLog: true },
    orderBy: { lastSeen: "desc" },
    take: 10,
  });

  // ٤-أ· 🏷️ **إصدارُ كودِ كلّ حاسبة** — والعاملُ يكتبه بنفسه عند كلّ إقلاعٍ منذ 2026-07-29
  //      في `system_settings` بمفتاح `workerVer:{machineId}` = `{sha, at}`. فلا حاجةَ
  //      لإضافةٍ على العامل: نقرأ ما يكتبه أصلاً ونقارنه بإيداع السحابة.
  const vers = await prisma.systemSetting.findMany({
    where: { type: { in: workers.map((w) => `workerVer:${w.machineId}`) } },
    select: { type: true, text: true },
  });
  const verOf = new Map(vers.map((v) => [String(v.type).replace("workerVer:", ""), v.text]));

  // ٤-ب· بصمةُ النسخة من آخر نتيجةِ ترحيلِ إرسال (`build` غائبٌ ⇒ نسخةٌ أقدمُ من هذا البناء)
  const relays = await prisma.waRelay.findMany({
    where: { towerId: { in: towers.length ? towers : [-1] }, kind: "sendMsg" },
    orderBy: { id: "desc" },
    take: 10,
    select: { id: true, towerId: true, status: true, result: true, error: true, createdAt: true },
  });
  const relayInfo = relays.map((r) => {
    let build: string | null = null, withImage: boolean | null = null, gotImage: boolean | null = null, imageError: string | null = null;
    try {
      const j = r.result ? (JSON.parse(r.result) as Record<string, unknown>) : null;
      if (j) {
        build = typeof j.build === "string" ? j.build : null;
        withImage = typeof j.withImage === "boolean" ? j.withImage : null;
        gotImage = typeof j.gotImage === "boolean" ? j.gotImage : null;
        imageError = typeof j.imageError === "string" ? j.imageError : null;
      }
    } catch { /* نتيجةٌ غيرُ مقروءة */ }
    return {
      id: r.id, towerId: r.towerId, status: r.status, at: r.createdAt,
      build: build ?? "— (نسخةٌ لا تُبلّغ ببنائها ⇒ أقدمُ من إصلاح 2026-08-21)",
      وصلتها_صورة: gotImage, أُرسلت_بصورة: withImage, سببُ_السقوط: imageError ?? r.error ?? null,
    };
  });

  return NextResponse.json({
    agentId, officeId,
    cloudBuild: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    templates,
    workers: workers.map((w) => {
      let sha: string | null = null, bootAt: string | null = null;
      try {
        const v = verOf.get(w.machineId);
        const jj = v ? (JSON.parse(v) as { sha?: string; at?: string }) : null;
        sha = jj?.sha ?? null; bootAt = jj?.at ?? null;
      } catch { /* بصمةٌ غيرُ مقروءة */ }
      return {
        machineId: w.machineId, name: w.displayName ?? w.name, towerId: w.towerId,
        approved: w.approved, lastSeen: w.lastSeen,
        codeVersion: sha, bootedAt: bootAt,
        buildLine: (w.lastLog ?? "").split("\n").reverse().find((l) => l.includes("[build]")) ?? null,
      };
    }),
    relays: relayInfo,
    messages,
  });
}
