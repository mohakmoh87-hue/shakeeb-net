import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { dailyLogData } from "@/lib/dailyLogAgg";

export const dynamic = "force-dynamic";

// سجل "مجموع المبالغ اليومية": كل حركات الصندوق مجمّعة حسب اليوم (بتوقيت بغداد).
// التجميعُ نفسُه في `@/lib/dailyLogAgg` — يشاركه مسارُ حركات «المبلغ الكلّي الموجود».
export async function GET() {
  const g = await guard("manager.accounts");
  if (g.error) return g.error;
  // عزل المستأجر: مكاتب وكيل المستخدم فقط
  const agentTowers = await agentTowerIds(g.session);
  return NextResponse.json(await dailyLogData(agentTowers));
}
