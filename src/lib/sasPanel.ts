import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secretbox";

// كلمةُ الساس قد تكون مشفَّرةً (`enc:v1:`) وقد تكون نصّاً قديماً. و`decryptSecret` تُرجع القيمةَ
// كما هي إن لم تكن مشفَّرة ⇒ **تطبيقُها آمنٌ دائماً**. وكان `subscribers/query` وحدَه يفكّها
// بينما التفعيلُ والمزامنةُ يقرآن الخامَ — علّةٌ كامنةٌ لو شُفِّرت كلمةُ مكتبٍ يوماً. فتُطبَّق هنا
// مرّةً واحدةً فينتفع كلُّ القارئين.
const pw = (v: string | null): string | null => (v == null ? null : (decryptSecret(v) ?? v));

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
  loanUser: true, loanPass: true,
} as const;

/** بياناتُ دخولِ حسابِ الديلر على لوحة قروض سوبر سيل. */
export type LoanCreds = { panelId: number | null; label: string | null; loanUser: string; loanPass: string };

/** ═════ القرضُ يتبع لوحةَ المشترك (طلبُ محمد 2026-08-13: «موقعَين للقروض») ═════
 *  حسابُ القرض هو حسابُ **الديلر** على سوبر سيل، وكان على `Tower` وحدَه ⇒ مكتبٌ
 *  بلوحتَي ساسٍ له حسابُ ديلرٍ واحد. ولكلّ مُخدِّمِ ساسٍ حسابُ ديلرٍ مستقلٌّ (قِيس على
 *  صميم: `sameem.faaq@slm` و`Dajlat.Alsalam1@slm`) ⇒ يُقرَأ حسابُ **لوحةِ المشترك**.
 *
 *  والارتدادُ إلى أعمدة المكتب مقصودٌ لا نسيان: المكاتبُ الستّةُ المفعَّلةُ اليومَ
 *  (٥ · ٦ · ٧ · ٣٨ · ٣٩ · ٤٢) بلوحةٍ واحدةٍ وحساباتُها على المكتب — فلا تتأثّر بحرف.
 *  ولوحةٌ بلا حسابِ قرضٍ تعمل بحساب مكتبها كما كانت.
 *
 *  `null` = لا حسابَ مكتملاً لا على اللوحة ولا على المكتب. */
export async function loanCredsOfSubscriber(subscriberId: number): Promise<LoanCreds | null> {
  const s = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { towerId: true, sasPanelId: true },
  });
  if (!s?.towerId) return null;

  if (s.sasPanelId != null) {
    const p = await prisma.sasPanel.findFirst({
      // 🔒 العزل: اللوحةُ يجب أن تكون **لهذا المكتب** — والمكتبُ فُحص في المسار المنادي
      where: { id: s.sasPanelId, towerId: s.towerId, isDeleted: false },
      select: { id: true, label: true, loanUser: true, loanPass: true },
    });
    const u = (p?.loanUser ?? "").trim();
    const w = pw(p?.loanPass ?? null) ?? "";
    // مكتملةٌ فقط تُقبَل: لوحةٌ بيوزرٍ بلا كلمةِ مرورٍ تسقط إلى المكتب بدل أن تفشل
    if (u && w) return { panelId: p!.id, label: p!.label, loanUser: u, loanPass: w };
  }

  const t = await prisma.tower.findUnique({
    where: { id: s.towerId },
    select: { name: true, loanUser: true, loanPass: true },
  });
  const u = (t?.loanUser ?? "").trim();
  const w = pw(t?.loanPass ?? null) ?? "";
  return u && w ? { panelId: null, label: t?.name ?? null, loanUser: u, loanPass: w } : null;
}

export function credsFromPanel(p: {
  id: number; towerId: number; agentId: number | null; label: string | null;
  loginUrl: string | null; username: string | null; password: string | null; activationTemplate: string | null;
}): SasCreds | null {
  if (!p.loginUrl || !p.username || !p.password) return null;
  return {
    panelId: p.id, towerId: p.towerId, agentId: p.agentId, label: p.label,
    loginUrl: p.loginUrl, username: p.username, password: pw(p.password)!,
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
    loginUrl: t.loginUrl, username: t.username, password: pw(t.password)!,
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
    url: p.odooUrl ?? "https://odoo.supercell.iq", user: p.odooUser, pass: pw(p.odooPass), uid: p.odooUid,
  };
}

