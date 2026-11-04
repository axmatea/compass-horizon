import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { corePage } from './src/routes.ts';

export default defineConfig({
  appType: 'mpa',
  plugins: [react(), {
    name: "compass-core-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = corePage(req.url ?? '/') ?? req.url;
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = corePage(req.url ?? '/') ?? req.url;
        next();
      });
    },
  }],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8770', ws: true } } },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app.html", import.meta.url)),
        login: fileURLToPath(new URL("./login.html", import.meta.url)),
      },
    },
  },
});
