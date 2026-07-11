// أداة نقل البيانات من قاعدة MyNet.v4 (SQLite) إلى PostgreSQL
// الاستخدام: node scripts/migrate-legacy.mjs
// تحافظ على المعرّفات الأصلية (id) لتبقى العلاقات صحيحة، ثم تضبط تسلسل الـ id.
import "dotenv/config";
import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const LEGACY = process.env.LEGACY_DB_PATH || "D:/MyNet.v4/Data/MyNetData.db3";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const sqlite = new Database(LEGACY, { readonly: true, fileMustExist: true });

// أدوات تحويل القيم
const rows = (t) => {
  try {
    return sqlite.prepare(`SELECT * FROM "${t}"`).all();
  } catch {
    return [];
  }
};
const D = (v) => (v ? new Date(v) : null); // تاريخ
const F = (v) => (v === null || v === undefined || v === "" ? null : Number(v)); // رقم
const I = (v) => (v === null || v === undefined || v === "" ? null : parseInt(v)); // صحيح
const S = (v) => (v === null || v === undefined ? null : String(v)); // نص
const B = (v) => Number(v) === 1; // منطقي (isdel)

// خريطة مستوى المستخدم القديم → الدور الجديد
function mapRole(level) {
  switch (Number(level)) {
    case 1:
    case 0:
      return "ADMIN";
    case 2:
      return "ACCOUNTANT";
    case 3:
      return "CASHIER";
    case 4:
      return "TECHNICIAN";
    default:
      return "VIEWER";
  }
}

// إدراج دفعة مع الحفاظ على المعرّف، وتخطّي المكرّر
async function insertKeepId(model, delegate, records, mapFn) {
  let ok = 0;
  for (const r of records) {
    try {
      await delegate.create({ data: mapFn(r) });
      ok++;
    } catch (e) {
      // تجاهل التعارضات (سجل موجود) واستمر
      if (!String(e.message).includes("Unique constraint")) {
        console.warn(`  ⚠ ${model} id=${r?.[Object.keys(r)[0]]}: ${e.message.split("\n")[0]}`);
      }
    }
  }
  console.log(`  ✓ ${model}: ${ok}/${records.length}`);
  return ok;
}

// ضبط تسلسل الـ id بعد إدراج معرّفات صريحة
async function fixSequence(table) {
  try {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
    );
  } catch (e) {
    console.warn(`  ⚠ sequence ${table}: ${e.message.split("\n")[0]}`);
  }
}

