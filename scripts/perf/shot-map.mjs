#!/usr/bin/env node
// Quick visual/density check for the built map. Serves dist/, opens headless
// Chrome via CDP, counts visible org bubbles, looks for visibly-overlapping
// bubble pairs (rounded-rect AABB intersection past a small threshold), and
// writes a full-page screenshot. Usage: npm run build && node scripts/perf/shot-map.mjs

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep, resolve, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DIST = resolve(ROOT, "dist");
const BASE_PATH = "/nerc-grid-map/";
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9335);
const OUT = "/tmp/nerc-shot";
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".webp": "image/webp" };

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync("which", ["google-chrome"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function safeJoinDist(pathname) {
  let rel = pathname;
  if (rel.startsWith(BASE_PATH)) rel = rel.slice(BASE_PATH.length);
  else if (rel === "/") rel = "";
  else return null;
  if (!rel || rel.endsWith("/")) rel = `${rel}index.html`;
  const file = normalize(join(DIST, rel));
  if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) return null;
  return file;
}

async function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const file = safeJoinDist(decodeURIComponent(url.pathname));
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "cache-control": "no-store", "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  return { server, url: `http://127.0.0.1:${a.port}${BASE_PATH}` };
}

async function getBrowserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("no debugger ws");
}

function makeConn(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: r, reject } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result);
    }
  });
  return { send(method, params = {}, sessionId) { return new Promise((r, reject) => { const mid = ++id; pending.set(mid, { resolve: r, reject }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); }); } };
}

async function evalJs(conn, sessionId, expression) {
  const result = await conn.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

const METRICS = `(() => {
  const vis = [...document.querySelectorAll("svg rect.org")].filter((n) => {
    if (n.classList.contains("hide")) return false;
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0 && r.width > 1 && r.height > 1;
  });
  const boxes = vis.map((n) => n.getBoundingClientRect());
  const id = (n) => (n.getAttribute("aria-label") || n.className.baseVal || "?").slice(0, 28);
  let overlaps = 0; const TH = 3; const pairs = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > TH && oy > TH) { overlaps++; if (pairs.length < 20) pairs.push([id(vis[i]), id(vis[j]), Math.round(ox), Math.round(oy)]); }
  }
  return { visible: vis.length, overlaps, pairs };
})()`;

async function main() {
  if (!existsSync(join(DIST, "index.html"))) { console.error("run npm run build first"); process.exit(1); }
  const chromePath = findChrome();
  if (!chromePath) { console.error("Chrome not found"); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer();
  const userDataDir = join(OUT, "chrome-profile");
  const chrome = spawn(chromePath, [
    "--headless=new", `--remote-debugging-port=${CHROME_PORT}`, `--user-data-dir=${userDataDir}`,
    "--window-size=1440,900", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", "about:blank",
  ], { stdio: "ignore" });
  let ws;
  try {
    ws = new WebSocket(await getBrowserWs());
    await new Promise((r, x) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", x, { once: true }); });
    const conn = makeConn(ws);
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);
    await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await conn.send("Page.navigate", { url }, sessionId);
    // wait for bubbles
    for (let i = 0; i < 80; i++) {
      const m = await evalJs(conn, sessionId, METRICS).catch(() => ({ visible: 0 }));
      if (m.visible > 0) break;
      await sleep(150);
    }
    await sleep(4000); // let the force sim settle
    const metrics = await evalJs(conn, sessionId, METRICS);
    const shot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = join(OUT, "map.png");
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(JSON.stringify({ ...metrics, screenshot: file }, null, 2));
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
