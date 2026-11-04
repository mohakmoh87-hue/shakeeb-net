import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppAdminSession } from "@/lib/appAdminAuth";
import { seedTestUsers, disableTestUsers, testUsersStatus } from "@/lib/appTestUsers";

export const dynamic = "force-dynamic";

// 👤 حساباتُ التجريب — إنشاؤها وتحديثُها وإيقافُها من أدمن التطبيق بلا لصقةِ SQL.
export async function GET() {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  return NextResponse.json(await testUsersStatus());
}

const schema = z.object({
  action: z.enum(["seed", "disable"]),
  officeId: z.coerce.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const s = await getAppAdminSession();
  if (!s) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  if (parsed.data.action === "disable") {
    const r = await disableTestUsers();
    return NextResponse.json({ ...r, ...(await testUsersStatus()) });
  }
  const r = await seedTestUsers(parsed.data.officeId);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "تعذّر الإنشاء" }, { status: 400 });
  return NextResponse.json({ ...r, ...(await testUsersStatus()) });
}
