#!/usr/bin/env node
// Inline DOI downloader:
//   - opens the article tab through the single control daemon and activates it
//   - extracts the real "View PDF"/"Download PDF" link
//   - asks the same daemon to navigate THAT SAME TAB to the PDF and capture it
//   - closes the tab and waits before the next paper
//
// Usage:
//   node download_doi_list_inline.mjs --list <manifest.tsv> --out <dir> [--capture-server http://127.0.0.1:3461]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROXY,
  newTab,
  waitForComplete,
  evalJs,
  closeTab,
} from "./lib/cdp-utils.mjs";
import { loadSchoolConfig } from "./lib/school-config.mjs";

function parseArgs(argv) {
  const a = {
    proxy: DEFAULT_PROXY,
    timeout: 60000,
    pageDelayMin: 6000,
    pageDelayMax: 15000,
    batchDelayMin: 10000,
    batchDelayMax: 20000,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--list") a.list = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--proxy") a.proxy = argv[++i];
    else if (k === "--capture-server") a.captureServer = argv[++i].replace(/\/$/, "");
    else if (k === "--result-file") a.resultFile = argv[++i];
    else if (k === "--timeout") a.timeout = Number(argv[++i]);
    else if (k === "--page-delay-min") a.pageDelayMin = Number(argv[++i]);
    else if (k === "--page-delay-max") a.pageDelayMax = Number(argv[++i]);
    else if (k === "--batch-delay-min") a.batchDelayMin = Number(argv[++i]);
    else if (k === "--batch-delay-max") a.batchDelayMax = Number(argv[++i]);
    else throw new Error("unknown arg " + k);
  }
  if (!a.captureServer) a.captureServer = a.proxy;
  if (!a.list) throw new Error("--list is required");
  if (!a.out) throw new Error("--out is required");

  return a;
}

const args = parseArgs(process.argv);
const outDir = path.resolve(args.out);
fs.mkdirSync(path.join(outDir, "PDFs"), { recursive: true });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(min + Math.random() * Math.max(0, max - min)); }
function safe(name) { return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 180); }

const verifyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify_pdf.py");
function verifyPdf(file, doi) {
  const bundledPython = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const candidates = process.env.LIT_DL_PYTHON
    ? [process.env.LIT_DL_PYTHON]
    : [bundledPython, ...(process.platform === "win32" ? ["py", "python"] : ["python3", "python"])];
  for (const python of candidates) {
    const args = python === "py" ? ["-3", verifyScript] : [verifyScript];
    const run = spawnSync(python, [...args, "--pdf", file, "--doi", doi], {
      encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
    });
    if (run.error?.code === "ENOENT") continue;
    try { return JSON.parse(run.stdout.trim()); } catch {
      return { status: "unverified", reason: `verifier_unavailable: ${String(run.stderr || run.error || "unknown").slice(0, 160)}` };
    }
  }
  return { status: "unverified", reason: "python_not_found" };
}

const rows = fs.readFileSync(args.list, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !/^doi\b/i.test(l))
  .map((l) => {
    const [doi, filename, label] = l.split(/\t/);
    return { doi, filename, label: label || doi };
  });
const configuredBatchSize = loadSchoolConfig()?.batch?.size || 10;
if (rows.length > configuredBatchSize) {
  throw new Error(`Manifest has ${rows.length} papers; configured batch limit is ${configuredBatchSize}. Split the list into smaller batches.`);
}

