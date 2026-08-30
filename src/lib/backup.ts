import { gunzipSync, createGzip } from "node:zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ===== النسخ الاحتياطي والاسترجاع لكل وكيل (عزل المستأجر) =====
// يُصدّر كل بيانات الوكيل (المشتركون، الكروت، الباقات، القوالب، الحسابات،
// المصروفات، الفواتير، الفنيون، المكاتب...) المرتبطة عبر agentId أو towerId.
// يُستثنى: حسابات الدخول والبيانات الخاصّة بالحاسبة/الجلسات (لحماية الدخول الحالي).

const BACKUP_VERSION = 1;

// جداول لا تُنسخ ولا تُسترجع (دخول/جلسات/مؤقّتة/مرجعية عامة)
const EXCLUDE = new Set([
  "users",           // حسابات الدخول — تُدار لكل تنصيب (تفادي كسر الجلسة وتعارض أسماء المستخدمين)
  "hybrid_workers",  // حواسيب الهجين — خاصّة بكل جهاز
  "wa_sessions",     // جلسات واتساب — خاصّة بالجهاز
  "wa_relays",       // مؤقّتة
  "install_tokens",  // رموز تنصيب مؤقّتة
  "map_points",      // مرجع عام مشترك (ليس بيانات وكيل)
]);

// نسخة النظام الكاملة (للمالك): كل شيء عدا سجل الهجرات (الهيكل يُدار بالهجرات لا البيانات).
// تختلف عن نسخة الوكيل: تشمل users/agents/كل الجداول ليعود النظام بأكمله تماماً كما وقت النسخ.
const FULL_EXCLUDE = new Set(["_prisma_migrations"]);

type Row = Record<string, unknown>;

// JSON.stringify مع تحويل BigInt (يظهر من بعض الأعمدة العددية) لتفادي الخطأ
function jsonReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? Number(v) : v;
}

