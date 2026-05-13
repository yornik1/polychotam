FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM base AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS prod
RUN apk add --no-cache bash
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && npm install --omit=dev
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
