/** Shared constants. No Foundry dependency. */
export const ID = "settlement-manager";
export const CORE_ID = "settlement-core";
export const CORE_MIN_VERSION = "0.2.0";

/** PF2e degrees of success, indexed by the system's numeric degree (0 = critical failure ... 3 = critical success). */
export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
export const DEGREE_LABELS = {
  criticalFailure: "Critical Failure", failure: "Failure", success: "Success", criticalSuccess: "Critical Success"
};

/** Building fields this module understands (core's building shape plus GM-file extras). */
export const HOST_KINDS = ["settlement", "tile", "discoverable"];
export const EFFECT_KEYS = [
  "security", "houses", "morale", "travelDC", "travelExploreBonus", "yieldStep", "workDC", "workBonus",
  "workDie", "produces", "bonusResources", "eventSeverityStep"
];
export const DICE = ["d4", "d6", "d8", "d10", "d12"];

/** Kinds of events that end up in the weekly Chronicle, in the order they are listed on a page. */
export const EVENT_KINDS = ["founded", "upkeep", "build-start", "build-progress", "build-complete", "build-setback",
  "build-removed", "work", "resources", "stats", "note"];

export const escapeHTML = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clampInt = (v, min = 0, max = 999999999) => Math.max(min, Math.min(max, Math.trunc(Number(v) || 0)));
export const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/** Compare "a.b.c" version strings. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(n => parseInt(n, 10) || 0), pb = String(b || "0").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** A stable key for a host reference, used to key attempts. */
export function hostKey(host) {
  if (!host) return "";
  if (host.kind === "settlement") return `settlement:${host.id}`;
  if (host.kind === "tile") return `tile:${host.sceneId}:${host.key}`;
  if (host.kind === "discoverable") return `discoverable:${host.sceneId}:${host.key}:${host.id}`;
  return "";
}
export const attemptKey = (host, slotId) => `${hostKey(host)}|${slotId}`;
