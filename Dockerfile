# syntax=docker/dockerfile:1
# صورة Cloud Run — بناء متعدد المراحل بمخرجات Next.js standalone.
# المرحلة النهائية لا تحوي node_modules الكاملة ولا أدوات البناء (صورة صغيرة وإقلاع أسرع).

# ===== 1) التبعيات =====
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
# postinstall = prisma generate — يحتاج السكيمة أثناء npm ci
COPY prisma ./prisma
RUN npm ci

# ===== 2) البناء =====
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# build = prisma generate && next build (لا يتصل بقاعدة البيانات — الرابط يُحقن وقت التشغيل)
RUN npm run build

# ===== 3) التشغيل =====
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
# Cloud Run يمرّر PORT (افتراضياً 8080)؛ خادم standalone يقرأ PORT وHOSTNAME
ENV PORT=8080 HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
