FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages-tmp/
RUN npm install --prefix apps/api || npm install
COPY . .
RUN npm run build -w api || npx tsc -p apps/api/tsconfig.json
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "api"]
