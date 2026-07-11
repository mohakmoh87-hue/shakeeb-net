"use client";

import { useEffect, useState } from "react";
import CrudManager, { type Field } from "@/components/CrudManager";
import PageHeader from "@/components/PageHeader";
import { usePermission } from "@/lib/usePermission";

type Account = {
  id: number;
  name: string | null;
  typeName: string | null;
  notes: string | null;
  isEmployee: boolean;
  towerId: number | null;
};
type Tower = { id: number; name: string | null };

export default function AccountsPage() {
  const { can, me } = usePermission();
  const [towers, setTowers] = useState<Tower[]>([]);
  useEffect(() => {
    fetch("/api/towers").then((r) => void (r.ok && r.json().then(setTowers)));
  }, []);

  if (!me) return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  if (!can("accounts.manage")) {
    return <div className="p-6"><PageHeader title="إنشاء حساب مصروفات" /><div className="rounded-lg bg-red-50 px-4 py-3 text-red-600">ليس لديك صلاحية إنشاء حسابات المصروفات.</div></div>;
  }

  const towerName = (id: number | null) => towers.find((t) => t.id === id)?.name ?? "—";
  const fields: Field[] = [
    { name: "name", label: "اسم الحساب", required: true },
    { name: "typeName", label: "نوع الحساب" },
    // قائمة حسابات مستقلة لكل مكتب — المدير يختار المكتب
    { name: "towerId", label: "المكتب", type: "select", required: true, options: towers.map((t) => ({ value: t.id, label: t.name ?? `#${t.id}` })) },
    { name: "isEmployee", label: "حساب موظف", type: "checkbox", placeholder: "نعم (يظهر سحبه في حسابات المدير)" },
    { name: "notes", label: "ملاحظات", type: "textarea" },
  ];

  return (
    <CrudManager<Account>
      title="الحسابات"
      subtitle="حسابات القبض والصرف لكل مكتب"
      apiBase="/api/accounts"
      addLabel="إضافة حساب"
      fields={fields}
      columns={[
        { header: "#", render: (r) => r.id },
        { header: "الاسم", render: (r) => r.name },
        { header: "المكتب", render: (r) => towerName(r.towerId) },
        { header: "النوع", render: (r) => r.typeName ?? "—" },
        { header: "موظف", render: (r) => (r.isEmployee ? "✓" : "—") },
        { header: "ملاحظات", render: (r) => r.notes ?? "—" },
      ]}
    />
  );
}
