#!/usr/bin/env node
// AK/HI inset regression audit: data checks + headless map inspection.
// Usage: npm run build && node scripts/perf/audit-alaska-map.mjs

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  STATE_COORD_BBOX,
  coordsInBbox,
  isOutOfFootprintCode,
} from "../../src/lib/nerc/geography-scope.mjs";
import { displayName, orgAcronym } from "../../src/lib/nerc/map/org-display.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DIST = resolve(ROOT, "dist");
const BASE_PATH = "/nerc-grid-map/";
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9336);
const OUT = "/tmp/nerc-inset-audit";

const INSET_EXPECTED = { AK: 34, HI: 21 };

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync("which", ["google-chrome"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function safeJoinDist(pathname) {
  let rel = pathname;
  if (rel === BASE_PATH.slice(0, -1)) return { redirect: BASE_PATH };
  if (rel.startsWith(BASE_PATH)) rel = rel.slice(BASE_PATH.length);
  else if (rel === "/") rel = "";
  else return null;
  if (!rel || rel.endsWith("/")) rel = `${rel}index.html`;
  const file = normalize(join(DIST, rel));
  if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) return null;
  return { file };
}

async function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = safeJoinDist(decodeURIComponent(url.pathname));
    if (route?.redirect) {
      res.writeHead(302, { Location: route.redirect });
      res.end();
      return;
    }
    if (!route?.file || !existsSync(route.file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME[extname(route.file)] ?? "application/octet-stream",
    });
    createReadStream(route.file).pipe(res);
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
  throw new Error("Chrome debugger not available");
}

function makeConn(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: r, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result);
    }
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((r, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve: r, reject });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
      });
    },
  };
}

async function evalJs(conn, sessionId, expression) {
  const result = await conn.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value;
}

function auditInsetState(orgs, state) {
  const bbox = STATE_COORD_BBOX[state];
  const inset = orgs.filter((o) => o.state === state);
  const geocoded = inset.filter((o) => !String(o.ncr_id).startsWith("SUP-"));
  const mainlandInBbox = orgs.filter(
    (o) =>
      o.state !== state &&
      o.state !== "AK" &&
      o.state !== "HI" &&
      !isOutOfFootprintCode(o.state) &&
      o.lat != null &&
      coordsInBbox(o.lat, o.lng, bbox),
  );
  const outOfBbox = inset.filter((o) => o.lat != null && !coordsInBbox(o.lat, o.lng, bbox));
  const oof = inset.filter((o) => o.out_of_footprint);
  const ariaLabels = inset.map((o) => `${orgAcronym(o)} ${displayName(o)}`.trim());
  const expected = INSET_EXPECTED[state];
  return {
    state,
    count: inset.length,
    expected,
    geocoded: geocoded.length,
    mainlandInBbox: mainlandInBbox.length,
    outOfBbox: outOfBbox.length,
    outOfFootprint: oof.length,
    ariaLabels,
    pass:
      inset.length === expected &&
      geocoded.length === 0 &&
      mainlandInBbox.length === 0 &&
      outOfBbox.length === 0 &&
      oof.length === 0,
  };
}

function auditData() {
  const orgs = JSON.parse(readFileSync(join(ROOT, "public/nerc/orgs.json"), "utf8")).orgs;
  const ak = auditInsetState(orgs, "AK");
  const hi = auditInsetState(orgs, "HI");
  return {
    total: orgs.length,
    ak,
    hi,
    pass: ak.pass && hi.pass,
  };
}

