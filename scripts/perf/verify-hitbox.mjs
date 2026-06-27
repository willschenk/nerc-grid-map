#!/usr/bin/env node
// Headless verification of the org-selection hitbox fix. Serves dist/, drives
// Chrome via CDP, and checks that:
//   - a wide pill's invisible hit target is now a TIGHT rounded RECT that hugs the
//     visible pill (hit height ≈ visible height), not a bounding CIRCLE whose
//     square bbox ballooned to ~the pill width.
//   - clicking inside the visible pill selects that pill.
//   - clicking the empty space just above the pill (inside where the old circle
//     reached, outside the new rect) hits no .org-hit element → selects nothing.
//   - a dot near/under a pill stays selectable (clicking it selects the dot).
// Usage: npm run build && node scripts/perf/verify-hitbox.mjs

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
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9351);
const OUT = "/tmp/nerc-verify-hitbox";
const MOBILE = !!process.env.NERC_MOBILE;
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
    const file = safeJoinDist(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end("nf"); return; }
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}${BASE_PATH}` };
}
async function getBrowserWs() {
  for (let i = 0; i < 50; i++) {
    try { const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`); const j = await res.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(100);
  }
  throw new Error("no chrome ws");
}
function makeConn(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const { resolve: r, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result); } });
  return { send(method, params = {}, sessionId) { return new Promise((r, reject) => { const mid = ++id; pending.set(mid, { resolve: r, reject }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); }); } };
}
async function evalJs(conn, sessionId, expr) {
  const { result, exceptionDetails } = await conn.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(exceptionDetails)}`);
  return result.value;
}
async function clickAt(conn, sessionId, x, y) {
  if (MOBILE) {
    await conn.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1 }] }, sessionId);
    await sleep(45);
    await conn.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
    await sleep(180);
    return;
  }
  await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await sleep(40);
  await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 }, sessionId);
  await sleep(35);
  await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 }, sessionId);
  await sleep(120);
}

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.log(`  ✗ ${msg}`); } }

// Whether ANY org is currently selected (the white-ring class on a visible bubble).
const HAS_SELECTION = `!!document.querySelector('rect.org.selected')`;
// entity_name selectOrg was last invoked with (source of truth — aria-label is a
// display name, not the entity_name). Reset to a sentinel before each click.
const LAST_PICK = `(window.__lastPick && window.__lastPick.o) || null`;
async function clearSelection(conn, sessionId) {
  await evalJs(conn, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`).catch(() => {});
  await clickAt(conn, sessionId, 6, 6); // background click clears
  await evalJs(conn, sessionId, `window.__lastPick = '__cleared__'`).catch(() => {});
  await sleep(120);
}

// Widest comfortably-on-screen pill, with its visible rect AND hit rect bboxes.
const WIDEST_PILL = `(() => {
  const hits = new Map();
  for (const h of document.querySelectorAll('rect.org-hit')) {
    if (h.classList.contains('hide')) continue;
    const d = h.__data__; if (d) hits.set(d.ncr_id, h);
  }
  let best = null;
  for (const r of document.querySelectorAll('rect.org')) {
    if (r.classList.contains('hide')) continue;
    const d = r.__data__; if (!d || d._renderFallback) continue;
    const vb = r.getBoundingClientRect();
    if (vb.width <= 0 || vb.height <= 0) continue;
    if (vb.top < 80 || vb.bottom > window.innerHeight - 120 || vb.left < 20 || vb.right > window.innerWidth - 20) continue;
    const h = hits.get(d.ncr_id); if (!h) continue;
    const hb = h.getBoundingClientRect();
    const aspect = vb.width / vb.height;
    const cand = { id: d.ncr_id, name: d.entity_name,
      vw: +vb.width.toFixed(1), vh: +vb.height.toFixed(1),
      cx: +(vb.left + vb.width/2).toFixed(1), cy: +(vb.top + vb.height/2).toFixed(1),
      vtop: +vb.top.toFixed(1),
      hw: +hb.width.toFixed(1), hh: +hb.height.toFixed(1), aspect: +aspect.toFixed(2) };
    if (!best || aspect > best.aspect) best = cand;
  }
  return best;
})()`;

