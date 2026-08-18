# SHAKEEB — دليل التعافي والتسليم الشامل (Disaster Recovery & Handoff)

> **لمن هذا الملف؟** لك، ولأي مساعد (إنسان أو ذكاء اصطناعي مثل Claude) يُكمل العمل على النظام.
> **ماذا يفترض؟** أسوأ سيناريو: **فقدتَ الحاسبة _و_ فقدتَ حسابات السحابة**. باتّباعه تعيد بناء
> `shakeebnet.com` كاملاً على حاسبة جديدة وسحابة جديدة **دون فقدان أي شيء**.
>
> 🔑 **القاعدة الذهبية:** الكود يُستعاد من GitHub بسهولة. الشيئان اللذان **لا يُستعادان إن ضاعا**
> هما: **(1) بيانات قاعدة البيانات، (2) قيم الأسرار.** لذا حقيبة النجاة (القسم 2) هي حياتك.

---

## 1. ما هو النظام وممّ يتكوّن

نظام إدارة مكاتب إنترنت **متعدّد المستأجرين** (كل «وكيل» = مستأجر مستقل، له «أبراج/مكاتب»،
وكل مكتب له مشتركوه وفنّيوه وحساباته). Next.js (نسخة معدّلة — انظر `AGENTS.md`).

| المكوّن | التقنية | الدور |
|---|---|---|
| **التطبيق** | Next.js (standalone) في حاوية Docker على **Azure Container Apps** | الموقع نفسه |
| **القاعدة** | **Aiven PostgreSQL 17** (مجاني) | كل البيانات (~10 آلاف مشترك) |
| **الدومين/الحماية** | **Cloudflare** (Free) | DNS + SSL + كاش + DDoS |
| **خطّ النشر** | **GitHub Actions** + **Docker Hub** | دفعة للفرع ← بناء ← نشر تلقائي |
| **حواسيب المكاتب** | Node worker (يفحص `git fetch` كل ١٠ دقائق ويحدّث نفسه) | واتساب + طباعة + مزامنة SAS محليّة |
| **تطبيق الهاتف** | APK (Capacitor) من فرع `native-app` | بصمة حضور الفنيين |
| **البريد** | Gmail SMTP | استرجاع كلمة السر + النسخ الاحتياطية |
| **الإشعارات** | Firebase FCM + Web Push (VAPID) | إشعارات الهاتف |

**تدفّق مهم:** حواسيب المكاتب تتّصل بـ Aiven **مباشرةً** (لا عبر Azure) بدور مقيّد
(`agent_<id>_worker` محكوم بـRLS). التطبيق يتّصل بـ Aiven بدور `avnadmin` (كامل الصلاحية).

---

## 2. 🎒 حقيبة النجاة — ما يجب أن تحتفظ به **الآن ودائماً** (الأهم)

احتفظ بهذه في **٣ أماكن مستقلة** (مدير كلمات سر + قرص خارجي + تخزين سحابي مختلف عن Azure/Aiven):

| # | العنصر | كيف تحصل عليه | حرِج؟ | يُحدَّث |
|---|---|---|---|---|
| 1 | **نسخة قاعدة البيانات** (`.sql`) | القسم ٢·١ (`pg_dump`) | 🔴 لا بديل عنه | يومياً/أسبوعياً |
| 2 | **جرد قيم الأسرار** (كل `env`) | القسم ٢·١ | 🔴 | عند أي تغيير |
| 3 | **الكود** (فرعا `main` + `native-app`) | القسم ٢·١ (`git bundle`) | 🟡 (في GitHub أصلاً) | عند تغييرات كبيرة |
| 4 | **هذا الملف** `RECOVERY.md` | نسخة مطبوعة/محفوظة | 🟡 | نادراً |
| 5 | **المفاتيح الحرجة منفردة**: `CREDS_ENC_KEY`، `AUTH_SECRET`، `DB_SSL_CA_B64` | من جرد الأسرار | 🔴 | ثابتة |
| 6 | **`prisma/schema.prisma`** (داخل حزمة الكود) | مع الكود | 🔴 | مع كل عمود جديد |

> بنسخة القاعدة + جرد الأسرار وحدهما تستطيع إعادة بناء **كل شيء** من الصفر.
> ونسخة `pg_dump` تحمل المخطط معها — أمّا نسخة المالك (JSON) فتحتاج مخططاً مبنيّاً أولاً (٥·٣).

