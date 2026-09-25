// Records the one-key fallback demo from the REAL /demo page replaying the recorded
// live session (?backend=mock -> dinner-turns.json, contract v1). Same scenario as live.
//   PLAYWRIGHT_CORE=... CHROME_PATH=... node src/presentation/stage/tools/record-fallback.mjs \
//     --url "http://localhost:8791/live.html?backend=mock" --out public/media/present/demo-fallback.mp4
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:8791/live.html?backend=mock");
const out = arg("out", "public/media/present/demo-fallback.mp4");
const pw = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pw ? pathToFileURL(`${pw}/index.mjs`).href : "playwright-core");
const dir = mkdtempSync(join(tmpdir(), "compass-fallback-"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const mark = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(2)}s ${m}`);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
mark("click line 1");
await page.locator(".cv-line").first().click();
await page.waitForTimeout(2600); // let COMPASS start acting (search running)
mark("click interrupt line");
await page.locator(".cv-line").first().click();
await page.waitForFunction(() => /done/i.test(document.querySelector(".cv-action")?.textContent || ""), null, { timeout: 20000 }).catch(() => mark("no done marker seen"));
await page.waitForTimeout(3500);
mark("end");
await ctx.close();
await browser.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith(".webm")));
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-an", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", out], { stdio: "inherit" });
if (r.status) process.exit(r.status);
console.log("wrote", out);
