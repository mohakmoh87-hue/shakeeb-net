// الصلاحيات المفصّلة (كل مستخدم يُمنح ما يشاء منها عبر مربعات صح)
export type Permission =
  | "subscribers.manage" // المشتركون
  | "subscribers.delete" // حذف المشترك نهائياً
  | "subscriptions.manage" // التفعيل والوصولات
  | "finance.manage" // الصندوق والمصاريف
  | "finance.view" // مشاهدة التقارير المالية
  | "inventory.manage" // المخزن وكروت التفعيل
  | "tickets.manage" // التذاكر
  | "messaging.manage" // الرسائل
  | "reports.view" // التقارير
  | "receipts.void" // حذف/إلغاء الوصولات عكسياً
  | "manager.accounts" // الاطلاع على حسابات الإدارة
  | "whatsapp.chat" // الرد على رسائل واتساب المشتركين
  | "offices.manage" // إدارة المكاتب (بيانات المكتب و SAS والمزامنة)
  | "accounts.manage" // إنشاء حسابات المصروفات والمقبوضات
  | "packages.manage" // إدارة الباقات
  | "cardprice.manage" // تحديد سعر الكارت
  | "cards.delete" // حذف كروت التفعيل من المخزن
  | "templates.manage" // قوالب الرسائل
  | "receipt.template" // قالب الوصل المطبوع
  | "users.manage" // المستخدمون
  | "field.manage" // إدارة الفنيين (إضافة الفنيين وتوجيه البطاقات)
  | "settings.manage"; // إعدادات المكتب

// قائمة الصلاحيات مع أسمائها العربية (لمربعات الصح عند إضافة مستخدم)
export const PERMISSION_LIST: { key: Permission; label: string }[] = [
  { key: "subscribers.manage", label: "إدارة المشتركين (إضافة/تعديل/تفعيل)" },
  { key: "subscribers.delete", label: "حذف المشترك نهائياً (مع كل وصولاته)" },
  { key: "subscriptions.manage", label: "تفعيل وتجديد الاشتراكات" },
  { key: "finance.manage", label: "الصندوق والمصاريف والمقبوضات" },
  { key: "finance.view", label: "مشاهدة التقارير المالية والديون" },
  { key: "inventory.manage", label: "المخزن وكروت التفعيل والفواتير" },
  { key: "tickets.manage", label: "التذاكر والدعم الفني" },
  { key: "messaging.manage", label: "الرسائل والقوالب" },
  { key: "reports.view", label: "التقارير" },
  { key: "receipts.void", label: "حذف/إلغاء الوصولات (تفعيل/مبيع/ديون) عكسياً" },
  { key: "manager.accounts", label: "الاطلاع على حسابات الإدارة" },
  { key: "whatsapp.chat", label: "الرد على رسائل واتساب المشتركين" },
  { key: "offices.manage", label: "إدارة المكاتب (البيانات و SAS والمزامنة)" },
  { key: "accounts.manage", label: "إنشاء حسابات المصروفات والمقبوضات" },
  { key: "packages.manage", label: "إدارة الباقات" },
  { key: "cardprice.manage", label: "تحديد سعر الكارت" },
  { key: "cards.delete", label: "حذف كروت التفعيل من المخزن" },
  { key: "templates.manage", label: "قوالب الرسائل" },
  { key: "receipt.template", label: "قالب الوصل المطبوع" },
  { key: "users.manage", label: "إدارة المستخدمين" },
  { key: "field.manage", label: "إدارة الفنيين (إضافة فنيين وتوجيه البطاقات)" },
  { key: "settings.manage", label: "إعدادات المكتب والباقات" },
];

export interface SessionLike {
  isAdmin?: boolean;
  permissions?: Permission[];
}

// المدير له كل الصلاحيات؛ غيره حسب ما مُنح
export function can(session: SessionLike | null | undefined, permission: Permission): boolean {
  if (!session) return false;
  if (session.isAdmin) return true;
  return (session.permissions ?? []).includes(permission);
}
