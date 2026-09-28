import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = "http://127.0.0.1:3461";
const js = `(() => {
  const out = [];
  document.querySelectorAll('a,span,div').forEach((e) => {
    const text = (e.innerText || e.textContent || '').trim();
    const href = e.href || '';
    const cls = String(e.className || '');
    const id = e.id || '';
    if (/laypage|pagination|page-link/i.test(cls + ' ' + id + ' ' + href) || /下一页|上一页|尾页|首页/.test(text)) {
      out.push({ tag: e.tagName, text: text.slice(0, 80), href, cls: cls.slice(0, 100), id });
    }
  });
  return JSON.stringify(out.slice(0, 150));
})()`;
console.log(await evalJs(proxy, target, js, 30000));
