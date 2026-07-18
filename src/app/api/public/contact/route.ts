import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// رقم تواصل المالك — عام (يظهر بصفحة الدخول ليتواصل الوكلاء)
export async function GET() {
  const s = await prisma.systemSetting.findFirst({ where: { type: "ownerPhone" } });
  return NextResponse.json({ phone: s?.value ?? "" });
}
