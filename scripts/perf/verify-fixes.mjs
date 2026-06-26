#!/usr/bin/env node
// Headless verification of today's map fixes. Serves dist/, drives Chrome via CDP:
//   - no orange ripple (.focus-rings) anywhere in the DOM
//   - hover tooltip: ISO/RTO, PJM Zone, MISO LBA show as pills ABOVE the role pills,
//     with no redundant "· CODE" text
//   - dot-near-pill hitbox: dots beside pills stay selectable; empty space above
//     pills must not select; visible pill clicks still work
//   - subarea clickability while a parent family is in focus (clicking a subarea
//     selects it / opens its panel and keeps PJM/MISO focus active)
//   - desktop detail card is narrow + tucked to the right
// Usage: npm run build && node scripts/perf/verify-fixes.mjs

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
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9347);
const OUT = "/tmp/nerc-verify";
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
  await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await sleep(50);
  await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 }, sessionId);
  await sleep(40);
  await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 }, sessionId);
}
async function moveTo(conn, sessionId, x, y) {
  await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
}
function boxOf(name) {
  // aria-label lives on rect.org; the org-hit rect is co-located, so the rect
  // centre is a valid click/hover point.
  return `(() => {
    const n = [...document.querySelectorAll('rect.org')].find((c) => (c.getAttribute('aria-label')||'').includes(${JSON.stringify(name)}) && !c.classList.contains('hide'));
    if (!n) return null; const b = n.getBoundingClientRect(); if (b.width <= 0) return null; return { x: b.left + b.width/2, y: b.top + b.height/2, w: b.width };
  })()`;
}
// Read the current tooltip's pill structure: ordered rows of pill-texts, flagging
// the special row, plus whether any pill carries a redundant separator.
const TOOLTIP_PROBE = `(() => {
  const tip = document.getElementById('nerc-tooltip');
  if (!tip || tip.hidden) return { shown: false };
  const rows = [...tip.querySelectorAll('.nerc-tt-pills')].map((row) => ({
    special: row.classList.contains('nerc-tt-special'),
    pills: [...row.querySelectorAll('.nerc-rolepill')].map((p) => p.textContent),
  }));
  return { shown: true, name: tip.querySelector('.tt-name')?.textContent, rows };
})()`;

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

const LAST_PICK = `(window.__lastPick && window.__lastPick.o) || null`;
const HAS_SELECTION = `!!document.querySelector('rect.org.selected')`;

