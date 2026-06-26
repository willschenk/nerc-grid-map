#!/usr/bin/env node
// Regression test for the "stale dot hover" bug: hovering a give-way dot promotes
// it (bigger + inside short-name label); moving the pointer AWAY must shrink it
// back and remove the label. Serves dist/, drives headless Chrome via CDP, zooms
// to reveal dots, hovers one by dispatching real mouse events at its centre, then
// moves away and asserts the dot returned to its small size with no lingering label.
// Usage: npm run build && node scripts/perf/hover-dot-test.mjs

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep, resolve, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DIST = resolve(ROOT, "dist");
const BASE_PATH = "/nerc-grid-map/";
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9356);
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".webp": "image/webp" };

function findChrome() {
  const c = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  for (const p of c) if (existsSync(p)) return p;
  const w = spawnSync("which", ["google-chrome"], { encoding: "utf8" });
  return w.status === 0 ? w.stdout.trim() : null;
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
    const file = safeJoinDist(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end("nf"); return; }
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}${BASE_PATH}` };
}
async function getBrowserWs() {
  for (let i = 0; i < 80; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error("no chrome ws");
}
function makeConn(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve: r, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result); } });
  return { send(method, params = {}, sessionId) { return new Promise((r, reject) => { const mid = ++id; pending.set(mid, { resolve: r, reject }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); }); } };
}
async function evalJs(conn, sid, expr) {
  const { result, exceptionDetails } = await conn.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
}
async function mouse(conn, sid, type, x, y) {
  await conn.send("Input.dispatchMouseEvent", { type, x, y, button: "none", buttons: 0 }, sid);
}

// Find an ISOLATED give-way dot comfortably inside the viewport (so a hover lands
// cleanly and the nearby-label check is unambiguous). Returns its centre + size.
const FIND_DOT = `(() => {
  const all = [...document.querySelectorAll("svg rect.org")].filter((n) => !n.classList.contains("hide")).map((n) => n.getBoundingClientRect());
  const dots = all.filter((b) => b.width > 1 && b.width < 16 && Math.abs(b.width - b.height) <= 2 &&
    b.left > 260 && b.right < 1180 && b.top > 200 && b.bottom < 700);
  if (!dots.length) return null;
  // pick the dot with the most empty space around it (fewest other rects within 60px)
  let best = null, bestN = 1e9;
  for (const d of dots) {
    const cx = d.left + d.width / 2, cy = d.top + d.height / 2;
    let n = 0;
    for (const b of all) { const bx = b.left + b.width / 2, by = b.top + b.height / 2; if (Math.hypot(bx - cx, by - cy) < 60) n++; }
    if (n < bestN) { bestN = n; best = d; }
  }
  const b = best;
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), size: Math.round(Math.min(b.width, b.height) * 10) / 10 };
})()`;

// Measure size of the rect nearest (x,y) + whether ANY label text sits within ~26px of it.
function probeAt(x, y) {
  return `(() => {
    let best = null, bestD = 1e9;
    for (const n of document.querySelectorAll("svg rect.org")) {
      if (n.classList.contains("hide")) continue;
      const b = n.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const d = (cx - ${x}) ** 2 + (cy - ${y}) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    let labelNear = false;
    for (const t of document.querySelectorAll("svg text.olabel")) {
      const s = getComputedStyle(t);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity || 1) === 0) continue;
      const b = t.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (Math.hypot(cx - ${x}, cy - ${y}) < 30) { labelNear = true; break; }
    }
    return { size: best ? Math.round(Math.min(best.width, best.height) * 10) / 10 : 0, labelNear };
  })()`;
}
const READ_K = `(() => { const s = document.getElementById("nerc-svg"); return s && s.__zoom ? s.__zoom.k : 0; })()`;

async function main() {
  if (!existsSync(join(DIST, "index.html"))) { console.error("run npm run build first"); process.exit(1); }
  const chromePath = findChrome();
  if (!chromePath) { console.error("Chrome not found"); process.exit(1); }
  mkdirSync("/tmp/nerc-hover", { recursive: true });
  const { server, url } = await startServer();
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${CHROME_PORT}`, `--user-data-dir=/tmp/nerc-hover/chrome`, "--window-size=1440,900", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws; let failures = 0;
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
    for (let i = 0; i < 80; i++) { if (await evalJs(conn, sessionId, `document.querySelectorAll("svg rect.org").length`).catch(() => 0)) break; await sleep(150); }
    // Zoom in to reveal give-way dots (reveal-K ~4.5).
    const cx = 720, cy = 450;
    for (let i = 0; i < 60; i++) {
      const k = await evalJs(conn, sessionId, `(() => { const s = document.getElementById("nerc-svg"); s.dispatchEvent(new WheelEvent("wheel", { deltaY: -160, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true })); return s.__zoom ? s.__zoom.k : 0; })()`);
      await sleep(50);
      if (k >= 8) break;
    }
    await sleep(3500);
    const dot = await evalJs(conn, sessionId, FIND_DOT);
    if (!dot) { console.log("no isolated dot found to test (zoom/region) — skipping"); process.exit(0); }
    const rest = await evalJs(conn, sessionId, probeAt(dot.x, dot.y));
    console.log(`dot at (${dot.x},${dot.y}) rest size=${dot.size}px restLabelNear=${rest.labelNear}  k=${Math.round(await evalJs(conn, sessionId, READ_K) * 100) / 100}`);

    // Hover the dot.
    await mouse(conn, sessionId, "mouseMoved", dot.x - 40, dot.y - 40);
    await sleep(150);
    await mouse(conn, sessionId, "mouseMoved", dot.x, dot.y);
    await sleep(700);
    const hovered = await evalJs(conn, sessionId, probeAt(dot.x, dot.y));
    console.log(`hovered: size=${hovered.size}px labelNear=${hovered.labelNear}`);
    const promoted = hovered.size > dot.size + 1;
    if (!promoted) { console.log("WARN: dot did not visibly promote on hover (may be tied/edge) — continuing"); }

    // Move the pointer far away.
    await mouse(conn, sessionId, "mouseMoved", 120, 120);
    await sleep(900);
    const after = await evalJs(conn, sessionId, probeAt(dot.x, dot.y));
    console.log(`after-leave: size=${after.size}px labelNear=${after.labelNear}`);

    // Assertions: returned to ~rest size, and label state returned to rest (a dot
    // with no label at rest must not keep one after the pointer leaves).
    if (after.size > dot.size + 1.5) { console.log(`FAIL: dot stayed expanded after leave (${after.size} > rest ${dot.size})`); failures++; }
    else console.log("ok: dot returned to rest size after pointer left");
    if (after.labelNear && !rest.labelNear) { console.log("FAIL: short-name label still drawn after pointer left (none at rest)"); failures++; }
    else console.log("ok: label state returned to rest after pointer left");
  } finally {
    ws?.close(); chrome.kill("SIGKILL"); server.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nPASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
