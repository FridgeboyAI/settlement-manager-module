/** Startup check of settlement-core's API (decision D6): which calls exist, and which features must be turned off. */
import { CORE_MIN_VERSION, compareVersions } from "./const.mjs";

/** API calls each feature needs. A missing call turns off only the features that list it. */
export const FEATURE_NEEDS = {
  settlement: ["getSettlement", "getSettlements", "createSettlement", "patchSettlement", "request"],
  stats: ["tileSecurity", "isSecure", "builtOn", "get"],
  buildings: ["define", "all", "get", "canAttach", "attach", "addProgress", "detach", "cancelPending", "buildDC", "builtOn"],
  resources: ["adjustResource", "setAccess"],
  work: ["workProfile", "activityDC", "getTile", "adjustResource"],
  week: ["getClock", "advancePhase", "request"],
  moduleData: ["getModuleData", "registerAction", "request"]
};

/** Fields on core data we read. Checked against a sample settlement / slot when one exists. */
export const SETTLEMENT_FIELDS = ["id", "name", "home", "resources", "morale", "population", "slots"];
export const SLOT_FIELDS = ["id", "built", "pending", "damaged"];

/**
 * Check a core API object. Returns { ok, versionOk, version, missing: [name], disabled: [feature] }.
 * `ok` is false only when core is missing entirely; otherwise individual features are disabled.
 */
export function checkCoreApi(api) {
  if (!api || typeof api !== "object") return { ok: false, versionOk: false, version: "", missing: ["api"], disabled: Object.keys(FEATURE_NEEDS) };
  const version = String(api.version || "");
  const versionOk = compareVersions(version, CORE_MIN_VERSION) >= 0;
  const all = new Set(Object.values(FEATURE_NEEDS).flat());
  const missing = [...all].filter(name => typeof api[name] !== "function").sort();
  const disabled = Object.entries(FEATURE_NEEDS).filter(([, needs]) => needs.some(n => missing.includes(n))).map(([f]) => f);
  return { ok: true, versionOk, version, missing, disabled };
}

/** Check that a core record has the fields we rely on. Returns the names of missing fields. */
export function missingFields(record, fields) {
  if (!record || typeof record !== "object") return [];
  return fields.filter(f => !(f in record));
}
