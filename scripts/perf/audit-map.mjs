#!/usr/bin/env node
// Startup performance audit for the built map. Serves dist/ locally under the
// GitHub Pages base path, opens headless Chrome via CDP, and reports startup
// timings plus console errors. Usage: npm run build && npm run perf:audit

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DIST = resolve(ROOT, "dist");
const BASE_PATH = "/nerc-grid-map/";
const CHROME_PORT = Number(process.env.PERF_CHROME_PORT ?? 9334);
const OUT = "/tmp/nerc-perf-audit";
const LAST_REPORT = `${OUT}/last-report.json`;

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function warnAndExit(message) {
  console.warn(`perf:audit skipped: ${message}`);
  process.exit(0);
}

function commandPath(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    commandPath("google-chrome"),
    commandPath("google-chrome-stable"),
    commandPath("chromium"),
    commandPath("chromium-browser"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate) || !candidate.startsWith("/")) ?? null;
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
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const stat = statSync(route.file);
    if (!stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": stat.size,
      "content-type": MIME[extname(route.file)] ?? "application/octet-stream",
    });
    createReadStream(route.file).pipe(res);
  });
  await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind local audit server");
  return { server, url: `http://127.0.0.1:${address.port}${BASE_PATH}` };
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
  throw new Error("Chrome did not expose a debugger WebSocket");
}

function makeConn(ws) {
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: resolvePending, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolvePending(msg.result);
      return;
    }
    if (msg.method && handlers.has(msg.method)) {
      for (const handler of handlers.get(msg.method)) handler(msg.params ?? {}, msg.sessionId, msg);
    }
  });
  return {
    on(method, handler) {
      const list = handlers.get(method) ?? [];
      list.push(handler);
      handlers.set(method, list);
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolvePending, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve: resolvePending, reject });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
      });
    },
  };
}

async function evalJs(conn, sessionId, expression) {
  const result = await conn.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function waitForValue(conn, sessionId, expression, label, timeoutMs = 20000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const value = await evalJs(conn, sessionId, expression).catch(() => 0);
    if (value) return value;
    await sleep(50);
  }
  console.warn(`perf:audit warning: timed out waiting for ${label}`);
  return null;
}

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatMs(value) {
  return value == null ? "n/a" : `${Math.round(value)} ms`;
}

function loadPreviousReport() {
  try {
    return JSON.parse(readFileSync(LAST_REPORT, "utf8"));
  } catch {
    return null;
  }
}

const perfProbe = `
(() => {
  const state = window.__nercPerf = { firstCircle: 0, loadingHidden: 0, longTasks: [] };
  const circleVisible = () => {
    for (const node of document.querySelectorAll("svg circle.org")) {
      if (node.classList.contains("hide")) continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const r = Number(node.getAttribute("r") || 0);
      if (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && r > 0 && rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
    return false;
  };
  const loadingHidden = () => {
    const node = document.querySelector("#nerc-loading");
    if (!node) return true;
    const style = getComputedStyle(node);
    return node.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0;
  };
  const tick = () => {
    if (!state.firstCircle && circleVisible()) state.firstCircle = performance.now();
    if (!state.loadingHidden && loadingHidden()) state.loadingHidden = performance.now();
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  const observer = new MutationObserver(tick);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "r"] });
  document.addEventListener("DOMContentLoaded", tick);
  requestAnimationFrame(function loop() {
    tick();
    if (!state.firstCircle || !state.loadingHidden) requestAnimationFrame(loop);
    else observer.disconnect();
  });
})();
`;

