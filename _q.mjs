import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").match(/DATABASE_URL="([^"]+)"/)[1];
const sql = neon(url);
const now = Date.now();
const bg = (d)=> d? new Date(new Date(d).getTime()+3*3600e3).toISOString().replace('T',' ').slice(0,19):null;
console.log("الآن بغداد:", bg(new Date()));
console.log("\n== العمّال (هل أحدهم متصل الآن؟) ==");
const w = await sql`select "machineId","displayName","name","agentId","approved","blocked","lastSeen" from hybrid_workers where "blocked"=false order by "lastSeen" desc nulls last`;
for (const x of w){ const ago=x.lastSeen?Math.round((now-new Date(x.lastSeen).getTime())/1000):null; const on=ago!=null&&ago<=60; console.log(`${x.displayName??x.name} agent=${x.agentId} approved=${x.approved} | آخر ظهور ${bg(x.lastSeen)} (منذ ${ago!=null?Math.round(ago/60):'?'} د) ${on?'🟢 متصل':'🔴 غير متصل'}`); }
console.log("\n== جلسات الواتساب (الحالة + حداثتها) ==");
const wa = await sql`select "towerId", state, error, "updatedAt" from wa_sessions order by "towerId"`;
for (const s of wa){ const ago=s.updatedAt?Math.round((now-new Date(s.updatedAt).getTime())/60000):null; console.log(`مكتب ${s.towerId}: ${s.state}${s.error?` (خطأ: ${s.error})`:''} — آخر تحديث ${bg(s.updatedAt)} (منذ ${ago} د)`); }
console.log("\n== آخر 8 رسائل واتساب (الحالة) ==");
const m = await sql`select id, status, phone, "createdByUser" as u, error, date from messages where channel='WHATSAPP' order by date desc nulls last limit 8`;
for (const x of m) console.log(`#${x.id} ${x.status}${x.error?` err="${(x.error||'').slice(0,40)}"`:''} @ ${bg(x.date)} by=${x.u||'-'}`);
console.log("\n== طلبات المُرحِّل الأخيرة (waRelay) ==");
try { const r = await sql`select id, "towerId", kind, status, error, "createdAt" from wa_relay order by id desc limit 6`; for (const x of r) console.log(`#${x.id} مكتب${x.towerId} ${x.kind} → ${x.status}${x.error?` err="${(x.error||'').slice(0,40)}"`:''} @ ${bg(x.createdAt)}`); } catch(e){ console.log("(تعذّر قراءة wa_relay:", e.message.slice(0,60),")"); }
