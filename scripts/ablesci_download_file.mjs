import { fetchToFile } from "./lib/pdf-utils.mjs";

const proxy = "http://127.0.0.1:3461";
const target = process.argv[2];
const url = process.argv[3];
const out = process.argv[4];
if (!target || !url || !out) throw new Error("usage: node ablesci_download_file.mjs <targetId> <url> <outFile>");
const result = await fetchToFile(proxy, target, url, out);
console.log(JSON.stringify(result, null, 2));
