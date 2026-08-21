import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasActivationWindow, actWindowFindSerial } from "@/lib/sas4";
import { credsOfTower } from "@/lib/sasPanel";
import { isOwnCabinet } from "@/lib/syncLog";

export const dynamic = "force-dynamic";

// ═════ 🪟 مسبارُ نافذة التفعيلات — قراءةٌ محضة (تشخيصُ 2026-08-21) ═════
// كلُّ تصنيفٍ في المزامنة (تفعيلٌ ذاتيّ · تنصيبُ شركة · قرض · كارتٌ خارج المخزن) يُبنى
// على هذه النافذة. فحين يبقى مشتركٌ في «تحديث معلومات» وهو تفعيلٌ خارجيٌّ واضح، السؤالُ
// الأوّل: **هل رأت النافذةُ تفعيلَه أصلاً؟** وكان الجوابُ يحتاج تخميناً — فصار يُقاس.
// لا يكتب شيئاً: يسجّل الدخولَ إلى الساس ويعيد إحصاءَ النافذة وما تعرفه عن يوزرٍ بعينه.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard("offices.sync");
  if (g.error) return g.error;
  const { id } = await params;
  const towerId = Number(id);
  const mine = await agentTowerIds(g.session ?? null);
  if (!mine.includes(towerId)) return NextResponse.json({ error: "المكتب لا يتبع حسابك" }, { status: 403 });

  const creds = await credsOfTower(towerId);
  if (!creds) return NextResponse.json({ error: "المكتب غير مربوط بـSAS" }, { status: 400 });
  const sp = new URL(req.url).searchParams;
  const days = Math.min(Math.max(Number(sp.get("days")) || 35, 1), 120);
  const user = (sp.get("user") ?? "").trim().toLowerCase();
  const serial = (sp.get("serial") ?? "").trim();

  const base = sasBaseUrl(creds.loginUrl);
  const token = await sasLogin(base, creds.username, creds.password);
  const win = await sasActivationWindow(base, token, days);
  const officeUser = creds.username.trim().toLowerCase();

  const rows = win.rows;
  const managers: Record<string, number> = {};
  for (const a of rows) managers[(a.managerUsername ?? "—").trim()] = (managers[(a.managerUsername ?? "—").trim()] ?? 0) + 1;

  return NextResponse.json({
    towerId, officeUser, days,
    since: win.since, complete: win.complete,
    rows: rows.length,
    newest: rows[0]?.createdAt ?? null,
    oldest: rows[rows.length - 1]?.createdAt ?? null,
    topManagers: Object.entries(managers).sort((a, b) => b[1] - a[1]).slice(0, 8),
    user: user
      ? (win.byUser.get(user) ?? []).slice(0, 5).map((a) => ({
          at: a.createdAt, price: a.price, pin: a.pin, manager: a.managerUsername,
          newExpiration: a.newExpiration,
          managerIsPage: (a.managerUsername ?? "").trim().toLowerCase() === officeUser,
          ownCabinet: isOwnCabinet(a.username, a.managerUsername),
        }))
      : undefined,
    serial: serial ? actWindowFindSerial(win, serial) : undefined,
  });
}
