import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

function demoRoute() {
  const rewrite = (req: { url?: string }) => {
    if (req.url && /^\/demo\/?(?:\?|$)/.test(req.url)) {
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      req.url = "/demo.html" + query;
    }
  };
  return {
    name: "compass-demo-route",
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, _res, next) => { rewrite(req); next(); });
    },
    configurePreviewServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, _res, next) => { rewrite(req); next(); });
    },
  };
}

export default defineConfig({
  appType: "mpa",
  plugins: [demoRoute()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        demo: fileURLToPath(new URL("./demo.html", import.meta.url)),
      },
    },
  },
});
