// ===== تعريف واحد لمعنى «الماستر» و«المبيعات» في كل الشاشات (المرحلة ٩) =====
// كان معرَّفاً بأربع صياغات متفرّقة: التقرير اليومي وحسابات المدير يستثنيان النوعين
// (master و master-invoice)، بينما التقرير التفصيلي والإجمالي يستثنيان "master" وحده —
// فمالُ **فاتورة الماستر** يُحتسب ماستراً في شاشة ونقداً في أخرى، أي يُعدّ مرتين أو
// يختفي حسب الشاشة التي تنظر إليها. (تدقيق 2026-08-04)
//
// القاعدة: أي استعلام يريد «مال الصندوق» يستعمل notCashless، وأي استعلام يريد
// «مال الماستر» يستعمل onlyMaster. لا تُكتب القوائم يدوياً في أي مكان بعد اليوم.

/** أنواع الحركات التي تنتمي لحساب الماستر المستقل — لا تدخل الصندوق ولا التقارير.
 *  master = ماستر تفعيل · master-invoice = ماستر فاتورة · master-debt = تسديد دين على الماستر. */
export const MASTER_SOURCE_TYPES = ["master", "master-invoice", "master-debt"] as const;

/** شرط Prisma: حركات الماستر وحدها. */
export const onlyMaster = { sourceType: { in: [...MASTER_SOURCE_TYPES] } };

/** شرط Prisma: كل ما ليس ماستر (مال الصندوق) — يشمل الحركات بلا sourceType. */
export const notMaster = {
  OR: [{ sourceType: null }, { sourceType: { notIn: [...MASTER_SOURCE_TYPES] } }],
};

/** الأنواع التي لها سطرها الخاص في التقرير اليومي، فلا تدخل سطر «المقبوضات». */
export const OWN_LINE_SOURCE_TYPES = ["activation", "invoice", "sale", ...MASTER_SOURCE_TYPES] as const;

/** شرط Prisma لسطر «المقبوضات (اليوم)»: ما ليس له سطر خاص. */
export const otherIncomeOnly = {
  moneyIn: { gt: 0 },
  OR: [{ sourceType: null }, { sourceType: { notIn: [...OWN_LINE_SOURCE_TYPES] } }],
};