### 2.1 كيف تصنع حقيبة النجاة (أوامر جاهزة — PowerShell)

> شغّلها في مجلّد آمن **خارج** المستودع (مثلاً `Desktop\shakeeb-backup`). الناتج سرّي — خزّنه بأمان.

```powershell
# اذهب لمجلّد آمن خارج المستودع
mkdir "$env:USERPROFILE\Desktop\shakeeb-backup" -Force; cd "$env:USERPROFILE\Desktop\shakeeb-backup"

# 1) نسخة القاعدة (الأهم) — تقرأ الرابط من Azure ثم pg_dump
$DB = az containerapp show -n app-shakeeb-test -g rg-shakeeb-test --query "properties.template.containers[0].env[?name=='DATABASE_URL'].value | [0]" -o tsv
pg_dump "$DB" --no-owner --no-acl -f ("database-" + (Get-Date -Format yyyyMMdd) + ".sql")

# 2) جرد الأسرار: كل متغيّرات البيئة + قيم الأسرار (creds-enc-key ...)
az containerapp show -n app-shakeeb-test -g rg-shakeeb-test --query "properties.template.containers[0].env" -o json > secrets-env.json
az containerapp secret show -n app-shakeeb-test -g rg-shakeeb-test --secret-name creds-enc-key --query value -o tsv > creds-enc-key.txt

# 3) حزمة الكود (كل الفروع) — نفّذها من داخل المستودع
git -C "C:\Users\shake\OneDrive\Desktop\Shakeeb net\mynet-web" bundle create "$env:USERPROFILE\Desktop\shakeeb-backup\shakeeb-code.bundle" --all
```
انقل المجلّد بعدها إلى **٣ أماكن مستقلة** (مدير كلمات سر + قرص خارجي + تخزين سحابي مختلف).

---

## 3. جرد الأسرار (الأسماء والغرض — **القيم في حقيبتك لا هنا**)

كلها متغيّرات بيئة على تطبيق Azure (عدا ما يخصّ GitHub). اقرأ القيم الحيّة بـ
`az containerapp show ... --query "properties.template.containers[0].env"` (أوامر القسم ٢·١).