const results = [];
for (const row of rows) {
  const started = Date.now();
  let outFile = path.join(outDir, "PDFs", safe(row.filename || row.doi) + ".pdf");
  if (fs.existsSync(outFile)) {
    const prior = verifyPdf(outFile, row.doi);
    if (prior.status === "verified") {
      row.status = "downloaded";
      row.err = "already exists and verified";
      row.file = outFile;
      row.verified_by = prior.matched_by;
      row.seconds = 0;
      results.push(row);
      console.error(`[skip] ${row.doi} -> already verified`);
      continue;
    }
    // Preserve the existing file while attempting a fresh capture.
    outFile = path.join(outDir, "PDFs", safe(row.filename || row.doi) + `__retry_${Date.now()}.pdf`);
  }
  let articleTarget = null;
  let status = "failed_after_retry";
  let pdfUrl = "";
  let err = "";
  try {
    const created = await newTab(args.proxy, "https://doi.org/" + row.doi, 60000);
    articleTarget = created.targetId;
    await fetch(args.captureServer + "/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: articleTarget }),
    }).catch(() => {});
    const info = await waitForComplete(args.proxy, articleTarget, args.timeout);
    await sleep(rand(args.pageDelayMin, args.pageDelayMax));
    const pageUrl = info?.url || "";
    const title = info?.title || "";
    if (/sso|cas|shibboleth|carsi|authserver|login/i.test(pageUrl) &&
        !/sciencedirect|springer|wiley|tandfonline|sagepub|nature\.com|academic\.oup\.com/i.test(pageUrl)) {
      status = "carsi_waiting_user";
      err = "institutional authentication page";
    } else {
      const bodyText = await evalJs(
        args.proxy,
        articleTarget,
        `document.body ? (document.body.innerText || '').slice(0,300) : ''`,
        20000
      ).catch(() => "");
      if (/captcha|robot|cloudflare|verify you are human|璇烽獙璇亅瀹夊叏楠岃瘉|璁块棶楠岃瘉|浜烘満/i.test(`${title} ${bodyText || ""}`)) {
        status = "publisher_verification_waiting_user";
        err = "publisher verification page";
      } else {
        const candidate = await evalJs(
          args.proxy,
          articleTarget,
          `(() => {
            const meta = document.querySelector('meta[name="citation_pdf_url"]');
            if (meta && meta.content) return meta.content;
            const pii = (location.pathname.match(/\\/pii\\/([A-Za-z0-9]+)/) || [])[1] || '';
            const doiMeta = (document.querySelector('meta[name="citation_doi"]') || {}).content || '';
            const links = [];
            document.querySelectorAll('a').forEach((a) => {
              const h = a.href || '';
              if (!h) return;
              if (/pdfft|pdfdirect|\\/doi\\/(pdf|epdf)|\\.pdf(\\?|$)|download.*pdf/i.test(h)) links.push(h);
            });
            let pick = links.find((h) => pii && h.includes(pii))
              || links.find((h) => doiMeta && h.includes(doiMeta))
              || links[0]
              || '';
            if (pick && pick.startsWith('/')) pick = new URL(pick, location.href).href;
            return pick;
          })()`,
          30000
        ).catch(() => "");
        if (!candidate) {
          status = "no_authorized_pdf_found";
          err = "no PDF candidate link on article page";
        } else {
          pdfUrl = candidate;
          // Wiley epdf opens a viewer; use pdfdirect to get the real PDF bytes.
          if (/wiley\.com/i.test(pdfUrl) && /\/doi\/epdf\//i.test(pdfUrl)) {
            const m = pdfUrl.match(/10\.\d{4,9}\/[^\s"?]+/);
            if (m) pdfUrl = `https://onlinelibrary.wiley.com/doi/pdfdirect/${m[0]}?download=true`;
          }
          const resp = await fetch(args.captureServer + "/capture-target", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...row, targetId: articleTarget, pdfUrl, outFile }),
          });
          const captured = await resp.json();
          status = captured.status || "pdf_fetch_failed";
          err = captured.err || "";
          if (captured.bytes) row.bytes = captured.bytes;
          if (status === "downloaded" && fs.existsSync(outFile)) {
            const verified = verifyPdf(outFile, row.doi);
            status = verified.status === "verified" ? "downloaded" : "unverified";
            err = verified.reason || "";
            row.file = outFile;
            row.verified_by = verified.matched_by;
          }
        }
      }
    }
  } catch (e) {
    status = "failed_after_retry";
    err = String(e).slice(0, 300);
  } finally {
    const keepOpen = status === "publisher_verification_waiting_user" || status === "carsi_waiting_user";
    if (keepOpen) row.targetId = articleTarget;
    if (articleTarget && !keepOpen) await closeTab(args.proxy, articleTarget);
  }
  row.status = status;
  row.err = err;
  row.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  results.push(row);
  console.error(`[dl] ${row.doi} -> ${status}${err ? " | " + err : ""}`);
  await sleep(rand(args.batchDelayMin, args.batchDelayMax));
}

const summary = {
  total: results.length,
  downloaded: results.filter((r) => r.status === "downloaded").length,
  seconds: results.reduce((s, r) => s + Number(r.seconds || 0), 0).toFixed(1),
};
const resultPath = args.resultFile ? path.resolve(args.resultFile) : path.join(outDir, "batch_results.json");
fs.writeFileSync(resultPath, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify({ summary, results }, null, 2));
