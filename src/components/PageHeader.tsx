"use client";

import { useRouter } from "next/navigation";

// ترويسة الصفحات الداخلية بالطراز الجديد (ب4 — تصميم النموذج): زر رجوع محايد +
// العنوان + وصف صغير + الإجراءات يساراً. تستعملها ~22 صفحة، فتغييرها هنا
// يُحدّث ترويساتها كلها دفعة واحدة.
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="nst">
      <div className="pg-h flex-wrap">
        <button className="back" onClick={() => router.push("/dashboard")}>→ رجوع</button>
        <div className="leading-tight">
          <h1>{title}</h1>
          {subtitle && <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>{subtitle}</p>}
        </div>
        {action && <div className="pg-acts flex-wrap">{action}</div>}
      </div>
    </div>
  );
}
