import { NextResponse } from "next/server";
import { guardOwner, confirmOwnerPassword } from "@/lib/guard";
import { restoreFullSystemBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// ⚠️ استعادة نسخة النظام الكاملة (للمالك فقط، بتأكيد كلمة السر). تستبدل **كل** بيانات النظام
// بمحتوى الملف — يعود كل الوكلاء وحساباتهم وكروتهم تماماً كما وقت النسخ. عملية لا رجعة فيها.
export async function POST(request: Request) {
  const g = await guardOwner();
  if (g.error) return g.error;

  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const file = form?.get("file");

  if (!(await confirmOwnerPassword(g.session!.userId, typeof password === "string" ? password : ""))) {
    return NextResponse.json({ error: "كلمة سر المالك غير صحيحة" }, { status: 403 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ارفع ملف النسخة الكاملة" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const r = await restoreFullSystemBackup(buf);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "فشلت الاستعادة" }, { status: 400 });
  }
}
