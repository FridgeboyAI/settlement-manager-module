/** Weekly upkeep (decision D12): 1 Ration per population by default, plus optional flat costs. No Foundry dependency. */

/**
 * @param population
 * @param rationsPerPop  setting, default 1
 * @param flat           { resourceId: amount } extra weekly costs
 * @param stock          { resourceId: amount } current stocks
 * @returns { lines: [{ resource, cost, stock, pay, shortage }], shortage: bool }
 */
export function computeUpkeep({ population = 0, rationsPerPop = 1, flat = {}, stock = {} }) {
  const costs = {};
  const add = (r, n) => { const v = Math.max(0, Math.trunc(Number(n) || 0)); if (v) costs[r] = (costs[r] || 0) + v; };
  add("rations", population * rationsPerPop);
  for (const [r, n] of Object.entries(flat || {})) add(r, n);
  const lines = Object.entries(costs).map(([resource, cost]) => {
    const have = Math.max(0, Math.trunc(Number(stock[resource]) || 0));
    const pay = Math.min(have, cost);
    return { resource, cost, stock: have, pay, shortage: cost - pay };
  });
  return { lines, shortage: lines.some(l => l.shortage > 0) };
}

/** Apply edited costs (the GM's Edit button) to the same stocks. */
export function editUpkeep(lines, edits) {
  return lines.map(l => {
    const cost = Math.max(0, Math.trunc(Number(edits?.[l.resource] ?? l.cost) || 0));
    const pay = Math.min(l.stock, cost);
    return { ...l, cost, pay, shortage: cost - pay };
  });
}

export function upkeepText(lines, labels = {}) {
  if (!lines.length) return "No upkeep due.";
  return lines.map(l => {
    const name = labels[l.resource] || l.resource;
    return l.shortage
      ? `${name}: −${l.pay} of ${l.cost} (stock ${l.stock} → 0, shortage of ${l.shortage})`
      : `${name}: −${l.cost} (stock ${l.stock} → ${l.stock - l.cost})`;
  }).join("; ");
}
