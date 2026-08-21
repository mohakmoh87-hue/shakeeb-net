import fs from "node:fs";
const L = (...x) => x.join("\n");
const p = "src/lib/subscriptionSync.ts";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const lines = s.split("\n");
const a = lines.findIndex((l) => l.includes("const classifyDateJump = async ("));
const b = lines.findIndex((l, i) => i > a && l === "    };");
if (a < 0 || b < 0) throw new Error("bounds");
const body = L(
"    const classifyDateJump = async (",
"      sub: { id: number; netUser: string | null; name: string | null; dateTo: Date | null },",
"      sasId: number, username: string | null, newSasExp: Date | null,",
"    ): Promise<boolean> => {",
"      const uKey = (username ?? sub.netUser ?? \"\").trim().toLowerCase();",
"      if (!uKey) return false;",
"      // 🎯 سؤالٌ واحدٌ موجَّهٌ للساس عن هذا اليوزر — بديلُ المسح الزمنيّ الذي ثبت فشلُه",
"      //    (التقريرُ مُجمَّعٌ بالمنجر لا بالتاريخ، فتفعيلاتُ الكابينات تغيب عن أيّ مسحٍ زمنيّ).",
"      const probe = await sasUserActivations(base, token, username ?? sub.netUser ?? \"\");",
"      if (!probe.ok || !probe.rows.length) return false; // تعذّرٌ أو لا تاريخَ ⇒ لا حكم",
"      // 💸 **شرطُ القرض الوحيد** (نصُّ محمد): آخرُ تفعيلٍ بمبلغ صفرٍ ⇒ قرضٌ ⇒ لا فرقَ تاريخٍ",
"      //    ولا تبويبَ تفعيلٍ (وهو مُسجَّلٌ مختوماً أصلاً حين يمرّ في حلقة الأحداث).",
"      const last = probe.rows[0];",
"      if (last && Math.round(last.price || 0) <= 0) { actedSasIds.add(sasId); return true; }",
"      // التفعيلةُ التي أنتجت تاريخَ الساس الحاليّ (±١٢ ساعة)، وإلّا فآخرُ تفعيلاته",
"      const hit = (newSasExp && probe.rows.find((r) => sameExpiry(r.newExpiration ? new Date(r.newExpiration) : null, newSasExp))) || last;",
"      const actAt = hit.createdAt ? new Date(hit.createdAt) : null;",
"      if (!actAt || isNaN(actAt.getTime())) return false;",
"      const newExp = hit.newExpiration ? new Date(hit.newExpiration) : null;",
"      // 💰 مقبوضٌ عندي (وصلٌ قريبٌ أو وصلٌ ينتهي بانتهائه) ⇒ ليس خارجيّاً — يبقى فرقَ تاريخٍ يدويّاً",
"      if (await collectedByUs(uKey, sub.id, actAt, newExp ?? newSasExp)) return false;",
"      const mgr = (hit.managerUsername ?? \"\").trim();",
"      const managerIsPage = mgr.toLowerCase() === officeUser;",
"      const ownCabinet = isOwnCabinet(hit.username ?? sub.netUser, mgr);",
"      const evBase = {",
"        agentId: office.agentId ?? -1, towerId: officeId, sasId, subscriberId: sub.id,",
"        netUser: hit.username ?? sub.netUser, name: hit.name ?? sub.name,",
"        amount: Math.round(hit.price || 0), activatedAt: actAt,",
"        sasDateTo: newExp && !isNaN(newExp.getTime()) ? newExp : null,",
"      };",
"      const isLoanAct = Math.round(hit.price || 0) <= 0;",
"      if (managerIsPage || ownCabinet) {",
"        // 🏷️ منجرُ صفحةِ المكتب ⇒ «تفعيلاتُ ساس» · منجرُ كابينةِ صاحبه ⇒ «تفعيلٌ خارجيّ»",
"        await recordActivationEvent(managerIsPage ? \"sas\" : \"self\", { ...evBase, loan: isLoanAct });",
"      } else {",
"        stillInstalls.add(sasId);",
"        await recordCompanyActivation({ ...evBase, loan: isLoanAct, managerName: mgr || null });",
"      }",
"      actedSasIds.add(sasId);",
"      return true;",
"    };",
);
lines.splice(a, b - a + 1, ...body.split("\n"));
s = lines.join("\n");

const must = (o, n) => { if (!s.includes(o)) throw new Error("sync: " + o.slice(0, 60)); s = s.replace(o, n); };
// الاستيراد
must(
  "  sasProbeSerial, sasActivationWindow, actWindowFindSerial, type ActWindow,",
  "  sasProbeSerial, sasUserActivations,",
);
// المسبارُ يُنادى للزيادة **والنقص** (فالنقصُ قد يفسّره تفعيلٌ أيضاً)، وقرضٌ يُغلق البابَ
must(
  L(
    "            if (!classified && grew) {",
    "              // 💸 **شرطُ القرض الوحيد** (تصحيحُ محمد 2026-08-21 الحرفيّ): «عند اختلاف",
    "              //    الأيّام يُفحَص **آخرُ تفعيلٍ له** في تقرير التفعيلات، فإن كان المبلغُ",
    "              //    صفراً فهو قرض» — لا عددَ أيّامٍ ولا شرطَ كارتٍ ولا مطابقةَ تاريخ.",
    "              const win = await getActWin();",
    "              const uk = (u.username ?? p.netUser ?? \"\").trim().toLowerCase();",
    "              const cands = [...(win.bySasId.get(u.sasId) ?? []), ...(uk ? win.byUser.get(uk) ?? [] : [])];",
    "              // النافذةُ مرتَّبةٌ من الأحدث، فأوّلُ ما يقع عليه هو آخرُ تفعيلاته",
    "              const last = cands.sort((x, y) => String(y.createdAt ?? \"\").localeCompare(String(x.createdAt ?? \"\")))[0];",
    "              if (last && Math.round(last.price || 0) <= 0) classified = true; // قرضٌ صريح",
    "            }",
    "            if (!classified && grew && dateProbes < MAX_DATE_PROBES) {",
    "              dateProbes++;",
    "              classified = await classifyDateJump(p, u.sasId, u.username, validDate);",
    "            }",
  ),
  L(
    "            // 🎯 كلُّ اختلافِ تاريخٍ يُسأل عنه الساسُ مباشرةً (زيادةً ونقصاً): مَن المنجر؟",
    "            //    كم المبلغ؟ — فيُصنَّف في تبويبه، أو يُعرَف أنّه قرضٌ فيُسكَت عنه.",
    "            if (!classified && dateProbes < MAX_DATE_PROBES) {",
    "              dateProbes++;",
    "              classified = await classifyDateJump(p, u.sasId, u.username, validDate);",
    "            }",
  ),
);
fs.writeFileSync(p, s);
console.log("s2 ok");
