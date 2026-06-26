#!/usr/bin/env node
// Headless verification of the market focus interaction. Serves dist/, opens
// Chrome via CDP, clicks each market hub (PJM, MISO, NYISO, ISO-NE) in turn,
// asserts the focus state (one parent, ≥1 related, dimmed background, only that
// family's class active), clears it, and confirms the map returns to normal.
// Writes before/after screenshots.
// Usage: npm run build && node scripts/perf/focus-test.mjs

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
const OUT = "/tmp/nerc-focus";
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".webp": "image/webp" };

function findChrome() {
  const candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
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

const STATE = `(() => {
  const svg = document.querySelector('#nerc-svg');
  const shown = (sel) => [...document.querySelectorAll(sel)].filter((n) => !n.classList.contains('hide'));
  const status = document.querySelector('#nerc-focus-status');
  return {
    focusMode: svg.classList.contains('focus-mode'),
    focusPjm: svg.classList.contains('focus-pjm'),
    focusMiso: svg.classList.contains('focus-miso'),
    focusNyiso: svg.classList.contains('focus-nyiso'),
    focusIsone: svg.classList.contains('focus-isone'),
    parents: shown('rect.org.focus-parent').length,
    related: shown('rect.org.focus-related').length,
    dimmed: shown('rect.org.focus-dim').length,
    statusShown: status && !status.hidden,
    statusTitle: document.querySelector('#nerc-focus-title')?.textContent,
  };
})()`;

// Find a hub bubble's viewport-centre and click it through the full pointer path.
async function clickHub(conn, sessionId, namePart) {
  const box = await evalJs(conn, sessionId, `(() => {
    const n = [...document.querySelectorAll('rect.org-hit')].find((c) => (c.getAttribute('aria-label')||'').includes(${JSON.stringify(namePart)}));
    if (!n) { const r = [...document.querySelectorAll('rect.org')].find((c) => (c.getAttribute('aria-label')||'').includes(${JSON.stringify(namePart)})); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 }; }
    const b = n.getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 };
  })()`);
  if (!box) throw new Error(`hub not found: ${namePart}`);
  await clickAt(conn, sessionId, box.x, box.y);
  await sleep(700);
}
// d3-zoom needs a pointer position established before the press, so move first.
async function clickAt(conn, sessionId, x, y) {
  await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await sleep(50);
  await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 }, sessionId);
  await sleep(40);
  await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 }, sessionId);
}
async function clickBackground(conn, sessionId) {
  await clickAt(conn, sessionId, 40, 300); // empty map at the left edge
  await sleep(500);
}

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

async function main() {
  if (!existsSync(join(DIST, "index.html"))) { console.error("run npm run build first"); process.exit(1); }
  const chromePath = findChrome();
  if (!chromePath) { console.error("Chrome not found"); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer();
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${CHROME_PORT}`, `--user-data-dir=${join(OUT, "chrome-profile")}`, "--window-size=1440,900", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    ws = new WebSocket(await getBrowserWs());
    await new Promise((r, x) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", x, { once: true }); });
    const conn = makeConn(ws);
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);
    conn.send("Log.enable", {}, sessionId);
    await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await conn.send("Page.navigate", { url }, sessionId);
    for (let i = 0; i < 80; i++) { const v = await evalJs(conn, sessionId, `document.querySelectorAll('rect.org').length`).catch(() => 0); if (v > 0) break; await sleep(150); }
    await sleep(4000);

    const before = await evalJs(conn, sessionId, STATE);
    assert(!before.focusMode, "default map has no focus-mode");
    const shotDefault = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "0-default.png"), Buffer.from(shotDefault.data, "base64"));

    // ── PJM ──
    await clickHub(conn, sessionId, "PJM Interconnection");
    const pjm = await evalJs(conn, sessionId, STATE);
    console.log("PJM state:", JSON.stringify(pjm));
    assert(pjm.focusMode && pjm.focusPjm, "clicking PJM activates focus-pjm");
    assert(pjm.parents === 1, `exactly one focus-parent (got ${pjm.parents})`);
    assert(pjm.related >= 5, `PJM has related areas shown (got ${pjm.related})`);
    assert(pjm.dimmed > 20, `unrelated orgs dimmed (got ${pjm.dimmed})`);
    assert(!pjm.statusShown, "focus status chip stays hidden (temporarily removed)");
    const shotPjm = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "1-pjm.png"), Buffer.from(shotPjm.data, "base64"));

    // ── switch to MISO ──
    await clickHub(conn, sessionId, "Midcontinent ISO");
    const miso = await evalJs(conn, sessionId, STATE);
    console.log("MISO state:", JSON.stringify(miso));
    assert(miso.focusMode && miso.focusMiso && !miso.focusPjm, "clicking MISO switches focus to MISO");
    assert(miso.parents === 1, `exactly one focus-parent for MISO (got ${miso.parents})`);
    assert(miso.related >= 5, `MISO has related areas shown (got ${miso.related})`);
    assert(!miso.statusShown, "focus status chip stays hidden for MISO too");
    const shotMiso = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "2-miso.png"), Buffer.from(shotMiso.data, "base64"));

    // ── switch to NYISO (8 Transmission Owners) ──
    await clickHub(conn, sessionId, "New York Independent System Operator");
    const nyiso = await evalJs(conn, sessionId, STATE);
    console.log("NYISO state:", JSON.stringify(nyiso));
    assert(nyiso.focusMode && nyiso.focusNyiso && !nyiso.focusMiso, "clicking NYISO switches focus to NYISO");
    assert(nyiso.parents === 1, `exactly one focus-parent for NYISO (got ${nyiso.parents})`);
    assert(nyiso.related >= 5, `NYISO has related TOs shown (got ${nyiso.related})`);
    const shotNyiso = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "2a-nyiso.png"), Buffer.from(shotNyiso.data, "base64"));

    // ── switch to ISO-NE (11 Participating Transmission Owners) ──
    await clickHub(conn, sessionId, "ISO-NE");
    const isone = await evalJs(conn, sessionId, STATE);
    console.log("ISO-NE state:", JSON.stringify(isone));
    assert(isone.focusMode && isone.focusIsone && !isone.focusNyiso, "clicking ISO-NE switches focus to ISO-NE");
    assert(isone.parents === 1, `exactly one focus-parent for ISO-NE (got ${isone.parents})`);
    assert(isone.related >= 5, `ISO-NE has related PTOs shown (got ${isone.related})`);
    const shotIsone = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "2b-isone.png"), Buffer.from(shotIsone.data, "base64"));

    // ── clear ──
    await clickBackground(conn, sessionId);
    const cleared = await evalJs(conn, sessionId, STATE);
    console.log("cleared state:", JSON.stringify(cleared));
    assert(!cleared.focusMode, "background click clears focus-mode");
    assert(cleared.parents === 0 && cleared.related === 0 && cleared.dimmed === 0, "no focus classes after clear");
    assert(!cleared.statusShown, "status chip hidden after clear");
    const shotClear = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(OUT, "3-cleared.png"), Buffer.from(shotClear.data, "base64"));

    console.log(`screenshots in ${OUT}`);
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
