FROM node:22-bookworm-slim
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
COPY package.json package-lock.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/commands/package.json ./packages/commands/package.json
COPY packages/crawler/package.json ./packages/crawler/package.json
COPY packages/execution-engine/package.json ./packages/execution-engine/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/ai-providers/package.json ./packages/ai-providers/package.json
COPY packages/schemas/package.json ./packages/schemas/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/queue/package.json ./packages/queue/package.json
COPY packages/security/package.json ./packages/security/package.json
COPY packages/observability/package.json ./packages/observability/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build -w @ai-scraper/core -w @ai-scraper/commands -w @ai-scraper/crawler -w @ai-scraper/execution-engine -w @ai-scraper/ai -w @ai-scraper/ai-providers -w @ai-scraper/storage -w @ai-scraper/queue -w @ai-scraper/observability && npm run build -w worker
# Chromium para Crawlee/Playwright (capa browser, §34)
RUN npx playwright install --with-deps chromium
CMD ["npm", "run", "start", "-w", "worker"]
