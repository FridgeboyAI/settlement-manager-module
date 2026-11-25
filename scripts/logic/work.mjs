/** Record Work (spec §7): what can be worked on a hex, and the yield. No Foundry dependency. */

/**
 * Workable things on a tile.
 * @param tile  core tile (full or player copy)
 * @param getBuilding (id) => building definition
 * @param getDiscoverable (type) => discoverable definition
 * @returns [{ kind: "discoverable", ref, label, resource } | { kind: "building", label, die, resource, bonusResources }]
 */
export function workTargets({ tile, sceneId, getBuilding, getDiscoverable }) {
  if (!tile) return [];
  const out = [];
  for (const d of tile.discoverables || []) {
    if (!d.found) continue;
    const def = getDiscoverable(d.type) || {};
    if (def.workable === false) continue;
    out.push({ kind: "discoverable", ref: { sceneId, key: tile.key, id: d.id }, label: d.name || def.label || d.type, resource: resourceOf(def) });
  }
  for (const slot of tile.slots || []) {
    if (!slot.built || slot.damaged) continue;
    const def = getBuilding(slot.built);
    const die = def?.effects?.workDie;
    if (!die) continue;
    out.push({ kind: "building", slotId: slot.id, label: def.label || slot.built, die, resource: def.effects.produces || "materials", bonusResources: Number(def.effects.bonusResources) || 0 });
  }
  return out;
}

/**
 * What Working a discoverable yields: its `produces` (core 0.2.1+): a resource id, or "" when it yields specific items
 * rather than a stock (core's null). Older definitions without `produces` fall back to Rations for food, else Materials.
 */
export function resourceOf(def) {
  if (def && "produces" in def) return def.produces ?? "";
  return def?.food ? "rations" : "materials";
}

/** The work profile of a tile building (core's workProfile covers only resources). */
export const buildingProfile = (target, workDC) => ({ die: target.die, dc: workDC, checkBonus: 0, bonusResources: target.bonusResources || 0 });

/** Yield from a Work result: success = die + bonus; critical success doubles it (decided 2026-11-25). */
export function workYield(degree, dieTotal, bonusResources = 0) {
  const base = Math.max(0, Math.trunc(Number(dieTotal) || 0)) + Math.max(0, Math.trunc(Number(bonusResources) || 0));
  if (degree === "criticalSuccess") return base * 2;
  if (degree === "success") return base;
  return 0;
}