async function columnsWith(name: "agentId" | "towerId"): Promise<string[]> {
  // ملاحظة: table_name نوعه 'name' في Postgres — نحوّله إلى text ليقرأه سائق Neon
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name=$1`,
    name,
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDE.has(t));
}

export type AgentBackup = {
  version: number;
  agentId: number;
  agentName: string | null;
  backupEmail: string | null;
  exportedAt: string;
  tables: Record<string, Row[]>; // اسم الجدول ← صفوفه
  settings: Row[];               // system_settings الخاصّة بالوكيل (قالب الوصل)
};

// اسمُ ملفِّ نسخة الوكيل
function agentBackupFilename(agentName: string | null, agentId: number): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (agentName ?? `agent-${agentId}`).replace(/[^\w؀-ۿ-]+/g, "_").slice(0, 40);
  return `backup-${safeName}-${stamp}.json.gz`;
}

// ═════ 🔴 «نسخةُ الوكيل لا تُنزَّل ولا تُرسَل (500)» (بلاغُ محمد 2026-08-29) ═════
// كانت `exportAgentBackup` تُجسّدُ كلَّ جداول الوكيل في الذاكرة ثمّ `JSON.stringify` تبني
// **سلسلةً واحدةً** بحجمها كلِّه — ولوكيلٍ كبيرٍ (خصوصاً card_photos المُرمَّزة base64) تتجاوز
// **أقصى طول سلسلةٍ في V8 (~512MB)** فيُرمى `RangeError: Invalid string length` ⇒ **500**
// يُفشل التنزيلَ والإرسالَ معاً (كلاهما يستدعيها). وهو **عينُ عطل النسخة الكاملة** الذي عولج
// بالبثّ. فهذه النواةُ البثّيّة تُصدّرُ **صفحةً صفحة** إلى مجرى gzip (ذاكرةٌ محدودةٌ مهما كبر
// الوكيل، بلا سلسلةٍ عملاقةٍ أبداً)، مع حارس اكتمالٍ داخل لقطةٍ متّسقة (REPEATABLE READ).
export async function exportAgentBackupTo(agentId: number, onChunk: (c: Buffer) => void): Promise<{ filename: string; tableCount: number; rowCount: number }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, backupEmail: true } });
  const towers = await prisma.tower.findMany({ where: { agentId }, select: { id: true } });
  const towerIds = towers.map((t) => t.id);

  const PAGE = 2000;
  let rowCount = 0, tableCount = 0;

  const gzip = createGzip({ level: 6 });
  gzip.on("data", (c: Buffer) => onChunk(c));
  const finished = new Promise<void>((res, rej) => { gzip.on("end", res); gzip.on("error", rej); });
  const put = (str: string): Promise<void> =>
    new Promise((res, rej) => {
      if (gzip.write(str)) return res();
      gzip.once("drain", res);
      gzip.once("error", rej);
    });

  await prisma.$transaction(async (tx) => {
    const count = async (sql: string, ...p: unknown[]): Promise<number> => {
      const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...p);
      return Number(n);
    };
    let firstTable = true;
    // يبثّ جدولاً واحداً `"label":[...]` صفحةً صفحة، ويحرس اكتمالَه بمقارنة المعدود بالحقيقيّ.
    const emit = async (label: string, pageFn: (off: number) => Promise<Row[]>, totalFn: () => Promise<number>) => {
      await put((firstTable ? "" : ",") + JSON.stringify(label) + ":[");
      firstTable = false; tableCount++;
      let offset = 0, tableRows = 0, firstRow = true;
      for (;;) {
        const rows = await pageFn(offset);
        if (rows.length === 0) break;
        for (const r of rows) { await put((firstRow ? "" : ",") + JSON.stringify(r, jsonReplacer)); firstRow = false; }
        rowCount += rows.length; tableRows += rows.length; offset += rows.length;
        if (rows.length < PAGE) break;
      }
      await put("]");
      const n = await totalFn();
      if (n !== tableRows) throw new Error(`نسخةٌ ناقصة: جدول ${label} فيه ${n} صفّاً وخرج منه ${tableRows} — أُوقفت النسخة`);
    };

    await put('{"version":' + BACKUP_VERSION + ',"agentId":' + agentId +
      ',"agentName":' + JSON.stringify(agent?.name ?? null) +
      ',"backupEmail":' + JSON.stringify(agent?.backupEmail ?? null) +
      ',"exportedAt":' + JSON.stringify(new Date().toISOString()) + ',"tables":{');

    const done = new Set<string>();
    // 1) جداول فيها agentId
    for (const t of await columnsWith("agentId")) {
      if (t === "agents" || !SAFE_IDENT.test(t)) continue;
      done.add(t);
      await emit(t,
        (off) => tx.$queryRawUnsafe<Row[]>(`SELECT * FROM "${t}" WHERE "agentId" = $1 ORDER BY 1 OFFSET ${off} LIMIT ${PAGE}`, agentId),
        () => count(`SELECT count(*)::bigint AS n FROM "${t}" WHERE "agentId" = $1`, agentId));
    }
    // 2) جداول فيها towerId (بلا agentId) + 3) سلسلةُ لوحات الفنيين
    if (towerIds.length) {
      for (const t of await columnsWith("towerId")) {
        if (done.has(t) || !SAFE_IDENT.test(t)) continue;
        done.add(t);
        await emit(t,
          (off) => tx.$queryRawUnsafe<Row[]>(`SELECT * FROM "${t}" WHERE "towerId" = ANY($1::int[]) ORDER BY 1 OFFSET ${off} LIMIT ${PAGE}`, towerIds),
          () => count(`SELECT count(*)::bigint AS n FROM "${t}" WHERE "towerId" = ANY($1::int[])`, towerIds));
      }
      await emit("task_lists",
        (off) => tx.$queryRawUnsafe<Row[]>(`SELECT l.* FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]) ORDER BY l.id OFFSET ${off} LIMIT ${PAGE}`, towerIds),
        () => count(`SELECT count(*)::bigint AS n FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds));
      await emit("task_cards",
        (off) => tx.$queryRawUnsafe<Row[]>(`SELECT c.* FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]) ORDER BY c.id OFFSET ${off} LIMIT ${PAGE}`, towerIds),
        () => count(`SELECT count(*)::bigint AS n FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds));
      await emit("card_photos",
        (off) => tx.$queryRawUnsafe<Row[]>(`SELECT p.* FROM card_photos p JOIN task_cards c ON c.id=p."cardId" JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]) ORDER BY p.id OFFSET ${off} LIMIT ${PAGE}`, towerIds),
        () => count(`SELECT count(*)::bigint AS n FROM card_photos p JOIN task_cards c ON c.id=p."cardId" JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[])`, towerIds));
    }

    // قالبُ الوصل الخاصّ بالوكيل (صغير — بلا ترقيم)
    await put('},"settings":[');
    const settings = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM system_settings WHERE type = $1`, `receipt:${agentId}`);
    let firstS = true;
    for (const s of settings) { await put((firstS ? "" : ",") + JSON.stringify(s, jsonReplacer)); firstS = false; }
    await put("]}");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300000, maxWait: 15000 });

  gzip.end();
  await finished;
  return { filename: agentBackupFilename(agent?.name ?? null, agentId), tableCount, rowCount };
}

