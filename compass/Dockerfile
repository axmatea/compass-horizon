FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html demo.html plan.html studio.html vite.config.ts ./
COPY src ./src
COPY public ./public
COPY server.mjs llm.mjs demo-api.mjs early-access.mjs homepage.mjs ./
COPY builder ./builder
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/demo/catalog.mjs ./src/demo/catalog.mjs
COPY server.mjs llm.mjs demo-api.mjs early-access.mjs homepage.mjs ./
COPY builder ./builder
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
