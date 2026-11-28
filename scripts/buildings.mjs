/**
 * GM building files (spec §6.1): the GM's client reads them and publishes the checked list in this module's data;
 * every client registers that list with core, so everyone sees the same buildings.
 */
import { ID, escapeHTML } from "./logic/const.mjs";
import { combineBuildingFiles } from "./logic/buildings.mjs";
import { core, run, data } from "./link.mjs";

/** Definitions as they were before this module changed them, so a reload patches the original, not our last copy. */
const originals = new Map();
let applied = "";

const FilePickerClass = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** Register the published list with core on this client. Safe to call often. */
export function applyPublished(force = false) {
  const api = core(); if (!api) return false;
  const { pub } = data();
  const stamp = `${pub.buildingsLoadedAt}|${Object.keys(pub.buildings).length}`;
  if (!force && stamp === applied) return false;
  for (const [id, def] of Object.entries(pub.buildings || {})) {
    if (!originals.has(id)) originals.set(id, api.get("buildings", id));
    api.define("buildings", id, def);
  }
  applied = stamp;
  return true;
}

/** GM only: read the folder, check every file, publish the result and report problems. */
export async function reloadBuildings({ quiet = false } = {}) {
  const api = core();
  const folder = String(game.settings.get(ID, "buildingsFolder") || "").replace(/^\/+|\/+$/g, "");
  let paths = [];
  try {
    const result = await FilePickerClass().browse("data", folder);
    paths = (result.files || []).filter(f => f.toLowerCase().endsWith(".json"));
  } catch (e) {
    if (!quiet) ui.notifications.info(`Settlement Manager: no building folder "${folder}" in your user data, so only the built-in buildings are used.`);
    await run("publishBuildings", { buildings: {}, loadedAt: new Date().toISOString() });
    return { buildings: {}, report: [], loaded: [] };
  }
  const files = [];
  for (const path of paths) {
    const name = decodeURIComponent(path.split("/").pop());
    try {
      const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`);
      files.push({ name, text: await res.text() });
    } catch (e) { files.push({ name, text: "" }); }
  }
  const existing = id => (originals.has(id) ? originals.get(id) : api.get("buildings", id));
  const existingIds = api.all("buildings").map(b => b.id).filter(id => !originals.has(id) || originals.get(id));
  const result = combineBuildingFiles(files, existing, existingIds);
  await run("publishBuildings", { buildings: result.buildings, loadedAt: new Date().toISOString() });
  applyPublished(true);

  if (result.report.length) {
    const rows = result.report.map(r => `<li><strong>${escapeHTML(r.file)}</strong>: ${escapeHTML(r.error)}</li>`).join("");
    await ChatMessage.create({
      content: `<div class="sm-card"><h3>Building files: ${result.report.length} skipped</h3><ul>${rows}</ul></div>`,
      whisper: game.users.filter(u => u.isGM).map(u => u.id), speaker: { alias: "Settlement Manager" }
    });
    ui.notifications.warn(`Settlement Manager: ${result.report.length} building file(s) skipped. See the chat for why.`);
  } else if (!quiet) {
    ui.notifications.info(`Settlement Manager: loaded ${result.loaded.length} building file(s).`);
  }
  return result;
}
