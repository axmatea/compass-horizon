import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCompassServer } from "./server.mjs";
import { applyHomepage } from "./homepage.mjs";

function localApplication(): Plugin {
  // Local previews use prepared builds. Do not inherit provider or delivery
  // credentials from the shell, and do not load old .env files through Vite.
  const env = {
    COMPASS_REVISION: process.env.COMPASS_REVISION || "local",
    DEMO_VIDEO_URL: process.env.DEMO_VIDEO_URL,
  };
  const install = (server: ViteDevServer | PreviewServer, preview = false) => {
    const app = createCompassServer({ env });
    server.httpServer?.once("close", () => { void app.close(); });
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/healthz" || url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        app.server.emit("request", req, res);
        return;
      }
      if (/^\/studio(?:\/|\.|$)/.test(url.pathname) && !/^\/studio\/?$/.test(url.pathname)) {
        app.server.emit("request", req, res);
        return;
      }
      if (preview && (url.pathname === "/" || url.pathname === "/index.html") && ["GET", "HEAD"].includes(req.method || "")) {
        try {
          const html = await readFile(resolve(server.config.root, server.config.build.outDir, "index.html"), "utf8");
          const body = Buffer.from(applyHomepage(html, env));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Content-Length": body.length });
          res.end(req.method === "HEAD" ? undefined : body);
        } catch (error) { next(error); }
        return;
      }
      if (/^\/(?:demo|voice-demo)\/?$/.test(url.pathname)) req.url = "/demo.html" + url.search;
      else if (/^\/plan\/?$/.test(url.pathname)) req.url = "/plan.html" + url.search;
      else if (/^\/studio\/?$/.test(url.pathname)) req.url = "/studio.html" + url.search;
      else if (/^\/create\/?$/.test(url.pathname)) req.url = "/create.html" + url.search;
      else if (/^\/workspace\/?$/.test(url.pathname)) { app.server.emit("request",req,res); return; }
      next();
    });
  };
  return {
    name: "compass-local-application",
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server, true); },
    transformIndexHtml(html, context) {
      // Leave the production build's video marker intact: its Node server
      // resolves optional video settings when a page is requested.
      if (context.server && context.path === "/index.html") return applyHomepage(html, env);
      return html;
    },
  };
}

export default defineConfig({
  appType: "mpa",
  envDir: false,
  plugins: [localApplication()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        demo: fileURLToPath(new URL("./demo.html", import.meta.url)),
        plan: fileURLToPath(new URL("./plan.html", import.meta.url)),
        studio: fileURLToPath(new URL("./studio.html", import.meta.url)),
        create: fileURLToPath(new URL("./create.html", import.meta.url)),
      },
    },
  },
});
