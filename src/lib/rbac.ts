// الصلاحيات المفصّلة — ٣٢ صلاحية في ٨ أصناف (القائمة النهائية المعتمدة من محمد 2026-07-26)
// أُلغيت نهائياً: offices.manage (فُصلت إلى edit/delete/backup/agent/rewards.config)
// و cardprice.manage (سعر الكارت للمدير حصراً — بلا صلاحية).
export type Permission =
  // ١ · المشتركون
  | "subscribers.manage" // المشتركون: إضافة وتعديل
  | "subscribers.import" // استيراد المشتركين من SAS
  | "subscribers.delete" // حذف مشترك
  | "subscriptions.manage" // تفعيل الاشتراكات
  // ٢ · المال
  | "finance.view" // مشاهدة الحسابات والديون
  | "finance.manage" // تسجيل المصروفات والمقبوضات
  | "accounts.manage" // إنشاء حسابات المصروفات
  | "receipts.void" // حذف وصل (مع عكس المبلغ)
  | "manager.accounts" // حسابات المدير
  // ٣ · المخزن والمبيع
  | "inventory.manage" // المخزن والفواتير وكروت التفعيل
  | "cards.delete" // حذف كروت التفعيل (+ إصلاح الكروت الوهمية)
  // ٤ · التقارير
  | "reports.view" // التقارير
  // ٥ · الرسائل والواتساب
  | "messaging.manage" // إرسال الرسائل والتذكيرات
  | "templates.manage" // قوالب الرسائل (منفصلة بقرار محمد)
  | "whatsapp.chat" // الرد على رسائل واتساب
  | "whatsapp.connect" // ربط وفصل واتساب المكتب (تسدّ ثغرة whatsapp/logout)
  // ٦ · الفنيون
  | "field.manage" // إدارة الفنيين والبطاقات
  | "field.payroll" // رواتب وخصومات وإجازات الفنيين
  // ٧ · المكاتب
  | "offices.edit" // تعديل المكتب (الإنشاء والتعديل — بلا حذف)
  | "offices.delete" // حذف المكتب (مستقلّ تماماً)
  | "offices.sync" // مزامنة اشتراكات المكتب (بلا استيراد)
  // ٨ · النظام والإعدادات
  | "settings.manage" // إعدادات المكتب
  | "receipt.template" // قالب الوصل المطبوع
  | "packages.manage" // الباقات
  | "users.manage" // المستخدمون والصلاحيات
  | "audit.view" // سجل التدقيق
  | "tickets.manage" // التذاكر
  | "rewards.clear" // حذف كود المكافأة
  | "rewards.config" // إعدادات المكافآت وسجلّها
  | "backup.manage" // النسخة الاحتياطية
  | "agent.settings" // إعدادات الوكيل (+ رمز تنصيب الحاسبة)
  | "hybrid.manage"; // حواسيب النظام الهجين