// نسخةٌ مضغوطةٌ (Buffer) لبيانات الوكيل — للإرسال بالبريد (مرفق). تجمع قطعَ البثّ (ذاكرةٌ محدودةٌ
// أثناء التوليد، والمضغوطُ وحدَه يُجمَّع — أصغرُ بمراتب من الخام).
export async function exportAgentBackup(agentId: number): Promise<{ gz: Buffer; filename: string }> {
  const chunks: Buffer[] = [];
  const r = await exportAgentBackupTo(agentId, (c) => { chunks.push(c); });
  return { gz: Buffer.concat(chunks), filename: r.filename };
}

// ===== نسخة النظام الكاملة (كل الوكلاء + حساباتهم + كروتهم + كل تفصيل) =====
export type FullBackup = { version: number; full: true; exportedAt: string; tables: Record<string, Row[]> };

// تصدير النظام بأكمله ككائن + gzip: كل جدول حقيقي بكل صفوفه. ملف واحد يعيد كل شيء تماماً.
export async function exportFullSystemBackup(): Promise<{ gz: Buffer; filename: string; tableCount: number; rowCount: number }> {
  const chunks: Buffer[] = [];
  const r = await exportFullSystemBackupTo((c) => { chunks.push(c); });
  return { gz: Buffer.concat(chunks), ...r };
}

