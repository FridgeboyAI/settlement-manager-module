/**
 * The one place that talks to settlement-core (decision D6). Everything else goes through these helpers.
 */
import { ID, CORE_ID } from "./logic/const.mjs";
import { checkCoreApi, missingFields, SETTLEMENT_FIELDS, SLOT_FIELDS } from "./logic/check.mjs";
import { readModuleData } from "./logic/data.mjs";

let api = null;
let check = { ok: false, disabled: [], missing: [], versionOk: false, version: "" };
const fieldWarnings = new Set();

export const core = () => api;
export const coreCheck = () => check;

/** Find core and check its API. Called at setup (to register actions) and again at ready. */
export function connect() {
  const mod = game.modules.get(CORE_ID);
  api = mod?.active ? mod.api || null : null;
  check = checkCoreApi(api);
  return check;
}

/** Is a feature usable? Features are named in logic/check.mjs (settlement, stats, buildings, resources, work, week, moduleData). */
export const enabled = feature => check.ok && !check.disabled.includes(feature);

/** The host GM is the active GM with the lowest user id, the same rule core uses for its writes. */
export function isHost() {
  if (!game.user?.isGM) return false;
  const first = game.users.filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
  return first?.id === game.user.id;
}
export const gmOnline = () => game.users.some(u => u.active && u.isGM);

/** Run one of this module's actions through core's pipeline. */
export const run = (name, args = {}) => api.request(`${ID}.${name}`, args);

export function data() { return readModuleData(api?.getModuleData?.(ID)); }

export const mainId = () => game.settings.get(ID, "mainSettlementId") || "";
export function mainSettlement() {
  const id = mainId();
  const s = id ? api?.getSettlement(id) : null;
  if (s) warnFields("settlement", s, SETTLEMENT_FIELDS);
  for (const slot of s?.slots || []) { warnFields("slot", slot, SLOT_FIELDS); break; }
  return s;
}

export const building = id => api?.get("buildings", id) || null;
export const resourceLabel = id => api?.get("resources", id)?.label || id;

/** Report a core field we rely on that has gone missing, once per field, to the GM only. */
function warnFields(kind, record, fields) {
  for (const f of missingFields(record, fields)) {
    const key = `${kind}.${f}`;
    if (fieldWarnings.has(key)) continue;
    fieldWarnings.add(key);
    if (game.user.isGM) ui.notifications.warn(`Settlement Manager: settlement-core's ${kind} has no "${f}" field any more. Features that use it may not work.`, { permanent: true });
  }
}

/** Tell the GM once what is wrong with core's API. */
export function reportCheck() {
  if (!game.user.isGM) return;
  if (!check.ok) { ui.notifications.error("Settlement Manager needs the settlement-core module to be active.", { permanent: true }); return; }
  if (!check.versionOk) ui.notifications.warn(`Settlement Manager expects settlement-core 0.2.1 or later (found ${check.version || "unknown"}).`, { permanent: true });
  if (check.missing.length) {
    ui.notifications.warn(`Settlement Manager: settlement-core has no ${check.missing.join(", ")}. Turned off: ${check.disabled.join(", ")}.`, { permanent: true });
  }
}

/** Every building host the module looks at: the settlement and every tile and resource the GM can see. */
export function allHosts() {
  const out = [];
  const s = mainSettlement();
  if (s) out.push({ host: { kind: "settlement", id: s.id }, label: s.name, slots: s.slots });
  const state = api.getState();
  for (const [sceneId, tiles] of Object.entries(state.tiles || {})) {
    const scene = game.scenes.get(sceneId);
    for (const t of Object.values(tiles || {})) {
      if (!t) continue;
      const where = `${t.name || t.key}${scene ? ` (${scene.name})` : ""}`;
      out.push({ host: { kind: "tile", sceneId, key: t.key }, label: where, slots: t.slots || [] });
      for (const d of t.discoverables || []) out.push({ host: { kind: "discoverable", sceneId, key: t.key, id: d.id }, label: `${d.name || d.type} on ${where}`, slots: d.slots || [] });
    }
  }
  return out;
}

/** Resolve a host reference to its slots and a label, from what this client may see. */
export function hostInfo(host) {
  if (host.kind === "settlement") { const s = api.getSettlement(host.id); return s ? { label: s.name, slots: s.slots, target: s } : null; }
  const t = api.getTile(host.sceneId, host.key); if (!t) return null;
  if (host.kind === "tile") return { label: t.name || t.key, slots: t.slots, target: t, tile: t };
  const d = t.discoverables.find(x => x.id === host.id);
  return d ? { label: `${d.name || d.type} on ${t.name || t.key}`, slots: d.slots, target: d, tile: t } : null;
}
