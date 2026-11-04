FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