// الصيغة البثّيّة: تدفع المضغوطَ قطعةً قطعةً إلى onChunk فورَ إنتاجها — يستهلكها مسارُ
// التنزيل (مهمّة GitHub تنزّل وتُرسل بالبريد لأنّ Railway/Hobby يحجب SMTP نهائيّاً)،
// فتتدفّق البايتات طوالَ التصدير ولا يقطع وسيطُ Railway الردَّ لصمته (~٤٥ ثانية).
export async function exportFullSystemBackupTo(onChunk: (c: Buffer) => void): Promise<{ filename: string; tableCount: number; rowCount: number }> {
  // ═════ 🔴 «النسخةُ الكاملةُ دائماً تفشل ولا تصل» (بلاغُ محمد 2026-08-19) ═════
  // مهمّةُ GitHub تردّ **502 بعد ~٥١ ثانية** — أي أنّ الخادمَ **سقط أثناء التنفيذ**
  // لا أنّه رفض الطلب. والسببُ أنّ هذه الدالّة كانت تُجسّد القاعدةَ كلَّها في الذاكرة
  // **ثلاثَ مرّاتٍ متراكبة**:
  //   ١. كائنٌ واحدٌ يحمل صفوفَ الجداول الـ٥٥ كلِّها معاً (٤٧٬٧٧٢ مشتركاً + الرسائل
  //      + سجلّاتُ التدقيق + الكروت…)
  //   ٢. ثمّ JSON.stringify يبني **نصّاً واحداً** بحجمها كلِّه
  //   ٣. ثمّ Buffer.from ينسخه، ثمّ gzipSync يحجز مخرجَه — وكلُّه **متزامنٌ**
  //      يُجمّد حلقةَ الأحداث حتى النهاية.
  // ⇒ ذروةُ الذاكرة أضعافُ حجم البيانات ⇒ الحاويةُ تُقتل (OOM) ⇒ 502.
  //
  // 🔑 والعلاج بثّيّ: مجرى gzip يُكتَب إليه **صفحةً صفحة**، فذروةُ الذاكرة تصير
  //   صفحةً واحدةً (٢٠٠٠ صفّ) مهما كبرت القاعدة — لا القاعدةَ كلَّها. والناتجُ
  //   المضغوطُ وحدَه يُجمَّع لأنّ البريدَ يحتاجه مرفقاً، وهو أصغرُ بمراتب.
  const PAGE = 2000;
  let rowCount = 0;
  let tableCount = 0;

  const gzip = createGzip({ level: 6 });
  gzip.on("data", (c: Buffer) => onChunk(c));
  const finished = new Promise<void>((res, rej) => { gzip.on("end", res); gzip.on("error", rej); });
  // كتابةٌ تحترم ضغطَ المجرى (drain) — وإلّا تراكم غيرُ المضغوط في الذاكرة فعاد العطل
  const put = (str: string): Promise<void> =>
    new Promise((res, rej) => {
      if (gzip.write(str)) return res();
      gzip.once("drain", res);
      gzip.once("error", rej);
    });

  // ═════ 🔒 لقطةٌ متّسقة (REPEATABLE READ) — علاجُ إنذار «نسخةٌ ناقصة» الكاذب ═════
  // التصديرُ يستغرق دقائقَ والقاعدةُ حيّةٌ تُدرِج طوالَها (رسائل، سجلّات تدقيق…).
  // فحارسُ الاكتمال أدناه كان يَعُدّ **بعد** الجولة فيجد صفوفاً وُلدت أثناءها ⇒ يصرخ
  // «نسخةٌ ناقصة» على نسخةٍ سليمة. داخل معاملةِ لقطةٍ واحدة يقرأ العدُّ والترقيمُ
  // الصورةَ ذاتَها المجمّدة، فيصير الحارسُ صادقاً والنسخةُ متّسقةً زمنيّاً بأكملها.
  await prisma.$transaction(async (tx) => {
  const realTables = await allRealTables(tx as typeof prisma);
  await put('{"version":' + BACKUP_VERSION + ',"full":true,"exportedAt":' + JSON.stringify(new Date().toISOString()) + ',"tables":{');
  for (const t of realTables) {
    if (FULL_EXCLUDE.has(t) || !SAFE_IDENT.test(t)) continue;
    await put((tableCount ? "," : "") + JSON.stringify(t) + ":[");
    tableCount++;
    let offset = 0;
    let tableRows = 0;
    let firstRow = true;
    for (;;) {
      // ⚠️ ترتيبٌ ثابتٌ شرطُ صحّةِ الترقيم: بلا ORDER BY قد يُعيد Postgres صفّاً مرّتَين
      //    ويُسقط آخرَ بين صفحتَين — أي نسخةٌ ناقصةٌ **بلا أيّ خطأ يظهر**.
      const rows = await tx.$queryRawUnsafe<Row[]>(
        'SELECT * FROM "' + t + '" ORDER BY 1 OFFSET ' + offset + " LIMIT " + PAGE,
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        await put((firstRow ? "" : ",") + JSON.stringify(r, jsonReplacer));
        firstRow = false;
      }
      rowCount += rows.length;
      tableRows += rows.length;
      offset += rows.length;
      if (rows.length < PAGE) break;
    }
    await put("]");
    // 🛡️ حارسُ الاكتمال: الترقيمُ بـOFFSET يعتمد ترتيبَ العمود الأوّل. فلو لم يكن
    //    مُميِّزاً في جدولٍ ما، أمكن نظريّاً أن يتكرّر صفٌّ ويسقط آخرُ **بلا خطأ يظهر**
    //    — أي نسخةٌ ناقصةٌ يُكتشَف نقصُها يومَ الكارثة وحدَه. فيُقارَن المعدودُ بالحقيقيّ
    //    (على اللقطة نفسِها)، وأيُّ فارقٍ يُسقط النسخةَ بصوتٍ عالٍ بدل أن يمرّ صامتاً.
    const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*)::bigint AS n FROM "' + t + '"',
    );
    if (Number(n) !== tableRows) {
      throw new Error(
        "نسخةٌ ناقصة: جدول " + t + " فيه " + Number(n) + " صفّاً وخرج منه " + tableRows + " — أُوقفت النسخة",
      );
    }
  }
  await put("}}");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 900000, maxWait: 15000 });
  gzip.end();
  await finished;

  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `shakeeb-full-${stamp}.json.gz`, tableCount, rowCount };
}

