import { NextResponse } from "next/server";
import { guard, agentTowerIds } from "@/lib/guard";
import { sasBaseUrl, sasLogin, sasRawPost } from "@/lib/sas4";
import { credsOfTower } from "@/lib/sasPanel";

export const dynamic = "force-dynamic";

// ═════ 🔬 مسبارُ صيغِ طلبِ تقرير التفعيلات — قراءةٌ محضة (تشخيصُ 2026-08-21) ═════
// القياسُ الذي استدعاه: لوحةُ الساس تُظهر **بحساب المكتب نفسِه** تفعيلاتِ الكابينات
// (`manager_details.username = "FDT53-SHU"`)، بينما نداءُ البرنامج بالحساب نفسِه يعيد
// ٢١٤٨ صفّاً **كلُّها بمنجر حساب المكتب** وصفرَ صفٍّ لذلك المشترك. فالحقلُ الذي يقرؤه
// الكودُ صحيحٌ — والفرقُ في **نطاق الطلب** لا في اسم الحقل.
// يجرّب هذا المسارُ صيغَ الطلب واحدةً واحدةً ويقول أيُّها تُعيد صفوفَ الكابينات،
// فيُبنى الإصلاحُ على قياسٍ لا على تخمين. ولا يكتب شيئاً في القاعدة ولا في الساس.
type Row = Record<string, unknown>;

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
  const user = (sp.get("user") ?? "").trim().toLowerCase();
  // 🔬 صيغةٌ حرّة: تُمرَّر جسمُ الطلب كما هو فتُجرَّب أيُّ بارامتراتٍ بلا نشرٍ جديد
  const rawBody = sp.get("raw");

  const base = sasBaseUrl(creds.loginUrl);
  const token = await sasLogin(base, creds.username, creds.password);

  if (rawBody) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(rawBody) as Record<string, unknown>; }
    catch { return NextResponse.json({ error: "raw ليس JSON صالحاً" }, { status: 400 }); }
    const j = (await sasRawPost(base, token, String(sp.get("route") ?? "index/activations"), body)) as { total?: number; data?: Row[] };
    const rows: Row[] = Array.isArray(j?.data) ? j.data : [];
    return NextResponse.json({
      body, total: j?.total ?? null, rows: rows.length,
      managers: [...new Set(rows.map((r) => String((r.manager_details as Row | undefined)?.username ?? "—")))].slice(0, 6),
      dates: rows.slice(0, 3).map((r) => String(r.created_at ?? "")),
      newest: rows.map((r) => String(r.created_at ?? "")).sort().slice(-1)[0] ?? null,
      oldest: rows.map((r) => String(r.created_at ?? "")).sort()[0] ?? null,
      users: [...new Set(rows.map((r) => String((r.user_details as Row | undefined)?.username ?? "—")))].slice(0, 5),
    });
  }

  const variants: { name: string; route: string; body: Record<string, unknown> }[] = [
    { name: "baseline", route: "index/activations", body: { page: 1, count: 100 } },
    { name: "search_user", route: "index/activations", body: { page: 1, count: 100, search: user } },
    { name: "manager_id_0", route: "index/activations", body: { page: 1, count: 100, manager_id: 0 } },
    { name: "all_true", route: "index/activations", body: { page: 1, count: 100, all: true } },
    { name: "include_subs", route: "index/activations", body: { page: 1, count: 100, include_subs: true } },
    { name: "sub_managers", route: "index/activations", body: { page: 1, count: 100, sub_managers: true } },
    { name: "children", route: "index/activations", body: { page: 1, count: 100, children: true } },
    { name: "filter_empty", route: "index/activations", body: { page: 1, count: 100, filter: {} } },
    { name: "report_route", route: "report/activations", body: { page: 1, count: 100 } },
    { name: "sort_desc", route: "index/activations", body: { page: 1, count: 100, sort: "created_at", order: "desc" } },
  ];

  const out: Row[] = [];
  for (const v of variants) {
    try {
      const j = (await sasRawPost(base, token, v.route, v.body)) as { total?: number; data?: Row[] };
      const rows: Row[] = Array.isArray(j?.data) ? j.data : [];
      const mgrs = new Map<string, number>();
      let hitUser = 0;
      for (const r of rows) {
        const m = String((r.manager_details as Row | undefined)?.username ?? "—");
        mgrs.set(m, (mgrs.get(m) ?? 0) + 1);
        if (user && String((r.user_details as Row | undefined)?.username ?? "").toLowerCase() === user) hitUser++;
      }
      out.push({
        variant: v.name, route: v.route, total: j?.total ?? null, rows: rows.length,
        managers: [...mgrs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        hasFDT: [...mgrs.keys()].some((m) => /^FDT/i.test(m)),
        userRows: hitUser,
        firstAt: rows[0]?.created_at ?? null,
      });
    } catch (e) {
      out.push({ variant: v.name, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    }
  }
  return NextResponse.json({ towerId, officeUser: creds.username, user, variants: out });
}
