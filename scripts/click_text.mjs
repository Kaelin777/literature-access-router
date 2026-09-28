import { evalJs } from "./lib/cdp-utils.mjs";

const target = process.argv[2];
const text = process.argv[3];
const proxy = "http://127.0.0.1:3461";
if (!target || !text) throw new Error("usage: node click_text.mjs <targetId> <text>");
const js = `(() => {
  const wanted = ${JSON.stringify(text)};
  const els = [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')];
  const el = els.find((e) => ((e.innerText || e.textContent || e.value || '').trim()).includes(wanted));
  if (!el) return JSON.stringify({ clicked: false, available: els.map((e) => (e.innerText || e.textContent || e.value || '').trim()).filter(Boolean).slice(0, 80) });
  el.click();
  return JSON.stringify({ clicked: true, tag: el.tagName, text: (el.innerText || el.textContent || el.value || '').trim() });
})()`;
console.log(await evalJs(proxy, target, js, 30000));
