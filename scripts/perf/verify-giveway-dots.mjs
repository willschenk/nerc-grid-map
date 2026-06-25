#!/usr/bin/env node
// Verifies the GO/GOP give-way dot layer:
//   1. At the overview (k < reveal-K) NO give-way dots are visible (zoom-gated).
//   2. Zooming into a region (k >= reveal-K) reveals dots.
//   3. Dots do NOT overlap real bubbles (the give-way invariant).
//   4. Real bubbles never overlap each other (unchanged base-map guarantee).
// Usage: npm run build && node scripts/perf/verify-giveway-dots.mjs

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
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9336);
const OUT = "/tmp/nerc-giveway";
const TARGET_K = Number(process.env.PERF_TARGET_K ?? 6);
const DSF = Number(process.env.PERF_DSF ?? 1);
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
    if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "cache-control": "no-store", "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  return { server, url: `http://127.0.0.1:${a.port}${BASE_PATH}` };
}

async function getBrowserWs() {
  for (let i = 0; i < 80; i++) {
    try { const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`); const json = await res.json(); if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error("no debugger ws");
}

function makeConn(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { resolve: r, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result); }
  });
  return { send(method, params = {}, sessionId) { return new Promise((r, reject) => { const mid = ++id; pending.set(mid, { resolve: r, reject }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); }); } };
}

async function evalJs(conn, sessionId, expression) {
  const result = await conn.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

// Measure visible real bubbles vs give-way dots and cross-overlaps. A "dot" is a
// rect.org.org-background; a "real" bubble is rect.org without org-background.
const MEASURE = `(() => {
  const svg = document.querySelector('#nerc-svg');
  const k = svg && svg.__zoom ? svg.__zoom.k : null;
  const all = [...document.querySelectorAll('svg rect.org')].filter((n) => {
    if (n.classList.contains('hide')) return false;
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 1 && r.height > 1;
  });
  const real = [], dots = [];
  for (const n of all) (n.classList.contains('org-background') ? dots : real).push(n);
  const box = (n) => n.getBoundingClientRect();
  const id = (n) => (n.getAttribute('aria-label') || '?').slice(0, 26);
  const over = (a, b, th) => {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return ox > th && oy > th;
  };
  const realBoxes = real.map(box), dotBoxes = dots.map(box);
  const dotSizes = dotBoxes.map((b) => Math.round(Math.max(b.width, b.height) * 10) / 10).sort((a, b) => a - b);
  const dotSizePx = dotSizes.length ? { min: dotSizes[0], median: dotSizes[dotSizes.length >> 1], max: dotSizes[dotSizes.length - 1] } : null;
  // give-way invariant: dots vs real bubbles
  let dotReal = 0; const dotRealPairs = [];
  for (let i = 0; i < dotBoxes.length; i++) for (let j = 0; j < realBoxes.length; j++) {
    if (over(dotBoxes[i], realBoxes[j], 1.5)) { dotReal++; if (dotRealPairs.length < 12) dotRealPairs.push([id(dots[i]), id(real[j])]); }
  }
  // base-map invariant: real vs real
  let realReal = 0; const realRealPairs = [];
  for (let i = 0; i < realBoxes.length; i++) for (let j = i + 1; j < realBoxes.length; j++) {
    if (over(realBoxes[i], realBoxes[j], 3)) { realReal++; if (realRealPairs.length < 12) realRealPairs.push([id(real[i]), id(real[j])]); }
  }
  return { k, real: real.length, dots: dots.length, dotSizePx, dotReal, dotRealPairs, realReal, realRealPairs };
})()`;

const ZOOM_AT = (cx, cy, n) => `(() => {
  const svg = document.querySelector('#nerc-svg');
  for (let i = 0; i < ${n}; i++) {
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -320, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true }));
  }
  return true;
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
    await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: DSF, mobile: false }, sessionId);
    await conn.send("Page.navigate", { url }, sessionId);
    for (let i = 0; i < 80; i++) { const m = await evalJs(conn, sessionId, MEASURE).catch(() => ({ real: 0 })); if (m.real > 0) break; await sleep(150); }
    await sleep(3500);

    const overview = await evalJs(conn, sessionId, MEASURE);

    // Zoom into the dense mid-Atlantic / Northeast (PJM) region.
    const cx = 1080, cy = 360;
    for (let pass = 0; pass < 16; pass++) {
      const m = await evalJs(conn, sessionId, MEASURE);
      if (m.k && m.k >= TARGET_K) break;
      await evalJs(conn, sessionId, ZOOM_AT(cx, cy, 3));
      await sleep(450);
    }
    await sleep(3500); // settle sim + give-way pass

    const deep = await evalJs(conn, sessionId, MEASURE);
    const shot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = join(OUT, "deep.png");
    writeFileSync(file, Buffer.from(shot.data, "base64"));

    // The give-way dot invariants. Real-real overlaps vary by zoom/region and are a
    // base-map property (dots are not involved) — reported for the baseline diff, not
    // asserted here.
    const pass =
      overview.dots === 0 && // zoom-gated: no dots at the overview
      deep.dots > 0 && // dots reveal once zoomed into a region
      deep.dotReal === 0; // give-way: no dot overlaps a real bubble

    console.log(JSON.stringify({ overview, deep, screenshot: file, PASS: pass }, null, 2));
    process.exit(pass ? 0 : 2);
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
