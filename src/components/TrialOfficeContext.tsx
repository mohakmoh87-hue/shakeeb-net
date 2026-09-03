"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// اختيارُ المكتب المشترك — يُستعمل في تطبيق الهاتف (جلد التجربة) وحده: منتقي «التقرير
// اليومي» يكتب هنا، ومربّعُ إدارة الفنيّين في الهاتف يقرأ منه فيتبعانه معاً. سطحُ المكتب
// (StatCards) خارجَ هذا المزوّد أصلاً ولا يقرؤه، فلا أثرَ له على الموقع إطلاقاً.
export type OfficeSel = "all" | number;

const Ctx = createContext<{ office: OfficeSel; setOffice: (o: OfficeSel) => void }>({
  office: "all",
  setOffice: () => {},
});

export function TrialOfficeProvider({ children }: { children: ReactNode }) {
  const [office, setOffice] = useState<OfficeSel>("all");
  return <Ctx.Provider value={{ office, setOffice }}>{children}</Ctx.Provider>;
}

export function useTrialOffice() {
  return useContext(Ctx);
}
