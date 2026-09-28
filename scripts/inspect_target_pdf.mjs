import { evalJs } from "./lib/cdp-utils.mjs";
const target = process.argv[2];
const proxy = process.argv[3] || "http://127.0.0.1:3461";
const js = `(() => {
  const meta = document.querySelector('meta[name="citation_pdf_url"]');
  const buttons = [];
  document.querySelectorAll('button,a').forEach((e) => {
    const text = (e.innerText || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    const href = e.href || '';
    if (/pdf|download|view|access/i.test(text + ' ' + href)) buttons.push({ tag: e.tagName, text, href });
  });
  const links = [];
  document.querySelectorAll('a').forEach((a) => {
    const h = a.href || '';
    if (/pdf|download|epdf/i.test(h)) links.push(h);
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    citationPdf: meta ? meta.content : '',
    buttons: buttons.slice(0, 40),
    links: [...new Set(links)].slice(0, 40),
    bodyText: (document.body ? document.body.innerText : '').slice(0, 500)
  });
})()`;
const raw = await evalJs(proxy, target, js, 30000);
console.log(raw);
