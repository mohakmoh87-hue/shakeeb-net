import { prisma } from "@/lib/prisma";
import { credsOfPanel, credsOfTower } from "@/lib/sasPanel";
import { sasBaseUrl, sasLogin, sasFindUserByUsername, sasFetchUserPassword } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";

type ResolveOpts = { towerId?: number | null; sasPanelId?: number | null; netUser?: string | null; sasId?: number | null };

export async function resolveUserPassword(opts: ResolveOpts): Promise<string | null> {
  try {
    const creds = opts.sasPanelId != null
      ? await credsOfPanel(opts.sasPanelId)
      : opts.towerId != null
        ? await credsOfTower(opts.towerId)
        : null;
    if (!creds || (await sasHostBlocked(creds.loginUrl))) return null;
    const base = sasBaseUrl(creds.loginUrl);
    const token = await sasLogin(base, creds.username, creds.password);
    let id: number | null = null;
    if (opts.netUser?.trim()) {
      const found = await sasFindUserByUsername(base, token, opts.netUser.trim());
      id = found?.sasId ?? null;
    } else if (opts.sasId != null) {
      id = opts.sasId;
    }
    if (id == null) return null;
    return await sasFetchUserPassword(base, token, id);
  } catch {
    return null;
  }
}

export async function fillCardPassword(cardId: number, opts: ResolveOpts): Promise<void> {
  try {
    const pw = await resolveUserPassword(opts);
    if (pw) await prisma.taskCard.update({ where: { id: cardId }, data: { userPassword: pw } });
  } catch (e) {
    console.error(`[userPassword] فشل جلب باسورد البطاقة ${cardId}:`, e instanceof Error ? e.message : e);
  }
}
