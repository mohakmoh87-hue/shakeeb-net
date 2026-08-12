import { prisma } from "@/lib/prisma";

// ===== أ-٢٣ · مُحلِّلُ لوحات الساس/أودو (طلب محمد 2026-08-12) =====
// المبدأ: **«المكتب» وحدةُ عمل، و«لوحةُ الساس» نقطةُ بنيةٍ تحتيّة.** كان البرنامجُ يخلطهما ١:١
// في أعمدة `Tower`، وحاجةُ محمد ١:عدّة — وكيلٌ يدير مكتبَين بواتساب واحدٍ وحاسبةٍ واحدةٍ
// ومستخدمٍ واحد، **ولكلّ مكتبٍ رابطُ ساسٍ ورابطُ أودو مختلفان**.
//
// 🔑 والقاعدةُ الحاكمةُ لكلّ دالّةٍ هنا: **السقوطُ إلى أعمدة المكتب هو السلوكُ القديم بالضبط.**
// فما لم تكن للمكتب لوحاتٌ (أو للمشترك لوحة) فالنتيجةُ حرفيّاً ما كان الكودُ يقرؤه قبل البند
// ⇒ إدخالُ هذا المُحلِّل **لا يُغيّر شيئاً لأيّ وكيل**، ويُفتح البابُ للوحة الثانية بإذن المالك.

export type SasCreds = {
  panelId: number | null; // null = من أعمدة المكتب (السلوك القديم)
  towerId: number;
  agentId: number | null;
  label: string | null;
  loginUrl: string;
  username: string;
  password: string;
  activationTemplate: string | null;
};

export type OdooCreds = {
  panelId: number | null;
  towerId: number;
  enabled: boolean;
  url: string;
  user: string | null;
  pass: string | null;
  uid: number | null;
};

const TOWER_SEL = {
  id: true, agentId: true, name: true,
  loginUrl: true, username: true, password: true, activationTemplate: true,
  odooEnabled: true, odooUrl: true, odooUser: true, odooPass: true, odooUid: true,
} as const;

const PANEL_SEL = {
  id: true, towerId: true, agentId: true, label: true,
  loginUrl: true, username: true, password: true, activationTemplate: true,
  odooEnabled: true, odooUrl: true, odooUser: true, odooPass: true, odooUid: true,
} as const;

function credsFromPanel(p: {
  id: number; towerId: number; agentId: number | null; label: string | null;
  loginUrl: string | null; username: string | null; password: string | null; activationTemplate: string | null;
}): SasCreds | null {
  if (!p.loginUrl || !p.username || !p.password) return null;
  return {
    panelId: p.id, towerId: p.towerId, agentId: p.agentId, label: p.label,
    loginUrl: p.loginUrl, username: p.username, password: p.password,
    activationTemplate: p.activationTemplate,
  };
}

/** كلُّ لوحات المكتب الحيّة مرتَّبةً (الأولى أوّلاً). فارغةٌ = لا لوحاتِ بعد ⇒ استعمِل أعمدة المكتب. */
export async function panelsOfTower(towerId: number) {
  return prisma.sasPanel.findMany({
    where: { towerId, isDeleted: false },
    select: PANEL_SEL,
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
}

/** بيانات ساس لوحةٍ بعينها. */
export async function credsOfPanel(panelId: number): Promise<SasCreds | null> {
  const p = await prisma.sasPanel.findFirst({ where: { id: panelId, isDeleted: false }, select: PANEL_SEL });
  return p ? credsFromPanel(p) : null;
}

/**
 * بيانات ساس المكتب — **لوحتُه الأولى**، وإن لم تكن له لوحاتٌ فأعمدتُه (السلوكُ القديم).
 * تُستعمل في كلّ مسارٍ يعمل على «المكتب» بلا لوحةٍ محدَّدة.
 */
export async function credsOfTower(towerId: number): Promise<SasCreds | null> {
  const panels = await panelsOfTower(towerId);
  for (const p of panels) { const c = credsFromPanel(p); if (c) return c; }
  const t = await prisma.tower.findUnique({ where: { id: towerId }, select: TOWER_SEL });
  if (!t?.loginUrl || !t.username || !t.password) return null;
  return {
    panelId: null, towerId: t.id, agentId: t.agentId, label: t.name,
    loginUrl: t.loginUrl, username: t.username, password: t.password,
    activationTemplate: t.activationTemplate,
  };
}

/**
 * بيانات ساس **المشترك** — لوحتُه إن كان موسوماً بها، وإلّا لوحةُ مكتبه الأولى، وإلّا أعمدةُ مكتبه.
 * 🔴 هذه هي الدالّةُ الصحيحة في مسارات التفعيل والاستبدال وحالة الساس: طلبُ محمد حرفيّاً
 * «عند تفعيل مشتركٍ تابعٍ لمكتبٍ واحدٍ يكون دخولُ الساس على مكتبٍ واحد، وإن كان اثنين فيدخل
 * على اثنَين» — أي أنّ **المشترك** هو ما يُحدّد اللوحة لا المكتب.
 */
export async function credsOfSubscriber(subscriberId: number): Promise<SasCreds | null> {
  const s = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { id: true, towerId: true, sasPanelId: true },
  });
  if (!s?.towerId) return null;
  if (s.sasPanelId != null) {
    const c = await credsOfPanel(s.sasPanelId);
    // لوحةٌ محذوفةٌ أو ناقصةُ البيانات ⇒ لا نُفعّل على لوحةٍ خطأً صامتاً، بل نسقط إلى المكتب
    if (c) return c;
  }
  return credsOfTower(s.towerId);
}

/** أودو لوحةٍ بعينها. */
export async function odooOfPanel(panelId: number): Promise<OdooCreds | null> {
  const p = await prisma.sasPanel.findFirst({ where: { id: panelId, isDeleted: false }, select: PANEL_SEL });
  if (!p) return null;
  return {
    panelId: p.id, towerId: p.towerId, enabled: p.odooEnabled === "1",
    url: p.odooUrl ?? "https://odoo.supercell.iq", user: p.odooUser, pass: p.odooPass, uid: p.odooUid,
  };
}

/** أودو المكتب — لوحتُه الأولى، وإلّا أعمدتُه (السلوكُ القديم). */
export async function odooOfTower(towerId: number): Promise<OdooCreds | null> {
  const panels = await panelsOfTower(towerId);
  const p = panels.find((x) => x.odooUser && x.odooPass) ?? panels[0];
  if (p) {
    return {
      panelId: p.id, towerId: p.towerId, enabled: p.odooEnabled === "1",
      url: p.odooUrl ?? "https://odoo.supercell.iq", user: p.odooUser, pass: p.odooPass, uid: p.odooUid,
    };
  }
  const t = await prisma.tower.findUnique({ where: { id: towerId }, select: TOWER_SEL });
  if (!t) return null;
  return {
    panelId: null, towerId: t.id, enabled: t.odooEnabled === "1",
    url: t.odooUrl ?? "https://odoo.supercell.iq", user: t.odooUser, pass: t.odooPass, uid: t.odooUid,
  };
}

/**
 * هل يُسمح لهذا الوكيل بلوحةٍ ثانية؟ — **إذنُ مالك النظام** (`Agent.multiSasAllowed`).
 * وبلا الإذن لا يظهر الخيارُ إطلاقاً في الواجهة، ويُرفض الإنشاءُ في المسار (لا في الواجهة وحدها).
 */
export async function multiSasAllowed(agentId: number | null | undefined): Promise<boolean> {
  if (agentId == null) return false;
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { multiSasAllowed: true } });
  return a?.multiSasAllowed === true;
}
