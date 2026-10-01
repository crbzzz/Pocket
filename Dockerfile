FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY apps/api/src apps/api/src
COPY apps/preview apps/preview
ENV POCKET_MODE=production PORT=8080 POCKET_WORKER=off
USER node
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "apps/api/src/main.ts"]
