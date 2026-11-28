/**
 * Settlement stats (spec §5, decisions D9 and D19). Stored values come from core and change only by GM edit;
 * everything a building adds is calculated here on the fly. No Foundry dependency.
 */
const sumEffect = (defs, key) => defs.reduce((n, d) => n + (Number(d?.effects?.[key]) || 0), 0);
const lines = (defs, key, where) => defs.filter(d => Number(d?.effects?.[key])).map(d => ({ label: d.label || d.id, value: Number(d.effects[key]), where }));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const LEADER_NOTE = "Leaders: + half each Leader's level (from settlement-teams, not counted yet)";

/**
 * @param settlement   core settlement record
 * @param settlementBuilt  finished, undamaged building definitions in the settlement's slots
 * @param homeBuilt    finished, undamaged building definitions on the home tile
 * @param tileSecurity core.tileSecurity(home) — already includes both lists' security
 * @param isSecure     core.isSecure
 */
export function computeStats({ settlement, settlementBuilt = [], homeBuilt = [], tileSecurity = 0, isSecure = (s, p) => s >= p && s > 0 }) {
  const population = Math.max(0, Number(settlement?.population) || 0);
  const housingLines = [...lines(settlementBuilt, "houses", "settlement"), ...lines(homeBuilt, "houses", "home tile")];
  const housing = sumEffect(settlementBuilt, "houses") + sumEffect(homeBuilt, "houses");

  const moraleBase = Number(settlement?.morale) || 0;
  const moraleLines = [...lines(settlementBuilt, "morale", "settlement"), ...lines(homeBuilt, "morale", "home tile")];
  const moraleBonus = sumEffect(settlementBuilt, "morale") + sumEffect(homeBuilt, "morale");
  const morale = clamp(moraleBase + moraleBonus, -10, 10);

  const security = Number(tileSecurity) || 0;
  const securityLines = settlement?.home
    ? [...lines(homeBuilt, "security", "home tile"), ...lines(settlementBuilt, "security", "settlement")]
    : [];
  const secure = !!isSecure(security, population);

  const warnings = [];
  if (population > housing) warnings.push({ id: "overCapacity", text: `Over capacity: ${population} people, housing for ${housing}.` });
  if (!secure) warnings.push({ id: "notSecure", text: `Not secure: Security ${security} against population ${population}.` });
  if (!settlement?.home) warnings.push({ id: "noHome", text: "No home hex: Security from the map can't be counted." });

  return {
    population, housing, housingLines,
    moraleBase, moraleBonus, morale, moraleLines,
    security, securityLines, leaderNote: LEADER_NOTE, secure,
    warnings
  };
}

/** A one-line breakdown for a tooltip, e.g. "Security 25 = Shelter I 5 + Portal Hall 20". */
export function breakdown(name, total, parts, extra = []) {
  const body = parts.length ? parts.map(p => `${p.label} ${p.value >= 0 ? "" : ""}${p.value}`).join(" + ") : "nothing";
  return [`${name} ${total} = ${body}`, ...extra].join("\n");
}
