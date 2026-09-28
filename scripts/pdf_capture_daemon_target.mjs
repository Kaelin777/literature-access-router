#!/usr/bin/env node
// Single persistent CDP control daemon for the literature-access-router skill.
//
// Why one daemon: Chromium 136+ asks the user to allow remote debugging once
// per CDP WebSocket connection. Starting the web-access proxy AND a separate
// PDF daemon therefore produced two or more permission prompts. This daemon
// opens exactly one CDP connection and serves both browser control and PDF
// capture over one local HTTP port, so the user clicks Allow at most once.
//
// Endpoints (all localhost, JSON unless noted):
//   GET  /health                     -> {ok, name, browser, pid}
//   GET  /targets                    -> [{targetId,url,title,...}]
//   GET  /info?target=<id>           -> {targetId,url,title,ready}
//   POST /new       (body=url)       -> {targetId,...}
//   POST /navigate?target=<id>       body=url
//   POST /eval?target=<id>           body=javascript -> {ok,value}
//   POST /click?target=<id>          body=css-selector
//   GET  /close?target=<id>
//   GET  /scroll?target=<id>&direction=bottom
//   POST /setFiles?target=<id>       body={"selector":"...","files":["..."]}
//   POST /activate  body={"targetId":"..."}
//   POST /capture-target            body={targetId,pdfUrl,outFile,...}
//   POST /shutdown                   stop the daemon (browser stays open)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const a = {
    httpPort: 3461,
    cdpPort: 0,
    timeout: 90000,
    preDelayMin: 5000,
    preDelayMax: 12000,
    postDelayMin: 10000,
    postDelayMax: 25000,
    browser: "chrome",
    devtoolsFile: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--http-port") a.httpPort = Number(argv[++i]);
    else if (k === "--cdp-port") a.cdpPort = Number(argv[++i]);
    else if (k === "--browser") a.browser = String(argv[++i]).toLowerCase();
    else if (k === "--devtools-file") a.devtoolsFile = argv[++i];
    else if (k === "--timeout") a.timeout = Number(argv[++i]);
    else if (k === "--pre-delay-min") a.preDelayMin = Number(argv[++i]);
    else if (k === "--pre-delay-max") a.preDelayMax = Number(argv[++i]);
    else if (k === "--post-delay-min") a.postDelayMin = Number(argv[++i]);
    else if (k === "--post-delay-max") a.postDelayMax = Number(argv[++i]);
    else throw new Error("unknown arg " + k);
  }
  return a;
}

function browserDevtoolsFile(browser) {
  const home = os.homedir();
  const roots = process.platform === "win32"
    ? {
        chrome: path.join(process.env.LOCALAPPDATA || home, "Google/Chrome/User Data"),
        edge: path.join(process.env.LOCALAPPDATA || home, "Microsoft/Edge/User Data"),
        chromium: path.join(process.env.LOCALAPPDATA || home, "Chromium/User Data"),
      }
    : process.platform === "darwin"
      ? {
          chrome: path.join(home, "Library/Application Support/Google/Chrome"),
          edge: path.join(home, "Library/Application Support/Microsoft Edge"),
          chromium: path.join(home, "Library/Application Support/Chromium"),
        }
      : {
          chrome: path.join(home, ".config/google-chrome"),
          edge: path.join(home, ".config/microsoft-edge"),
          chromium: path.join(home, ".config/chromium"),
        };
  if (!roots[browser]) throw new Error(`Unsupported browser: ${browser}`);
  return path.join(roots[browser], "DevToolsActivePort");
}

