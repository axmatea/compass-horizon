FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html demo.html plan.html studio.html create.html vite.config.ts ./
COPY src ./src
COPY public ./public
COPY server.mjs llm.mjs demo-api.mjs early-access.mjs homepage.mjs ./
COPY builder ./builder
COPY html ./html
COPY account ./account
COPY platform ./platform
COPY generation ./generation
COPY sandbox ./sandbox
COPY integrations ./integrations
COPY billing ./billing
COPY usage.mjs ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/demo/catalog.mjs ./src/demo/catalog.mjs
COPY --from=build /app/src/create/draft.mjs ./src/create/draft.mjs
COPY --from=build /app/src/builder/project-store.mjs ./src/builder/project-store.mjs
COPY --from=build /app/node_modules ./node_modules
COPY server.mjs llm.mjs demo-api.mjs early-access.mjs homepage.mjs ./
COPY builder ./builder
COPY html ./html
COPY account ./account
COPY platform ./platform
COPY generation ./generation
COPY sandbox ./sandbox
COPY integrations ./integrations
COPY billing ./billing
COPY usage.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
