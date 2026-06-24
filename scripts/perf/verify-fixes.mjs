#!/usr/bin/env node
// Headless verification of today's map fixes. Serves dist/, drives Chrome via CDP:
//   - no orange ripple (.focus-rings) anywhere in the DOM
//   - hover tooltip: ISO/RTO, PJM Zone, MISO LBA show as pills ABOVE the role pills,
//     with no redundant "· CODE" text
//   - subarea clickability while a parent hub is selected (panel stays on the hub,
//     the clicked subarea is marked focus-picked)
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
  // aria-label lives on rect.org (not the org-hit circle); the hit circle is
  // co-located, so the rect centre is a valid click/hover point.
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
        for (const c of document.querySelectorAll('circle.org-hit')) {
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

    // Click the on-screen PJM subarea farthest from the hub (clearly a distinct
    // bubble, not the hub) and assert the panel stays on PJM while the subarea itself
    // visibly responds (focus-picked). Runs at overview zoom AND after a button-zoom
    // into the cluster — the zoomed-in case exercises hit-testing after an animated
    // zoom (a subarea click must not resolve to the enlarged parent hub).
    async function clickSubareaAndVerify(label) {
      const subBox = await evalJs(conn, sessionId, `(() => {
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
          if (d > bestD) { bestD = d; best = { el, id: el.getAttribute('aria-label') || '' }; }
        }
        if (!best) return null;
        const hit = [...document.querySelectorAll('circle.org-hit')].find((c) => (c.getAttribute('aria-label')||'') === best.id);
        const hb = (hit || best.el).getBoundingClientRect();
        return { x: hb.left + hb.width/2, y: hb.top + hb.height/2, name: best.id };
      })()`);
      assert(!!subBox, `a clickable PJM subarea is visible (${label})`);
      if (!subBox) return;
      console.log("DEBUG", label, "subBox:", JSON.stringify(subBox));
      await clickAt(conn, sessionId, subBox.x, subBox.y);
      await sleep(450);
      console.log("DEBUG", label, "lastPick:", JSON.stringify(await evalJs(conn, sessionId, `window.__lastPick`)));
      console.log("DEBUG", label, "clickedClasses:", await evalJs(conn, sessionId, `(() => { const e=[...document.querySelectorAll('rect.org')].find(r=>(r.getAttribute('aria-label')||'')===${JSON.stringify(subBox.name)}); return e? e.getAttribute('class') : 'NOTFOUND'; })()`));
      const afterSub = await evalJs(conn, sessionId, `(() => ({
        panel: document.querySelector('#nerc-panel .p-title h2')?.textContent,
        focusMode: document.getElementById('nerc-svg').classList.contains('focus-mode'),
        picked: document.querySelectorAll('rect.org.focus-picked').length,
      }))()`);
      assert(/PJM/i.test(afterSub.panel || ""), `panel STAYS on PJM after subarea click (${label}, got "${afterSub.panel}")`);
      assert(afterSub.focusMode, `still in PJM focus after subarea click (${label})`);
      assert(afterSub.picked >= 1, `clicked subarea is marked focus-picked (${label}, got ${afterSub.picked})`);
    }
    await clickSubareaAndVerify("overview zoom");

    // Re-select PJM, centre it, button-zoom in, and click a subarea again — verifies
    // the live-projection hit-test fix (clicks resolve correctly after animated zoom).
    const pjmAgain = await evalJs(conn, sessionId, boxOf("PJM Interconnection"));
    if (pjmAgain) { await clickAt(conn, sessionId, pjmAgain.x, pjmAgain.y); await sleep(600); }
    const hubB = await evalJs(conn, sessionId, boxOf("PJM Interconnection"));
    if (hubB) await panBy(720 - hubB.x, 460 - hubB.y);
    for (let i = 0; i < 3; i++) { await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-in').click()`); await sleep(380); }
    await sleep(500);
    await clickSubareaAndVerify("after button-zoom");

    // ── item 1: desktop card is narrow + tucked right ──
    const card = await evalJs(conn, sessionId, `(() => { const p = document.getElementById('nerc-panel'); if (p.hidden) return null; const b = p.getBoundingClientRect(); return { w: b.width, right: b.right, vw: window.innerWidth }; })()`);
    assert(card && card.w <= 460, `desktop card is narrow (width ${card?.w}px ≤ 460)`);
    assert(card && card.right >= card.vw - 30, `desktop card is tucked to the right edge (right ${card?.right} of ${card?.vw})`);

    // ── item 2 sanity: clicking an unrelated org exits focus ──
    await evalJs(conn, sessionId, `document.getElementById('nerc-zoom-home').click()`);
    await sleep(800);
    const ercotBox = await evalJs(conn, sessionId, boxOf("Electric Reliability Council of Texas"));
    if (ercotBox) {
      await clickAt(conn, sessionId, ercotBox.x, ercotBox.y);
      await sleep(700);
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
