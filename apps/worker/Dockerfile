FROM node:22-bookworm-slim
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY tsconfig.base.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build:core && npm run build -w @ai-scraper/storage -w @ai-scraper/queue -w @ai-scraper/observability && npm run build -w worker
# Chromium para Crawlee/Playwright (capa browser, §34)
RUN npx playwright install --with-deps chromium
CMD ["npm", "run", "start", "-w", "worker"]