// الأصناف الثمانية — تُعرض في صفحة المستخدمين مقسّمة تحت عناوين (طلب محمد: أسماء مفهومة بلا مصطلحات)
export const PERMISSION_GROUPS: { title: string; items: { key: Permission; label: string }[] }[] = [
  {
    title: "١ · المشتركون",
    items: [
      { key: "subscribers.manage", label: "المشتركون: إضافة وتعديل" },
      { key: "subscribers.import", label: "استيراد المشتركين من SAS" },
      { key: "subscribers.delete", label: "حذف مشترك" },
      { key: "subscriptions.manage", label: "تفعيل الاشتراكات" },
    ],
  },
  {
    title: "٢ · المال",
    items: [
      { key: "finance.view", label: "مشاهدة الحسابات والديون" },
      { key: "finance.manage", label: "تسجيل المصروفات والمقبوضات" },
      { key: "accounts.manage", label: "إنشاء حسابات المصروفات" },
      { key: "receipts.void", label: "حذف وصل (مع عكس المبلغ)" },
      { key: "manager.accounts", label: "حسابات المدير" },
    ],
  },
  {
    title: "٣ · المخزن والمبيع",
    items: [
      { key: "inventory.manage", label: "المخزن والفواتير وكروت التفعيل" },
      { key: "cards.delete", label: "حذف كروت التفعيل" },
    ],
  },
  {
    title: "٤ · التقارير",
    items: [{ key: "reports.view", label: "التقارير" }],
  },
  {
    title: "٥ · الرسائل والواتساب",
    items: [
      { key: "messaging.manage", label: "إرسال الرسائل والتذكيرات" },
      { key: "templates.manage", label: "قوالب الرسائل" },
      { key: "whatsapp.chat", label: "الرد على رسائل واتساب" },
      { key: "whatsapp.connect", label: "ربط وفصل واتساب المكتب" },
    ],
  },
  {
    title: "٦ · الفنيون",
    items: [
      { key: "field.manage", label: "إدارة الفنيين والبطاقات" },
      { key: "field.payroll", label: "رواتب وخصومات وإجازات الفنيين" },
    ],
  },
  {
    title: "٧ · المكاتب",
    items: [
      { key: "offices.edit", label: "تعديل المكتب" },
      { key: "offices.delete", label: "حذف المكتب" },
      { key: "offices.sync", label: "مزامنة اشتراكات المكتب" },
    ],
  },
  {
    title: "٨ · النظام والإعدادات",
    items: [
      { key: "settings.manage", label: "إعدادات المكتب" },
      { key: "receipt.template", label: "قالب الوصل المطبوع" },
      { key: "packages.manage", label: "الباقات" },
      { key: "users.manage", label: "المستخدمون والصلاحيات" },
      { key: "audit.view", label: "سجل التدقيق" },
      { key: "tickets.manage", label: "التذاكر" },
      { key: "rewards.clear", label: "حذف كود المكافأة" },
      { key: "rewards.config", label: "إعدادات المكافآت" },
      { key: "backup.manage", label: "النسخة الاحتياطية" },
      { key: "agent.settings", label: "إعدادات الوكيل" },
      { key: "hybrid.manage", label: "حواسيب النظام الهجين" },
    ],
  },
];

// قائمة مسطّحة (توافق مع من يحتاجها كقائمة واحدة)
export const PERMISSION_LIST: { key: Permission; label: string }[] =
  PERMISSION_GROUPS.flatMap((g) => g.items);

// توافق الجلسات القديمة: جلسة صادرة قبل الهجرة تحمل المفاتيح القديمة فقط —
// المفتاح القديم يمنح مفاتيحه الجديدة حتى يعيد المستخدم الدخول (نفس خريطة هجرة القاعدة)
const LEGACY_IMPLIES: Record<string, Permission[]> = {
  "offices.manage": ["offices.edit", "offices.delete", "backup.manage", "agent.settings", "rewards.config"],
  "subscribers.manage": ["subscribers.import"],
  "users.manage": ["audit.view"],
  "manager.accounts": ["hybrid.manage"],
  "field.manage": ["field.payroll"],
};

// توسيع المفاتيح القديمة إلى الجديدة وإسقاط الملغاة — تستعمله صفحة المستخدمين عند
// تحميل مستخدم لم تلحقه هجرة القاعدة بعد؛ أول حفظ له يكتب المفاتيح الجديدة النظيفة
export function expandLegacyPermissions(perms: string[]): Permission[] {
  const out = new Set<string>();
  for (const p of perms) {
    if (p && p !== "offices.manage" && p !== "cardprice.manage") out.add(p);
    for (const k of LEGACY_IMPLIES[p] ?? []) out.add(k);
  }
  return [...out] as Permission[];
}

export interface SessionLike {
  isAdmin?: boolean;
  permissions?: Permission[];
}

// المدير له كل الصلاحيات؛ غيره حسب ما مُنح (مع توافق المفاتيح القديمة)
export function can(session: SessionLike | null | undefined, permission: Permission): boolean {
  if (!session) return false;
  if (session.isAdmin) return true;
  const held = (session.permissions ?? []) as string[];
  if (held.includes(permission)) return true;
  return held.some((h) => LEGACY_IMPLIES[h]?.includes(permission));
}
