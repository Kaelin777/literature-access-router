#!/usr/bin/env node
// Assist a batch of AbleSci requests:
//   for each detail id: open detail page -> read DOI -> download DOI via existing inline workflow
//   -> set file input via the single control daemon /setFiles -> click #upload-bth -> verify success -> delete local PDF.
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

function parseArgs(argv) {
  const a = { proxy: DEFAULT_PROXY, daemon: DEFAULT_PROXY, out: "./AbleSci_Assist" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--ids") a.ids = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--proxy") a.proxy = argv[++i];
    else if (k === "--daemon") a.daemon = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else throw new Error("unknown arg " + k);
  }
  if (!a.ids || !a.ids.length) throw new Error("--ids is required");
  return a;
}

const args = parseArgs(process.argv);
const inlineScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "download_doi_list_inline.mjs");
const outRoot = path.resolve(args.out);
fs.mkdirSync(outRoot, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getDetail(target) {
  const js = `(() => {
    const doiLink = [...document.querySelectorAll('a')].find((a) => /^https?:\\/\\/doi\\.org\\/10\\./.test(a.href || ''));
    const badge = document.querySelector('.assist-badge');
    const titleEl = document.querySelector('.assist-detail-page h1, .assist-detail-page .detail-title, h1');
    return JSON.stringify({
      url: location.href,
      title: (document.title || '').replace(/\\s*-\\s*科研通.*$/, '').trim(),
      doi: doiLink ? (doiLink.href.match(/10\\.\\d{4,9}\\/[^\\s"?]+/) || [])[0] || '' : '',
      status: badge ? (badge.innerText || '').trim() : '',
      body: (document.body ? document.body.innerText : '').slice(0, 400)
    });
  })()`;
  return JSON.parse((await evalJs(args.proxy, target, js, 30000)) || '{}');
}

async function uploadFile(target, file) {
  const setRes = await fetch(`${args.proxy}/setFiles?target=${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selector: "input[type=file]", files: [file] }),
  });
  const setText = await setRes.text();
  const clickRes = await fetch(`${args.proxy}/click?target=${encodeURIComponent(target)}`, {
    method: "POST",
    body: "#upload-bth",
  });
  const clickText = await clickRes.text();
  await sleep(6000);
  const body = await evalJs(args.proxy, target, `document.body ? document.body.innerText.slice(0,2000) : ''`, 30000).catch(() => "");
  return { setText, clickText, body: body || "" };
}

const results = [];
for (const id of args.ids) {
  const started = Date.now();
  let detailTarget = null;
  const workDir = path.join(outRoot, id);
  fs.mkdirSync(workDir, { recursive: true });
  let result = { id, status: "failed", err: "" };
  try {
    const created = await newTab(args.proxy, `https://www.ablesci.com/assist/detail?id=${id}`, 60000);
    detailTarget = created.targetId;
    await waitForComplete(args.proxy, detailTarget, 45000);
    await sleep(2000);
    const detail = await getDetail(detailTarget);
    result.title = detail.title;
    result.doi = detail.doi;
    result.detailStatus = detail.status;
    if (!detail.doi) throw new Error("no DOI found on detail page");
    if (detail.status && !detail.status.includes("求助中")) throw new Error(`request not waiting: ${detail.status}`);

    const filename = `${id}_${(detail.doi.split("/").pop() || "paper").replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const manifest = path.join(workDir, "manifest.tsv");
    fs.writeFileSync(manifest, `doi\tfilename\tlabel\n${detail.doi}\t${filename}\t${detail.title || id}\n`, "utf8");
    const dlOut = path.join(workDir, "PDFs");
    const dlResultFile = path.join(workDir, "download_results.json");
    const dl = spawnSync(process.execPath, [
      inlineScript,
      "--list", manifest,
      "--out", workDir,
      "--capture-server", args.daemon,
      "--result-file", dlResultFile,
    ], { encoding: "utf8", timeout: 6 * 60 * 1000 });
    const dlJson = fs.existsSync(dlResultFile) ? JSON.parse(fs.readFileSync(dlResultFile, "utf8")) : null;
    const pdfFile = path.join(dlOut, filename + ".pdf");
    if (!fs.existsSync(pdfFile)) {
      throw new Error(`PDF not downloaded: ${(dl.stderr || dl.stdout || "").slice(-300)}`);
    }
    const head = fs.readFileSync(pdfFile).subarray(0, 5).toString("ascii");
    if (head !== "%PDF-") throw new Error(`downloaded file is not PDF (head=${JSON.stringify(head)})`);

    const up = await uploadFile(detailTarget, pdfFile);
    const success = /上传成功/.test(up.body);
    result.uploadSuccess = success;
    result.uploadSnippet = up.body.slice(-500);
    if (!success) throw new Error("upload success message not found");

    // delete original downloaded PDF (and the work folder) after successful upload
    fs.rmSync(workDir, { recursive: true, force: true });

    result.status = "uploaded";
    result.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  } catch (e) {
    result.err = String(e.message || e).slice(0, 400);
    result.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  } finally {
    if (detailTarget) await closeTab(args.proxy, detailTarget);
  }
  results.push(result);
  console.error(`[assist] ${id} -> ${result.status}${result.err ? " | " + result.err : ""}`);
  await sleep(1500);
}
console.log(JSON.stringify(results, null, 2));
