"use client";

import CrudManager, { type Field } from "@/components/CrudManager";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Account = {
  id: number;
  name: string | null;
  typeName: string | null;
  notes: string | null;
  isEmployee: boolean;
};

const fields: Field[] = [
  { name: "name", label: "اسم الحساب", required: true },
  { name: "typeName", label: "نوع الحساب" },
  { name: "isEmployee", label: "حساب موظف", type: "checkbox", placeholder: "نعم (يظهر سحبه في حسابات المدير)" },
  { name: "notes", label: "ملاحظات", type: "textarea" },
];

export default function AccountsPage() {
  const { can, me } = usePermission();
  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("accounts.manage")) {
    return <div className="p-6"><PageHeader title="إنشاء حساب مصروفات" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إنشاء حسابات المصروفات.</div></div>;
  }
  return (
    <CrudManager<Account>
      title="الحسابات"
      subtitle="حسابات القبض والصرف للتقرير اليومي"
      apiBase="/api/accounts"
      addLabel="إضافة حساب"
      fields={fields}
      columns={[
        { header: "#", render: (r) => r.id },
        { header: "الاسم", render: (r) => r.name },
        { header: "النوع", render: (r) => r.typeName ?? "—" },
        { header: "موظف", render: (r) => (r.isEmployee ? "✓" : "—") },
        { header: "ملاحظات", render: (r) => r.notes ?? "—" },
      ]}
    />
  );
}
