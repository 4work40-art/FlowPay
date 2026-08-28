# Прод-образ фронтенда: сборка Next.js в builder-стадии, затем тонкий
# runtime-образ. Установка через `npm ci` по package-lock.json —
# воспроизводимо и без --legacy-peer-deps (лок уже разрешается штатным
# `npm ci`, что подтверждает CI). Раньше стоял `npm install --legacy-peer-deps`
# без лока — невоспроизводимо, а флаг ещё и маскировал конфликты peer-зависимостей.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000 || exit 1
CMD ["npm", "start"]
