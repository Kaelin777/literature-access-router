#!/usr/bin/env node
// Open publisher / AbleSci login pages in the user's controlled Chrome session.
// The agent should confirm the publisher list and target institution with the user first.
//
// Usage:
//   node open_login_pages.mjs --publishers "Elsevier,Wiley,Springer,AbleSci" [--proxy http://127.0.0.1:3461] [--delay 2500]
//   node open_login_pages.mjs --urls "https://a.example,https://b.example"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROXY,
  newTab,
  waitForComplete,
  closeTab,
} from "./lib/cdp-utils.mjs";

function parseArgs(argv) {
  const a = { proxy: DEFAULT_PROXY, delay: 2500, activateServer: null, publishers: null, urls: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--publishers") a.publishers = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--urls") a.urls = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--proxy") a.proxy = argv[++i].replace(/\/$/, "");
    else if (k === "--activate-server") a.activateServer = argv[++i].replace(/\/$/, "");
    else if (k === "--delay") a.delay = Number(argv[++i]);
    else throw new Error("unknown arg " + k);
  }
  if (!a.activateServer) a.activateServer = a.proxy;
  if (!a.publishers && !a.urls) throw new Error("--publishers or --urls is required");
  return a;
}

const args = parseArgs(process.argv);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(scriptDir, "publisher_login_urls.json"), "utf8"));

const targets = [];
if (args.publishers) {
  for (const p of args.publishers) {
    const url = config[p];
    if (!url) throw new Error(`unknown publisher key: ${p}`);
    targets.push({ key: p, url });
  }
} else {
  for (const url of args.urls) targets.push({ key: url, url });
}

const results = [];
for (const item of targets) {
  let targetId = null;
  try {
    const created = await newTab(args.proxy, item.url, 60000);
    targetId = created.targetId;
    const info = await waitForComplete(args.proxy, targetId, 45000);
    if (args.activateServer) {
      await fetch(`${args.activateServer}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      }).catch(() => {});
    }
    results.push({ key: item.key, url: item.url, targetId, title: info?.title || "", status: "opened" });
    console.error(`[login] ${item.key}: ${info?.title || item.url}`);
  } catch (e) {
    results.push({ key: item.key, url: item.url, targetId, status: "failed", err: String(e.message || e) });
    console.error(`[login] ${item.key}: failed ${String(e.message || e)}`);
  }
  await new Promise((r) => setTimeout(r, args.delay));
}

console.log(JSON.stringify({ results, note: "Ask the user to choose their institution and complete SSO/CARSI/CAPTCHA/2FA in each opened tab. Do not ask again after they confirm completion." }, null, 2));