const args = parseArgs(process.argv);
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(min + Math.random() * Math.max(0, max - min)); }
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || "operation"} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const devtoolsFile = args.devtoolsFile || browserDevtoolsFile(args.browser);
if (!fs.existsSync(devtoolsFile)) {
  throw new Error(`Browser CDP is unavailable at ${devtoolsFile}. Ask the user to enable remote debugging in their existing browser; never launch or alter its profile automatically. Use --devtools-file for a nonstandard profile.`);
}
const lines = fs.readFileSync(devtoolsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
if (lines.length < 2) throw new Error(`Invalid DevToolsActivePort file: ${devtoolsFile}`);
const cdpPort = Number(args.cdpPort || lines[0]);
const wsUrl = `ws://127.0.0.1:${cdpPort}${lines[1]}`;
console.error(`[control-daemon] browser=${args.browser} CDP: ${wsUrl}`);
console.error("[control-daemon] Browser will ask ONCE to allow remote debugging. Click Allow once; every later action reuses this daemon.");

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();
const listeners = new Set();

function send(method, params = {}, sessionId = undefined) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
ws.addEventListener("message", (event) => {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
    return;
  }
  for (const fn of [...listeners]) fn(msg);
});
ws.addEventListener("close", () => {
  for (const [id, p] of pending) {
    pending.delete(id);
    p.reject(new Error(`${p.method}: CDP connection closed`));
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", (event) => reject(new Error((event && event.message) || `cannot connect to ${wsUrl}`)), { once: true });
}).catch((e) => {
  console.error(`[control-daemon] CDP connection failed: ${e.message}`);
  console.error(`[control-daemon] Open ${args.browser} and enable remote debugging, then restart this daemon.`);
  process.exit(1);
});
console.error("[control-daemon] CDP connected.");

// ---------------------------------------------------------------------------
// Control-plane helpers: all reuse the one WebSocket above.
// ---------------------------------------------------------------------------
const controlSessions = new Map(); // targetId -> sessionId

async function attachControl(targetId) {
  if (!targetId) throw new Error("targetId is required");
  const existing = controlSessions.get(targetId);
  if (existing) return existing;
  const attached = await withTimeout(
    send("Target.attachToTarget", { targetId, flatten: true }),
    15000,
    "Target.attachToTarget"
  );
  controlSessions.set(targetId, attached.sessionId);
  await send("Page.enable", {}, attached.sessionId).catch(() => {});
  return attached.sessionId;
}

async function withControlSession(targetId, fn) {
  let sessionId = await attachControl(targetId);
  try {
    return await fn(sessionId);
  } catch (e) {
    const message = String((e && e.message) || e);
    if (!/session.*not found|target.*closed|no target|detached|inspected target navigated or closed/i.test(message)) {
      throw e;
    }
    controlSessions.delete(targetId);
    sessionId = await attachControl(targetId);
    return await fn(sessionId);
  }
}

async function evalOn(targetId, expression, timeoutMs = 60000) {
  return withControlSession(targetId, async (sessionId) => {
    const out = await withTimeout(
      send("Runtime.evaluate", {
        expression: String(expression == null ? "" : expression),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }, sessionId),
      timeoutMs,
      "Runtime.evaluate"
    );
    if (out && out.exceptionDetails) {
      const details = out.exceptionDetails;
      const desc = details.exception && (details.exception.description || details.exception.value);
      throw new Error(desc || details.text || "Runtime.evaluate failed");
    }
    return out && out.result ? out.result.value : undefined;
  });
}

async function infoOn(targetId) {
  const value = await evalOn(
    targetId,
    `({ url: location.href, title: document.title, ready: document.readyState })`,
    15000
  );
  return {
    targetId,
    url: (value && value.url) || "",
    title: (value && value.title) || "",
    ready: (value && value.ready) || "",
  };
}

async function newTarget(url) {
  const targetUrl = url && String(url).trim() ? String(url).trim() : "about:blank";
  const created = await withTimeout(
    send("Target.createTarget", { url: targetUrl }),
    20000,
    "Target.createTarget"
  );
  const targetId = created.targetId;
  try { await attachControl(targetId); } catch (_) {}
  await send("Target.activateTarget", { targetId }).catch(() => {});
  return { ok: true, targetId, url: targetUrl };
}

async function navigateTarget(targetId, url) {
  if (!targetId) throw new Error("targetId is required");
  if (!url) throw new Error("url is required");
  await withControlSession(targetId, async (sessionId) => {
    await withTimeout(send("Page.navigate", { url }, sessionId), 20000, "Page.navigate");
  });
  return { ok: true, targetId, url };
}

async function clickTarget(targetId, selector) {
  if (!targetId) throw new Error("targetId is required");
  if (!selector) throw new Error("selector is required");
  const clicked = await evalOn(
    targetId,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    20000
  );
  return { ok: true, targetId, clicked: !!clicked };
}

async function scrollTarget(targetId, direction) {
  if (!targetId) throw new Error("targetId is required");
  const js = direction === "top"
    ? "window.scrollTo(0, 0)"
    : "window.scrollTo(0, document.documentElement.scrollHeight)";
  await evalOn(targetId, js, 15000);
  return { ok: true, targetId, direction: direction || "bottom" };
}

async function closeTarget(targetId) {
  if (!targetId) throw new Error("targetId is required");
  controlSessions.delete(targetId);
  await send("Target.closeTarget", { targetId }).catch(() => {});
  return { ok: true, targetId };
}

async function listTargets() {
  const result = await withTimeout(send("Target.getTargets"), 15000, "Target.getTargets");
  return (result.targetInfos || [])
    .filter((t) => t.type === "page" && !/^devtools:/i.test(t.url || ""))
    .map((t) => ({
      targetId: t.targetId,
      url: t.url || "",
      title: t.title || "",
      attached: !!t.attached,
      openerId: t.openerId || "",
    }));
}

async function setFiles(targetId, selector, files) {
  if (!targetId) throw new Error("targetId is required");
  if (!selector) throw new Error("selector is required");
  if (!Array.isArray(files) || !files.length) throw new Error("files[] is required");
  return withControlSession(targetId, async (sessionId) => {
    await send("DOM.enable", {}, sessionId).catch(() => {});
    const doc = await withTimeout(
      send("DOM.getDocument", { depth: -1, pierce: true }, sessionId),
      20000,
      "DOM.getDocument"
    );
    const found = await withTimeout(
      send("DOM.querySelector", { nodeId: doc.root.nodeId, selector }, sessionId),
      15000,
      "DOM.querySelector"
    );
    if (!found.nodeId) throw new Error(`file input not found: ${selector}`);
    await withTimeout(
      send("DOM.setFileInputFiles", { files, nodeId: found.nodeId }, sessionId),
      20000,
      "DOM.setFileInputFiles"
    );
    return { ok: true, targetId, files };
  });
}

// ---------------------------------------------------------------------------
// PDF capture using CDP Fetch on a session of the same one WebSocket.
// ---------------------------------------------------------------------------
let activeSessionId = null;
let current = null;
let captured = false;
let captureErr = "";

listeners.add(async (msg) => {
  if (!activeSessionId || msg.sessionId !== activeSessionId) return;
  if (msg.method !== "Fetch.requestPaused") return;
  const p = msg.params;
  const requestId = p.requestId;
  const url = (p.request && p.request.url) || "";
  const headers = p.responseHeaders || [];
  const ct = (headers.find((h) => String(h.name).toLowerCase() === "content-type") || {}).value || "";
  const isPdfMime = /application\/pdf/i.test(ct) || (/application\/octet-stream/i.test(ct) && /\.pdf(\?|$)/i.test(url));
  const isDirectPdfUrl = /\.pdf(\?|$)/i.test(url) && !/text\/html/i.test(ct);
  const looksPdf = isPdfMime || isDirectPdfUrl;
  if (current && !captured && looksPdf) {
    let body = null;
    for (let attempt = 0; attempt < 4 && !body; attempt++) {
      try {
        body = await send("Fetch.getResponseBody", { requestId }, msg.sessionId);
      } catch (e) {
        captureErr = String(e.message || e).slice(0, 200);
        await sleep(350);
      }
    }
    if (body && body.base64Encoded) {
      fs.mkdirSync(path.dirname(path.resolve(current.outFile)), { recursive: true });
      fs.writeFileSync(current.outFile, Buffer.from(body.body, "base64"));
      captured = true;
    } else if (!captureErr) {
      captureErr = "response body not base64";
    }
  }
  try {
    if (p.responseStatusCode) await send("Fetch.continueResponse", { requestId }, msg.sessionId);
    else await send("Fetch.continueRequest", { requestId }, msg.sessionId);
  } catch {
    try { await send("Fetch.continueRequest", { requestId }, msg.sessionId); } catch {}
  }
});

async function captureTarget(item) {
  const started = Date.now();
  const attached = await send("Target.attachToTarget", { targetId: item.targetId, flatten: true });
  const sessionId = attached.sessionId;
  activeSessionId = sessionId;
  current = item;
  captured = false;
  captureErr = "";
  try {
    await send("Page.enable", {}, sessionId).catch(() => {});
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] }, sessionId);
    await send("Target.activateTarget", { targetId: item.targetId }).catch(() => {});
    await sleep(rand(args.preDelayMin, args.preDelayMax));
    await send("Page.stopLoading", {}, sessionId).catch(() => {});
    await send("Page.navigate", { url: item.pdfUrl }, sessionId);
    const deadline = Date.now() + args.timeout;
    while (!captured && Date.now() < deadline) await sleep(200);
    let status = "pdf_fetch_failed";
    let err = captureErr || "no PDF captured";
    if (fs.existsSync(item.outFile)) {
      const head = fs.readFileSync(item.outFile).subarray(0, 5).toString("ascii");
      if (head === "%PDF-") {
        status = "downloaded";
        err = "";
      } else {
        err = `not PDF (head=${JSON.stringify(head)})${captureErr ? " " + captureErr : ""}`;
      }
    }
    await sleep(rand(args.postDelayMin, args.postDelayMax));
    return { ...item, status, err, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
  } finally {
    activeSessionId = null;
    current = null;
    controlSessions.delete(item.targetId);
    // Leave verification/login pages open so the user can act; close after a file existed.
    if (fs.existsSync(item.outFile)) {
      await send("Target.closeTarget", { targetId: item.targetId }).catch(() => {});
    }
  }
}

