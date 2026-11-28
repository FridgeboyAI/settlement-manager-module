// Downloads the pinned settlement-core version the tests run against into tests/.core/ (not committed).
// Run automatically before `npm test`; run it by hand with `node tests/fetch-core.mjs`.
// Updating the pin is a deliberate step: change COMMIT, run the tests, commit.
import { mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = "FVTT-Mods-Hawthorne/settlement-core-module";
const COMMIT = "74f04ef6c60c0387c5dab4e6c3be23426e09e377"; // settlement-core v0.3.2
const FILES = ["scripts/core.mjs", "scripts/content-liftland.mjs", "scripts/module.mjs"];
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".core");
const stamp = path.join(dir, `${COMMIT}.pin`);

try { await access(stamp); process.exit(0); } catch { /* not fetched yet */ }
await mkdir(dir, { recursive: true });
for (const f of FILES) {
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${f}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`Could not download ${url}: ${res.status}`); process.exit(1); }
  await writeFile(path.join(dir, path.basename(f)), await res.text());
}
await writeFile(stamp, `${REPO}@${COMMIT}\n`);
console.log(`settlement-core ${COMMIT.slice(0, 7)} downloaded to tests/.core/`);
