import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

// توليد رمز تنصيب لمرّة واحدة (صالح 30 دقيقة) — يُسلّم رابط القاعدة للمُنصِّب بأمان.
export async function POST(request: Request) {
  const g = await guard("offices.manage");
  if (g.error) return g.error;

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.installToken.create({
    data: { token, agentId: g.session?.agentId ?? null, createdBy: g.session?.userId ?? null, expiresAt },
  });

  const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  // أمر PowerShell واحد يُلصَق مباشرةً في نافذة PowerShell (كما في التعليمات): يضبط الرمز ثم
  // يشغّل المُنصِّب. لا نغلّفه بـ `powershell -Command "..."` لأن ذلك يجعل PowerShell الخارجي
  // يوسّع $env:INSTALL_TOKEN (الفارغ) قبل التنفيذ فيكسر الأمر عند لصقه دفعة واحدة.
  const command = `$env:INSTALL_TOKEN='${token}'; iwr -UseBasicParsing '${origin}/api/hybrid/setup.ps1' | iex`;

  return NextResponse.json({ token, command, expiresAt });
}
