import { Client } from "pg";
import { credsOfPanel, credsOfTower } from "@/lib/sasPanel";
import { sasBaseUrl, sasLogin, sasFindUserByUsername, sasFetchUserPassword } from "@/lib/sas4";
import { sasHostBlocked } from "@/lib/sasProxy";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bgLine = (desc: string | null): string | null => {
  const m = (desc ?? "").match(/👤\s*اليوزر:\s*(bg-[a-z0-9-]+@[a-z0-9]+)/i);
  return m ? m[1].trim() : null;
};

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cards = (await c.query(`
    SELECT tc.id, tc."subscriberId", tc."odooBg", tc.description, tc."odooPanelId", tb."towerId"
      FROM task_cards tc
      JOIN task_lists tl ON tl.id = tc."listId"
      JOIN task_boards tb ON tb.id = tl."boardId"
     WHERE tc."isDeleted"=false AND tc.done=false AND tc.settled=false AND tc."archivedAt" IS NULL
       AND (tc."userPassword" IS NULL OR tc."userPassword"='')
  `)).rows as { id: number; subscriberId: number | null; odooBg: string | null; description: string | null; odooPanelId: number | null; towerId: number | null }[];

  const subIds = [...new Set(cards.map((c) => c.subscriberId).filter((x): x is number => x != null))];
  const subs = subIds.length
    ? (await c.query(`SELECT id, "netUser", "sasPanelId" FROM subscribers WHERE id = ANY($1)`, [subIds])).rows as { id: number; netUser: string | null; sasPanelId: number | null }[]
    : [];
  const subById = new Map(subs.map((s) => [s.id, s]));

  type Job = { cardId: number; netUser: string };
  const groups = new Map<string, { towerId: number; sasPanelId: number | null; jobs: Job[] }>();
  for (const card of cards) {
    let netUser: string | null = null, sasPanelId: number | null = null;
    if (card.subscriberId != null) { const s = subById.get(card.subscriberId); netUser = s?.netUser ?? null; sasPanelId = s?.sasPanelId ?? null; }
    else { netUser = card.odooBg?.trim() || bgLine(card.description); sasPanelId = card.odooPanelId; }
    if (!netUser || card.towerId == null) continue;
    const key = sasPanelId != null ? `p:${sasPanelId}` : `t:${card.towerId}`;
    if (!groups.has(key)) groups.set(key, { towerId: card.towerId, sasPanelId, jobs: [] });
    groups.get(key)!.jobs.push({ cardId: card.id, netUser });
  }
  console.log(`بطاقاتٌ مفتوحةٌ بلا باسورد: ${cards.length} — منها ${[...groups.values()].reduce((a, g) => a + g.jobs.length, 0)} قابلةٌ للحلّ عبر ${groups.size} مجموعةَ لوحة`);

  let filled = 0, failed = 0;
  for (const [key, g] of groups) {
    const creds = g.sasPanelId != null ? await credsOfPanel(g.sasPanelId) : await credsOfTower(g.towerId);
    if (!creds || (await sasHostBlocked(creds.loginUrl))) { console.log(`  ${key}: بلا اعتماد/محجوب — تُخطّى ${g.jobs.length}`); failed += g.jobs.length; continue; }
    const base = sasBaseUrl(creds.loginUrl);
    let token: string;
    try { token = await sasLogin(base, creds.username, creds.password); }
    catch { console.log(`  ${key}: فشل الدخول — تُخطّى ${g.jobs.length}`); failed += g.jobs.length; continue; }
    let tf = 0;
    for (const j of g.jobs) {
      try {
        const found = await sasFindUserByUsername(base, token, j.netUser);
        const pw = found?.sasId != null ? await sasFetchUserPassword(base, token, found.sasId) : null;
        if (pw) { await c.query(`UPDATE task_cards SET "userPassword"=$1 WHERE id=$2`, [pw, j.cardId]); filled++; tf++; }
        else failed++;
      } catch { failed++; }
      await sleep(120);
    }
    console.log(`  ${key}: مُلئ ${tf}/${g.jobs.length}`);
  }
  console.log(`\n✅ اكتمل: مُلئ ${filled} بطاقة، تعذّر ${failed}`);
  await c.end();
}
main().catch((e) => { console.error("خطأ:", e.message); process.exit(1); });