// Fresh current geometry (visible + hit bbox) of one org by id — re-measured right
// before a sub-test so an intervening redraw/nudge can't leave a stale coordinate.
const pillById = (id) => `(() => {
  const v = [...document.querySelectorAll('rect.org')].find(r => !r.classList.contains('hide') && r.__data__ && r.__data__.ncr_id === ${JSON.stringify(id)});
  const h = [...document.querySelectorAll('rect.org-hit')].find(r => !r.classList.contains('hide') && r.__data__ && r.__data__.ncr_id === ${JSON.stringify(id)});
  if (!v || !h) return null;
  const vb = v.getBoundingClientRect(), hb = h.getBoundingClientRect();
  return { cx: vb.left+vb.width/2, vtop: vb.top, vbot: vb.bottom, vw: vb.width,
    htop: hb.top, hbot: hb.bottom, hw: hb.width, hh: hb.height };
})()`;

// What element is at a screen point — flag whether it's an org-hit target.
const elAt = (x, y) => `(() => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return { none: true };
  const d = el.__data__;
  return { tag: el.tagName, isHit: !!(el.classList && el.classList.contains('org-hit')),
    ncr: d ? d.ncr_id : null, name: d ? d.entity_name : null };
})()`;

// A visible dot whose centre sits NEAR a pill but OUTSIDE the pill's visible body —
// the genuine "nearby dot" the old oversized circle used to swallow. (A dot whose
// centre is under the pill body is hidden behind it; selecting the pill there is
// correct, so those are excluded.)
const DOT_NEAR_PILL = `(() => {
  const onScreen = (x, y) => x > 20 && x < window.innerWidth - 20 && y > 80 && y < window.innerHeight - 120;
  const dots = [], pills = [];
  for (const h of document.querySelectorAll('rect.org-hit')) {
    if (h.classList.contains('hide') || !h.__data__) continue;
    const b = h.getBoundingClientRect(); if (b.width <= 0) continue;
    const x = b.left+b.width/2, y = b.top+b.height/2; if (!onScreen(x, y)) continue;
    if (h.__data__._renderFallback) { dots.push({ id: h.__data__.ncr_id, name: h.__data__.entity_name, x, y }); }
  }
  for (const r of document.querySelectorAll('rect.org')) {
    if (r.classList.contains('hide') || !r.__data__ || r.__data__._renderFallback) continue;
    const b = r.getBoundingClientRect(); if (b.width <= 0) continue;
    pills.push({ id: r.__data__.ncr_id, name: r.__data__.entity_name, cx: b.left+b.width/2, cy: b.top+b.height/2,
      l: b.left, rt: b.right, t: b.top, btm: b.bottom });
  }
  let best = null;
  for (const dt of dots) {
    for (const p of pills) {
      const insideBody = dt.x >= p.l && dt.x <= p.rt && dt.y >= p.t && dt.y <= p.btm;
      if (insideBody) continue; // dot hidden under the pill — not a "nearby" dot
      const d = Math.hypot(dt.x - p.cx, dt.y - p.cy);
      if (d > 90) continue;
      if (!best || d < best.dist) best = { dot: dt, pill: { id: p.id, name: p.name }, dist: +d.toFixed(1) };
    }
  }
  return best;
})()`;

const bubbleCenterById = (id) => `(() => {
  const r = [...document.querySelectorAll('rect.org')].find((n) => !n.classList.contains('hide') && n.__data__ && n.__data__.ncr_id === ${JSON.stringify(id)});
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
})()`;

