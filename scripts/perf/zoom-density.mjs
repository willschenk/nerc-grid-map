#!/usr/bin/env node
// Deep-zoom density/size probe. Serves dist/, drives headless Chrome via CDP,
// zooms the map ALL THE WAY IN (max wheel-in) for both a desktop and an iOS
// viewport, then reports — at overview and at deep zoom — the visible org-bubble
// count, bubble pixel-size percentiles, inside-label font percentiles, and any
// visibly-overlapping bubble pairs. Usage: npm run build && node scripts/perf/zoom-density.mjs
//
// This is the harness for the "more + larger pills + bigger font when zoomed all
// the way in, on PC and iOS" tuning. Compare two runs by eye (it prints both).

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
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9351);
const OUT = "/tmp/nerc-zoom-density";
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
    try { const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`); const j = await res.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
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

// Read current zoom scale (d3 stashes the live transform on the node as __zoom).
const READ_K = `(() => { const s = document.getElementById("nerc-svg"); return s && s.__zoom ? s.__zoom.k : 0; })()`;

// Measure visible bubbles + inside-label fonts + overlaps in CSS px.
const METRICS = `(() => {
  const vis = [...document.querySelectorAll("svg rect.org")].filter((n) => {
    if (n.classList.contains("hide")) return false;
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0 && r.width > 1 && r.height > 1;
  });
  const boxes = vis.map((n) => n.getBoundingClientRect());
  // bubble "size" = min(width,height) in CSS px (the readable short dimension)
  const sizes = boxes.map((b) => Math.min(b.width, b.height)).sort((a, b) => a - b);
  const widths = boxes.map((b) => b.width).sort((a, b) => a - b);
  const fonts = [...document.querySelectorAll("svg text.olabel.inside")].filter((n) => {
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) > 0 && r.width > 0;
  }).map((n) => parseFloat(getComputedStyle(n).fontSize)).filter((x) => x > 0).sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] * 10) / 10 : 0;
  // Give-way dots reuse rect.org but render as circles: width≈height and rx≈half.
  // Heuristic: small rects (min side < 16px) whose aspect ratio is ~1.
  const dots = boxes.filter((b) => Math.min(b.width, b.height) < 16 && Math.abs(b.width - b.height) <= 1.5);
  const dotAspect = dots.length ? Math.round((dots.reduce((s, b) => s + b.width / Math.max(1, b.height), 0) / dots.length) * 100) / 100 : 0;
  let overlaps = 0; const TH = 3;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > TH && oy > TH) overlaps++;
  }
  return {
    bubbles: vis.length,
    overlaps,
    dots: dots.length,
    dotAspect,
    insideLabels: fonts.length,
    size: { min: pct(sizes, 0), p50: pct(sizes, 0.5), p90: pct(sizes, 0.9), max: sizes.length ? Math.round(sizes[sizes.length - 1] * 10) / 10 : 0 },
    width: { p50: pct(widths, 0.5), p90: pct(widths, 0.9) },
    font: { min: fonts.length ? Math.round(fonts[0] * 10) / 10 : 0, p50: pct(fonts, 0.5), p90: pct(fonts, 0.9), max: fonts.length ? Math.round(fonts[fonts.length - 1] * 10) / 10 : 0 },
  };
})()`;

function wheelInExpr(cx, cy) {
  // Dispatch a zoom-in wheel event at (cx,cy) — d3-zoom reads deltaY and keeps
  // that point fixed, so aiming at a populated centroid zooms INTO the cluster.
  return `(() => {
    const s = document.getElementById("nerc-svg");
    const ev = new WheelEvent("wheel", { deltaY: -160, deltaMode: 0, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true });
    s.dispatchEvent(ev);
    return s.__zoom ? s.__zoom.k : 0;
  })()`;
}

// Screen position of the DENSEST bubble cluster — the bubble with the most
// neighbours within a 220px box. Aiming the deep zoom here lands on a populated
// region (NE corridor / Great Lakes) where "more pills" is actually measurable,
// not an empty patch of Plains/ocean.
const CENTROID = `(() => {
  const vis = [...document.querySelectorAll("svg rect.org")].filter((n) => !n.classList.contains("hide") && n.getBoundingClientRect().width > 1);
  if (!vis.length) return null;
  const c = vis.map((n) => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  let best = c[0], bestN = -1;
  for (const a of c) {
    let n = 0;
    for (const b of c) if (Math.abs(a.x - b.x) < 110 && Math.abs(a.y - b.y) < 110) n++;
    if (n > bestN) { bestN = n; best = a; }
  }
  return { x: Math.round(best.x), y: Math.round(best.y) };
})()`;

async function runViewport(conn, label, width, height, deviceScaleFactor, mobile, url, fixedTarget) {
  const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
  await conn.send("Page.enable", {}, sessionId);
  await conn.send("Runtime.enable", {}, sessionId);
  await conn.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile }, sessionId);
  await conn.send("Page.navigate", { url }, sessionId);
  for (let i = 0; i < 100; i++) {
    const m = await evalJs(conn, sessionId, METRICS).catch(() => ({ bubbles: 0 }));
    if (m.bubbles > 0) break;
    await sleep(150);
  }
  await sleep(3500); // let the force sim settle at overview
  const overview = await evalJs(conn, sessionId, METRICS);
  const overviewK = await evalJs(conn, sessionId, READ_K);

  // Zoom "all the way in" to a meaningful LOCAL view over the populated centroid
  // (not k=hundreds on empty ocean). Stop at TARGET_K — the deep-but-readable
  // local level where the deepGrow/deepMin ramps are in effect.
  const TARGET_K = 13;
  // Optional fixed zoom target (fractions of the viewport) — used for the coastal
  // run that stress-tests the "no dot in the ocean" rule near a shoreline.
  let cx, cy;
  if (fixedTarget) {
    cx = Math.round(width * fixedTarget[0]);
    cy = Math.round(height * fixedTarget[1]);
  } else {
    const c = await evalJs(conn, sessionId, CENTROID);
    cx = c ? c.x : Math.round(width / 2);
    cy = c ? c.y : Math.round(height / 2);
  }
  let lastK = overviewK;
  let stagnant = 0;
  for (let i = 0; i < 200; i++) {
    const k = await evalJs(conn, sessionId, wheelInExpr(cx, cy));
    await sleep(50);
    if (k >= TARGET_K) break;
    if (k <= lastK + 0.005) { stagnant++; if (stagnant >= 8) break; } else stagnant = 0;
    lastK = k;
  }
  await sleep(3500); // let the sim settle at deep zoom
  const deep = await evalJs(conn, sessionId, METRICS);
  const deepK = await evalJs(conn, sessionId, READ_K);

  const shot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const file = join(OUT, `deep-${label}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));

  await conn.send("Target.closeTarget", { targetId }, sessionId).catch(() => {});
  return { label, overview: { k: Math.round(overviewK * 100) / 100, ...overview }, deep: { k: Math.round(deepK * 100) / 100, ...deep }, screenshot: file };
}

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
    const results = [];
    results.push(await runViewport(conn, "desktop", 1440, 900, 1, false, url));
    results.push(await runViewport(conn, "ios", 390, 844, 3, true, url));
    // Coastal stress test for the "no dot in the ocean" rule: zoom into the SE /
    // Florida shoreline where generators cluster right at the coast.
    results.push(await runViewport(conn, "coast-fl", 1440, 900, 1, false, url, [0.82, 0.84]));
    for (const r of results) {
      console.log(`\n=== ${r.label} ===`);
      console.log(`  overview  k=${r.overview.k}  bubbles=${r.overview.bubbles}  overlaps=${r.overview.overlaps}  size[min/p50/p90/max]=${r.overview.size.min}/${r.overview.size.p50}/${r.overview.size.p90}/${r.overview.size.max}px  font[min/p50/p90/max]=${r.overview.font.min}/${r.overview.font.p50}/${r.overview.font.p90}/${r.overview.font.max}px`);
      console.log(`  DEEPZOOM  k=${r.deep.k}  bubbles=${r.deep.bubbles}  overlaps=${r.deep.overlaps}  dots=${r.deep.dots} (aspect=${r.deep.dotAspect})  size[min/p50/p90/max]=${r.deep.size.min}/${r.deep.size.p50}/${r.deep.size.p90}/${r.deep.size.max}px  font[min/p50/p90/max]=${r.deep.font.min}/${r.deep.font.p50}/${r.deep.font.p90}/${r.deep.font.max}px`);
      console.log(`  shot: ${r.screenshot}`);
    }
    console.log("\n" + JSON.stringify(results, null, 2));
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