// فكّ ملف نسخة النظام الكاملة (gzip أو JSON خام) والتحقّق من صحّته
export function parseFullBackup(buf: Buffer): FullBackup {
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buf) : buf).toString("utf8");
  const obj = JSON.parse(text) as FullBackup;
  if (!obj || typeof obj !== "object" || !obj.tables || obj.full !== true) {
    throw new Error("ملف نسخة النظام الكاملة غير صالح");
  }
  return obj;
}

// إدراج صفوف خام (كل الأعمدة كما هي، المعرّفات محفوظة) — بلا فرض agentId (للنظام الكامل)
async function insertRowsRaw(tx: typeof prisma, table: string, rows: Row[]) {
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => SAFE_IDENT.test(c));
    if (cols.length === 0) continue;
    const values = cols.map((c) => {
      const v = row[c];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const colList = cols.map((c) => `"${c}"`).join(",");
    const params = cols.map((_, i) => `$${i + 1}`).join(",");
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES (${params})`, ...values);
  }
}

// ⚠️ استعادة كاملة للنظام (شديدة الحساسية — تمسح كل البيانات وتستبدلها بالملف).
// للمالك فقط بتأكيد كلمة السر. تُعطّل قيود FK داخل المعاملة (avnadmin سوبر) فيصحّ الترتيب،
// ثم تمسح كل الجداول وتُدرج صفوف الملف كما هي، وتُعيد ضبط تسلسلات المعرّفات. النتيجة: النظام
// يعود بأكمله (كل الوكلاء وحساباتهم وكروتهم) تماماً كما وقت أخذ النسخة.
export async function restoreFullSystemBackup(buf: Buffer): Promise<{ tables: number; rows: number }> {
  const parsed = parseFullBackup(buf);
  const realTables = await allRealTables();
  let tableCount = 0, rowCount = 0;
  await prisma.$transaction(async (tx) => {
    // تعطيل مشغّلات قيود المفاتيح الأجنبية أثناء التحميل — محصور بالمعاملة (LOCAL) فيعود تلقائياً
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    // امسح كل الجداول الحقيقية (عدا سجل الهجرات)
    for (const t of realTables) {
      if (FULL_EXCLUDE.has(t) || !SAFE_IDENT.test(t)) continue;
      await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
    // أدرج كل صفوف الملف كما هي (المعرّفات محفوظة)
    for (const [t, rowsRaw] of Object.entries(parsed.tables)) {
      if (!realTables.has(t) || FULL_EXCLUDE.has(t) || !SAFE_IDENT.test(t) || !Array.isArray(rowsRaw)) continue;
      if (rowsRaw.length > 0) { await insertRowsRaw(tx as typeof prisma, t, rowsRaw); rowCount += rowsRaw.length; }
      tableCount++;
    }
  }, { timeout: 600000, maxWait: 15000 });
  // أعِد ضبط تسلسلات المعرّفات بعد الإدراج بمعرّفات صريحة
  for (const t of realTables) { if (!FULL_EXCLUDE.has(t) && SAFE_IDENT.test(t)) await resyncSequence(prisma, t); }
  return { tables: tableCount, rows: rowCount };
}

// فكّ ملف نسخة (يقبل gzip أو JSON خام) إلى كائن
export function parseBackupFile(buf: Buffer): AgentBackup {
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buf) : buf).toString("utf8");
  const obj = JSON.parse(text) as AgentBackup;
  if (!obj || typeof obj !== "object" || !obj.tables || typeof obj.version !== "number") {
    throw new Error("ملف النسخة غير صالح");
  }
  return obj;
}

// حذف كل بيانات الوكيل الحالية (تمهيداً للاستبدال الكامل) — عدا صف الوكيل نفسه
async function deleteAgentData(tx: typeof prisma, agentId: number) {
  const towers = await tx.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM towers WHERE "agentId" = $1`, agentId);
  const towerIds = towers.map((t) => t.id);
  if (towerIds.length) {
    // أبناء لوحات الفنيين أولاً
    await tx.$executeRawUnsafe(`DELETE FROM card_photos WHERE "cardId" IN (SELECT c.id FROM task_cards c JOIN task_lists l ON l.id=c."listId" JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    await tx.$executeRawUnsafe(`DELETE FROM task_cards WHERE "listId" IN (SELECT l.id FROM task_lists l JOIN task_boards b ON b.id=l."boardId" WHERE b."towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    await tx.$executeRawUnsafe(`DELETE FROM task_lists WHERE "boardId" IN (SELECT id FROM task_boards WHERE "towerId" = ANY($1::int[]))`, towerIds).catch(() => {});
    const towerTables = await tx.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='towerId'`);
    for (const { table_name } of towerTables) {
      if (EXCLUDE.has(table_name)) continue;
      await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "towerId" = ANY($1::int[])`, towerIds).catch(() => {});
    }
  }
  const agentTables = await tx.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name::text AS table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='agentId' AND table_name <> 'agents'`);
  for (const { table_name } of agentTables) {
    if (EXCLUDE.has(table_name)) continue;
    await tx.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "agentId" = $1`, agentId).catch(() => {});
  }
  await tx.$executeRawUnsafe(`DELETE FROM system_settings WHERE type = $1`, `receipt:${agentId}`).catch(() => {});
}

