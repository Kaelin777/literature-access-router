import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = "http://127.0.0.1:3461";
const js = `(() => {
  const out = [];
  document.querySelectorAll('a[href*="/assist/detail?id="]').forEach((a) => {
    const href = a.href || '';
    const title = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
    if (!title) return;
    let el = a;
    for (let i = 0; i < 5 && el; i++) el = el.parentElement;
    const container = a.closest('[class*="assist-list-item"], .layui-card, .item, li') || el;
    const text = container ? (container.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 300) : '';
    out.push({ title, href, cls: String(container && container.className || '').slice(0, 100), text });
  });
  return JSON.stringify(out.slice(0, 80));
})()`;
console.log(await evalJs(proxy, target, js, 30000));
