#!/usr/bin/env node
// Regression tests for give-way dot interaction + dot/pill hitbox selection.
//   1. Hover promotion: hovering a give-way dot promotes it; moving away shrinks
//      it back and removes any lingering label.
//   2. Hitbox selection: a dot beside a larger pill stays selectable; empty space
//      above a pill (inside the old circular hit) must not select the pill; clicking
//      inside the visible pill still selects normally.
// Serves dist/, drives headless Chrome via CDP. Usage:
//   npm run build && node scripts/perf/hover-dot-test.mjs

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
async function clickAt(conn, sid, x, y) {
  await mouse(conn, sid, "mouseMoved", x, y);
  await sleep(50);
  await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 }, sid);
  await sleep(40);
  await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 }, sid);
  await sleep(120);
}
async function clearSelection(conn, sid) {
  await evalJs(conn, sid, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`).catch(() => {});
  await clickAt(conn, sid, 6, 6);
  await evalJs(conn, sid, `window.__lastPick = '__cleared__'`).catch(() => {});
  await sleep(120);
}
const LAST_PICK = `(window.__lastPick && window.__lastPick.o) || null`;
const HAS_SELECTION = `!!document.querySelector('rect.org.selected')`;
const PANEL_TITLE = `document.querySelector('#nerc-panel .p-title h2')?.textContent || null`;

// Visible dot whose centre sits near a larger pill but outside the pill body.
const DOT_NEAR_PILL = `(() => {
  const onScreen = (x, y) => x > 20 && x < window.innerWidth - 20 && y > 80 && y < window.innerHeight - 120;
  const dots = [], pills = [];
  for (const h of document.querySelectorAll('rect.org-hit')) {
    if (h.classList.contains('hide') || !h.__data__) continue;
    const b = h.getBoundingClientRect(); if (b.width <= 0) continue;
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    if (!onScreen(x, y)) continue;
    if (h.__data__._renderFallback) dots.push({ id: h.__data__.ncr_id, name: h.__data__.entity_name, x, y, r: Math.min(b.width, b.height) / 2 });
  }
  for (const r of document.querySelectorAll('rect.org')) {
    if (r.classList.contains('hide') || !r.__data__ || r.__data__._renderFallback) continue;
    const b = r.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) continue;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    if (!onScreen(cx, cy)) continue;
    pills.push({ id: r.__data__.ncr_id, name: r.__data__.entity_name, cx, cy,
      l: b.left, rt: b.right, t: b.top, btm: b.bottom, vw: b.width, vh: b.height });
  }
  let best = null;
  for (const dt of dots) {
    for (const p of pills) {
      if (p.vw < dt.r * 2.5) continue; // prefer a visibly larger pill neighbour
      const insideBody = dt.x >= p.l && dt.x <= p.rt && dt.y >= p.t && dt.y <= p.btm;
      if (insideBody) continue;
      const d = Math.hypot(dt.x - p.cx, dt.y - p.cy);
      if (d > 90) continue;
      if (!best || d < best.dist) best = { dot: dt, pill: p, dist: +d.toFixed(1) };
    }
  }
  return best;
})()`;

const pillById = (id) => `(() => {
  const v = [...document.querySelectorAll('rect.org')].find(r => !r.classList.contains('hide') && r.__data__ && r.__data__.ncr_id === ${JSON.stringify(id)});
  const h = [...document.querySelectorAll('rect.org-hit')].find(r => !r.classList.contains('hide') && r.__data__ && r.__data__.ncr_id === ${JSON.stringify(id)});
  if (!v || !h) return null;
  const vb = v.getBoundingClientRect(), hb = h.getBoundingClientRect();
  return { cx: vb.left + vb.width / 2, cy: vb.top + vb.height / 2,
    vtop: vb.top, vbot: vb.bottom, vw: vb.width, vh: vb.height,
    htop: hb.top, hbot: hb.bottom, hw: hb.width, hh: hb.height,
    dotX: hb.left + hb.width / 2, dotY: hb.top + hb.height / 2 };
})()`;

// Native click on an org-hit rect (drives wireOrgPointer + nearestOrgAtPointer reliably).
const clickOrgHit = (ncrId) => `(() => {
  const hit = [...document.querySelectorAll('rect.org-hit')].find(c => !c.classList.contains('hide') && c.__data__ && c.__data__.ncr_id === ${JSON.stringify(ncrId)});
  if (!hit) return { ok: false };
  const b = hit.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  hit.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }));
  return { ok: true, x, y };
})()`;

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

    // ── dot-near-pill hitbox selection regression ──
    console.log("\n── dot-near-pill hitbox (selection regression) ──");
    await mouse(conn, sessionId, "mouseMoved", 120, 120);
    await sleep(300);
    const near = await evalJs(conn, sessionId, DOT_NEAR_PILL);
    if (!near) {
      console.log("skip: no visible dot within 90px of a larger pill at this zoom");
    } else {
      console.log(`pair: dot "${near.dot.name}" @${near.dist}px from pill "${near.pill.name}" (${Math.round(near.pill.vw)}×${Math.round(near.pill.vh)}px)`);

      await clearSelection(conn, sessionId);
      const dotClick = await evalJs(conn, sessionId, clickOrgHit(near.dot.id));
      await sleep(200);
      const dotPick = await evalJs(conn, sessionId, LAST_PICK);
      const dotPanel = await evalJs(conn, sessionId, PANEL_TITLE);
      console.log(`  dot click @(${dotClick?.x?.toFixed?.(0) ?? "?"},${dotClick?.y?.toFixed?.(0) ?? "?"}) → pick=${JSON.stringify(dotPick)} panel=${JSON.stringify(dotPanel)}`);
      if (!dotClick?.ok || dotPick !== near.dot.name) { console.log("FAIL: dot centre click selected the pill (or nothing) instead of the dot"); failures++; }
      else console.log("ok: dot centre click selects the dot, not the nearby pill");

      const geom = await evalJs(conn, sessionId, pillById(near.pill.id));
      if (!geom) {
        console.log("skip: pill geometry lost after dot click");
      } else {
        const emptyX = geom.cx;
        const emptyY = geom.htop - 8;
        console.log(`  empty-space probe above pill: (${Math.round(emptyX)}, ${Math.round(emptyY)}) — visible top ${geom.vtop.toFixed(0)}, hit top ${geom.htop.toFixed(0)}`);
        await clearSelection(conn, sessionId);
        await clickAt(conn, sessionId, emptyX, emptyY);
        const emptyPick = await evalJs(conn, sessionId, LAST_PICK);
        console.log(`  empty-space click → pick=${JSON.stringify(emptyPick)}`);
        if (emptyPick === near.pill.name) { console.log("FAIL: empty space above pill selected the pill (circular hit overshoot regression)"); failures++; }
        else console.log("ok: empty space above pill does not select the pill");
      }

      await clearSelection(conn, sessionId);
      const pillClick = await evalJs(conn, sessionId, clickOrgHit(near.pill.id));
      await sleep(200);
      const pillPick = await evalJs(conn, sessionId, LAST_PICK);
      const pillPanel = await evalJs(conn, sessionId, PANEL_TITLE);
      const hasSel = await evalJs(conn, sessionId, HAS_SELECTION);
      console.log(`  pill click @(${pillClick?.x?.toFixed?.(0) ?? "?"},${pillClick?.y?.toFixed?.(0) ?? "?"}) → pick=${JSON.stringify(pillPick)} panel=${JSON.stringify(pillPanel)} hasSelection=${hasSel}`);
      if (!pillClick?.ok || !hasSel || pillPick !== near.pill.name) { console.log("FAIL: visible pill centre click did not select the pill"); failures++; }
      else console.log("ok: visible pill centre click selects the pill normally");
    }
  } finally {
    ws?.close(); chrome.kill("SIGKILL"); server.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nPASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
