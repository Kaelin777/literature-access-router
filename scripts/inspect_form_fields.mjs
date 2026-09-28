import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = process.argv[3] || "http://127.0.0.1:3461";
const js = `(() => {
  const out = [];
  document.querySelectorAll('input,select,textarea').forEach((e) => {
    out.push({
      tag: e.tagName,
      type: e.type || '',
      name: e.name || '',
      id: e.id || '',
      placeholder: e.placeholder || '',
      value: e.value || '',
      checked: e.checked || false,
      options: e.tagName === 'SELECT' ? Array.from(e.options).map((o) => ({ value: o.value, text: o.text })).slice(0, 30) : []
    });
  });
  return JSON.stringify(out, null, 2);
})()`;
console.log(await evalJs(proxy, target, js, 30000));
