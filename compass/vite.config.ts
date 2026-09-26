import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), {
    name: "compass-demo-route",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/(acquisition(?:\/app)?|login)\/?(?:\?|$)/.test(req.url)) req.url = "/acquisition.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        else if (req.url && /^\/(demo|voice-demo)\/?(?:\?|$)/.test(req.url)) req.url = "/live.html";
        else if (req.url && /^\/horizon\/?(?:\?|$)/.test(req.url)) req.url = "/horizon.html";
        else if (req.url && /^\/office\/?(?:\?|$)/.test(req.url)) req.url = "/office.html";
        else if (req.url && /^\/original\/site\/?(?:\?|$)/.test(req.url)) req.url = "/original-site.html";
        else if (req.url && /^\/original(?:\/tour)?\/?(?:\?|$)/.test(req.url)) req.url = "/original.html";
        else if (req.url && /^\/(presentation(?:\/legacy)?|present|story)\/?(?:\?|$)/.test(req.url)) req.url = "/story.html";
        else if (req.url && /^\/(app|presentation\/finale|demo\/(?:table|workspace|remaster(?:\/app)?))\/?(?:\?|$)/.test(req.url)) req.url = "/app.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/(acquisition(?:\/app)?|login)\/?(?:\?|$)/.test(req.url)) req.url = "/acquisition.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        else if (req.url && /^\/(demo|voice-demo)\/?(?:\?|$)/.test(req.url)) req.url = "/live.html";
        else if (req.url && /^\/horizon\/?(?:\?|$)/.test(req.url)) req.url = "/horizon.html";
        else if (req.url && /^\/office\/?(?:\?|$)/.test(req.url)) req.url = "/office.html";
        else if (req.url && /^\/original\/site\/?(?:\?|$)/.test(req.url)) req.url = "/original-site.html";
        else if (req.url && /^\/original(?:\/tour)?\/?(?:\?|$)/.test(req.url)) req.url = "/original.html";
        else if (req.url && /^\/(presentation(?:\/legacy)?|present|story)\/?(?:\?|$)/.test(req.url)) req.url = "/story.html";
        else if (req.url && /^\/(app|presentation\/finale|demo\/(?:table|workspace|remaster(?:\/app)?))\/?(?:\?|$)/.test(req.url)) req.url = "/app.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        next();
      });
    },
  }],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8770', ws: true } } },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        website: fileURLToPath(new URL("./index.html", import.meta.url)),
        original: fileURLToPath(new URL("./original.html", import.meta.url)),
        originalSite: fileURLToPath(new URL("./original-site.html", import.meta.url)),
        app: fileURLToPath(new URL("./app.html", import.meta.url)),
        acquisition: fileURLToPath(new URL("./acquisition.html", import.meta.url)),
        story: fileURLToPath(new URL("./story.html", import.meta.url)),
        presentation: fileURLToPath(new URL("./present.html", import.meta.url)),
        live: fileURLToPath(new URL("./live.html", import.meta.url)),
        horizon: fileURLToPath(new URL("./horizon.html", import.meta.url)),
      },
    },
  },
});
