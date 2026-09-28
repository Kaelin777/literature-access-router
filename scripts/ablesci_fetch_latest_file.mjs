import { evalJs } from "./lib/cdp-utils.mjs";
import { fetchToFile } from "./lib/pdf-utils.mjs";

const proxy = "http://127.0.0.1:3461";
const target = process.argv[2];
const out = process.argv[3];
if (!target || !out) throw new Error("usage: node ablesci_fetch_latest_file.mjs <targetId> <outFile>");

const js = `(() => {
  const entries = performance.getEntriesByType('resource')
    .filter((e) => /filehub\\d*(vip)?\\.ablesci\\.com\\/file\\/download/.test(e.name));
  entries.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  return entries.length ? entries[0].name : '';
})()`;
const url = await evalJs(proxy, target, js, 30000);
if (!url) throw new Error("no filehub download URL found in performance entries");
console.error(`[ablesci] using file URL: ${url.slice(0, 120)}...`);
const result = await fetchToFile(proxy, target, url, out);
console.log(JSON.stringify(result, null, 2));