let chain = Promise.resolve();
function enqueue(item) {
  const p = chain.then(() => captureTarget(item));
  chain = p.catch(() => {});
  return p;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathName = requestUrl.pathname;
  const query = requestUrl.searchParams;
  const json = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === "GET" && pathName === "/health") {
      json(200, { ok: true, name: "literature-access-router-control", browser: args.browser, pid: process.pid });
      return;
    }
    if (req.method === "POST" && pathName === "/shutdown") {
      json(200, { ok: true, shutting_down: true });
      setTimeout(() => {
        try { ws.close(); } catch {}
        server.close(() => process.exit(0));
      }, 100);
      return;
    }
    if (req.method === "GET" && pathName === "/targets") {
      json(200, await listTargets());
      return;
    }
    if (req.method === "GET" && pathName === "/info") {
      json(200, await infoOn(query.get("target")));
      return;
    }
    if (req.method === "POST" && pathName === "/new") {
      json(200, await newTarget(await readBody(req)));
      return;
    }
    if (req.method === "POST" && pathName === "/navigate") {
      json(200, await navigateTarget(query.get("target"), (await readBody(req)).trim()));
      return;
    }
    if (req.method === "POST" && pathName === "/eval") {
      json(200, { ok: true, value: await evalOn(query.get("target"), await readBody(req), 120000) });
      return;
    }
    if (req.method === "POST" && pathName === "/click") {
      json(200, await clickTarget(query.get("target"), (await readBody(req)).trim()));
      return;
    }
    if (req.method === "GET" && pathName === "/close") {
      json(200, await closeTarget(query.get("target")));
      return;
    }
    if (req.method === "GET" && pathName === "/scroll") {
      json(200, await scrollTarget(query.get("target"), query.get("direction") || "bottom"));
      return;
    }
    if (req.method === "POST" && pathName === "/setFiles") {
      const body = JSON.parse(await readBody(req));
      json(200, await setFiles(query.get("target"), body.selector, body.files));
      return;
    }
    if (req.method === "POST" && pathName === "/activate") {
      const body = JSON.parse(await readBody(req));
      if (!body.targetId) throw new Error("targetId is required");
      await send("Target.activateTarget", { targetId: body.targetId });
      json(200, { ok: true, targetId: body.targetId });
      return;
    }
    if (req.method === "POST" && pathName === "/capture-target") {
      const body = JSON.parse(await readBody(req));
      if (!body.targetId || !body.pdfUrl || !body.outFile) throw new Error("targetId, pdfUrl and outFile are required");
      json(200, await enqueue(body));
      return;
    }
    json(404, { ok: false, error: "not found", path: pathName });
  } catch (e) {
    json(500, { ok: false, error: String((e && e.message) || e).slice(0, 400) });
  }
});
server.listen(args.httpPort, "127.0.0.1", () => {
  console.error(`[control-daemon] listening on http://127.0.0.1:${args.httpPort}`);
});
