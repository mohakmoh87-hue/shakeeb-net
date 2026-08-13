import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownsTower } from "@/lib/guard";
import { canAddPanel, multiSasQuota, panelsOfTower } from "@/lib/sasPanel";
import { encryptSecret } from "@/lib/secretbox";

export const dynamic = "force-dynamic";

// ===== أ-٢٣ · لوحاتُ الساس/أودو لمكتب — للمدير والمستخدم (كلٌّ لمكتبه) عبر ownsTower =====
// المبدأ: «المكتب» وحدةُ عمل و«لوحةُ الساس» نقطةُ بنيةٍ تحتيّة. ومكتبٌ بلوحتَين يبقى **مكتباً
// واحداً**: مشتركوه وماله ومخزنُه وفنيّوه وتقريرُه وواتسابُه ووصلُه واحد — واللوحةُ تحدّد
// **مُخدِّمَ الساس/أودو** الذي يُفعَّل عليه كلُّ مشترك.

const panelSchema = z.object({
  label: z.string().trim().max(60).optional(),
  loginUrl: z.string().trim().max(300).optional(),
  username: z.string().trim().max(120).optional(),
  password: z.string().max(200).optional(),
  activationTemplate: z.string().trim().max(500).optional(),
  odooEnabled: z.enum(["0", "1"]).optional(),
  odooUrl: z.string().trim().max(300).optional(),
  odooUser: z.string().trim().max(120).optional(),
  odooPass: z.string().max(200).optional(),
  // القروضُ تتبع اللوحة (طلبُ محمد): حسابُ الديلر على سوبر سيل
  loanUser: z.string().max(200).optional(),
  loanPass: z.string().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).max(99).optional(),
});

async function ownedTower(id: string) {
  const towerId = Number(id);
  if (!Number.isInteger(towerId)) return { error: NextResponse.json({ error: "مكتب غير صحيح" }, { status: 400 }) };
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "غير مصرّح" }, { status: 401 }) };
  // 🔒 العزل: لا يُقبل إلّا مكتبٌ يملكه هذا المستخدم (وكيلاً ومكتباً) — كنمط مسار أودو
  if (!(await ownsTower(session, towerId))) {
    return { error: NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 }) };
  }
  const tower = await prisma.tower.findFirst({ where: { id: towerId, isDeleted: false }, select: { id: true, agentId: true, name: true } });
  if (!tower) return { error: NextResponse.json({ error: "المكتب غير موجود" }, { status: 404 }) };
  return { session, tower };
}

// عرض: لوحاتُ المكتب + حصّةُ الوكيل (فتعرف الواجهةُ هل تُظهر زرَّ الإضافة أصلاً)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await ownedTower(id);
  if ("error" in r) return r.error;
  const panels = await panelsOfTower(r.tower.id);
  const quota = await multiSasQuota(r.tower.agentId);
  return NextResponse.json({
    // ⚠️ كلماتُ المرور **لا تُرسَل** إلى الواجهة أبداً — يُرسَل وجودُها فقط.
    panels: panels.map((p) => ({
      id: p.id, label: p.label, loginUrl: p.loginUrl, username: p.username,
      hasPassword: !!p.password, activationTemplate: p.activationTemplate,
      odooEnabled: p.odooEnabled, odooUrl: p.odooUrl, odooUser: p.odooUser, hasOdooPass: !!p.odooPass,
      // كلمةُ المرور **لا تُعاد أبداً** — تُعرَض علامةُ وجودٍ فقط (كنمط `hasPassword`)
      loanUser: p.loanUser, hasLoanPass: !!p.loanPass,
    })),
    quota,
    // عددُ مشتركي كلّ لوحة — يُظهره الحذفُ ويُحمى به
    counts: Object.fromEntries(
      await Promise.all(panels.map(async (p) => [p.id, await prisma.subscriber.count({ where: { sasPanelId: p.id, isDeleted: false } })])),
    ),
  });
}

