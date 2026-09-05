import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";
import { encryptSecret } from "@/lib/secretbox";
// ملاحظة: التحقّقُ من الاعتماد يجري على **حاسبة المكتب** (العامل المحليّ /contracts-verify)
// لأنّ موقع العقود لا يُفتَح إلّا من إنترنت سوبر سيل — والخادمُ السحابيُّ لا يصله. فالحفظُ
// هنا تخزينٌ فقط (بعد أن تحقّق المستخدمُ محليّاً).

export const dynamic = "force-dynamic";

async function gate() {
  const g = await guard("manager.accounts");
  if (g.error) return { error: g.error };
  const agentId = g.session.agentId;
  if (agentId == null) return { error: NextResponse.json({ error: "لا وكيل" }, { status: 403 }) };
  return { agentId };
}

// مكاتبُ الوكيل + لوحاتُها + اعتماداتُ موقع العقود المحفوظة (لبناء نوافذ الإدخال)
export async function GET(request: Request) {
  const gr = await gate();
  if ("error" in gr) return gr.error;
  // استطلاعُ نتيجةِ مهمّةِ فحصٍ (مُرحَّلة عبر حاسبة المكتب)
  const taskId = Number(new URL(request.url).searchParams.get("taskId")) || 0;
  if (taskId) {
    const t = await prisma.contractsTask.findFirst({ where: { id: taskId, agentId: gr.agentId }, select: { status: true, resultCount: true, error: true } });
    if (!t) return NextResponse.json({ error: "غير موجودة" }, { status: 404 });
    return NextResponse.json({ status: t.status, count: t.resultCount, error: t.error });
  }
  const [towers, panels, accounts] = await Promise.all([
    prisma.tower.findMany({ where: { agentId: gr.agentId, isDeleted: false }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.sasPanel.findMany({ where: { isDeleted: false }, select: { id: true, towerId: true }, orderBy: { id: "asc" } }),
    prisma.contractsAccount.findMany({ where: { agentId: gr.agentId, isDeleted: false }, select: { id: true, towerId: true, sasPanelId: true, username: true, label: true }, orderBy: { id: "asc" } }),
  ]);
  const towerIds = new Set(towers.map((t) => t.id));
  const panelCount = new Map<number, number>();
  for (const p of panels) if (towerIds.has(p.towerId)) panelCount.set(p.towerId, (panelCount.get(p.towerId) ?? 0) + 1);
  return NextResponse.json({
    offices: towers.map((t) => ({
      towerId: t.id, name: t.name, panelCount: panelCount.get(t.id) ?? 0,
      accounts: accounts.filter((a) => a.towerId === t.id).map((a) => ({ id: a.id, sasPanelId: a.sasPanelId, username: a.username, label: a.label })),
    })),
    configured: accounts.length > 0,
  });
}

// POST: action = save (تخزينٌ بعد تحقّقٍ محليّ) | delete (فصل). التحقّقُ على حاسبة المكتب.
export async function POST(request: Request) {
  const gr = await gate();
  if ("error" in gr) return gr.error;
  const b = await request.json().catch(() => null);
  const action = String(b?.action ?? "");

  if (action === "delete") {
    const id = Number(b?.id) || 0;
    if (!id) return NextResponse.json({ error: "لا معرّف" }, { status: 400 });
    // عزل: الصفُّ يجب أن يتبع الوكيل
    const row = await prisma.contractsAccount.findFirst({ where: { id, agentId: gr.agentId, isDeleted: false }, select: { id: true } });
    if (!row) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    await prisma.contractsAccount.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json({ ok: true });
  }

  // تحقّقٌ مُرحَّل: يُنشئ مهمّةً تلتقطها حاسبةُ مكتبٍ متّصلةٌ للوكيل (تصل موقعَ العقود). الباسورد
  // مؤقّتٌ مشفَّرٌ يُمسَح فور التنفيذ. يعمل من الهاتف/بعيداً ما دامت حاسبةُ مكتبٍ واحدةٌ تعمل.
  if (action === "verify") {
    const username = typeof b?.username === "string" ? b.username.trim() : "";
    const password = typeof b?.password === "string" ? b.password : "";
    if (!username || !password) return NextResponse.json({ error: "أدخل اليوزر والباسورد" }, { status: 400 });
    const enc = encryptSecret(password);
    if (!enc) return NextResponse.json({ error: "تعذّر تشفيرُ الباسورد" }, { status: 500 });
    const towerId = Number(b?.towerId) || null;
    const task = await prisma.contractsTask.create({ data: { agentId: gr.agentId, kind: "verify", towerId, username, password: enc, status: "pending" }, select: { id: true } });
    return NextResponse.json({ ok: true, taskId: task.id });
  }

  if (action === "save") {
    const username = typeof b?.username === "string" ? b.username.trim() : "";
    const password = typeof b?.password === "string" ? b.password : "";
    if (!username || !password) return NextResponse.json({ error: "أدخل اليوزر والباسورد" }, { status: 400 });
    const id = Number(b?.id) || 0;
    const label = typeof b?.label === "string" && b.label.trim() ? b.label.trim() : null;
    const enc = encryptSecret(password);
    if (!enc) return NextResponse.json({ error: "تعذّر تشفيرُ الباسورد" }, { status: 500 });
    if (id) {
      // تعديلُ اعتمادٍ قائم — عزل: يتبع الوكيل
      const row = await prisma.contractsAccount.findFirst({ where: { id, agentId: gr.agentId, isDeleted: false }, select: { id: true } });
      if (!row) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
      await prisma.contractsAccount.update({ where: { id }, data: { username, password: enc, label } });
      return NextResponse.json({ ok: true });
    }
    const towerId = Number(b?.towerId) || 0;
    if (!towerId) return NextResponse.json({ error: "اختر المكتب" }, { status: 400 });
    // 🔒 عزل: المكتبُ يجب أن يتبع الوكيل
    const tw = await prisma.tower.findFirst({ where: { id: towerId, agentId: gr.agentId, isDeleted: false }, select: { id: true } });
    if (!tw) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });
    const sasPanelId = b?.sasPanelId != null && Number(b.sasPanelId) > 0 ? Number(b.sasPanelId) : null;
    await prisma.contractsAccount.create({ data: { agentId: gr.agentId, towerId, sasPanelId, username, password: enc, label } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "إجراءٌ غير معروف" }, { status: 400 });
}
