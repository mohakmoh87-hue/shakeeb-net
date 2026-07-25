import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret, isEncrypted } from "@/lib/secretbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ترحيل لمرّة واحدة: تشفير القيم القديمة النصّية (plainPassword للمستخدمين، plainCode
// للفنيين) في مكانها. عديم الأثر عند التكرار (يتخطّى المشفّرة مسبقاً). محميّ بـCRON_SECRET.
// يُطلب مرّة بعد ضبط CREDS_ENC_KEY. الدخول لا يتأثر (يعتمد على bcrypt hash منفصل).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }
  if (!process.env.CREDS_ENC_KEY) {
    return NextResponse.json({ error: "CREDS_ENC_KEY غير مضبوط — اضبطه أولاً" }, { status: 400 });
  }

  // المستخدمون (كلمات سرّ المدراء/المالك)
  const users = await prisma.user.findMany({
    where: { plainPassword: { not: null } },
    select: { id: true, plainPassword: true },
  });
  let usersEncrypted = 0;
  for (const u of users) {
    if (isEncrypted(u.plainPassword)) continue;
    await prisma.user.update({ where: { id: u.id }, data: { plainPassword: encryptSecret(u.plainPassword) } });
    usersEncrypted++;
  }

  // الفنيون (رموز الدخول)
  const techs = await prisma.technician.findMany({
    where: { plainCode: { not: null } },
    select: { id: true, plainCode: true },
  });
  let techsEncrypted = 0;
  for (const t of techs) {
    if (isEncrypted(t.plainCode)) continue;
    await prisma.technician.update({ where: { id: t.id }, data: { plainCode: encryptSecret(t.plainCode) } });
    techsEncrypted++;
  }

  return NextResponse.json({
    ok: true,
    users: { total: users.length, encrypted: usersEncrypted, alreadyEncrypted: users.length - usersEncrypted },
    technicians: { total: techs.length, encrypted: techsEncrypted, alreadyEncrypted: techs.length - techsEncrypted },
  });
}
