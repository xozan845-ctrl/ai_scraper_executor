FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY tsconfig.base.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build:core && npm run build -w @ai-scraper/storage -w @ai-scraper/queue -w @ai-scraper/observability && npm run build -w api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["npm", "run", "start", "-w", "api"]
