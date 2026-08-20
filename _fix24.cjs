const fs=require("fs"); const R=(f)=>fs.readFileSync(f,"utf8").replace(/\r\n/g,"\n"); const W=(f,s)=>fs.writeFileSync(f,s);
const rep=(f,s,a,b,tag)=>{const c=s.split(a).length-1;if(c!==1){console.log("FAIL",tag,":",c);process.exit(1);}return s.replace(a,b);};
let done=[];
{ const f="src/lib/field.ts"; let s=R(f);
  const a=[
'  if (!dayKey) return null;',
'  const l = await prisma.leave.findFirst({',
'    where: { technicianId, dayKey, kind: "time", status: "approved", isDeleted: false },',
'    select: { startMin: true, endMin: true },',
'    orderBy: { id: "desc" },',
'  }).catch(() => null);',
'  return l?.startMin != null && l.endMin != null ? { startMin: l.startMin, endMin: l.endMin } : null;'].join("\n");
  const b=[
'  if (!dayKey) return null;',
'  // متوسّط(٢٤) · كان `.catch(() => null)` يحوّل **فشلَ القاعدة** إلى «لا إجازة» — فيُخصَم',
'  // من راتب فنيٍّ وقتٌ أذن به المديرُ فعلاً. المالُ الخاطئ أسوأُ من فشلٍ صريح: تُعاد',
'  // المحاولةُ مرّةً، وفشلُ الثانية يُرمى عمداً (حسابٌ توقّف خيرٌ من راتبٍ منقوص).',
'  const q = () => prisma.leave.findFirst({',
'    where: { technicianId, dayKey, kind: "time", status: "approved", isDeleted: false },',
'    select: { startMin: true, endMin: true },',
'    orderBy: { id: "desc" },',
'  });',
'  let l;',
'  try { l = await q(); }',
'  catch { await new Promise((r) => setTimeout(r, 1000)); l = await q(); }',
'  return l?.startMin != null && l.endMin != null ? { startMin: l.startMin, endMin: l.endMin } : null;'].join("\n");
  s=rep(f,s,a,b,"24"); W(f,s); done.push("24"); }
{ const f="src/app/api/manager/card-guard/route.ts"; let s=R(f);
  s=rep(f,s,
'      where: { id: row.subscriberId, towerId: { in: towers.map((t) => t.id) } }, select: { id: true },',
'      where: { id: row.subscriberId, towerId: { in: towers.map((t) => t.id) } }, select: { id: true, dateTo: true },',"30a");
  const a2=[
'    const newTo = new Date(entry.dateFrom.getTime() + days * 86400_000);',
'    await prisma.subscriptionEntry.update({ where: { id: entry.id }, data: { dateTo: newTo } });'].join("\n");
  const b2=[
'    const newTo = new Date(entry.dateFrom.getTime() + days * 86400_000);',
'    await prisma.subscriptionEntry.update({ where: { id: entry.id }, data: { dateTo: newTo } });',
'    // متوسّط(٣٠) · النسختان كانتا تفترقان: يُصحَّح تاريخُ الوصل ويبقى تاريخُ المشترك الحيُّ',
'    // القديمَ (وعليه تعمل المزامنةُ والتذكيراتُ والتقارير). إن كان تاريخُ المشترك مأخوذاً',
'    // من هذا الوصل بعينه (يطابق قيمتَه القديمة) صُحّح معه — وإلّا فلا يُمَسّ.',
'    if (sub.dateTo != null && entry.dateTo != null && sub.dateTo.getTime() === entry.dateTo.getTime()) {',
'      await prisma.subscriber.update({ where: { id: sub.id }, data: { dateTo: newTo } });',
'    }'].join("\n");
  s=rep(f,s,a2,b2,"30b"); W(f,s); done.push("30"); }
{ const f="src/app/api/field/technicians/route.ts"; let s=R(f);
  const a=[
'  await prisma.technician.update({ where: { id }, data });',
'  // مواءمة حساب الموظف مع المكتب الجديد (ليظهر الفني وذمّته/راتبه في مكتبه الحالي)',
'  if (data.towerId != null && tech.accountId) {',
'    await prisma.account.update({ where: { id: tech.accountId }, data: { towerId: newTowerId } }).catch(() => {});',
'  }'].join("\n");
  const b=a+[
'',
'  // متوسّط(٣١) · إعادةُ التسمية كانت تترك نسخةَ الاسم في حساب الموظف الماليّ على القديم —',
'  // فكشوفُ الرواتب والذمم تحمل اسماً لم يعد اسمَه. المرآةُ تكتمل: الاسمُ يُواكَب كالمكتب.',
'  if (typeof data.name === "string" && data.name.trim() && tech.accountId) {',
'    await prisma.account.update({ where: { id: tech.accountId }, data: { name: data.name.trim() } }).catch(() => {});',
'  }'].join("\n");
  s=rep(f,s,a,b,"31"); W(f,s); done.push("31"); }
{ const f="src/app/api/manager-accounts/tx/route.ts"; let s=R(f);
  const a=[
'  const pairId = Number(row.notes?.match(/زوج #(\d+)/)?.[1] ?? NaN);',
'  if (Number.isFinite(pairId)) {',
'    const other = await prisma.managerTx.findFirst({ where: { id: pairId, isDeleted: false, agentId }, select: { id: true, notes: true } });',
'    const mutual = other && Number(other.notes?.match(/زوج #(\d+)/)?.[1] ?? NaN) === row.id;',
'    if (mutual) {'].join("\n");
  const b=[
'  // متوسّط(٣٤) · كانت **أوّلُ** علامةٍ وحدَها تُقرأ: نصُّ مستخدمٍ يحمل «زوج #س» قبل',
'  // العلامة الحقيقيّة كان يحجبها ⇒ يُحذف شقٌّ واحدٌ من تحويلٍ حقيقيّ. الآن تُجرَّب كلُّ',
'  // العلامات، والتبادلُ (كلٌّ يشير للآخر) يبقى الفيصلَ القاطع.',
'  const pairIds = [...(row.notes ?? "").matchAll(/زوج #(\d+)/g)].map((m) => Number(m[1])).filter((x) => Number.isFinite(x));',
'  for (const pairId of pairIds) {',
'    const other = await prisma.managerTx.findFirst({ where: { id: pairId, isDeleted: false, agentId }, select: { id: true, notes: true } });',
'    const mutual = other && [...(other.notes ?? "").matchAll(/زوج #(\d+)/g)].some((m) => Number(m[1]) === row.id);',
'    if (mutual) {'].join("\n");
  s=rep(f,s,a,b,"34"); W(f,s); done.push("34"); }
console.log("OK", done.join(" "));
