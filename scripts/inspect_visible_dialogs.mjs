import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = "http://127.0.0.1:3461";
const js = `(() => {
  const out = [];
  const all = document.querySelectorAll('div,section,form,span,buttons,a');
  all.forEach((e) => {
    const cls = String(e.className || '');
    const id = e.id || '';
    const text = (e.innerText || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 220);
    if (!text) return;
    if (/layui-layer|dialog|modal|confirm|tip/i.test(cls + ' ' + id) || /采纳|驳回|确定|确认|取消/.test(text)) {
      out.push({ tag: e.tagName, cls: cls.slice(0, 160), id, text });
    }
  });
  return JSON.stringify(out.slice(0, 100));
})()`;
console.log(await evalJs(proxy, target, js, 30000));