async function main() {
  console.log(`\n📦 بدء النقل من: ${LEGACY}\n`);

  // 1) المجموعات
  await insertKeepId("Group", prisma.group, rows("group_brig"), (r) => ({
    id: I(r.gr_id),
    name: S(r.gr_name),
    balance: F(r.gr_balance) ?? 0,
    isDeleted: B(r.gr_isdel),
  }));

  // 2) الأبراج
  await insertKeepId("Tower", prisma.tower, rows("brig"), (r) => ({
    id: I(r.brig_id),
    name: S(r.brig_name),
    address: S(r.brig_address),
    note: S(r.brig_note),
    phone: S(r.brig_phone),
    username: S(r.brig_user),
    password: S(r.brig_pass),
    passOnline: S(r.brig_passOnline),
    type: I(r.brig_type),
    price: I(r.brig_price),
    nesba: I(r.brig_nesba),
    groupId: I(r.brig_groupfk),
    isMain: I(r.brig_main),
    allowAdd: I(r.brig_add),
    allowSms: I(r.brig_sms),
    month: I(r.brig_month),
    isDeleted: B(r.brig_isdel),
  }));

  // 3) معلومات الأبراج
  await insertKeepId("TowerInfo", prisma.towerInfo, rows("brgInfo"), (r) => ({
    id: I(r.brg_id),
    sector: S(r.brg_sector),
    towerId: I(r.brg_fk),
    ip: S(r.brg_ip),
    username: S(r.brg_user),
    password: S(r.brg_pass),
    type: S(r.brg_type),
    userCount: I(r.brg_usercount),
    channel: S(r.brg_chanel),
    company: S(r.brg_company),
    address: S(r.brg_address),
    notes: S(r.brg_notes),
    isDeleted: B(r.brg_isdel),
  }));

  // 4) الباقات
  await insertKeepId("Package", prisma.package, rows("card"), (r) => ({
    id: I(r.card_id),
    name: S(r.card_name),
    priceDollar: F(r.card_priceDO),
    priceDinar: F(r.card_priceDinar),
    addPrice: F(r.card_add),
    towerId: I(r.card_brigfk),
    isDeleted: B(r.card_isdel),
  }));

  // 5) المشتركون
  await insertKeepId("Subscriber", prisma.subscriber, rows("costumer"), (r) => ({
    id: I(r.cost_id),
    name: S(r.cost_name),
    phone: S(r.cost_phone),
    address: S(r.cost_address),
    packageId: I(r.cost_cardFk),
    note: S(r.cost_note),
    dateFrom: D(r.cost_dateFrom),
    dateTo: D(r.cost_dateTo),
    towerId: I(r.cost_bregFk),
    groupId: I(r.cost_GroupFk),
    month: I(r.cost_month),
    money: F(r.cost_money),
    wasel: F(r.cost_wasel),
    carry: F(r.cost_carry),
    sector: S(r.cost_secter),
    state: S(r.cost_state),
    type: I(r.cost_type),
    smsEnabled: I(r.cost_sms),
    createdByUser: S(r.cost_user),
    createdByName: S(r.cost_userName),
    wifiUser: S(r.wifiuser),
    wifiPass: S(r.wifipass),
    cardCode: S(r.cardID),
    tele: S(r.cost_tele),
    mac: S(r.cost_mac),
    affiliate: S(r.cost_affiliate),
    lastSmsDate: D(r.cost_lastSMSDate),
    isDeleted: B(r.cost_isdel),
  }));

  // 6) الحسابات
  await insertKeepId("Account", prisma.account, rows("acounts"), (r) => ({
    id: I(r.acount_id),
    name: S(r.acount_name),
    notes: S(r.acount_notes),
    type: I(r.acount_type),
    typeName: S(r.acount_typeName),
    userId: I(r.acount_userfk),
    isDeleted: B(r.acount_isdel),
  }));

  // 7) وصولات التفعيل
  await insertKeepId("SubscriptionEntry", prisma.subscriptionEntry, rows("Sand"), (r) => ({
    id: I(r.Sand_id),
    date: D(r.Sand_date),
    notes: S(r.Sand_notes),
    dateFrom: D(r.Sand_datefrom),
    dateTo: D(r.Sand_dateto),
    money: F(r.Sand_money),
    moneyIn: F(r.Sand_moneyin),
    moneyCarry: F(r.Sand_moneyCarry),
    moneyType: I(r.Sand_moneyType),
    cardType: S(r.Sand_cardtype),
    withdrawal: F(r.Sand_withdrawal),
    priceDollar: F(r.Sand_pricedolar),
    deposit: F(r.Sand_deposit),
    balance: F(r.Sand_balance),
    operation: S(r.Sand_operation),
    subscriberId: I(r.Sand_cosFk),
    month: S(r.Sand_month),
    card2: S(r.Sand_card2),
    withdrawalIq: F(r.Sand_withdrawal_iq),
    towerId: I(r.Sand_fkBrig),
    nextDate: D(r.Sand_nextdate),
    userId: I(r.Sand_userfk),
    pushType: S(r.Sand_pushType),
    createdByUser: S(r.sand_user),
    addPrice: F(r.Sand_add),
    isDeleted: B(r.Sand_isdel),
  }));

  // 8) الحركات المالية
  await insertKeepId("MoneyTx", prisma.moneyTx, rows("money"), (r) => ({
    id: I(r.money_id),
    moneyIn: F(r.money_in),
    moneyOut: F(r.money_out),
    accountId: I(r.money_acFk),
    userId: I(r.money_userfk),
    date: D(r.money_date),
    notes: S(r.money_notes),
    pc: S(r.money_pc),
    serverDate: D(r.money_serverdate),
    isDeleted: B(r.money_isdel),
  }));

  // 9) الصندوق
  await insertKeepId("Box", prisma.box, rows("box"), (r) => ({
    id: I(r.box_id),
    userId: I(r.box_userfk),
    date: D(r.box_date),
    idFrom: I(r.box_idfrom),
    idTo: I(r.box_idto),
    money: F(r.box_money),
    type: I(r.box_type),
    oldMoney: F(r.box_Oldmoney),
    notes: S(r.box_notes),
    isDeleted: B(r.box_isdel),
  }));

  // 10) أقسام الصندوق
  await insertKeepId("BoxDep", prisma.boxDep, rows("box_dep"), (r) => ({
    id: I(r.dep_id),
    name: S(r.dep_name),
    type: I(r.dep_type),
    money: F(r.dep_money),
    isDeleted: B(r.dep_isdel),
  }));

  // 11) كروت الشحن
  await insertKeepId("RechargeCard", prisma.rechargeCard, rows("cards"), (r) => ({
    id: I(r.crd_id),
    number: S(r.crd_num),
    password: S(r.crd_password),
    serial: S(r.crd_serial),
    useDate: D(r.crd_useDate),
    addDate: D(r.crd_addDate),
    userId: I(r.crd_userFk),
    userName: S(r.crd_user),
  }));

  // 12) المواد
  await insertKeepId("Item", prisma.item, rows("items"), (r) => ({
    id: I(r.item_id),
    name: S(r.item_name),
    category: S(r.item_cat),
    priceDinar: F(r.item_priceDinar),
    priceDollar: F(r.item_priceDolar),
    priceSale: F(r.item_priceSale),
    priceSale2: F(r.item_priceSale2),
    type: I(r.item_type),
    barcode: S(r.item_barcode),
    count: F(r.item_count),
    minCount: I(r.item_MinCount),
    color: S(r.item_color),
    size: S(r.item_size),
    isDeleted: B(r.item_isdel),
  }));

  // 13) الفواتير
  await insertKeepId("Invoice", prisma.invoice, rows("fatora"), (r) => ({
    id: I(r.fatora_id),
    date: D(r.fatora_date),
    number: I(r.fatora_number),
    itemsCount: F(r.fatora_numberItems),
    totalMy: F(r.fatora_total_my),
    waselHim: F(r.fatora_wasel_him),
    pushType: I(r.fatora_pushtype),
    note: S(r.fatora_note ?? r.fatora_notes),
    user: S(r.fatora_user),
    type: S(r.fatora_type),
    subscriberId: I(r.fatora_cosfk),
    isDeleted: B(r.fatora_isdel),
  }));

  // 14) أصناف الفاتورة
  await insertKeepId("InvoiceItem", prisma.invoiceItem, rows("item_fatora"), (r) => ({
    id: I(r.item_fatora_id),
    invoiceId: I(r.item_fatorafk),
    itemId: I(r.item_fatora_itemfk),
    count: F(r.item_fatora_count),
    price: F(r.item_fatora_price),
    buyPrice: F(r.item_fatora_buy),
    note: S(r.item_fatora_note),
    barcode: S(r.item_fatora_barcode),
    color: S(r.item_fatora_color),
    size: S(r.item_fatora_size),
    isDeleted: B(r.item_fatora_isdel),
  }));

  // 15) التذاكر + المراجع
  await insertKeepId("TicketType", prisma.ticketType, rows("tct_type"), (r) => ({
    id: I(r.type_id),
    name: S(r.type_name),
    isDeleted: B(r.type_isdel),
  }));
  await insertKeepId("TicketPriority", prisma.ticketPriority, rows("tct_priorty"), (r) => ({
    id: I(r.pri_id),
    name: S(r.pri_name),
    isDeleted: B(r.pri_isdel),
  }));
  await insertKeepId("TicketState", prisma.ticketState, rows("tct_State"), (r) => ({
    id: I(r.state_id),
    name: S(r.state_name),
    isDeleted: B(r.state_isdel),
  }));
  await insertKeepId("Ticket", prisma.ticket, rows("tct"), (r) => ({
    id: I(r.tct_id),
    createdByUser: S(r.tct_userCreater),
    typeId: I(r.tct_typefk),
    priorityId: I(r.tct_priortyfk),
    statusId: I(r.tct_statusfk),
    desc: S(r.tct_desc),
    note: S(r.tct_note),
    tower: S(r.tct_brig),
    date: D(r.tct_date),
    dateClose: D(r.tct_dateClose),
    isClosed: I(r.tct_close),
    closedByUser: S(r.tct_userClose),
    depName: S(r.tct_depName),
    isDeleted: B(r.tct_isdel),
  }));

  // 16) الأشهر
  await insertKeepId("Month", prisma.month, rows("month"), (r) => ({
    id: I(r.mo_id),
    name: S(r.mo_name),
    notes: S(r.mo_notes),
    user: S(r.mo_user),
    date: D(r.mo_date),
    month: S(r.mo_month),
    money: F(r.mo_money),
    isDeleted: B(r.mo_isdel),
  }));

  // 17) الملاحظات
  await insertKeepId("Note", prisma.note, rows("notes"), (r) => ({
    id: I(r.note_id),
    name: S(r.note_name),
    text: S(r.note_text),
    date: D(r.note_date),
    done: I(r.note_done),
    category: S(r.note_cat),
    desc: S(r.note_desc),
    dateAlert: D(r.note_dateAlert),
    user: S(r.note_user),
    isDeleted: B(r.note_isdel),
  }));

  // 18) الأحداث
  await insertKeepId("Event", prisma.event, rows("events"), (r) => ({
    id: I(r.event_id),
    name: S(r.event_name),
    date: D(r.event_date),
    desc: S(r.event_desc),
    user: S(r.event_user),
  }));

  // 19) إعدادات النظام
  await insertKeepId("SystemSetting", prisma.systemSetting, rows("Setting_system"), (r) => ({
    id: I(r.id),
    type: S(r.type),
    value: S(r.value),
    text: S(r.text),
  }));

  // 20) قوالب الرسائل
  await insertKeepId("SmsTemplate", prisma.smsTemplate, rows("Setting_sms"), (r) => ({
    id: I(r.sms_id),
    type: S(r.sms_type),
    text: S(r.sms_text),
    enable: S(r.sms_enable),
  }));

  // 21) أنواع الإشعار
  await insertKeepId("PushType", prisma.pushType, rows("pushType"), (r) => ({
    id: I(r.id),
    type: S(r.type),
    isDeleted: B(r.isdel),
  }));

  // 22) المستخدمون (بكلمات سر مشفّرة - نستخدم القديمة كبداية)
  const legacyUsers = rows("users");
  let uOk = 0;
  for (const r of legacyUsers) {
    const username = S(r.user_name);
    if (!username) continue;
    try {
      const exists = await prisma.user.findUnique({ where: { username } });
      if (exists) {
        uOk++;
        continue;
      }
      const plain = S(r.user_pass) || "123456";
      await prisma.user.create({
        data: {
          fullName: S(r.Fullname) || username,
          username,
          password: await bcrypt.hash(plain, 10),
          role: mapRole(r.user_level),
          isActive: Number(r.user_active) !== 0,
          isDeleted: B(r.user_isdel),
          legacyId: I(r.user_id),
        },
      });
      uOk++;
    } catch (e) {
      console.warn(`  ⚠ User ${username}: ${e.message.split("\n")[0]}`);
    }
  }
  console.log(`  ✓ User: ${uOk}/${legacyUsers.length} (كلمات السر شُفّرت)`);

  // ضبط التسلسلات
  console.log("\n🔧 ضبط تسلسلات المعرّفات...");
  for (const t of [
    "groups", "towers", "tower_info", "packages", "subscribers", "accounts",
    "subscription_entries", "money_tx", "boxes", "box_deps", "recharge_cards",
    "items", "invoices", "invoice_items", "tickets", "ticket_types",
    "ticket_priorities", "ticket_states", "months", "notes", "events",
    "system_settings", "sms_templates", "push_types", "users",
  ]) {
    await fixSequence(t);
  }

  console.log("\n✅ اكتمل النقل بنجاح.\n");
}

main()
  .catch((e) => {
    console.error("❌ فشل النقل:", e);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
