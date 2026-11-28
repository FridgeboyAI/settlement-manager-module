/**
 * GM building files (spec §6.1). One JSON object per file, in settlement-core's building shape plus an `id`.
 * A file whose id already exists replaces that building, unless it sets "patch": true; then its fields are merged
 * onto the existing definition. No Foundry dependency.
 */
import { EFFECT_KEYS, HOST_KINDS, DICE, isObj } from "./const.mjs";

const NUMBER_FIELDS = ["complexity", "level", "weeks", "dc", "materialsPerWeek"];
const LIST_FIELDS = ["hosts", "needs", "skills", "terrain", "tileTags", "discoverableCategories", "discoverableTypes"];
const STRING_FIELDS = ["label", "family", "requires", "text"];
const ALLOWED = new Set(["id", "patch", ...NUMBER_FIELDS, ...LIST_FIELDS, ...STRING_FIELDS, "effects"]);

/** Parse one file's text. Returns { ok, id, def, patch } or { ok: false, error }. */
export function parseBuildingFile(fileName, text) {
  let raw;
  try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { return { ok: false, file: fileName, error: `Not valid JSON: ${e.message}` }; }
  if (!isObj(raw)) return { ok: false, file: fileName, error: "The file must hold one JSON object" };
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, file: fileName, error: 'Needs an "id" of lowercase letters, digits and dashes' };
  const unknown = Object.keys(raw).filter(k => !ALLOWED.has(k));
  if (unknown.length) return { ok: false, file: fileName, error: `Unknown field(s): ${unknown.join(", ")}` };
  const { id: _id, patch, ...def } = raw;
  return { ok: true, file: fileName, id, patch: patch === true, def };
}

/** Check a complete definition. `knownIds` holds every building id that will exist. Returns a list of problems. */
export function validateDefinition(def, knownIds = new Set()) {
  const errors = [];
  if (typeof def.label !== "string" || !def.label.trim()) errors.push('needs a "label"');
  const level = def.level ?? def.complexity;
  if (!Number.isInteger(level) || level < 1) errors.push('needs a whole-number "complexity" or "level" of 1 or more');
  if (!Array.isArray(def.hosts) || !def.hosts.length || def.hosts.some(h => !HOST_KINDS.includes(h))) {
    errors.push(`"hosts" must list one or more of ${HOST_KINDS.join(", ")}`);
  }
  for (const f of NUMBER_FIELDS) if (def[f] !== undefined && (!Number.isFinite(def[f]) || def[f] < 0)) errors.push(`"${f}" must be a number of 0 or more`);
  for (const f of LIST_FIELDS) if (def[f] !== undefined && (!Array.isArray(def[f]) || def[f].some(x => typeof x !== "string"))) errors.push(`"${f}" must be a list of words`);
  for (const f of STRING_FIELDS) if (def[f] !== undefined && typeof def[f] !== "string") errors.push(`"${f}" must be text`);
  if (def.requires && !knownIds.has(def.requires)) errors.push(`"requires" names an unknown building "${def.requires}"`);
  if (def.effects !== undefined) {
    if (!isObj(def.effects)) errors.push('"effects" must be an object');
    else {
      for (const [k, v] of Object.entries(def.effects)) {
        if (!EFFECT_KEYS.includes(k)) errors.push(`unknown effect "${k}"`);
        else if (k === "workDie" && !DICE.includes(v)) errors.push(`"workDie" must be one of ${DICE.join(", ")}`);
        else if (k === "produces" && typeof v !== "string") errors.push('"produces" must be a resource id');
        else if (!["workDie", "produces"].includes(k) && !Number.isFinite(v)) errors.push(`effect "${k}" must be a number`);
      }
    }
  }
  return errors;
}

/**
 * Combine parsed files with the existing definitions.
 * @param files    [{ name, text }]
 * @param existing (id) => definition or null — the definitions before any GM file (Liftland and others)
 * @param existingIds  ids of all existing buildings
 * @returns { buildings: { id: def }, report: [{ file, id?, error }], loaded: [{ file, id, mode }] }
 */
export function combineBuildingFiles(files, existing, existingIds = []) {
  const parsed = files.map(f => parseBuildingFile(f.name, f.text));
  const report = parsed.filter(p => !p.ok).map(p => ({ file: p.file, error: p.error }));
  const good = parsed.filter(p => p.ok);

  const seen = new Map();
  for (const p of good) {
    if (seen.has(p.id)) report.push({ file: p.file, id: p.id, error: `Same id as ${seen.get(p.id)}; this file was skipped` });
    else seen.set(p.id, p.file);
  }
  const unique = good.filter(p => seen.get(p.id) === p.file);
  const knownIds = new Set([...existingIds, ...unique.filter(p => !p.patch).map(p => p.id)]);

  const buildings = {}, loaded = [];
  for (const p of unique) {
    let def;
    if (p.patch) {
      const base = existing(p.id);
      if (!base) { report.push({ file: p.file, id: p.id, error: `"patch" needs an existing building with id "${p.id}"` }); continue; }
      const { id: _drop, ...baseDef } = base;
      def = { ...baseDef, ...p.def, effects: p.def.effects ? { ...(baseDef.effects || {}), ...p.def.effects } : baseDef.effects };
      if (def.effects === undefined) delete def.effects;
    } else def = { ...p.def };
    const errors = validateDefinition(def, knownIds);
    if (errors.length) { report.push({ file: p.file, id: p.id, error: errors.join("; ") }); continue; }
    buildings[p.id] = def;
    loaded.push({ file: p.file, id: p.id, mode: p.patch ? "patch" : existing(p.id) ? "replace" : "new" });
  }
  return { buildings, report, loaded };
}

/** Materials a weekly attempt costs. Missing means 0 (decision D18). */
export const materialsPerWeek = def => Math.max(0, Math.trunc(Number(def?.materialsPerWeek) || 0));