// مُعرّف SQL آمن (اسم جدول/عمود) — أحرف/أرقام/شرطة سفلية فقط، يمنع الحقن عبر الأسماء
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// أسماء كل جداول القاعدة الحقيقية (قائمة بيضاء للاسترجاع)
async function allRealTables(client: typeof prisma = prisma): Promise<Set<string>> {
  const rows = await client.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema='public'`,
  );
  return new Set(rows.map((r) => r.table_name));
}

// إدراج صفوف جدول (بأعمدتها وقيمها) مع إجبار agentId على الوكيل الهدف.
// الجدول مُتحقَّق منه من المُستدعي (قائمة بيضاء)؛ هنا نتحقّق من أسماء الأعمدة أيضاً.
// الصفوف مُصفّاة مسبقاً من المُستدعي (عزل المستأجر: لا تُقبل إلا صفوف مكاتب الوكيل الهدف).
async function insertRows(tx: typeof prisma, table: string, rows: Row[], targetAgentId: number, hasAgentId: boolean) {
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => SAFE_IDENT.test(c)); // تجاهل أي اسم عمود غير آمن
    if (cols.length === 0) continue;
    const values = cols.map((c) => {
      if (hasAgentId && c === "agentId") return targetAgentId; // ربط بالوكيل الهدف
      const v = row[c];
      // أعمدة JSON: مرّرها كنصّ JSON
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const colList = cols.map((c) => `"${c}"`).join(",");
    const params = cols.map((_, i) => `$${i + 1}`).join(",");
    await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES (${params})`, ...values);
  }
}

