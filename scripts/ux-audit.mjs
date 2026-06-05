// One-off UX audit driver. Launches headless Chrome, loads the live map with
// ?audit=1, drives ~20 zoom levels on desktop + iOS viewports, and reads out the
// renderer's own per-bubble stats (water coverage, displacement, overlaps, label
// fit) plus screenshots. Not part of the build. Usage: node scripts/ux-audit.mjs
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.AUDIT_URL ?? "http://localhost:4323/?audit=1";
const OUT = "/tmp/nerc-audit";
const PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const ZOOMS = [0.72, 0.85, 1.0, 1.2, 1.45, 1.7, 2.0, 2.4, 2.9, 3.5, 4.2, 5.1, 6.2, 7.5, 9.0, 11, 14, 18, 24, 32];
const SHOT_ZOOMS = new Set([0.72, 1.0, 1.7, 3.0, 3.5, 6.2, 12, 11]);
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, dsf: 1, mobile: false },
  { name: "ios", width: 390, height: 844, dsf: 2, mobile: true },
];
// Coastal centers to spot-check the "no dots stranded offshore" rule.
const COASTS = [
  { name: "florida", lng: -80.6, lat: 26.5, k: 2.4 },
  { name: "nyc", lng: -73.9, lat: 40.7, k: 2.4 },
  { name: "la", lng: -118.2, lat: 34.0, k: 2.4 },
  { name: "seattle", lng: -122.3, lat: 47.6, k: 2.4 },
  { name: "boston", lng: -71.0, lat: 42.3, k: 3.5 },
  { name: "houston", lng: -95.4, lat: 29.8, k: 2.4 },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const userDataDir = `/tmp/nerc-chrome-${Date.now()}`;
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "about:blank",
], { stdio: "ignore" });

async function getBrowserWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugger ws");
}

function makeConn(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
}

async function evalJs(send, sessionId, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

const main = async () => {
  const browserWs = await getBrowserWs();
  const ws = new WebSocket(browserWs);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const send = makeConn(ws);

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const report = {};
  for (const vp of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf, mobile: vp.mobile,
    }, sessionId);
    await send("Page.navigate", { url: BASE }, sessionId);
    // wait for audit hook
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { ready = await evalJs(send, sessionId, "!!window.__nercAuditReady"); } catch {}
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error(`audit hook never ready for ${vp.name}`);
    const info = await evalJs(send, sessionId, "window.__nercAudit.info()");
    report[vp.name] = { info, sweep: [] };

    for (const k of ZOOMS) {
      await evalJs(send, sessionId, `window.__nercAudit.setZoom(${k})`);
      await sleep(80);
      const a = await evalJs(send, sessionId, "window.__nercAudit.audit()");
      // keep summary; drop the big per-dot array except worst offenders
      const dots = a.dots;
      delete a.dots;
      a.worstWater = dots
        .filter((d) => d.frame !== "terr")
        .sort((x, y) => y.waterFrac - x.waterFrac)
        .slice(0, 8)
        .map((d) => ({ n: d.name, wf: d.waterFrac, cw: d.centerWater, off: d.baseOff, r: d.rcss, pr: d.pr }));
      report[vp.name].sweep.push(a);
      if (k === 0.72 || k === 1.7 || k === 3.5) {
        console.error(`  [${vp.name} k=${k}] top-priority label coverage:\n    ${a.topByPriority.join("  ")}`);
      }
      if (SHOT_ZOOMS.has(k)) {
        const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(`${OUT}/${vp.name}_k${String(k).replace(".", "_")}.png`, Buffer.from(shot.data, "base64"));
      }
    }

    // Coast spot-checks (iOS only — that's the focus; desktop coasts captured via overview).
    if (vp.name === "ios") {
      report[vp.name].coasts = [];
      for (const c of COASTS) {
        await evalJs(send, sessionId, `window.__nercAudit.setZoomAt(${c.k}, ${c.lng}, ${c.lat})`);
        await sleep(80);
        const a = await evalJs(send, sessionId, "window.__nercAudit.audit()");
        const dots = a.dots;
        delete a.dots;
        a.coast = c.name;
        a.worstWater = dots.filter((d) => d.frame !== "terr").sort((x, y) => y.waterFrac - x.waterFrac).slice(0, 6)
          .map((d) => ({ n: d.name, wf: d.waterFrac, cw: d.centerWater, off: d.baseOff }));
        report[vp.name].coasts.push(a);
        const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(`${OUT}/ios_coast_${c.name}.png`, Buffer.from(shot.data, "base64"));
      }
    }
  }

  writeFileSync(`${OUT}/stats.json`, JSON.stringify(report, null, 2));
  // Compact console summary.
  for (const [name, r] of Object.entries(report)) {
    console.log(`\n=== ${name} (W=${r.info.W} H=${r.info.H} compact=${r.info.compact} upp=${r.info.unitPerPx} n=${r.info.count}) ===`);
    console.log("  k    vis  lbl  in/fl  ovl  strand cWater minR medR maxOff  worstWaterFracs");
    for (const a of r.sweep) {
      const ww = a.worstWater.slice(0, 4).map((d) => `${d.n}:${d.wf}${d.cw ? "*" : ""}`).join(" ");
      console.log(
        `  ${String(a.k).padStart(5)} ${String(a.visible).padStart(4)} ${String(a.labels).padStart(4)} ` +
        `${String(a.inside + "/" + a.float).padStart(6)} ${String(a.severeOverlaps).padStart(4)} ` +
        `${String(a.stranded).padStart(5)} ${String(a.centerInWater).padStart(6)} ` +
        `${String(a.minRcss).padStart(4)} ${String(a.medRcss).padStart(4)} ${String(a.maxBaseOff).padStart(6)}  ${ww}`,
      );
    }
    if (r.coasts) {
      console.log("  -- coasts (k centered) --");
      for (const a of r.coasts) {
        const ww = a.worstWater.slice(0, 5).map((d) => `${d.n}:${d.wf}${d.cw ? "*" : ""}`).join(" ");
        console.log(`  ${a.coast.padEnd(8)} k=${a.k} vis=${a.visible} strand=${a.stranded} cWater=${a.centerInWater}  ${ww}`);
      }
    }
  }

  ws.close();
  chrome.kill("SIGKILL");
  rmSync(userDataDir, { recursive: true, force: true });
};

main().catch((e) => { console.error(e); chrome.kill("SIGKILL"); process.exit(1); });
