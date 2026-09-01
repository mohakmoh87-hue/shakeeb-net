import { NextResponse } from "next/server";
import { guardOwner } from "@/lib/guard";
import { ownerSubStats } from "@/lib/ownerSubStats";

export const dynamic = "force-dynamic";

// مجاميعُ مشتركي/أكتف/متصلي كلّ الوكلاء — لمالك النظام حصراً.
export async function GET() {
  const g = await guardOwner();
  if (g.error) return g.error;
  const data = await ownerSubStats();
  return NextResponse.json(data);
}
