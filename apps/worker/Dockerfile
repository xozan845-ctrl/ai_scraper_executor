FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps/worker/package.json ./apps/worker/
RUN npm install --prefix apps/worker || npm install
COPY . .
EXPOSE 3001
CMD ["npm", "run", "start:dev", "-w", "worker"]