| المتغيّر | الغرض | إن ضاع | حرِج |
|---|---|---|---|
| `DATABASE_URL` | رابط Aiven بدور `avnadmin` (المستخدم/الكلمة/المضيف/القاعدة) | يشير للبيانات — احتفظ به | 🔴 |
| `DB_SSL_CA_B64` | شهادة Aiven CA (base64) للاتصال المشفّر | يُعاد تنزيلها من Aiven إن بقي الحساب | 🔴 |
| `DB_DRIVER` | يختار سائق Prisma (قيمة `pg` للـPostgreSQL القياسي) | أعِد ضبطه `pg` | 🟢 |
| `AUTH_SECRET` | توقيع جلسات الدخول (JWT HS256) | تغييره يُخرج **الجميع** (يعيدون الدخول فقط) | 🔴 |
| `CREDS_ENC_KEY` | تشفير `plainPassword`/`plainCode` المخزَّنة | تغييره ⇒ تعذّر عرض كلمات السر المخزَّنة (**الدخول يبقى سليماً**) | 🔴 |
| `CRON_SECRET` | حماية مسارات `/api/cron/*` و`hosting-usage` | ولّد جديداً وحدّثه في أسرار GitHub أيضاً | 🟡 |
| `APP_BASE_URL` / `APP_URL` | الدومين العام `https://shakeebnet.com` (لروابط التنصيب) | أعِد ضبطه | 🟡 |
| `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | بريد Gmail (كلمة مرور تطبيق) | ولّد كلمة مرور تطبيق جديدة من Gmail | 🟡 |
| `FIREBASE_SERVICE_ACCOUNT_B64` | حساب خدمة FCM (base64) | **يجب بقاء نفس مشروع Firebase** وإلا بطلت رموز أجهزة الفنيين | 🔴 |
| `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` | Web Push للمتصفح | ولّد زوجاً جديداً (`npx web-push generate-vapid-keys`) — يُعيد المتصفّحون الاشتراك | 🟢 |
| `DB_SIZE_LIMIT_MB` | حدّ مؤشّر حجم القاعدة (قيمة `1000` لـAiven) | تجميلي | 🟢 |

**أسرار GitHub** (Settings ← Secrets ← Actions): `DOCKERHUB_USERNAME`، `DOCKERHUB_TOKEN`،
`AZURE_CREDENTIALS` (بيانات Service Principal بصيغة JSON)، `CRON_SECRET`، `APP_BASE_URL`.

**سرّ سجل Azure:** `dockerio-shakeebshakeeb` (= نفس `DOCKERHUB_TOKEN`) — لسحب الصورة عند الإقلاع.
⚠️ **رمز Docker Hub مستعمل في مكانين** (سرّ GitHub + سرّ سجل Azure) — تدويره يتطلّب تحديث الاثنين.

---

## 4. الحسابات والموارد (الهوية)

| الخدمة | الحساب/المعرّف | تفاصيل |
|---|---|---|
| **Azure** | `shakeebshakeeb1987@gmail.com` | اشتراك «Azure subscription 1»، Pay-As-You-Go. المجموعة `rg-shakeeb-test`، البيئة `cae-shakeeb-test`، التطبيق `app-shakeeb-test`، المنطقة `germanywestcentral` |
| **Aiven** | (حساب المستخدم) | مشروع `shakeeb-net`، خدمة `pg-shakeeb-test`، مضيف `pg-3b75309e-shakeeb-net.l.aivencloud.com:23629/defaultdb` |
| **Cloudflare** | (حساب المستخدم) | نطاق `shakeebnet.com`، خادما الأسماء `aldo/zainab.ns.cloudflare.com`، وضع SSL **Full** (بروكسي برتقالي) |
| **GitHub** | `mohakmoh87-hue` | المستودع `shakeeb-net`، الفرع الإنتاجي `main`، فرع النشر الحالي `claude/adoring-meninsky-e8db74`، فرع الهاتف `native-app` |
| **Docker Hub** | `shakeebshakeeb` | مستودع خاص `shakeebshakeeb/shakeeb-net` |
| **Gmail SMTP** | `shakeebshakeeb1987@gmail.com` | كلمة مرور تطبيق (يتطلّب 2FA) |
| **Firebase** | مشروع `shakeeb-net` | حساب خدمة FCM |

---

## 5. 🔧 إعادة البناء الكاملة من الصفر

> الترتيب مهمّ: **قاعدة → أسرار → تطبيق → دومين → حواسيب المكاتب**.

### 5.1 تجهيز الحاسبة الجديدة
ثبّت: **Git**، **Node.js LTS**، **Azure CLI** (`az`)، **PostgreSQL client** (`psql`/`pg_dump`/`pg_restore`)، (اختياري: **Docker**).
تسجيل الدخول: `az login`.

### 5.2 استعادة الكود
```bash
git clone https://github.com/mohakmoh87-hue/shakeeb-net.git
# لو فُقد GitHub أيضاً: استعد من حقيبتك:  git clone shakeeb-net.bundle shakeeb-net
```

### 5.3 قاعدة بيانات جديدة (Aiven أو أي PostgreSQL 17)
1. أنشئ خدمة PostgreSQL جديدة، واحصل على رابطها (`avnadmin`) وشهادة CA.
2. استعد البيانات من حقيبتك:
   ```bash
   psql "<NEW_DATABASE_URL>" -f backup-YYYYMMDD.sql
   ```
   > **نسخة `pg_dump` تحمل المخطط والبيانات معاً** — وهذا الطريق المضمون.
   > **أمّا نسخة المالك الكاملة (`shakeeb-full-*.json.gz`) فتحمل الصفوف لا المخطط**: لا
   > تُستعمل إلا على قاعدة **مبنيّ مخططها أولاً**:
   > ```bash
   > DATABASE_URL="<NEW_DATABASE_URL>" npx prisma db push   # يبني ٥٤ جدولاً من schema.prisma
   > ```
   > ⚠️ **تعديلات المخطط تُطبَّق على القاعدة الحيّة يدوياً** (ALTER/CREATE) **مع** تحديث
   > `prisma/schema.prisma` في نفس الدفعة — فالملف هو المرجع، و`db push` يعيد بناء كل شيء.
   > راجع القسم ١١ لسجل ما أُضيف ومتى.
3. **أعِد تطبيق العزل RLS** (إلزامي — العزل يعتمد عليه للحواسيب):
   ```bash
   psql "<NEW_DATABASE_URL>" -f prisma/rls/01-infra.sql
   psql "<NEW_DATABASE_URL>" -f prisma/rls/02-grants.sql
   psql "<NEW_DATABASE_URL>" -f prisma/rls/03-policies.sql
   ```
   ثم يُعاد إنشاء دور كل وكيل تلقائياً عند أول «تنصيب حاسبة مكتب» (أو يدوياً عبر
   `SELECT create_agent_worker_role(id, '<كلمة عشوائية>') FROM agents WHERE "isDeleted"=false;`).
   > بعد الاستعادة صفّر `agents."workerDbUrl"` لأن الأدوار القديمة لم تعد موجودة — تُولَّد من جديد عند التنصيب.

### 5.4 استضافة تطبيق جديدة (Azure Container Apps أو أي مضيف Docker)
1. أنشئ Resource Group + Container Apps Environment + Container App.
2. **اضبط كل متغيّرات البيئة** من جرد الأسرار (القسم 3) — مع `DATABASE_URL` و`DB_SSL_CA_B64` الجديدين.
   خزّن الحسّاس كأسرار: مثال `CREDS_ENC_KEY`:
   ```bash
   az containerapp secret set -n <app> -g <rg> --secrets "creds-enc-key=<VALUE>"
   az containerapp update -n <app> -g <rg> --set-env-vars "CREDS_ENC_KEY=secretref:creds-enc-key"
   ```
3. اضبط بيانات سجل الصور (Docker Hub) لسحب الصورة:
   ```bash
   az containerapp registry set -n <app> -g <rg> --server docker.io --username shakeebshakeeb --password <DOCKER_PAT>
   ```

### 5.5 النشر
- **عبر GitHub Actions (الطريقة المعتادة):** اضبط أسرار المستودع (القسم 3) ثم ادفع للفرع →
  `.github/workflows/build-trial-image.yml` يبني ويدفع لـDocker Hub وينشر على Azure تلقائياً.
- **يدوياً (بلا CI):**
  ```bash
  docker build -t shakeebshakeeb/shakeeb-net:manual .
  docker push shakeebshakeeb/shakeeb-net:manual
  az containerapp update -n <app> -g <rg> --image docker.io/shakeebshakeeb/shakeeb-net:manual
  ```

### 5.6 الدومين والشهادة (Cloudflare)
> **دومين جديد مقبول تماماً:** لا حاجة لاستعادة `shakeebnet.com` بعينه — اشترِ أي دومين جديد،
> وجّهه للمضيف الجديد، واضبط `APP_BASE_URL`/`APP_URL` عليه. النظام يعمل على أي دومين.
1. في Cloudflare: وجّه `A @` و`CNAME www` إلى المضيف الجديد على Azure، وأضف سجل `TXT asuid`
   (قيمته من Azure: Custom domains ← verification ID).
2. الشهادة: شهادة Azure المُدارة قد تفشل بسبب تحويل ACME — الحل المُجرّب: **شهادة موقّعة ذاتياً**
   مربوطة على Azure + وضع Cloudflare SSL = **Full** (ليس Strict). راجع [[shakeeb-azure-trial]].

### 5.7 حواسيب المكاتب
كلٌّ يُعاد تنصيبه برمز جديد: لوحة المدير ← «تنصيب حاسبة مكتب» ← ينسخ الأمر ويشغّله (يجلب
`.env` بدور الوكيل الجديد من `install-config`). لا إدخال روابط يدوياً.

### 5.8 التحقّق النهائي
- الموقع يفتح ويسجّل الدخول (مالك + مدير + فني).
- عدد المشتركين مطابق للنسخة.
- لوحة المالك تعرض كلمات سرّ المدراء (يثبت أن `CREDS_ENC_KEY` صحيح).
- نبضة حاسبة مكتب حيّة + مزامنة تعمل.

---

## 6. العمليات اليومية (كيف تشتغل تماماً مثل الجلسة الحالية)

- **نشر تعديل:** ادفع إلى الفرع → بناء ونشر تلقائيان (~2–10 دقائق).
- **تأكيد النشر:** `az containerapp show -n app-shakeeb-test -g rg-shakeeb-test --query "properties.template.containers[0].image" -o tsv` حتى تتغيّر الوسم.
- **الوصول للقاعدة:** `psql "$DATABASE_URL"` (اقرأ الرابط من Azure أو حقيبتك).
- **تدوير سرّ:** حدّثه في **كل** مستهلكيه (الدرس المكلف: Docker PAT في مكانين، و`DATABASE_URL` = كلمة Aiven).
- **تنصيب/تحديث حاسبة مكتب:** لوحة المدير ← «تنصيب حاسبة مكتب».
- **النسخ الاحتياطية:**
  - *لكل وكيل:* نسخته تصل إيميله يومياً (كرون `auto-checkout` 00:15 بغداد).
  - *للمالك (نظام كامل):* ملف واحد `shakeeb-full-*.json.gz` يضمّ **كل الوكلاء** يصل إيميل المالك
    (حساب المالك ← «إيميل النسخة الكاملة»). التشغيل: workflow `owner-backup.yml` كل ساعة →
    `/api/cron/owner-backup`، و**أول تشغيل في اليوم يُرسل** ثم يمتنع البقيّة (مانع ازدواج بيوم
    بغداد). **الوقت المضبوط تفضيلٌ معروض لا شرط** — لأن GitHub يؤخّر الجدولة ساعات، وشرطُ
    الساعة الصارم أسقط النسخة ثلاث ليالٍ بصمت (2–5 آب 2026).
  - *الاستعادة الكاملة:* حساب المالك ← «استعادة نسخة كاملة» وارفع الملف، أو `POST /api/owner/restore-full`
    (يستبدل **كل** البيانات — يعود كل الوكلاء تماماً كما وقت النسخ). **تفترض مخططاً مبنيّاً** (القسم ٥·٣).
    للتعافي الكامل على قرص استعمل أوامر القسم ٢·١.
- **الكرون الليلي (`auto-checkout.yml`)** يعمل بنداءات قصيرة مستقلّة: `?step=daily` ثم `?step=list`
  ثم `?step=sync&officeId=` لكل مكتب — لأن بوّابة Azure تقطع أي طلب يتجاوز ~٢٤٠ ثانية (القسم ٨).
  تشغيله يدوياً: صفحة Actions ← `auto-checkout-cron` ← Run workflow.

---

## 7. نموذج الأمان (اقرأه قبل أي تعديل)

- **التطبيق يتّصل كـ`avnadmin` (superuser) فيتجاوز RLS بالكامل ⇒ فحص الكود (`guard` + `agentId`/`ownsTower`/`towerScope`) هو الدفاع الوحيد عن العزل.** لا تكتب مساراً يقرأ/يكتب بيانات مستأجر دون فحص ملكيّته.
- **حواسيب المكاتب** تتّصل بدور `agent_<id>_worker` محكوم بـRLS (دفاع عميق). راجع `prisma/rls/README.md`.
- **بيانات الدخول المعروضة** (`plainPassword`/`plainCode`) مشفّرة عند التخزين بـ`CREDS_ENC_KEY`؛ الدخول نفسه على bcrypt منفصل. راجع [[shakeeb-creds-enc-key]].
- المصادقة HS256 بإعادة تحقّق من القاعدة + تحديد معدّل + قفل حساب. حقن SQL مصدود (معاملات + قائمة بيضاء + `SAFE_IDENT`). SSRF مصدود في بروكسي SAS.

---

## 8. مطبّات ودروس (Gotchas)

- **Next.js معدّل:** اقرأ `node_modules/next/dist/docs/` قبل كتابة كود Next — قد تختلف الواجهات عن المعتاد (`AGENTS.md`).
- **Docker Hub PAT في مكانين** (سرّ GitHub + سرّ سجل Azure) — تدويره يتطلّب تحديث الاثنين وإلا `ImagePullUnauthorized` عند أول إقلاع بارد.
- **Windows/Git Bash:** استعمل `MSYS_NO_PATHCONV=1` عند تمرير مسارات تبدأ بـ`/` (مثل `/subscriptions/...`) لـ`az`/`git`.
- **مساعد Claude:** مصنّف الأمان يحجب **أوامر الإنتاج الحسّاسة** (`az ... secret set`/`update`، `git push`) داخل الجلسة — ينفّذها المالك بنفسه بأوامر جاهزة.
- **الشهادة:** ذاتية التوقيع + Cloudflare **Full** (المُدارة تفشل بتحويل ACME).
- **حدّ اتصالات Aiven = 20:** Pool مصغّر عبر متغيّر بيئة (الحاسبة ~2، الموقع ~5). القياس عبر لوحة المالك «X/20».
- **الاسم مضلّل:** `app-shakeeb-test`/`rg-shakeeb-test` هو **الإنتاج الحيّ** رغم كلمة "test".
- **⏱ بوّابة Azure تقطع الطلب عند ~٢٤٠ ثانية:** أي مسار طويل (كرون/مزامنة/نسخ) **يجب** أن
  يُقسَّم إلى نداءات قصيرة. هذا ما أسقط الكرون الليلي أربع ليالٍ (1–5 آب 2026) وكل تشغيل
  يفشل بعد `4m` تماماً. القاعدة: **لا مسار يتجاوز دقيقتين**.
- **الفشل الذي يُحسب نجاحاً هو أخطر من الفشل:** مسار يُرجع `ok: true` مع `skipped` لا يظهر في
  أي شاشة. حدث مرّتين (النسخة الكاملة «ليست الساعة»، ورسائل واتساب الفاشلة). أي تخطٍّ صامت
  يجب أن يُسجَّل ويُعرض.
- **سجل الرسائل يُحذف بعد ٣ أيام** (`purgeOldMessages`) — فتشخيص «لماذا لم تصل رسالة» ممكنٌ
  لثلاثة أيام فقط. لا تعتمد عليه في تدقيق أقدم.
- **واتساب:** الجلسة على **حاسبة المكتب** لا في السحابة — فلا رمز QR ولا إرسال إن كانت مطفأة.
  والحالة المنشورة في القاعدة **مجمّدة** إن ماتت الحاسبة، لذا تُصدَّق فقط إن كانت الحاسبة تنبض
  (٩٠ث) والصفّ حديثاً (٥د). وخطأ `No LID for user` يُعالَج بحلّ معرّف الرقم (`getNumberId`) ثم
  إعادة الإرسال — بلا ذلك ضاعت ~٢٢٠ رسالة في ستة أيام.
- **أولوية الخرائط:** نقاط `map_points` لها `source`: `kml` (ملف رفعه المالك — **الأولوية**) و
  `tech` (أرسلها فنيّ وقبِلها المدير). رفع ملفٍ **يترك المكرّر `kml` كما هو** ويحلّ محلّ `tech` فقط.
- **مصنّف أمان المساعد** قد يحجب كتابةً على قاعدة الإنتاج (`UPDATE` على `users` مثلاً) بينما
  يسمح بـ`ALTER/INSERT` — إن حُجب، نفّذ الأمر بنفسك أو من واجهة البرنامج.

---

## 9. مراجع داخل المشروع
- `AGENTS.md` — تحذير Next.js المعدّل.
- `prisma/rls/README.md` + `prisma/rls/*.sql` — العزل على مستوى القاعدة.
- `.github/workflows/` — `build-trial-image.yml` (نشر)، `auto-checkout.yml` (الكرون الليلي
  بخطواته القصيرة)، `owner-backup.yml` (النسخة الكاملة كل ساعة/مرّة يومياً)، `hosting-usage.yml`.
- `Dockerfile` — بناء standalone متعدّد المراحل.
- `src/lib/secretbox.ts` — تشفير بيانات الدخول.
- `src/lib/guard.ts` — `guard`/`guardOwner`/`towerScope`/`ownsTower`/`agentTowerIds` (كل العزل).
- `src/lib/moneyKinds.ts` — تعريف واحد لأنواع المال (ماستر/دخل آخر) تستعمله كل التقارير.
- `src/lib/mapLocation.ts` — اشتقاق اسم عمود الخريطة من يوزر المشترك (`F{b}/{a}/{المنطقة}`).
- `src/lib/itemCatalog.ts` — كتالوج المواد: أسماء المدير تظهر في كل مكتب ولو بصفر.
- `src/lib/whatsapp.ts` — جلسات المكاتب والمُرحِّل ونشر الحالة.
- `src/worker.ts` — عامل حاسبة المكتب (تحديث ذاتي كل ١٠ دقائق).
- ملفّات ذاكرة المساعد: `shakeeb-azure-trial`، `shakeeb-deploy-mechanism`، `shakeeb-creds-enc-key`، `shakeeb-phantom-cards`، `shakeeb-pending-biometric`، `user-mohammed-preferences`.

## 10. تطبيق الهاتف (APK) — البنية والبناء والتعديل

**ما هو:** غلاف **Capacitor** رقيق (`appId: com.shakeebnet.field`، الاسم SHAKEEB) **يحمّل الموقع الحيّ
مباشرةً** في WebView على `https://shakeebnet.com/field-management`، ويضيف **إضافة بصمة أصلية** للحضور.
> ⭐ أي تعديل على **الموقع** يصل التطبيق **تلقائياً** (يحمّل الموقع البعيد) — **لا يحتاج إعادة بناء APK
> إلا عند تغيير الكود الأصلي**: البصمة/الأذونات/الإصدار/رابط الخادم.

**الفرع `native-app` — الملفّات المهمّة:**
| الملف | الدور |
|---|---|
| `capacitor.config.ts` | `server.url` = الصفحة المُحمَّلة (`/field-management`) + `appId` |
| `android/app/build.gradle` | `versionCode`/`versionName` + التبعيات (biometric, firebase-messaging, location) |
| `.../java/com/shakeebnet/field/BiometricNativePlugin.java` | إضافة البصمة (مفتاح EC في AndroidKeyStore + توقيع) |
| `.../java/com/shakeebnet/field/MainActivity.java` | `registerPlugin(BiometricNativePlugin.class)` |
| `android/app/src/main/AndroidManifest.xml` | أذونات USE_BIOMETRIC/FINGERPRINT |
| `.github/workflows/android.yml` | بناء APK تلقائياً |
| `src/lib/biometric.ts` + `src/app/api/field/biometric/route.ts` | جانب الويب/الخادم للبصمة (على `main`) |

**البناء:** ادفع إلى فرع **`native-app`** → workflow `android.yml`: `npm ci` → Java 17 → `npx cap sync android`
→ `./gradlew assembleDebug` → يرفع **`app-debug.apk`** كـartifact. (بناء **debug** — بلا مفتاح توقيع رسمي.)

**التوزيع:** نزّل الـartifact من صفحة **Actions** ← ضع الملف باسم **`public/shakeeb-net.apk`** على فرع
**`main`** ← ادفع (ينشر) ← يصبح على **`https://shakeebnet.com/shakeeb-net.apk`** (الرابط في `TechOpsBar.tsx`).

**التعديل:**
- *سلوك/شاشات التطبيق:* عدّل **الموقع** (`/field-management` ومكوّناته على `main`) — **بلا إعادة بناء** (يصل تلقائياً).
- *كود أصلي (بصمة/أذونات/إصدار/رابط الخادم):* عدّل ملفّات فرع `native-app`، **ارفع `versionCode` (+1)** و`versionName`،
  ادفع إلى `native-app` ← ابنِ ← وزّع كما أعلاه ← المستخدمون ينزّلون النسخة الجديدة.

**بنية البصمة (الضمان القاطع):** عند التفعيل يولّد التطبيق مفتاح EC في AndroidKeyStore
(`setUserAuthenticationRequired`) مربوطاً بالحساب، ويرسل مفتاحه العام للخادم. عند كل حضور: `BiometricPrompt`
يوقّع تحدّياً (SHA256withECDSA) والخادم يتحقّق (`/api/field/biometric`). فلا يبصم فنيٌّ لغيره. **البصمة للحضور لا للدخول.**

**تنبيه التوقيع:** البناء debug (توقيع مؤقّت متغيّر) → التحديث ليس «في المكان» (قد يتطلّب إزالة القديمة).
تحسين مستقبلي: مفتاح توقيع release ثابت (keystore) في `android.yml` + `assembleRelease`.
**ملاحظة:** `README` فرع `native-app` قديم (يذكر Vercel/Neon) — الواقع Azure+Aiven.

---

## 11. سجل التغييرات البنيوية (منذ 25 تموز 2026)

> **لماذا هذا القسم؟** لأن مَن يُعيد البناء بعد سنة يحتاج أن يعرف **ما الذي أُضيف للمخطط**
> و**أي سلوكٍ تشغيليٍّ تغيّر ولماذا** — لا قائمة ميزات. كل بند هنا يمسّ التعافي أو التشغيل.

### 11.1 تعديلات المخطط (كلّها في `prisma/schema.prisma`، ومطبَّقة على القاعدة الحيّة)
| التاريخ | التغيير | لماذا يهمّ التعافي |
|---|---|---|
| 04-08 | `technicians.ownCardsOnly` + بوّابات التوزيع التلقائي (`towers.autoAssignEnabled`، `card_types.autoAssign`) | إعدادات تُفقد لو أُعيد البناء بمخطط قديم |
| 05-08 | جدول `managers` + حسابات المدراء لكل مكتب (`accounts.managerId`) | أرصدة المدراء تُبنى عليه |
| 05-08 | `subscribers.purgedAt` | يميّز «محذوف» عن «مُنقّى نهائياً» — بدونه يعود المحذوفون |
| 05-08 | `money_tx.settledAt` + `settledTxId` (+فهرس) | تسديد مكاتب التفعيل — بدونهما تُعرض ديون مسدَّدة كأنها قائمة |
| 05-08 | `map_points.source` + `updatedAt` (وسم كل الموجود `kml`) | قاعدة أولوية الخرائط (القسم ٨) |
| 05-08 | جدول `map_point_proposals` (+`GRANT SELECT` لدور العامل) | مواقع الأعمدة التي يرسلها الفنيون |

**عدد الجداول الآن: ٥٤.** أي جدول جديد يحتاج `GRANT` + سياسة RLS إن كان العامل المحلي يقرؤه
(راجع `prisma/rls/`) — **النسخة الاحتياطية لا تحمل RLS إطلاقاً**، تُعاد سكربتاتها يدوياً (القسم ٥·٣).

### 11.2 تغييرات تشغيلية (تمسّ الكرون والنسخ والرسائل)
- **الكرون الليلي قُسِّم إلى خطوات** (`?step=daily` / `list` / `sync&officeId=`) بسبب مهلة بوّابة
  Azure (~٢٤٠ث). قبلها: أربع ليالٍ بلا مزامنة ولا نسخ احتياطية، وكل تشغيل يفشل بعد `4m`.
- **النسخة الكاملة للمالك: مرّة كل يوم مضمونة** بدل «في الساعة المضبوطة حصراً» (القسم ٦).
- **رسائل واتساب:** حلّ معرّف الرقم عند `No LID for user`؛ و«متصل» لا تُصدَّق بلا نبضة حاسبة
  وصفٍّ حديث؛ وشاشة الربط تقول سبب غياب الرمز بدل صمت.
- **المخزن:** لا بيع من شاشة المخزن (البيع بفاتورة حصراً)؛ وكتالوج الأسماء يظهر في كل مكتب ولو
  بصفر؛ وقيد تدقيق لكل تغيير كمية.
- **المال:** «المصروفات والمقبوضات» تعرض ما أُدخل فيها فقط + فلتر حساب؛ ولوحة تسديد مكاتب
  التفعيل (التسديد يدخل تقرير **يوم الضغط**).
- **الخرائط:** رفع KML من لوحة المالك (بفحصٍ مسبق قبل الكتابة)، واقتراحات الفنيين بقبول المدير،
  وقاعدة الأولوية في القسم ٨.

### 11.3 ثغرات وُجدت وأُغلقت (لا تُعِدها)
- مسار ينشئ مالاً بلا `towerId` ⇒ مالٌ يتيم لا يظهر في تقرير — أُضيف `requireTower` في ستة مسارات.
- إسناد بطاقة لفنيّ **وكيلٍ آخر** كان مقبولاً بلا تحقّق — صار عبر `verifyManualAssignee`.
- قائمة «إلى مكتب» في ترحيل المواد كانت فارغة لمستخدم المكتب (تُبنى من مسار مقصور على مكتبه).
- كاش PWA كان يسرّب صفحات بين الجلسات — **لا كاش لـHTML أبداً**.

---
_آخر تحديث: **2026-08-05**. حدّث هذا الملف عند أي تغيير بنيوي (عمود/جدول جديد، سرّ جديد، مضيف
جديد، خطوة نشر مختلفة، إصدار APK) — وأضِف سطراً في القسم ١١._
