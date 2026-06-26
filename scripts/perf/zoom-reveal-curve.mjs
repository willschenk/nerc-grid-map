#!/usr/bin/env node
// Give-way dot visibility regression + reveal curve probe. Serves dist/, drives
// headless Chrome via CDP, zooms IN step by step from the overview at desktop and
// mobile widths, and reports visible org counts by tier at each zoom level:
//   - real pills (placed bubbles)
//   - background dots (placement fallback, non give-way)
//   - give-way dots (GO/GOP-only subordinate layer)
//   - labeled orgs (persistent inside labels)
//
// Loose assertions catch extreme regressions (dots hidden until deep zoom, or
// give-way dots appearing at the national overview). Not pixel-exact counts.
//
// Usage: npm run build && npm run perf:reveal-curve
//        node scripts/perf/zoom-reveal-curve.mjs

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
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9358);
const OUT = "/tmp/nerc-reveal-curve";
const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

function findChrome() {
  const c = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of c) if (existsSync(p)) return p;
  const w = spawnSync("which", ["google-chrome"], { encoding: "utf8" });
  return w.status === 0 ? w.stdout.trim() : null;
}

function safeJoinDist(p) {
  let rel = p;
  if (rel.startsWith(BASE_PATH)) rel = rel.slice(BASE_PATH.length);
  else if (rel === "/") rel = "";
  else return null;
  if (!rel || rel.endsWith("/")) rel = `${rel}index.html`;
  const f = normalize(join(DIST, rel));
  if (f !== DIST && !f.startsWith(`${DIST}${sep}`)) return null;
  return f;
}