// إضافةُ لوحة — 🔒 محكومةٌ بحصّة المالك، **والفحصُ هنا لا في الواجهة**
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await ownedTower(id);
  if ("error" in r) return r.error;
  const parsed = panelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });

  const gate = await canAddPanel(r.tower.id);
  if (!gate.ok) return NextResponse.json({ error: gate.reason ?? "غير مسموح" }, { status: 403 });

  const d = parsed.data;
  if (!d.loginUrl || !d.username || !d.password) {
    return NextResponse.json({ error: "رابطُ الساس واسمُ المستخدم وكلمةُ المرور مطلوبةٌ للوحة" }, { status: 400 });
  }
  // 🔴 قبل إضافة اللوحة الثانية: **يُوسَم مشتركو المكتب الحاليّون بلوحته الأولى صراحةً.**
  // فبلا وسمٍ يعملون بالسقوط إلى «أوّل لوحة» — وهو صحيحٌ اليوم، لكنّ تغييرَ الترتيب أو حذفَ
  // الأولى يُسقطهم إلى اللوحة الجديدة ⇒ **تفعيلٌ على مُخدِّمٍ خطأ بلا أن يُنبَّه أحد**.
  // فالوسمُ يجعل الصحّةَ بنيويّةً لا معتمدةً على ترتيب. (وهي عينُ الثغرة التي أُغلقت لصميم.)
  const primary = await prisma.sasPanel.findFirst({
    where: { towerId: r.tower.id, isDeleted: false },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const created = await prisma.$transaction(async (tx) => {
    if (primary) {
      const stamped = await tx.subscriber.updateMany({
        where: { towerId: r.tower.id, sasPanelId: null },
        data: { sasPanelId: primary.id },
      });
      if (stamped.count) console.log(`[panels] وُسم ${stamped.count} مشتركاً باللوحة الأولى #${primary.id} قبل إضافة الثانية`);
    }
    return tx.sasPanel.create({
      data: {
        towerId: r.tower.id, agentId: r.tower.agentId,
        label: d.label || `${r.tower.name ?? "المكتب"} ٢`,
        sortOrder: d.sortOrder ?? 1, isPrimary: false,
        loginUrl: d.loginUrl, username: d.username, password: d.password,
        activationTemplate: d.activationTemplate ?? null,
        odooEnabled: d.odooEnabled ?? "0", odooUrl: d.odooUrl || "https://odoo.supercell.iq",
        odooUser: d.odooUser ?? null, odooPass: d.odooPass ?? null,
        loanUser: d.loanUser ?? null,
        // مشفَّرةٌ كما في `Tower.loanPass` — فهي بيانُ دخولٍ لنظامٍ ماليٍّ خارجيّ
        loanPass: d.loanPass ? encryptSecret(d.loanPass) : null,
      },
      select: { id: true, label: true },
    });
  });
  await prisma.auditLog.create({
    data: {
      userId: r.session.userId, action: "SAS_PANEL_CREATE", entity: "sasPanel", entityId: String(created.id),
      details: `لوحةُ ساس جديدة «${created.label}» لمكتب ${r.tower.name ?? r.tower.id}`,
    },
  }).catch(() => {});
  return NextResponse.json({ ok: true, panelId: created.id }, { status: 201 });
}

// تعديلُ لوحة — الحقولُ الفارغةُ لا تُمسح (كلمةُ المرور تُحدَّث فقط إن أُرسلت غيرَ فارغة)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await ownedTower(id);
  if ("error" in r) return r.error;
  const url = new URL(request.url);
  const panelId = Number(url.searchParams.get("panelId"));
  if (!Number.isInteger(panelId)) return NextResponse.json({ error: "لوحة غير صحيحة" }, { status: 400 });
  // 🔒 اللوحةُ يجب أن تتبع هذا المكتب — وإلّا صار تعديلُ لوحةِ مكتبٍ آخرَ ممكناً بتمرير معرّف
  const panel = await prisma.sasPanel.findFirst({ where: { id: panelId, towerId: r.tower.id, isDeleted: false }, select: { id: true, isPrimary: true } });
  if (!panel) return NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 });

  const parsed = panelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.label != null) data.label = d.label;
  if (d.loginUrl != null) data.loginUrl = d.loginUrl;
  if (d.username != null) data.username = d.username;
  if (d.password) data.password = d.password; // فارغةٌ = أبقِ القديمة
  if (d.activationTemplate != null) data.activationTemplate = d.activationTemplate;
  if (d.odooEnabled != null) data.odooEnabled = d.odooEnabled;
  if (d.odooUrl != null) data.odooUrl = d.odooUrl;
  if (d.odooUser != null) data.odooUser = d.odooUser;
  if (d.odooPass) data.odooPass = d.odooPass; // فارغةٌ = أبقِ القديمة
  if (d.loanUser !== undefined) data.loanUser = d.loanUser || null;
  if (d.loanPass) data.loanPass = encryptSecret(d.loanPass); // فارغةٌ = أبقِ القديمة
  if (d.sortOrder != null) data.sortOrder = d.sortOrder;
  if (!Object.keys(data).length) return NextResponse.json({ error: "لا تغيير" }, { status: 400 });
  await prisma.sasPanel.update({ where: { id: panelId }, data });

  // ═════ والجهةُ المقابلة: تعديلُ **اللوحة الأولى** يُحدِّث أعمدةَ المكتب معها ═════
  // فالمزامنةُ في جهةٍ واحدةٍ لا تكفي: تعديلُ المكتب يُصلح اللوحة، ثمّ تعديلُ اللوحة يُعيد
  // التباعد. وأعمدةُ المكتب هي **مرجعُ من لا لوحةَ له** (مشتركٌ بلا `sasPanelId`) — فبقاؤها
  // قديمةً يعني تفعيلَ أوّلِ مشتركٍ جديدٍ على مُخدِّمٍ خطأ.
  // ⚠️ واللوحاتُ غيرُ الأولى **لا تُنسَخ إلى المكتب أبداً**: هي مُخدِّماتٌ مستقلّةٌ برابطها،
  // ونسخُها يُفسِد مرجعَ المكتب بلوحةٍ ليست لوحتَه.
  if (panel.isPrimary) {
    const back: Record<string, string> = {};
    if (d.loginUrl != null) back.loginUrl = d.loginUrl;
    if (d.username != null) back.username = d.username;
    if (d.activationTemplate != null) back.activationTemplate = d.activationTemplate;
    if (d.password) back.password = d.password; // الفارغةُ تُبقي القديمة هنا أيضاً
    // وأودو كذلك: مزامنةُ أودو تقرأ **أعمدةَ المكتب** للّوحة الأولى، فلو عُدِّلت من محرِّر
    // اللوحات وحدَه لبقيت المزامنةُ على القديم — وهو «يُكتَب ولا يُقرَأ» بعينه.
    if (d.odooEnabled != null) back.odooEnabled = d.odooEnabled;
    if (d.odooUrl != null) back.odooUrl = d.odooUrl;
    if (d.odooUser != null) back.odooUser = d.odooUser;
    if (d.odooPass) back.odooPass = d.odooPass; // الفارغةُ تُبقي القديمة
    if (Object.keys(back).length) {
      await prisma.tower.update({ where: { id: r.tower.id }, data: back }).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true });
}