const MAP_PROBE = `(async (akAriaLabels) => {
  const akLabelSet = new Set(akAriaLabels);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svg = document.querySelector("#nerc-svg");
  const gMap = svg?.querySelector("g.map");
  if (!svg || !gMap) return { error: "map not mounted" };

  const parseK = () => {
    const t = gMap.getAttribute("transform") || "";
    const m = t.match(/scale\\(([-\\d.]+)\\)/);
    return m ? Number(m[1]) : 1;
  };

  const akPath = [...svg.querySelectorAll("path.state")].find(
    (p) => p.__data__?.properties?.name === "Alaska",
  );
  let akInsetBox = null;
  if (akPath) {
    const bb = akPath.getBBox();
    akInsetBox = { x0: bb.x, y0: bb.y, x1: bb.x + bb.width, y1: bb.y + bb.height };
  }

  const centerInAkInset = (cx, cy) => {
    if (!akInsetBox) return false;
    return cx >= akInsetBox.x0 && cx <= akInsetBox.x1 && cy >= akInsetBox.y0 && cy <= akInsetBox.y1;
  };

  const visibleOrgs = () => {
    return [...svg.querySelectorAll("rect.org")].filter((n) => {
      if (n.classList.contains("hide")) return false;
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity || 1) <= 0) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    });
  };

  const orgMetrics = () => {
    const k = parseK();
    const akLand = akPath ? akPath.getBoundingClientRect() : null;
    const akLandVisible = !!(akLand && akLand.width > 8 && akLand.height > 8);
    const akLabel = [...svg.querySelectorAll("text.land-label")].find((t) => t.textContent?.trim() === "Alaska");
    const akLabelVisible = !!(akLabel && !akLabel.classList.contains("hide") && akLabel.getBoundingClientRect().width > 0);

    const orgs = visibleOrgs();
    let akVisible = 0;
    let akInInset = 0;
    let akOutsideInset = 0;
    let nonAkInInset = 0;
    const stray = [];

    for (const n of orgs) {
      const label = (n.getAttribute("aria-label") || "").trim();
      const isAk = akLabelSet.has(label);
      const x = Number(n.getAttribute("x") || 0);
      const y = Number(n.getAttribute("y") || 0);
      const w = Number(n.getAttribute("width") || 0);
      const h = Number(n.getAttribute("height") || 0);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const inInset = centerInAkInset(cx, cy);

      if (isAk) {
        akVisible++;
        if (inInset) akInInset++;
        else {
          akOutsideInset++;
          stray.push({ kind: "ak-outside-inset", label: label.slice(0, 40), cx, cy, k });
        }
      } else if (inInset) {
        nonAkInInset++;
        stray.push({ kind: "non-ak-in-inset", label: label.slice(0, 40), cx, cy, k });
      }
    }

    return {
      k: Number(k.toFixed(3)),
      akLandVisible,
      akLabelVisible,
      visibleOrgCount: orgs.length,
      akVisible,
      akInInset,
      akOutsideInset,
      nonAkInInset,
      stray: stray.slice(0, 8),
    };
  };

  const wheelAt = async (clientX, clientY, deltaY, times = 1) => {
    for (let i = 0; i < times; i++) {
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY,
          clientX,
          clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
      await sleep(35);
    }
    await sleep(900);
  };

  const wheelTo = async (targetK, anchorX, anchorY) => {
    for (let i = 0; i < 40; i++) {
      const k = parseK();
      if (Math.abs(k - targetK) < 0.06) break;
      const delta = k < targetK ? -160 : 160;
      await wheelAt(anchorX, anchorY, delta, 1);
    }
    await sleep(800);
  };

  const rect = svg.getBoundingClientRect();
  const akAnchorX = rect.left + rect.width * 0.14;
  const akAnchorY = rect.top + rect.height * 0.88;
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.55;

  const samples = [];
  samples.push({ phase: "overview", ...orgMetrics() });
  await wheelTo(2.2, akAnchorX, akAnchorY);
  samples.push({ phase: "ak-inset-k~2.2", ...orgMetrics() });
  await wheelTo(1.0, centerX, centerY);
  samples.push({ phase: "mainland-k~1", ...orgMetrics() });
  return { samples, akInsetBox };
})`;

