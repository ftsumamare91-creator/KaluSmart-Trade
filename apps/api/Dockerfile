FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# schema first: npm ci runs postinstall (prisma generate), which needs it
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 4000
# Apply migrations on start (never resets data), then run the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
