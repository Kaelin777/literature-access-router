#!/usr/bin/env node
// Batch-publish AbleSci (科研通) literature requests for papers that failed institution access.
// Automatic submission uses only the user's explicit local fallback configuration.
//
// Usage:
//   node ablesci_batch_request.mjs --items "failed_items.json" [--proxy http://127.0.0.1:3461]
// failed_items.json: [{"doi":"10.x/y","title":"...","url":"https://publisher/..."}]
import fs from "node:fs";
import { loadSchoolConfig } from "./lib/school-config.mjs";
import {
  DEFAULT_PROXY,
  newTab,
  waitForComplete,
  evalJs,
  proxyGet,
  closeTab,
} from "./lib/cdp-utils.mjs";

function parseArgs(argv) {
  const a = { proxy: DEFAULT_PROXY };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--items") a.items = argv[++i];
    else if (k === "--proxy") a.proxy = argv[++i].replace(/\/$/, "");
    else if (k === "--point") a.point = String(argv[++i]);
    else throw new Error("unknown arg " + k);
  }
  if (!a.items) throw new Error("--items is required");
  return a;
}

const args = parseArgs(process.argv);
const items = JSON.parse(fs.readFileSync(args.items, "utf8"));
if (!Array.isArray(items)) throw new Error("items file must contain a JSON array");
const profile = loadSchoolConfig();
const fallback = profile?.version === 2 ? profile.fallback : null;
if (fallback?.provider !== "ablesci" || fallback.auto_request !== true) {
  throw new Error("Automatic AbleSci requests require fallback.provider=ablesci and auto_request=true in profile.json");
}
const reward = fallback.reward_points;
const cap = fallback.max_points_per_run;
if (!Number.isSafeInteger(reward) || reward <= 0 ||
    !Object.hasOwn(fallback, "max_points_per_run") ||
    (cap !== null && (!Number.isSafeInteger(cap) || cap < 0))) {
  throw new Error("Configure a positive reward and an explicit per-run cap or unlimited opt-in");
}
if (args.point !== undefined && Number(args.point) !== reward) {
  throw new Error("--point must match the reward configured in profile.json");
}
if (cap !== null && items.length * reward > cap) {
  throw new Error(`Batch would exceed the configured ${cap}-point per-run cap`);
}
args.point = String(reward);

const fillJs = (item) => `(() => {
  const p = ${JSON.stringify({
    doi: item.doi || "",
    title: item.title || "",
    url: item.url || "",
    note: item.note || "",
    point: args.point,
  })};
  function setValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }
  return JSON.stringify({
    doi: setValue('#Assist-doi', p.doi),
    title: setValue('#Assist-title', p.title),
    url: setValue('#Assist-url', p.url),
    note: setValue('#Assist-note', p.note),
    point: setValue('#Assist-point', p.point)
  });
})()`;

const results = [];
for (const item of items) {
  let targetId = null;
  let status = "failed";
  let detailUrl = "";
  try {
    const created = await newTab(args.proxy, "https://www.ablesci.com/assist/create", 60000);
    targetId = created.targetId;
    await waitForComplete(args.proxy, targetId, 45000);
    await new Promise((r) => setTimeout(r, 1500));
    const page = await proxyGet(args.proxy, "/info", { target: targetId }, 10000).catch(() => ({}));
    if (!/assist\/create/.test(page.url || "")) {
      throw new Error(`not on AbleSci create page: ${page.url || "unknown"}`);
    }
    const filled = await evalJs(args.proxy, targetId, fillJs(item), 30000);
    // Click submit through the proxy /click endpoint (body = selector).
    const clickRes = await fetch(`${args.proxy}/click?target=${encodeURIComponent(targetId)}`, {
      method: "POST",
      body: "#form-submit-btn",
    });
    if (!clickRes.ok) throw new Error(`submit click failed: HTTP ${clickRes.status}`);
    await new Promise((r) => setTimeout(r, 5000));
    const info = await proxyGet(args.proxy, "/info", { target: targetId }, 10000).catch(() => ({}));
    detailUrl = info.url || "";
    if (/assist\/detail\?id=/.test(detailUrl)) {
      status = "requested";
    } else {
      const body = await evalJs(args.proxy, targetId, `document.body ? document.body.innerText.slice(0,1500) : ''`, 20000).catch(() => "");
      if (/处理提示|尚未处理|已经有人上传文件/.test(body || "")) {
        status = "blocked_pending_confirmation";
        const pending = await evalJs(
          args.proxy,
          targetId,
          `(() => { const a = [...document.querySelectorAll('a')].find((x) => /my\\/assist-my/.test(x.href || '')); return a ? a.href : ''; })()`,
          20000
        ).catch(() => "");
        detailUrl = pending || detailUrl;
      } else if (/验证码|人机|安全验证|captcha|robot/i.test(body || "")) {
        status = "user_verification_required";
      } else {
        status = "submit_unverified";
      }
    }
    results.push({ ...item, status, detailUrl, body: (await evalJs(args.proxy, targetId, `document.body ? document.body.innerText.slice(0,300) : ''`, 20000).catch(() => "")) });
  } catch (e) {
    results.push({ ...item, status, detailUrl, err: String(e.message || e).slice(0, 300) });
  } finally {
    if (targetId && status !== "user_verification_required") await closeTab(args.proxy, targetId);
  }
  console.error(`[ablesci] ${item.doi || item.title || "item"} -> ${status}${detailUrl ? " " + detailUrl : ""}`);
}
console.log(JSON.stringify({ results }, null, 2));