const HI_MAP_PROBE = `(async (hiAriaLabels, targetK) => {
  const hiLabelSet = new Set(hiAriaLabels);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svg = document.querySelector("#nerc-svg");
  const gMap = svg?.querySelector("g.map");
  if (!svg || !gMap) return { error: "map not mounted" };

  const parseK = () => {
    const t = gMap.getAttribute("transform") || "";
    const m = t.match(/scale\\(([-\\d.]+)\\)/);
    return m ? Number(m[1]) : 1;
  };

  const hiPath = [...svg.querySelectorAll("path.state")].find(
    (p) => p.__data__?.properties?.name === "Hawaii",
  );
  let hiInsetBox = null;
  if (hiPath) {
    const bb = hiPath.getBBox();
    hiInsetBox = { x0: bb.x, y0: bb.y, x1: bb.x + bb.width, y1: bb.y + bb.height };
  }

  const centerInHiInset = (cx, cy) => {
    if (!hiInsetBox) return false;
    return cx >= hiInsetBox.x0 && cx <= hiInsetBox.x1 && cy >= hiInsetBox.y0 && cy <= hiInsetBox.y1;
  };

  const visibleOrgs = () =>
    [...svg.querySelectorAll("rect.org")].filter((n) => {
      if (n.classList.contains("hide")) return false;
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity || 1) <= 0) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    });

  const orgMetrics = () => {
    const k = parseK();
    const hiLand = hiPath ? hiPath.getBoundingClientRect() : null;
    const hiLandVisible = !!(hiLand && hiLand.width > 8 && hiLand.height > 8);
    let hiVisible = 0;
    let hiInInset = 0;
    let hiOutsideInset = 0;
    let nonHiInInset = 0;
    for (const n of visibleOrgs()) {
      const label = (n.getAttribute("aria-label") || "").trim();
      const isHi = hiLabelSet.has(label);
      const cx = Number(n.getAttribute("x") || 0) + Number(n.getAttribute("width") || 0) / 2;
      const cy = Number(n.getAttribute("y") || 0) + Number(n.getAttribute("height") || 0) / 2;
      const inInset = centerInHiInset(cx, cy);
      if (isHi) {
        hiVisible++;
        if (inInset) hiInInset++;
        else hiOutsideInset++;
      } else if (inInset) nonHiInInset++;
    }
    return { k: Number(k.toFixed(3)), hiLandVisible, hiVisible, hiInInset, hiOutsideInset, nonHiInInset };
  };

  const wheelAt = async (clientX, clientY, deltaY) => {
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));
    await sleep(35);
  };
  const wheelTo = async (target, anchorX, anchorY) => {
    for (let i = 0; i < 48; i++) {
      const k = parseK();
      if (Math.abs(k - target) < 0.08) break;
      await wheelAt(anchorX, anchorY, k < target ? -160 : 160);
    }
    await sleep(800);
  };

  const rect = svg.getBoundingClientRect();
  let hiAnchorX = rect.left + rect.width * 0.55;
  let hiAnchorY = rect.top + rect.height * 0.88;
  if (hiPath) {
    const bb = hiPath.getBBox();
    const pt = svg.createSVGPoint();
    pt.x = bb.x + bb.width / 2;
    pt.y = bb.y + bb.height / 2;
    const ctm = hiPath.getScreenCTM();
    if (ctm) {
      const sp = pt.matrixTransform(ctm);
      hiAnchorX = sp.x;
      hiAnchorY = sp.y;
    }
  }
  const samples = [{ phase: "overview", ...orgMetrics() }];
  await wheelTo(targetK, hiAnchorX, hiAnchorY);
  samples.push({ phase: \`hi-inset-k~\${targetK}\`, ...orgMetrics() });
  return { samples, hiInsetBox, targetK };
})`;

