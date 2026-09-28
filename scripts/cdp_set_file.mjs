const target = process.argv[2];
const selector = process.argv[3];
const file = process.argv[4];
if (!target || !selector || !file) throw new Error("usage: node cdp_set_file.mjs <target> <selector> <file>");
const url = `http://127.0.0.1:3461/setFiles?target=${encodeURIComponent(target)}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ selector, files: [file] }),
});
console.log(res.status, await res.text());