async function startServer() {
  const server = createServer((q, e) => {
    const f = safeJoinDist(decodeURIComponent(new URL(q.url, "http://x").pathname));
    if (!f || !existsSync(f) || !statSync(f).isFile()) {
      e.statusCode = 404;
      e.end("nf");
      return;
    }
    e.setHeader("content-type", MIME[extname(f)] ?? "application/octet-stream");
    createReadStream(f).pipe(e);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}${BASE_PATH}` };
}

async function getBrowserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no debugger ws");
}

function makeConn(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result);
    }
  });
  return {
    send(method, params = {}, s) {
      return new Promise((r, rej) => {
        const mid = ++id;
        pending.set(mid, { resolve: r, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId: s }));
      });
    },
  };
}

async function evalJs(conn, s, expr) {
  const { result, exceptionDetails } = await conn.send(
    "Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true },
    s,
  );
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
}

const READ_K = `(() => { const s = document.getElementById("nerc-svg"); return s && s.__zoom ? s.__zoom.k : 0; })()`;

// Split visible orgs into pills, placement-fallback dots, and give-way dots; count
// persistent inside labels and pill↔pill overlaps. Uses DOM geometry only.
const COUNTS = `(() => {
  const GO = new Set(["GO", "GOP"]);
  const isGiveWay = (d) =>
    d._giveWay === true ||
    (Array.isArray(d.roles) && d.roles.length > 0 && d.roles.every((r) => GO.has(r)));
  const onScreen = (b) =>
    b.right > 0 && b.left < window.innerWidth && b.bottom > 0 && b.top < window.innerHeight && b.width > 0.5;
  let pills = 0, bgDots = 0, giveWay = 0, labeled = 0;
  const pillBoxes = [];
  for (const n of document.querySelectorAll("svg rect.org")) {
    if (n.classList.contains("hide") || !n.__data__) continue;
    const b = n.getBoundingClientRect();
    if (!onScreen(b)) continue;
    const d = n.__data__;
    if (n.classList.contains("labeled")) labeled++;
    const dotLike = d._renderFallback || d.placementMode === "fallbackTiny";
    if (dotLike) {
      if (isGiveWay(d)) giveWay++;
      else bgDots++;
    } else {
      pills++;
      pillBoxes.push(b);
    }
  }
  let overlaps = 0;
  const TH = 3;
  for (let i = 0; i < pillBoxes.length; i++)
    for (let j = i + 1; j < pillBoxes.length; j++) {
      const a = pillBoxes[i], b = pillBoxes[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > TH && oy > TH) overlaps++;
    }
  const dots = bgDots + giveWay;
  return { pills, bgDots, giveWay, dots, labeled, total: pills + dots, overlaps };
})()`;

const wheelIn = (cx, cy, dy = -150) =>
  `(() => { const s = document.getElementById("nerc-svg"); s.dispatchEvent(new WheelEvent("wheel", { deltaY: ${dy}, deltaMode: 0, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true })); return s.__zoom ? s.__zoom.k : 0; })()`;

const ZOOM_TARGETS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0];

async function runViewport(conn, label, width, height, mobile, url) {
  const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
  await conn.send("Page.enable", {}, s);
  await conn.send("Runtime.enable", {}, s);
  await conn.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile },
    s,
  );
  await conn.send("Page.navigate", { url }, s);
  for (let i = 0; i < 100; i++) {
    if (await evalJs(conn, s, `document.querySelectorAll('rect.org').length`).catch(() => 0)) break;
    await sleep(150);
  }
  await sleep(3200);
  const cx = Math.round(width * 0.52);
  const cy = Math.round(height * 0.46);

  const rows = [];
  let ti = 0;
  let k = await evalJs(conn, s, READ_K);
  const sample = async (kk) => {
    await sleep(450);
    const c = await evalJs(conn, s, COUNTS);
    rows.push({ k: Math.round(kk * 100) / 100, ...c });
  };
  while (ti < ZOOM_TARGETS.length && k >= ZOOM_TARGETS[ti]) {
    await sample(k);
    ti++;
  }
  for (let i = 0; i < 400 && ti < ZOOM_TARGETS.length; i++) {
    k = await evalJs(conn, s, wheelIn(cx, cy));
    await sleep(45);
    if (k >= ZOOM_TARGETS[ti]) {
      await sample(k);
      ti++;
    }
  }
  await conn.send("Target.closeTarget", { targetId }, s).catch(() => {});
  return { label, width, mobile, rows };
}

function rowNear(rows, targetK) {
  if (!rows.length) return null;
  return rows.reduce((best, r) =>
    !best || Math.abs(r.k - targetK) < Math.abs(best.k - targetK) ? r : best,
  null);
}

function rowAtOrBelow(rows, minK) {
  return rows.filter((r) => r.k >= minK).sort((a, b) => a.k - b.k)[0] ?? null;
}

function assert(cond, msg, failures) {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
}

// Loose regression gates — tuned to current map behavior, not exact counts.
function runRegressionChecks(results) {
  let failures = 0;
  console.log("\n── give-way visibility regression ──");

  for (const r of results) {
    const tag = r.label;
    const overview = rowNear(r.rows, 1.0) ?? r.rows[0];
    const early = rowNear(r.rows, 2.0);
    const regional = rowNear(r.rows, r.mobile ? 3.2 : 3.5);
    const deep = rowNear(r.rows, 6.0);

    assert(
      overview && overview.giveWay === 0,
      `${tag} overview (k≈${overview?.k}): no give-way dots (got ${overview?.giveWay ?? "?"})`,
      failures,
    );
    assert(
      overview && overview.total <= (r.mobile ? 120 : 350),
      `${tag} overview: total visible orgs bounded (got ${overview?.total ?? "?"})`,
      failures,
    );

    if (early) {
      assert(
        early.giveWay === 0,
        `${tag} first zoom band (k≈${early.k}): still no give-way dots (got ${early.giveWay})`,
        failures,
      );
    }

    if (regional) {
      assert(
        regional.giveWay >= (r.mobile ? 25 : 8),
        `${tag} regional (k≈${regional.k}): give-way dots visible (got ${regional.giveWay})`,
        failures,
      );
      assert(
        regional.giveWay <= (r.mobile ? 900 : 350),
        `${tag} regional (k≈${regional.k}): give-way count not excessive (got ${regional.giveWay})`,
        failures,
      );
    } else {
      assert(false, `${tag} regional: no sample near k≈${r.mobile ? 3.2 : 3.5}`, failures);
    }

    if (deep) {
      assert(
        deep.giveWay >= 3,
        `${tag} deep (k≈${deep.k}): give-way dots still present (got ${deep.giveWay})`,
        failures,
      );
      assert(
        deep.giveWay <= (r.mobile ? 650 : 280),
        `${tag} deep (k≈${deep.k}): give-way count not excessive (got ${deep.giveWay})`,
        failures,
      );
    }

    // Delayed-reveal detector: give-way must appear before k≈4.5 on both layouts.
    const late = rowAtOrBelow(r.rows, 4.5);
    if (late) {
      assert(
        late.giveWay >= 5,
        `${tag} by k≈${late.k}: give-way dots disclosed (got ${late.giveWay}) — not delayed to deep zoom`,
        failures,
      );
    }
  }

  // Mobile must not trail desktop on regional give-way disclosure.
  const deskReg = rowNear(results.find((x) => !x.mobile)?.rows ?? [], 3.5);
  const mobReg = rowNear(results.find((x) => x.mobile)?.rows ?? [], 3.2);
  if (deskReg && mobReg) {
    assert(
      mobReg.k <= deskReg.k + 0.35,
      `mobile give-way appears no later than desktop (mobile k≈${mobReg.k} vs desktop k≈${deskReg.k})`,
      failures,
    );
  }

  console.log(failures ? `\nREGRESSION: ${failures} failure(s)` : "\nREGRESSION: all checks passed");
  return failures;
}

function printTable(r) {
  console.log(`\n=== ${r.label} ===`);
  console.log("    k  pills  bgDot  giveWay  dots  labeled  total  overlaps");
  for (const row of r.rows) {
    console.log(
      `  ${String(row.k).padStart(4)}  ${String(row.pills).padStart(5)}  ${String(row.bgDots).padStart(5)}  ${String(row.giveWay).padStart(7)}  ${String(row.dots).padStart(4)}  ${String(row.labeled).padStart(7)}  ${String(row.total).padStart(5)}  ${String(row.overlaps).padStart(8)}`,
    );
  }
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("run npm run build first");
    process.exit(1);
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.warn("perf:reveal-curve skipped: Chrome not found (install Chrome or set PATH)");
    process.exit(0);
  }

  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer();
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${CHROME_PORT}`,
      `--user-data-dir=${join(OUT, "chrome")}`,
      "--window-size=1440,900",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ws;
  let failures = 0;
  try {
    ws = new WebSocket(await getBrowserWs());
    await new Promise((r, x) => {
      ws.addEventListener("open", r, { once: true });
      ws.addEventListener("error", x, { once: true });
    });
    const conn = makeConn(ws);
    const results = [];
    results.push(await runViewport(conn, "desktop 1440×900", 1440, 900, false, url));
    results.push(await runViewport(conn, "mobile 390×844", 390, 844, true, url));
    for (const r of results) printTable(r);
    failures = runRegressionChecks(results);
  } finally {
    try {
      ws?.close();
    } catch {}
    try {
      chrome.kill("SIGKILL");
    } catch {}
    server.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