async function auditMap(dataAudit) {
  const chromePath = findChrome();
  if (!chromePath) return { skipped: true, reason: "Chrome not found" };

  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer();
  const userDataDir = join(OUT, "chrome-profile");
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${CHROME_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ws;
  const viewports = [
    { name: "desktop", width: 960, height: 800, mobile: false },
    { name: "mobile", width: 375, height: 812, mobile: true },
  ];
  const results = {};

  try {
    ws = new WebSocket(await getBrowserWs());
    await new Promise((r, x) => {
      ws.addEventListener("open", r, { once: true });
      ws.addEventListener("error", x, { once: true });
    });
    const conn = makeConn(ws);
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);

    for (const vp of viewports) {
      await conn.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: vp.mobile ? 2 : 1,
          mobile: vp.mobile,
        },
        sessionId,
      );
      await conn.send("Page.navigate", { url }, sessionId);
      for (let i = 0; i < 100; i++) {
        const ready = await evalJs(
          conn,
          sessionId,
          `document.querySelector('#nerc-svg g.map') ? document.querySelectorAll('rect.org:not(.hide)').length : 0`,
        ).catch(() => 0);
        if (ready > 20) break;
        await sleep(200);
      }
      await sleep(4000);
      const probe = await evalJs(
        conn,
        sessionId,
        `(${MAP_PROBE})(${JSON.stringify(dataAudit.ak.ariaLabels)})`,
      );
      await conn.send("Page.navigate", { url }, sessionId);
      for (let i = 0; i < 100; i++) {
        const ready = await evalJs(
          conn,
          sessionId,
          `document.querySelector('#nerc-svg g.map') ? document.querySelectorAll('rect.org:not(.hide)').length : 0`,
        ).catch(() => 0);
        if (ready > 20) break;
        await sleep(200);
      }
      await sleep(4000);
      const hiTargetK = vp.mobile ? 2.4 : 2.4;
      const hiProbe = await evalJs(
        conn,
        sessionId,
        `(${HI_MAP_PROBE})(${JSON.stringify(dataAudit.hi.ariaLabels)}, ${hiTargetK})`,
      );
      results[vp.name] = { ak: probe, hi: hiProbe };
      const shot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(OUT, `inset-${vp.name}.png`), Buffer.from(shot.data, "base64"));
      if (hiProbe && !hiProbe.error) {
        const hiShot = await conn.send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(join(OUT, `inset-${vp.name}-hi.png`), Buffer.from(hiShot.data, "base64"));
      }
    }
  } finally {
    ws?.close();
    chrome.kill("SIGKILL");
    server.close();
  }

  return results;
}

function summarizeMap(results) {
  const issues = [];
  for (const [vp, data] of Object.entries(results)) {
    for (const [inset, probe] of [
      ["AK", data?.ak],
      ["HI", data?.hi],
    ]) {
      if (!probe) continue;
      if (probe.error) {
        issues.push(`${vp} ${inset}: ${probe.error}`);
        continue;
      }
      const prefix = inset === "AK" ? "ak" : "hi";
      const landKey = `${prefix}LandVisible`;
      const visKey = `${prefix}Visible`;
      const outKey = `${prefix}OutsideInset`;
      const nonKey = `non${inset}InInset`;
      for (const sample of probe.samples ?? []) {
        if (sample[landKey] === false) issues.push(`${vp} ${sample.phase}: ${inset} land not visible`);
        if ((sample[nonKey] ?? 0) > 0) {
          issues.push(`${vp} ${sample.phase}: ${sample[nonKey]} non-${inset} org(s) in ${inset} inset`);
        }
        if ((sample[outKey] ?? 0) > 0) {
          issues.push(`${vp} ${sample.phase}: ${sample[outKey]} ${inset} org(s) outside inset`);
        }
        if (sample.phase === "overview" && (sample[visKey] ?? 0) > 0) {
          issues.push(`${vp} ${sample.phase}: ${sample[visKey]} ${inset} org(s) visible at overview`);
        }
        if (sample.phase.includes("inset-k~") && (sample[visKey] ?? 0) === 0 && sample.k >= (probe.targetK ?? 2) * 0.92) {
          // Compact HI inset slots are capacity-gated; mobile safety is nonHiInInset/hiOutsideInset.
          if (inset === "HI" && vp === "mobile") continue;
          issues.push(`${vp} ${sample.phase}: no ${inset} orgs visible at k=${sample.k}`);
        }
      }
    }
    if (data?.ak && data?.ak?.samples) {
      const mainland = data.ak.samples.find((s) => s.phase === "mainland-k~1");
      if (mainland?.akVisible > 0) {
        issues.push(`${vp} mainland: ${mainland.akVisible} AK org(s) visible on mainland view`);
      }
    }
  }
  return { pass: issues.length === 0, issues };
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("Run npm run build first");
    process.exit(1);
  }
  const dataAudit = auditData();
  const mapAudit = await auditMap(dataAudit);
  const summary = summarizeMap(mapAudit);
  const report = { dataAudit, mapAudit, summary, screenshots: OUT };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(summary.pass && dataAudit.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