async function main() {
  if (!existsSync(join(DIST, "index.html"))) warnAndExit("dist/index.html not found; run npm run build first");
  if (typeof WebSocket === "undefined") warnAndExit("this Node runtime has no global WebSocket support");
  const chromePath = findChrome();
  if (!chromePath) warnAndExit("Chrome or Chromium not found");

  mkdirSync(OUT, { recursive: true });

  const { server, url } = await startServer();
  const userDataDir = `/tmp/nerc-perf-chrome-${Date.now()}`;
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    "--no-default-browser-check",
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    const browserWs = await getBrowserWs();
    ws = new WebSocket(browserWs);
    await new Promise((resolveWs, rejectWs) => {
      ws.addEventListener("open", resolveWs, { once: true });
      ws.addEventListener("error", rejectWs, { once: true });
    });
    const conn = makeConn(ws);
    const consoleErrors = [];
    conn.on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error") return;
      const text = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "").join(" ");
      consoleErrors.push(text || "console.error");
    });
    conn.on("Runtime.exceptionThrown", (params) => {
      consoleErrors.push(params.exceptionDetails?.text ?? "runtime exception");
    });
    conn.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error") consoleErrors.push(params.entry.text ?? "log error");
    });

    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);
    await conn.send("Network.enable", {}, sessionId);
    await conn.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await conn.send("Log.enable", {}, sessionId);
    await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: perfProbe }, sessionId);

    await conn.send("Page.navigate", { url }, sessionId);
    const pageLoaded = await waitForValue(
      conn,
      sessionId,
      `(() => { const nav = performance.getEntriesByType("navigation")[0]; return nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : 0; })()`,
      "page load",
    );
    const firstCircle = await waitForValue(conn, sessionId, "window.__nercPerf?.firstCircle || 0", "first visible org circle");
    const loadingHidden = await waitForValue(conn, sessionId, "window.__nercPerf?.loadingHidden || 0", "loading overlay hidden");
    await sleep(600);

    const bytesBeforeFirstRender = await evalJs(
      conn,
      sessionId,
      `(() => {
        const cutoff = window.__nercPerf?.firstCircle || performance.now();
        let bytes = 0;
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav && nav.responseEnd <= cutoff) bytes += nav.transferSize || nav.encodedBodySize || 0;
        for (const entry of performance.getEntriesByType("resource")) {
          if (entry.responseEnd <= cutoff) bytes += entry.transferSize || entry.encodedBodySize || 0;
        }
        return bytes;
      })()`,
    );
    const requestCountBeforeFirstRender = await evalJs(
      conn,
      sessionId,
      `(() => {
        const cutoff = window.__nercPerf?.firstCircle || performance.now();
        let count = 0;
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav && nav.responseEnd <= cutoff) count++;
        for (const entry of performance.getEntriesByType("resource")) if (entry.responseEnd <= cutoff) count++;
        return count;
      })()`,
    );
    const longTasks = await evalJs(conn, sessionId, "window.__nercPerf?.longTasks || []");
    const report = {
      url,
      pageLoaded,
      firstCircle,
      loadingHidden,
      bytesBeforeFirstRender,
      requestCountBeforeFirstRender,
      longTaskCount: longTasks.length,
      longTaskTotal: longTasks.reduce((sum, task) => sum + task.duration, 0),
      consoleErrors,
      payloadBytes: {
        full: sizeOf(join(ROOT, "public/nerc/orgs.json")),
        render: sizeOf(join(ROOT, "public/nerc/orgs-render.json")),
        details: sizeOf(join(ROOT, "public/nerc/org-details.json")),
      },
    };

    const previous = loadPreviousReport();
    writeFileSync(LAST_REPORT, JSON.stringify(report, null, 2));

    console.log(`perf:audit ${url}`);
    console.log(`  page loaded:              ${formatMs(report.pageLoaded)}`);
    console.log(`  first org circle visible: ${formatMs(report.firstCircle)}`);
    console.log(`  loading hidden:           ${formatMs(report.loadingHidden)}`);
    console.log(`  bytes before first render: ${formatBytes(report.bytesBeforeFirstRender)} across ${report.requestCountBeforeFirstRender} request(s)`);
    console.log(`  long tasks:               ${report.longTaskCount} (${formatMs(report.longTaskTotal)} total)`);
    console.log(
      `  org payload split:        render ${formatBytes(report.payloadBytes.render)} vs canonical ${formatBytes(report.payloadBytes.full)} ` +
      `(${Math.round((1 - report.payloadBytes.render / report.payloadBytes.full) * 100)}% smaller before details)`,
    );
    if (previous) {
      const delta = report.firstCircle - previous.firstCircle;
      console.log(`  previous first circle:    ${formatMs(previous.firstCircle)} (${delta >= 0 ? "+" : ""}${Math.round(delta)} ms)`);
    }
    if (report.consoleErrors.length) {
      console.error(`\nconsole errors (${report.consoleErrors.length}):`);
      for (const error of report.consoleErrors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log("  console errors:           0");
    }
  } finally {
    if (ws) ws.close();
    chrome.kill("SIGKILL");
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
