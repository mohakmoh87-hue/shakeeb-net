"use client";

type Entry = {
  kind: "daily" | "manager";
  key: string;
  at: string;
  day: string | null;
  label: string;
  type?: string;
  amount: number;
  sign: 1 | -1;
  moneyIn?: number;
  moneyOut?: number;
  count?: number;
  notes: string | null;
  byName: string | null;
  forManager?: boolean;
  balanceAfter: number;
};

export type MoneyLogData = { entries: Entry[]; sum: number; balanced: boolean };

const fmt = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ع`;

// 📜 قائمةُ حركاتِ رصيدٍ — سهمٌ أخضرُ لما أُضيف وأحمرُ لما صُرف، بتاريخه وساعته وسببه،
// ومعه «أصبح» = الرصيدُ بعد الحركة. مصدرٌ واحدٌ يستعمله «المبلغ الكلّي» و«الماستر»،
// فلو عُدِّل عرضُ أحدِهما تبعه الآخرُ ولا يفترقان (طلبُ محمد: «نفس الشيء بالضبط»).
export default function MoneyLog({
  data,
  title,
  hint,
  footer,
  onDayClick,
  accent = "emerald",
}: {
  data: MoneyLogData | null;
  title: string;
  hint: string;
  footer: string;
  onDayClick?: (day: string) => void;
  accent?: "emerald" | "indigo";
}) {
  const head = accent === "indigo" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700";
  return (
    <div className={`border-t-4 ${accent === "indigo" ? "border-indigo-100" : "border-emerald-100"}`}>
      <div className="flex items-center justify-between bg-white px-4 py-3">
        <div>
          <div className="text-sm font-bold text-slate-800">📜 {title}</div>
          <div className="text-[11px] text-slate-500">{hint}</div>
        </div>
        {data && !data.balanced && (
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">⚠️ مجموعُ الحركات {fmt(data.sum)}</span>
        )}
      </div>
      {!data ? (
        <div className="p-6 text-center text-sm text-slate-400">جاري تحميل الحركات…</div>
      ) : data.entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">لا حركاتٍ بعد</div>
      ) : (
        <table className="w-full text-right text-sm">
          <tbody>
            {data.entries.map((e) => {
              const up = e.kind === "daily" ? e.amount >= 0 : e.sign === 1;
              const shown = e.kind === "daily" ? Math.abs(e.amount) : e.amount;
              const isDay = e.kind === "daily" && e.day && onDayClick;
              return (
                <tr key={e.key}
                  onClick={isDay ? () => onDayClick!(e.day!) : undefined}
                  title={isDay ? "اضغط لعرض تقرير هذا اليوم كاملاً" : undefined}
                  className={`border-b border-slate-100 ${isDay ? "cursor-pointer hover:bg-indigo-50/60" : ""}`}>
                  <td className="w-9 py-2.5 pr-3 align-top text-lg leading-none">
                    <span className={up ? "text-emerald-600" : "text-red-600"}>{up ? "▲" : "▼"}</span>
                  </td>
                  <td className="py-2.5 align-top">
                    <div className="font-semibold text-slate-800">
                      {e.label}
                      {isDay && <span className="text-mynet-blue"> ↗</span>}
                      {e.forManager && e.byName && <span className="text-[11px] font-normal text-slate-500"> — {e.byName}</span>}
                    </div>
                    {e.kind === "daily" ? (
                      <div className="text-[11px] text-slate-500" dir="ltr">
                        {e.day} · قبض {fmt(e.moneyIn ?? 0)} · صرف {fmt(e.moneyOut ?? 0)} · {e.count} حركة
                      </div>
                    ) : (
                      <>
                        {e.notes && <div className="text-[11px] leading-5 text-slate-500">{e.notes}</div>}
                        <div className="text-[11px] text-slate-400" dir="ltr">
                          {new Date(e.at).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                          {!e.forManager && e.byName ? ` · ${e.byName}` : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className={`py-2.5 px-2 text-left align-top font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>
                    {up ? "+" : "−"}{fmt(shown)}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pl-3 text-left align-top">
                    <div className="text-[10px] text-slate-400">أصبح</div>
                    <div className={`font-bold ${e.balanceAfter < 0 ? "text-red-700" : "text-slate-800"}`}>{fmt(e.balanceAfter)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className={`font-extrabold ${head}`}>
            <tr>
              <td></td>
              <td className="p-3">= {footer}</td>
              <td></td>
              <td className="p-3 text-left">{fmt(data.sum)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
