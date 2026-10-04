FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
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
RUN npm ci --ignore-scripts --legacy-peer-deps
COPY . .
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build -w @ai-scraper/core -w @ai-scraper/commands -w @ai-scraper/storage -w @ai-scraper/queue -w @ai-scraper/observability && npm run build -w api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["npm", "run", "start", "-w", "api"]