// إعادة ضبط تسلسل المفتاح id بعد إدراج صفوف بمعرّفات صريحة (لتفادي تعارض المعرّفات لاحقاً)
async function resyncSequence(tx: typeof prisma, table: string) {
  await tx.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM "${table}"),1))
     WHERE pg_get_serial_sequence($1,'id') IS NOT NULL`, table,
  // متوسّط(٢٨) · كان الفشلُ مبتلَعاً: استعادةٌ «تنجح» ثمّ تنفجر الإدراجاتُ لاحقاً بتعارض
  // معرّفاتٍ لا يُعرف مصدرُه. الصراخُ باسم الجدول يجعل التشخيصَ فوريّاً.
  ).catch((e) => console.error(`[backup] 🔴 تعذّر ضبطُ تسلسل «${table}» — إدراجاتُه القادمة قد تتعارض:`, e instanceof Error ? e.message : e));
}

// استرجاع كامل (استبدال): يمسح بيانات الوكيل الحالية ويُدرج بيانات الملف تحت الوكيل الهدف
export async function importAgentBackup(targetAgentId: number, backup: AgentBackup): Promise<{ ok: boolean; tablesRestored: number; rowsRestored: number }> {
  const agentTableSet = new Set(await columnsWith("agentId"));
  const towerTableSet = new Set(await columnsWith("towerId")); // جداول مرتبطة بالمكتب
  const realTables = await allRealTables(); // قائمة بيضاء لأسماء الجداول الحقيقية

  // ===== عزل المستأجر في الاستعادة =====
  // اتصال الموقع يتجاوز RLS، فالتحقق هنا هو خط الدفاع الوحيد ضد ملف ملغّم يحقن صفوفاً
  // في مكاتب وكيل آخر. القاعدة: لا يُقبل إلا صف يخصّ مكاتب الوكيل الهدف.
  // مكاتب الوكيل الهدف = معرّفات صفوف جدول towers في الملف (تُدرَج بـagentId=الهدف حصراً).
  const idOf = (r: Row) => Number((r as { id?: unknown }).id);
  const num = (v: unknown) => (v == null ? NaN : Number(v));
  const allowedTowerIds = new Set<number>((backup.tables["towers"] ?? []).map(idOf).filter(Number.isFinite));
  // سلسلة لوحات الفنيين (لا towerId مباشر): list→board→card — تُقبل بالتبعية لمكاتب مقبولة
  const okBoards = new Set<number>((backup.tables["task_boards"] ?? []).filter((r) => allowedTowerIds.has(num(r.towerId))).map(idOf).filter(Number.isFinite));
  const okLists = new Set<number>((backup.tables["task_lists"] ?? []).filter((r) => okBoards.has(num(r.boardId))).map(idOf).filter(Number.isFinite));
  const okCards = new Set<number>((backup.tables["task_cards"] ?? []).filter((r) => okLists.has(num(r.listId))).map(idOf).filter(Number.isFinite));

  // يقرّر إن كان الصف يخصّ الوكيل الهدف (يمنع الحقن عبر المستأجرين):
  // - جدول فيه agentId ⇒ يُجبَر agentId=الهدف عند الإدراج ⇒ آمن دائماً.
  // - جدول فيه towerId (بلا agentId) ⇒ towerId يجب أن يكون ضمن مكاتب الهدف.
  // - سلسلة اللوحات ⇒ يجب أن يكون الأب (board/list/card) مقبولاً.
  function rowBelongs(table: string, row: Row): boolean {
    if (agentTableSet.has(table)) return true;
    if (table === "task_lists") return okBoards.has(num(row.boardId));
    if (table === "task_cards") return okLists.has(num(row.listId));
    if (table === "card_photos") return okCards.has(num(row.cardId));
    if (towerTableSet.has(table)) return allowedTowerIds.has(num(row.towerId));
    return true;
  }

  let tablesRestored = 0, rowsRestored = 0;
  await prisma.$transaction(async (tx) => {
    await deleteAgentData(tx as typeof prisma, targetAgentId);

    for (const [table, rowsRaw] of Object.entries(backup.tables)) {
      // أمان: تجاهُل أي جدول باسم غير آمن أو غير موجود فعلاً أو مستثنى (يمنع الحقن عبر ملف ملغّم)
      if (!SAFE_IDENT.test(table) || !realTables.has(table) || EXCLUDE.has(table) || !Array.isArray(rowsRaw) || rowsRaw.length === 0) continue;
      // عزل المستأجر: أسقِط أي صف لا يخصّ مكاتب الوكيل الهدف قبل الإدراج
      const rows = rowsRaw.filter((r) => rowBelongs(table, r));
      if (rows.length === 0) continue;
      const hasAgentId = agentTableSet.has(table);
      await insertRows(tx as typeof prisma, table, rows, targetAgentId, hasAgentId);
      await resyncSequence(tx as typeof prisma, table);
      tablesRestored++; rowsRestored += rows.length;
    }
    // قالب الوصل: يُخزَّن بمفتاح receipt:{targetAgentId}
    for (const s of backup.settings ?? []) {
      const text = s.text ?? null; const value = s.value ?? null;
      await tx.$executeRawUnsafe(
        `INSERT INTO system_settings (type, text, value) VALUES ($1,$2,$3)`,
        `receipt:${targetAgentId}`, text, value,
      ).catch(() => {});
    }
    // تحديث اسم العلامة وإيميل النسخ من الملف (دون المساس بانتهاء الاشتراك/النوع)
    if (backup.agentName) {
      await tx.$executeRawUnsafe(`UPDATE agents SET name = $1 WHERE id = $2`, backup.agentName, targetAgentId).catch(() => {});
    }
  }, { timeout: 120000 });

  return { ok: true, tablesRestored, rowsRestored };
}