async function clearSelection(conn, sessionId) {
  await evalJs(conn, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`).catch(() => {});
  await clickAt(conn, sessionId, 6, 6);
  await evalJs(conn, sessionId, `window.__lastPick = '__cleared__'`).catch(() => {});
  await sleep(120);
}

// Visible dot near a larger pill, measured from rect.org / rect.org-hit DOM boxes.
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
      if (p.vw < dt.r * 2.5) continue;
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
    vtop: vb.top, vbot: vb.bottom, htop: hb.top, hw: hb.width };
})()`;

const clickOrgHit = (ncrId) => `(() => {
  const hit = [...document.querySelectorAll('rect.org-hit')].find(c => !c.classList.contains('hide') && c.__data__ && c.__data__.ncr_id === ${JSON.stringify(ncrId)});
  if (!hit) return { ok: false };
  const b = hit.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  hit.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }));
  return { ok: true, x, y };
})()`;

async function runDotPillHitboxTests(conn, sessionId) {
  console.log("\n── dot-near-pill hitbox regression ──");
  const zoomIn = `document.getElementById('nerc-zoom-in').click()`;
  for (let i = 0; i < 6; i++) { await evalJs(conn, sessionId, zoomIn); await sleep(380); }
  await sleep(700);

  const near = await evalJs(conn, sessionId, DOT_NEAR_PILL);
  if (!near) {
    console.log("note: no visible dot within 90px of a larger pill at this zoom — skipping hitbox checks");
    await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-home').click()`);
    await sleep(800);
    return;
  }
  console.log(`pair: dot "${near.dot.name}" @${near.dist}px from pill "${near.pill.name}"`);

  await clearSelection(conn, sessionId);
  await evalJs(conn, sessionId, clickOrgHit(near.dot.id));
  await sleep(200);
  const dotPick = await evalJs(conn, sessionId, LAST_PICK);
  assert(dotPick === near.dot.name, `dot centre click selects the dot (got ${JSON.stringify(dotPick)})`);

  const geom = await evalJs(conn, sessionId, pillById(near.pill.id));
  if (geom) {
    const emptyX = geom.cx, emptyY = geom.htop - 8;
    await clearSelection(conn, sessionId);
    await clickAt(conn, sessionId, emptyX, emptyY);
    const emptyPick = await evalJs(conn, sessionId, LAST_PICK);
    assert(emptyPick !== near.pill.name, `empty space above pill does not select the pill (got ${JSON.stringify(emptyPick)})`);
  } else {
    console.log("note: pill geometry unavailable for empty-space probe — skipping");
  }

  await clearSelection(conn, sessionId);
  await evalJs(conn, sessionId, clickOrgHit(near.pill.id));
  await sleep(200);
  const pillPick = await evalJs(conn, sessionId, LAST_PICK);
  const hasSel = await evalJs(conn, sessionId, HAS_SELECTION);
  assert(hasSel && pillPick === near.pill.name, `visible pill centre click selects the pill (got ${JSON.stringify(pillPick)}, hasSelection=${hasSel})`);

  await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-home').click()`);
  await sleep(800);
}

async function hoverAndRead(conn, sessionId, name) {
  const box = await evalJs(conn, sessionId, boxOf(name));
  if (!box) return null;
  await moveTo(conn, sessionId, box.x, box.y);
  await sleep(180);
  return { box, tip: await evalJs(conn, sessionId, TOOLTIP_PROBE) };
}

// Find the special-classification text in a tooltip probe, asserting ordering:
// the special row must come BEFORE any role row.
function specialPills(tip) {
  if (!tip || !tip.shown) return { special: [], orderOk: true };
  const specialIdx = tip.rows.findIndex((r) => r.special);
  const roleIdx = tip.rows.findIndex((r) => !r.special);
  const special = specialIdx >= 0 ? tip.rows[specialIdx].pills : [];
  const orderOk = special.length === 0 || roleIdx === -1 || specialIdx < roleIdx;
  return { special, orderOk };
}

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
    await conn.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await conn.send("Page.navigate", { url }, sessionId);
    for (let i = 0; i < 80; i++) { const v = await evalJs(conn, sessionId, `document.querySelectorAll('rect.org').length`).catch(() => 0); if (v > 0) break; await sleep(150); }
    await sleep(3500);
    await evalJs(conn, sessionId, `window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message || e.error || e)));`);

    await runDotPillHitboxTests(conn, sessionId);

    // ── item 5: no orange ripple element anywhere ──
    const hasRings = await evalJs(conn, sessionId, `!!document.querySelector('.focus-rings')`);
    assert(!hasRings, "no .focus-rings element exists in the DOM (orange ripple removed)");
    const hasRippleKf = await evalJs(conn, sessionId, `[...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => (r.name||'') === 'nerc-focus-ripple'); } catch { return false; } })`);
    assert(!hasRippleKf, "no nerc-focus-ripple keyframes remain in CSS");

    // ── item 4a: hover an ISO/RTO (PJM hub) → "ISO / RTO" pill ABOVE role pills ──
    const pjmHover = await hoverAndRead(conn, sessionId, "PJM Interconnection");
    assert(pjmHover && pjmHover.tip.shown, "hovering PJM shows a tooltip");
    const pjmSpecial = specialPills(pjmHover?.tip);
    assert(pjmSpecial.special.includes("ISO / RTO"), `ISO/RTO pill shown for PJM (got ${JSON.stringify(pjmSpecial.special)})`);
    assert(pjmSpecial.orderOk, "ISO/RTO special pill sits ABOVE the role pills");
    await moveTo(conn, sessionId, 5, 5);
    await sleep(120);

    // ── item 4b/4c: zoom in + scan visible bubbles for MISO LBA and PJM Zone pills ──
    // Zoom toward the centre (Midwest/East) so subareas disclose, then sweep.
    const zoomIn = `document.getElementById('nerc-zoom-in').click()`;
    for (let i = 0; i < 4; i++) { await evalJs(conn, sessionId, zoomIn); await sleep(380); }
    await sleep(600);

    const found = { "MISO LBA": null, "PJM Zone": null };
    const seen = { redundant: false };
    async function sweep() {
      const boxes = await evalJs(conn, sessionId, `(() => {
        const out = [];
        for (const c of document.querySelectorAll('rect.org-hit')) {
          if (c.classList.contains('hide')) continue;
          const b = c.getBoundingClientRect();
          const cx = b.left + b.width/2, cy = b.top + b.height/2;
          if (cx < 10 || cx > 1430 || cy < 70 || cy > 890) continue;
          out.push({ x: cx, y: cy });
        }
        return out.slice(0, 220);
      })()`);
      for (const b of boxes) {
        if (found["MISO LBA"] && found["PJM Zone"]) break;
        await moveTo(conn, sessionId, b.x, b.y);
        await sleep(60);
        const tip = await evalJs(conn, sessionId, TOOLTIP_PROBE);
        if (!tip.shown) continue;
        const sp = specialPills(tip);
        for (const label of ["MISO LBA", "PJM Zone"]) {
          if (sp.special.includes(label) && !found[label]) {
            found[label] = { name: tip.name, orderOk: sp.orderOk, special: sp.special };
          }
        }
        // redundant-text check: no pill (any row) should carry "·" or " - CODE"
        for (const row of tip.rows) for (const p of row.pills) {
          if (/·|\s-\s/.test(p)) seen.redundant = true;
        }
      }
    }
    async function panBy(dx, dy) {
      const cx = 720, cy = 460;
      await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy }, sessionId);
      await conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1, buttons: 1 }, sessionId);
      await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + dx, y: cy + dy, button: "left", buttons: 1 }, sessionId);
      await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + dx, y: cy + dy, button: "left", clickCount: 1, buttons: 0 }, sessionId);
      await sleep(450);
    }
    await sweep();
    // PJM zones sit in the mid-Atlantic; drag the map westward (content moves left)
    // in steps so the eastern seaboard scrolls into view, sweeping after each.
    for (let step = 0; step < 4 && !found["PJM Zone"]; step++) {
      await panBy(-380, step === 0 ? -60 : 40);
      await sweep();
    }
    assert(!!found["MISO LBA"], `MISO LBA pill found on a control area (${JSON.stringify(found["MISO LBA"])})`);
    if (found["MISO LBA"]) assert(found["MISO LBA"].orderOk, "MISO LBA pill sits above role pills");
    assert(!!found["PJM Zone"], `PJM Zone pill found on a zone org (${JSON.stringify(found["PJM Zone"])})`);
    if (found["PJM Zone"]) assert(found["PJM Zone"].orderOk, "PJM Zone pill sits above role pills");
    assert(!seen.redundant, "no tooltip pill carries redundant '·' or ' - CODE' text");

    // ── reset view ──
    await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-home').click()`);
    await sleep(900);

    // ── item 3: subarea clickability while PJM is selected ──
    const pjmBox = await evalJs(conn, sessionId, boxOf("PJM Interconnection"));
    await clickAt(conn, sessionId, pjmBox.x, pjmBox.y);
    await sleep(700);
    const afterPjm = await evalJs(conn, sessionId, `(() => ({
      panel: document.querySelector('#nerc-panel .p-title h2')?.textContent,
      panelHidden: document.getElementById('nerc-panel').hidden,
      focusMode: document.getElementById('nerc-svg').classList.contains('focus-mode'),
    }))()`);
    assert(!afterPjm.panelHidden && /PJM/i.test(afterPjm.panel || ""), `panel shows PJM after hub click (got "${afterPjm.panel}")`);
    assert(afterPjm.focusMode, "focus mode active after PJM click");

    // Click the on-screen PJM subarea farthest from the hub and assert the subarea is
    // clickable/interactive while the family stays in focus: it selects the subarea
    // (its own panel opens) and PJM focus mode remains active. The click is dispatched
    // as a native event on the subarea's hit rect (with correct client coords) so it
    // drives the real d3 click handler + nearestOrgAtPointer + selectOrg without
    // d3-zoom's drag-gesture detection swallowing a synthesized CDP press/release.
    const sub = await evalJs(conn, sessionId, `(() => {
      const hubEl = [...document.querySelectorAll('rect.org')].find((c) => (c.getAttribute('aria-label')||'').includes('PJM Interconnection'));
      const hb0 = hubEl ? hubEl.getBoundingClientRect() : { left: 720, top: 460, width: 0, height: 0 };
      const hx = hb0.left + hb0.width/2, hy = hb0.top + hb0.height/2;
      let best = null, bestD = 0;
      for (const el of document.querySelectorAll('rect.org.focus-related')) {
        if (el.classList.contains('hide')) continue;
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width/2, cy = b.top + b.height/2;
        if (cx < 30 || cx > 1410 || cy < 80 || cy > 760) continue; // on-screen, clear of card
        const d = Math.hypot(cx - hx, cy - hy);
        if (d > bestD) { bestD = d; best = el; }
      }
      if (!best) return null;
      const name = best.getAttribute('aria-label') || '';
      const id = best.__data__ && best.__data__.ncr_id;
      const hit = [...document.querySelectorAll('rect.org-hit')].find((c) => c.__data__ && c.__data__.ncr_id === id) || best;
      const b = hit.getBoundingClientRect();
      const x = b.left + b.width/2, y = b.top + b.height/2;
      hit.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }));
      return name;
    })()`);
    assert(!!sub, "a PJM subarea is visible to click while PJM is selected");
    await sleep(450);
    const afterSub = await evalJs(conn, sessionId, `(() => ({
      panel: document.querySelector('#nerc-panel .p-title h2')?.textContent,
      panelHidden: document.getElementById('nerc-panel').hidden,
      focusMode: document.getElementById('nerc-svg').classList.contains('focus-mode'),
      selectedNames: [...document.querySelectorAll('rect.org.selected')].map(e=>e.getAttribute('aria-label')),
    }))()`);
    // New behavior (parallel agent's focused-subarea panels): clicking a subarea opens
    // its OWN panel and keeps the family in focus — the subarea is fully interactive.
    assert(!afterSub.panelHidden, "subarea click opens a detail panel");
    assert(afterSub.focusMode, "still in PJM focus after subarea click");
    assert(afterSub.selectedNames.includes(sub),
      `the clicked subarea "${sub}" is the selected org (selected=${JSON.stringify(afterSub.selectedNames)})`);

    // ── item 1: desktop card is narrow + tucked right (panel open) ──
    const card = await evalJs(conn, sessionId, `(() => { const p = document.getElementById('nerc-panel'); if (p.hidden) return null; const b = p.getBoundingClientRect(); return { w: b.width, right: b.right, vw: window.innerWidth }; })()`);
    assert(card && card.w <= 460, `desktop card is narrow (width ${card?.w}px ≤ 460)`);
    assert(card && card.right >= card.vw - 30, `desktop card is tucked to the right edge (right ${card?.right} of ${card?.vw})`);

    // Background click clears focus + selection cleanly. Dispatch the click on the svg
    // root (its handler closes popovers/focus) so d3-zoom's gesture detection can't
    // swallow a synthesized empty-space press/release.
    await evalJs(conn, sessionId, `document.getElementById('nerc-svg').dispatchEvent(new MouseEvent('click', { clientX: 40, clientY: 300, bubbles: true, cancelable: true, view: window }))`);
    await sleep(500);
    const cleared = await evalJs(conn, sessionId, `document.querySelectorAll('rect.org.selected, rect.org.focus-picked').length + (document.getElementById('nerc-svg').classList.contains('focus-mode') ? 100 : 0)`);
    assert(cleared === 0, `background click clears focus + selection (got ${cleared})`);
    const errs = await evalJs(conn, sessionId, `window.__errs || []`);
    assert(errs.length === 0, `no page errors during interaction (got ${JSON.stringify(errs)})`);

    // ── item 2 sanity: clicking an unrelated org exits focus ──
    await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-home').click()`);
    await sleep(800);
    // Re-enter PJM focus, then click ERCOT (unrelated ISO) — focus must clear.
    const pjmHub3 = await evalJs(conn, sessionId, boxOf("PJM Interconnection"));
    if (pjmHub3) { await clickAt(conn, sessionId, pjmHub3.x, pjmHub3.y); await sleep(600); }
    const clickedErcot = await evalJs(conn, sessionId, `(() => {
      const r = [...document.querySelectorAll('rect.org')].find((c) => (c.getAttribute('aria-label')||'').includes('Electric Reliability Council of Texas') && !c.classList.contains('hide'));
      if (!r) return false;
      const id = r.__data__ && r.__data__.ncr_id;
      const hit = [...document.querySelectorAll('rect.org-hit')].find((c) => c.__data__ && c.__data__.ncr_id === id) || r;
      const b = hit.getBoundingClientRect();
      hit.dispatchEvent(new MouseEvent('click', { clientX: b.left + b.width/2, clientY: b.top + b.height/2, bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
    if (clickedErcot) {
      await sleep(500);
      const afterErcot = await evalJs(conn, sessionId, `document.getElementById('nerc-svg').classList.contains('focus-mode')`);
      assert(!afterErcot, "clicking an unrelated ISO (ERCOT) exits PJM/MISO focus");
    } else {
      console.log("note: ERCOT not located for the unrelated-click check (skipped)");
    }

    const shot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(OUT, "final.png"), Buffer.from(shot.data, "base64"));
    console.log(`screenshot in ${OUT}`);
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill();
    server.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