async function main() {
  if (!existsSync(join(DIST, "index.html"))) { console.error("run npm run build first"); process.exit(1); }
  const chromePath = findChrome();
  if (!chromePath) { console.error("Chrome not found"); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const VIEW = MOBILE ? { w: 390, h: 844 } : { w: 1440, h: 900 };
  console.log(`viewport: ${VIEW.w}×${VIEW.h} ${MOBILE ? "(mobile/compact)" : "(desktop)"}`);
  const { server, url } = await startServer();
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${CHROME_PORT}`, `--user-data-dir=${join(OUT, "chrome-profile")}`, `--window-size=${VIEW.w},${VIEW.h}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    ws = new WebSocket(await getBrowserWs());
    await new Promise((r, x) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", x, { once: true }); });
    const conn = makeConn(ws);
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);
    await conn.send("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: MOBILE, ...(MOBILE ? { screenWidth: VIEW.w, screenHeight: VIEW.h } : {}) }, sessionId);
    if (MOBILE) await conn.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId).catch(() => {});
    await conn.send("Page.navigate", { url }, sessionId);
    for (let i = 0; i < 80; i++) { const v = await evalJs(conn, sessionId, `document.querySelectorAll('rect.org').length`).catch(() => 0); if (v > 0) break; await sleep(150); }
    await sleep(3000);

    // Zoom in a few steps so pills grow and the deeper layers (incl. give-way dots) reveal.
    for (let i = 0; i < 6; i++) { await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-in').click()`); await sleep(420); }
    await sleep(800);

    console.log("\n── hit-target shape (tight rect, not bounding circle) ──");
    const pill = await evalJs(conn, sessionId, WIDEST_PILL);
    if (!pill) { console.log("  ! no on-screen pill found — aborting"); failed++; }
    else {
      console.log(`  pill: ${JSON.stringify(pill)}`);
      // A bounding-circle hit bbox is ~square (hh ≈ hw). A tight pill rect keeps the
      // wide aspect: hit height hugs the visible height, far below the hit width.
      assert(pill.hw >= pill.vw - 1 && pill.hh >= pill.vh - 1, "hit rect fully covers the visible pill");
      assert(pill.hh <= pill.vh + 24, `hit height hugs visible height (hh ${pill.hh} ≤ vh ${pill.vh} + 24)`);
      if (pill.aspect >= 1.6) {
        assert(pill.hh < pill.hw * 0.72, `wide pill's hit stays wide, not a circle (hh ${pill.hh} < hw ${pill.hw} × 0.72)`);
      } else {
        console.log(`  (pill aspect ${pill.aspect} < 1.6 — skipping circle-vs-rect ratio assert)`);
      }
    }

    console.log("\n── click inside the visible pill selects the pill ──");
    if (pill) {
      await clearSelection(conn, sessionId);
      await clickAt(conn, sessionId, pill.cx, pill.cy);
      const pick = await evalJs(conn, sessionId, LAST_PICK);
      const hasSel = await evalJs(conn, sessionId, HAS_SELECTION);
      console.log(`  selectOrg picked: ${JSON.stringify(pick)}  (hasSelection=${hasSel})`);
      assert(hasSel && pick === pill.name, "pill centre click selects the pill");
    }

    console.log("\n── empty space just above the pill selects nothing ──");
    if (pill) {
      const g = await evalJs(conn, sessionId, pillById(pill.id)); // re-measure (the click test nudged it)
      if (!g) { console.log("  ! pill no longer on screen — skipping"); }
      else {
        // The OLD circular hit reached ~half the pill WIDTH above the bubble; the new
        // tight rect reaches only its small pad. Probe just above the actual hit-rect
        // top — a band the old circle covered (hw/2 ≈ ${(g.hw / 2).toFixed(0)}px up) but the rect does not.
        const gx = g.cx, gy = g.htop - (MOBILE ? 18 : 8);
        const oldCircleReach = g.hw / 2; // ≈ old hitTargetRadius in px for a wide pill
        const cy = (g.vtop + g.vbot) / 2;
        console.log(`  pill top: visible ${g.vtop.toFixed(0)}, hit ${g.htop.toFixed(0)}; old circle reached ~${(cy - oldCircleReach).toFixed(0)} (≈${oldCircleReach.toFixed(0)}px above centre), probing y=${gy.toFixed(0)}`);
        const at = await evalJs(conn, sessionId, elAt(gx, gy));
        console.log(`  elementFromPoint(${gx.toFixed(0)}, ${gy.toFixed(0)}): ${JSON.stringify(at)}`);
        assert(!(at && at.isHit && at.ncr === pill.id), "point above the tight hit rect is NOT over the pill (no circular overshoot)");
        await clearSelection(conn, sessionId);
        await clickAt(conn, sessionId, gx, gy);
        const pick = await evalJs(conn, sessionId, LAST_PICK);
        console.log(`  selectOrg picked after empty-space click: ${JSON.stringify(pick)}`);
        assert(pick !== pill.name, "empty space above the pill does not select the pill");
      }
    }

    console.log("\n── a dot near a pill stays selectable (click + hover) ──");
    const near = await evalJs(conn, sessionId, DOT_NEAR_PILL);
    if (!near) { console.log("  (no dot found within 90px of a pill at this zoom — skipping)"); }
    else {
      console.log(`  dot ${JSON.stringify(near.dot.name)} @${near.dist}px from pill ${JSON.stringify(near.pill.name)}`);
      // CLICK: nearestOrgAtPointer must resolve the dot even if the pill's padded
      // hit rect sits on top at that pixel.
      await clearSelection(conn, sessionId);
      const dotEl = await evalJs(conn, sessionId, bubbleCenterById(near.dot.id));
      if (!dotEl) {
        console.log("  ! dot no longer visible after clearing selection");
        failed++;
      } else {
        const dotAt = await evalJs(conn, sessionId, elAt(dotEl.x, dotEl.y));
        console.log(`  elementAt current dot center: ${JSON.stringify(dotAt)}`);
        await clickAt(conn, sessionId, dotEl.x, dotEl.y);
      }
      const pick = await evalJs(conn, sessionId, LAST_PICK);
      console.log(`  selectOrg picked after dot click: ${JSON.stringify(pick)}`);
      assert(pick === near.dot.name, "clicking the dot selects the dot, not the pill");
      // SELECTED PILL must not swallow a nearby dot: pick the pill first, then click
      // the dot — nearestOrgAtPointer should follow the pointer, not stick on the pill.
      await clearSelection(conn, sessionId);
      const pillEl = await evalJs(conn, sessionId, bubbleCenterById(near.pill.id));
      if (pillEl) {
        await clickAt(conn, sessionId, pillEl.x, pillEl.y);
        const pillPick = await evalJs(conn, sessionId, LAST_PICK);
        assert(pillPick === near.pill.name, "pill centre click selects the pill");
        const currentDotEl = await evalJs(conn, sessionId, bubbleCenterById(near.dot.id));
        let attemptedSelectedDotTap = false;
        if (!currentDotEl) {
          console.log("  ! dot no longer visible after selecting the pill");
          failed++;
        } else {
          const currentDotAt = await evalJs(conn, sessionId, elAt(currentDotEl.x, currentDotEl.y));
          console.log(`  elementAt current dot center after pill select: ${JSON.stringify(currentDotAt)}`);
          if (currentDotAt?.isHit) {
            attemptedSelectedDotTap = true;
            await clickAt(conn, sessionId, currentDotEl.x, currentDotEl.y);
          } else {
            console.log("  (dot is covered after selecting the pill — skipping selected-pill dot tap)");
          }
        }
        const dotPick = await evalJs(conn, sessionId, LAST_PICK);
        console.log(`  selectOrg after pill→dot click: ${JSON.stringify(dotPick)}`);
        if (attemptedSelectedDotTap) {
          assert(dotPick === near.dot.name, "clicking the dot while pill is selected selects the dot");
        }
      }
      // HOVER (desktop only — touch devices have no hover): clear selection (hover
      // is suppressed while selected), hover the dot centre, and confirm the HOT
      // bubble (what hoverOrg highlights) is the dot, not the pill whose padded hit
      // rect sits on top at that pixel.
      if (!MOBILE) {
        await clearSelection(conn, sessionId);
        await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 6, y: 6 }, sessionId); await sleep(150);
        const hoverDotEl = await evalJs(conn, sessionId, bubbleCenterById(near.dot.id));
        if (!hoverDotEl) {
          console.log("  ! dot no longer visible before hover");
          failed++;
        } else {
          await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverDotEl.x, y: hoverDotEl.y }, sessionId);
          await sleep(300);
          const hot = await evalJs(conn, sessionId, `(() => { const h = document.querySelector('rect.org.hot'); return h && h.__data__ ? { ncr: h.__data__.ncr_id, name: h.__data__.entity_name } : null; })()`);
          console.log(`  hot bubble after hovering dot: ${JSON.stringify(hot)}`);
          assert(hot != null && hot.ncr === near.dot.id, "hovering the dot highlights the DOT, not the pill");
        }
      }
    }

    const errs = await evalJs(conn, sessionId, `(window.__errs||[])`).catch(() => []);
    console.log(`\n── runtime errors: ${errs && errs.length ? JSON.stringify(errs) : "none"} ──`);

    console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    try { ws?.close(); } catch {}
    try { chrome.kill(); } catch {}
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
