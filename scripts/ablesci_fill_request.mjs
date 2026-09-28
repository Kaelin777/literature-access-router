import { evalJs } from "./lib/cdp-utils.mjs";

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--target") a.target = argv[++i];
    else if (k === "--doi") a.doi = argv[++i];
    else if (k === "--title") a.title = argv[++i];
    else if (k === "--url") a.url = argv[++i];
    else if (k === "--note") a.note = argv[++i];
    else if (k === "--point") a.point = argv[++i];
    else throw new Error("unknown arg " + k);
  }
  if (!a.target) throw new Error("--target is required");
  return a;
}

const args = parseArgs(process.argv);
const proxy = "http://127.0.0.1:3461";
const payload = {
  doi: args.doi || "",
  title: args.title || "",
  url: args.url || "",
  note: args.note || "",
  point: args.point || "10",
};
const js = `(() => {
  const payload = ${JSON.stringify(payload)};
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
  const out = {
    doi: setValue('#Assist-doi', payload.doi),
    title: setValue('#Assist-title', payload.title),
    url: setValue('#Assist-url', payload.url),
    note: setValue('#Assist-note', payload.note),
    point: setValue('#Assist-point', payload.point)
  };
  return JSON.stringify(out);
})()`;
console.log(await evalJs(proxy, args.target, js, 30000));