/** أودو المكتب — لوحتُه الأولى، وإلّا أعمدتُه (السلوكُ القديم). */
export async function odooOfTower(towerId: number): Promise<OdooCreds | null> {
  const panels = await panelsOfTower(towerId);
  const p = panels.find((x) => x.odooUser && x.odooPass) ?? panels[0];
  if (p) {
    return {
      panelId: p.id, towerId: p.towerId, enabled: p.odooEnabled === "1",
      url: p.odooUrl ?? "https://odoo.supercell.iq", user: p.odooUser, pass: pw(p.odooPass), uid: p.odooUid,
    };
  }
  const t = await prisma.tower.findUnique({ where: { id: towerId }, select: TOWER_SEL });
  if (!t) return null;
  return {
    panelId: null, towerId: t.id, enabled: t.odooEnabled === "1",
    url: t.odooUrl ?? "https://odoo.supercell.iq", user: t.odooUser, pass: pw(t.odooPass), uid: t.odooUid,
  };
}

// ===== حصّةُ مالك النظام (طلب محمد 2026-08-13) =====
// «إذا الوكيل له ٣ مكاتب فيمكنني اختيار **كم مكتبٍ** بساسَين وكم بساسٍ واحد، وأيضاً **صفر**
// ليبقى على الوضع الحالي». ⇒ عددٌ لا مفتاح. والحصّةُ **تُتيح لا تُشعِل**.

export type MultiSasQuota = {
  quota: number; // كم مكتباً يُسمح له (٠ = الوضعُ الحاليّ، لا خيارَ يظهر)
  used: number; // كم مكتباً استهلك الحصّةَ فعلاً (له أكثرُ من لوحةٍ حيّة)
  remaining: number; // المتبقّي
  usedTowerIds: number[]; // أيُّها — كي تُظهر الواجهةُ «هذا المكتبُ ضمن حصّتك»
};

/** حصّةُ الوكيل وما استُهلك منها — تُقرأ مرّةً وتُستعمل في الواجهة والمسار معاً. */
export async function multiSasQuota(agentId: number | null | undefined): Promise<MultiSasQuota> {
  if (agentId == null) return { quota: 0, used: 0, remaining: 0, usedTowerIds: [] };
  const a = await prisma.agent.findUnique({ where: { id: agentId }, select: { multiSasOffices: true } });
  const quota = Math.max(0, a?.multiSasOffices ?? 0);
  // المكاتبُ المستهلِكة = مكاتبُ هذا الوكيل التي لها **أكثرُ من لوحةٍ حيّة**.
  // (لا علاقةَ مُعلَنةً بين `SasPanel` و`Tower` في المخطّط — فالترشيحُ بمعرّفات المكاتب.)
  const towerIds = (await prisma.tower.findMany({ where: { agentId, isDeleted: false }, select: { id: true } })).map((t) => t.id);
  if (!towerIds.length) return { quota, used: 0, remaining: quota, usedTowerIds: [] };
  const grouped = await prisma.sasPanel.groupBy({
    by: ["towerId"],
    where: { isDeleted: false, towerId: { in: towerIds } },
    _count: { _all: true },
  });
  const usedTowerIds = grouped.filter((g) => g._count._all > 1).map((g) => g.towerId);
  return { quota, used: usedTowerIds.length, remaining: Math.max(0, quota - usedTowerIds.length), usedTowerIds };
}

/**
 * هل يجوز إضافةُ لوحةٍ **جديدة** لهذا المكتب؟ يُستدعى في **المسار** لا في الواجهة وحدها.
 * القاعدة: مكتبٌ استهلك الحصّةَ سلفاً (له أكثرُ من لوحة) يُسمح له بالمزيد؛ ومكتبٌ بلوحةٍ واحدةٍ
 * لا يُسمح له إلّا إن بقي من الحصّة شيء. ⇒ الحصّةُ تحدّ **عددَ المكاتب** لا عددَ اللوحات.
 */
export async function canAddPanel(towerId: number): Promise<{ ok: boolean; reason?: string; quota: MultiSasQuota }> {
  const t = await prisma.tower.findUnique({ where: { id: towerId }, select: { agentId: true, isDeleted: true } });
  if (!t || t.isDeleted) return { ok: false, reason: "المكتب غير موجود", quota: { quota: 0, used: 0, remaining: 0, usedTowerIds: [] } };
  const q = await multiSasQuota(t.agentId);
  if (q.quota === 0) return { ok: false, reason: "لم يسمح مالكُ النظام بأكثر من لوحةِ ساسٍ لأيّ مكتب", quota: q };
  if (q.usedTowerIds.includes(towerId)) return { ok: true, quota: q }; // ضمن الحصّة أصلاً
  if (q.remaining <= 0) {
    return { ok: false, reason: `الحصّةُ مستهلكة: ${q.used} من ${q.quota} مكتباً. اطلب من المالك زيادتَها أو أزِل لوحةً من مكتبٍ آخر`, quota: q };
  }
  return { ok: true, quota: q };
}