// حذفُ لوحة (ناعم) — 🔴 **يُرفض إن كان لها مشتركون**
// وإلّا سقط مشتركوها إلى بيانات ساس المكتب ⇒ **تفعيلٌ على مُخدِّمٍ خطأ** بلا أن يُنبَّه أحد.
// وشرطُ محمد الحاكم: **لا يضيع شيءٌ من الموجود**. فيُنقل مشتركوها إلى لوحةٍ أخرى أوّلاً.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await ownedTower(id);
  if ("error" in r) return r.error;
  const url = new URL(request.url);
  const panelId = Number(url.searchParams.get("panelId"));
  const panel = await prisma.sasPanel.findFirst({
    where: { id: panelId, towerId: r.tower.id, isDeleted: false },
    select: { id: true, label: true, isPrimary: true },
  });
  if (!panel) return NextResponse.json({ error: "اللوحة لا تتبع هذا المكتب" }, { status: 403 });
  if (panel.isPrimary) return NextResponse.json({ error: "اللوحةُ الأولى لا تُحذف — هي لوحةُ المكتب نفسِه" }, { status: 400 });
  const used = await prisma.subscriber.count({ where: { sasPanelId: panelId, isDeleted: false } });
  if (used > 0) {
    return NextResponse.json({
      error: `لا يمكن حذفُ «${panel.label}»: ${used} مشتركاً مربوطون بها. انقلهم إلى لوحةٍ أخرى أوّلاً — وإلّا فُعِّلوا على مُخدِّمٍ خطأ.`,
    }, { status: 400 });
  }
  await prisma.sasPanel.update({ where: { id: panelId }, data: { isDeleted: true } });
  await prisma.auditLog.create({
    data: {
      userId: r.session.userId, action: "SAS_PANEL_DELETE", entity: "sasPanel", entityId: String(panelId),
      details: `حذفُ لوحة «${panel.label}» من مكتب ${r.tower.name ?? r.tower.id} (بلا مشتركين)`,
    },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
