/** Weekly construction attempts (spec §6.2, decision D11). No Foundry dependency. */
import { DEGREES, DEGREE_LABELS, attemptKey } from "./const.mjs";
import { materialsPerWeek } from "./buildings.mjs";

/** All pending builds on a list of hosts: [{ host, hostLabel, slotId, building, progress, upgrading }]. */
export function pendingBuilds(hosts) {
  const out = [];
  for (const h of hosts) for (const slot of h.slots || []) {
    if (slot.pending?.building) out.push({ host: h.host, hostLabel: h.label, slotId: slot.id, building: slot.pending.building, progress: slot.pending.progress || 0, upgrading: !!slot.built });
  }
  return out;
}

/**
 * Plan this week's attempts. Materials are taken in list order; a build that can't be paid is "short" and keeps its
 * progress. Builds that already have an attempt this week are left out.
 * @returns [{ ...pending, key, cost, status: "open" | "short" }], plus the total spent
 */
export function planAttempts(pending, getDef, materials, attempts = {}, week = 0) {
  let left = Math.max(0, Number(materials) || 0), spent = 0;
  const plan = [];
  for (const p of pending) {
    const key = attemptKey(p.host, p.slotId);
    if (attempts[key]?.week === week) continue;
    const cost = materialsPerWeek(getDef(p.building));
    if (cost > left) { plan.push({ ...p, key, cost, status: "short" }); continue; }
    left -= cost; spent += cost;
    plan.push({ ...p, key, cost, status: "open" });
  }
  return { plan, spent };
}

/** Turn the PF2e numeric degree (0–3) or a degree name into a degree name. */
export function degreeName(d) {
  if (typeof d === "number") return DEGREES[Math.max(0, Math.min(3, Math.trunc(d)))];
  return DEGREES.includes(d) ? d : null;
}

/** What a degree of success does to a build: { progress, refund, setback, text }. */
export function attemptResult(degree, cost) {
  switch (degree) {
    case "criticalSuccess": return { progress: 1, refund: cost > 0 ? 1 : 0, setback: false, text: cost > 0 ? "+1 week and 1 Materials refunded" : "+1 week" };
    case "success": return { progress: 1, refund: 0, setback: false, text: "+1 week" };
    case "failure": return { progress: 0, refund: 0, setback: false, text: "No progress" };
    case "criticalFailure": return { progress: 0, refund: 0, setback: true, text: "No progress, and a setback (1d6)" };
    default: throw Error(`Unknown degree "${degree}"`);
  }
}

/**
 * The 1d6 setback chart. `materials` is what the settlement has left.
 * @returns { kind: "text" | "materials" | "week", materials, weeks, text }
 */
export function setbackResult(d6, materials) {
  const n = Math.trunc(Number(d6));
  if (n < 1 || n > 6) throw Error("A setback needs a d6 result");
  if (n <= 3) return { kind: "text", materials: 0, weeks: 0, text: "Setback: the Team suffers 1 Injury or a PC takes 1d6 damage (GM applies)." };
  if (n <= 5) {
    return materials >= 1
      ? { kind: "materials", materials: 1, weeks: 0, text: "Setback: 1 extra Materials spent." }
      : { kind: "text", materials: 0, weeks: 0, text: "Setback: 1 extra Materials is due, but there are none left (GM decides)." };
  }
  return { kind: "week", materials: 0, weeks: -1, text: "Setback: the project loses 1 week of progress." };
}

export const degreeLabel = d => DEGREE_LABELS[d] || d;
