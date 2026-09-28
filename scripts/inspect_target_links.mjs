import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = process.argv[3] || "http://127.0.0.1:3461";
const js = `(() => {
  const out = [];
  document.querySelectorAll('a,button').forEach((e) => {
    const text = (e.innerText || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    const href = e.href || '';
    if (text || href) out.push({ tag: e.tagName, text, href, id: e.id || '', cls: String(e.className || '').slice(0, 80) });
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    bodyText: (document.body ? document.body.innerText : '').slice(0, 1200),
    controls: out.slice(0, 250)
  });
})()`;
const raw = await evalJs(proxy, target, js, 30000);
console.log(raw);
