"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

type Log = {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
  user: string;
  date: string;
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "تسجيل دخول",
  ACTIVATE: "تفعيل اشتراك",
  PAY_DEBT: "تسديد دين",
  SEND_MESSAGE: "إرسال رسالة",
};

const fmtDate = (d: string) => formatDateTime(d);

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    fetch("/api/audit").then((r) => {
      if (r.ok) r.json().then(setLogs);
    });
  }, []);

  return (
    <div className="p-6">
      <PageHeader title="سجل التدقيق" subtitle="سجل العمليات الحساسة في النظام" />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">المستخدم</th>
              <th className="p-3">العملية</th>
              <th className="p-3">التفاصيل</th>
              <th className="p-3">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">لا توجد سجلات</td></tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="p-3">{l.id}</td>
                  <td className="p-3 font-medium">{l.user}</td>
                  <td className="p-3">{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td className="p-3 text-slate-600">{l.details ?? "—"}</td>
                  <td className="p-3 text-slate-500">{fmtDate(l.date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
