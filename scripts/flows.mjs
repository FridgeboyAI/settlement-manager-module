/**
 * What the GM (and the host GM's client) does with core's API: founding, building, attempts, upkeep, Work and the
 * Chronicle. Every change to core data is a core API call; every change to this module's data is one of our actions.
 */
import { ID, attemptKey, escapeHTML } from "./logic/const.mjs";
import { materialsPerWeek } from "./logic/buildings.mjs";
import { pendingBuilds, planAttempts, attemptResult, setbackResult, degreeLabel } from "./logic/construction.mjs";
import { computeUpkeep, upkeepText } from "./logic/upkeep.mjs";
import { workYield } from "./logic/work.mjs";
import { weekPageHTML, recapText, pageName, chronicleName } from "./logic/chronicle.mjs";
import { core, run, data, mainId, mainSettlement, building, resourceLabel, allHosts, hostInfo, isHost } from "./link.mjs";
import { parseFlat } from "./settings.mjs";
import * as Cards from "./chat.mjs";

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const notify = (msg, type = "info") => ui.notifications[type](`Settlement Manager: ${msg}`);
export async function log(kind, text, settlementId = mainId()) {
  if (!settlementId) return;
  try { await run("logEvent", { settlementId, kind, text }); } catch (e) { console.warn(`${ID} | could not log`, e); }
}
const materials = s => s?.resources?.materials?.amount ?? 0;

/* ---------------------------------------------------------------- settlement */
export async function found(name, sceneId, key) {
  const api = core();
  if (mainSettlement()) throw Error("There is already a settlement. v1 has one settlement.");
  const tile = api.getTile(sceneId, key);
  if (!tile) throw Error("That hex isn't in settlement-core yet. Save it in the tile tools first.");
  if (!tile.revealed) throw Error("That hex isn't revealed yet.");
  const id = await api.createSettlement(name || "Settlement", { sceneId, key });
  await game.settings.set(ID, "mainSettlementId", id);
  await log("founded", `${name || "The settlement"} was founded${tile.name ? ` at ${tile.name}` : ""}.`, id);
  await ensureChronicle(api.getSettlement(id));
  return id;
}

export async function deleteSettlement() {
  const s = mainSettlement(); if (!s) return;
  await core().request("settlement.delete", { id: s.id });
  await game.settings.set(ID, "mainSettlementId", "");
  notify(`${s.name} was deleted. Its Chronicle journal is kept.`);
}

export async function patchSettlement(patch, text) {
  const s = mainSettlement(); if (!s) return;
  await core().patchSettlement(s.id, patch);
  if (text) await log("stats", text);
}

export async function adjustResource(resource, delta, reason = "") {
  const s = mainSettlement(); if (!s || !delta) return;
  await core().adjustResource(s.id, resource, delta);
  await log("resources", `${resourceLabel(resource)} ${delta > 0 ? "+" : ""}${delta}${reason ? ` (${reason})` : ""}.`);
}

export async function setAccess(resource, access) {
  const s = mainSettlement(); if (!s) return;
  await core().setAccess(s.id, resource, access);
}

/* ---------------------------------------------------------------- building lists */
/** Access labels a building needs that the settlement doesn't have (core doesn't check these). */
export function missingAccess(def, settlement = mainSettlement()) {
  return (def?.needs || []).filter(n => !settlement?.resources?.[n]?.access);
}

/** Every building for a host, available or not, with the reason it isn't. */
export function buildList(host) {
  const api = core(), s = mainSettlement();
  return api.all("buildings").filter(b => (b.hosts || []).includes(host.kind)).map(b => {
    let { ok, reason } = api.canAttach(host, b.id);
    const lacks = missingAccess(b, s);
    if (ok && lacks.length) { ok = false; reason = `Needs access to ${lacks.map(resourceLabel).join(" and ")}`; }
    if (ok && !s) { ok = false; reason = "Found the settlement first"; }
    return { id: b.id, label: b.label || b.id, ok, reason: reason || "", cost: materialsPerWeek(b), weeks: weeksOf(b), dc: api.buildDC(b.id), text: b.text || "" };
  }).sort((a, b) => (b.ok - a.ok) || a.label.localeCompare(b.label));
}
const weeksOf = b => (b.weeks ? b.weeks : Math.max(1, Number(b.level ?? b.complexity ?? 1)));

/** Start a build: directly for the GM, as a request for a player. */
export async function startBuild(host, buildingId) {
  const def = building(buildingId);
  const s = mainSettlement();
  if (!s) throw Error("Found the settlement first.");
  const lacks = missingAccess(def, s);
  if (lacks.length) throw Error(`Needs access to ${lacks.map(resourceLabel).join(" and ")}.`);
  if (game.user.isGM) {
    await core().attach(host, buildingId);
    await log("build-start", `Started ${def?.label || buildingId} on ${hostInfo(host)?.label || "the map"}.`);
    return { status: "started" };
  }
  const check = core().canAttach(host, buildingId);
  if (!check.ok) throw Error(check.reason);
  const id = await run("requestBuild", { host, building: buildingId, settlementId: s.id });
  return { status: game.settings.get(ID, "playerBuildsNeedApproval") ? "requested" : "queued", id };
}

export async function approveRequest(requestId) {
  const req = await run("takeRequest", { id: requestId });
  const name = game.users.get(req.userId)?.name || "A player";
  if (req.kind === "build") {
    const def = building(req.building);
    const lacks = missingAccess(def);
    if (lacks.length) { notify(`Can't start ${def?.label}: needs access to ${lacks.join(", ")}.`, "warn"); return; }
    await core().attach(req.host, req.building);
    await log("build-start", `Started ${def?.label || req.building} on ${hostInfo(req.host)?.label || "the map"} (requested by ${name}).`);
  }
  return req;
}

export async function rejectRequest(requestId) {
  const req = await run("takeRequest", { id: requestId });
  const def = req.kind === "build" ? building(req.building) : null;
  await ChatMessage.create({
    content: `<div class="sm-card"><p>The GM declined ${def ? `the request to build <strong>${escapeHTML(def.label)}</strong>` : "the Work request"}.</p></div>`,
    whisper: [...new Set([req.userId, ...gmIds()])], speaker: { alias: "Settlement Manager" }
  });
  return req;
}

/* ---------------------------------------------------------------- GM overrides */
const slotOf = (host, slotId) => hostInfo(host)?.slots.find(s => s.id === slotId) || null;

export async function changeProgress(host, slotId, weeks) {
  const slot = slotOf(host, slotId); if (!slot?.pending) return;
  const res = await core().addProgress(host, slotId, weeks);
  const label = building(slot.pending.building)?.label || slot.pending.building;
  await log(res?.complete ? "build-complete" : "build-progress", res?.complete ? `${label} was finished by the GM.` : `${label}: progress set to ${res?.progress ?? "?"} of ${res?.needed ?? "?"} weeks by the GM.`);
}

export async function finishNow(host, slotId) {
  const slot = slotOf(host, slotId); if (!slot?.pending) return;
  await changeProgress(host, slotId, 999);
}

/** Cancel a pending build without refund. An upgrade in progress keeps the finished earlier level (core's cancelPending). */
export async function cancelBuild(host, slotId) {
  const slot = slotOf(host, slotId); if (!slot?.pending) return;
  const label = building(slot.pending.building)?.label || slot.pending.building;
  const result = await core().cancelPending(host, slotId);
  const kept = result === "kept" ? ` ${building(slot.built)?.label || slot.built} stays.` : "";
  await log("build-removed", `${label} was cancelled (no refund).${kept}`);
}

/** Remove a building outright, without refund (D7). */
export async function removeBuilding(host, slotId) {
  const slot = slotOf(host, slotId); if (!slot) return;
  const label = building(slot.built || slot.pending?.building)?.label || slot.built;
  await core().detach(host, slotId);
  await log("build-removed", `${label} was removed from ${hostInfo(host)?.label || "the map"} (no refund).`);
}

export const setDamaged = (host, slotId, damaged) => core().setDamaged(host, slotId, damaged);

/* ---------------------------------------------------------------- weekly attempts */
/** GM: spend Materials for this week's attempts and post a card for each (Resolution). */
export async function openAttempts() {
  const api = core(), s = mainSettlement();
  if (!s) throw Error("Found the settlement first.");
  const { week } = api.getClock();
  const { pub } = data();
  const pending = pendingBuilds(allHosts());
  const { plan, spent } = planAttempts(pending, building, materials(s), pub.attempts, week);
  if (!plan.length) { notify("No builds are waiting for an attempt this week."); return; }
  if (spent) await api.adjustResource(s.id, "materials", -spent);
  const items = plan.map(p => {
    const def = building(p.building);
    return { key: p.key, host: p.host, slotId: p.slotId, building: p.building, settlementId: s.id, cost: p.cost, dc: api.buildDC(p.building), skills: def?.skills || [], status: p.status, hostLabel: p.hostLabel };
  });
  await run("openAttempts", { items });
  for (const it of items) {
    const label = building(it.building)?.label || it.building;
    if (it.status === "short") { await log("build-progress", `${label}: no attempt, not enough Materials (needs ${it.cost}).`); continue; }
    const msg = await Cards.attemptCard({ ...it, label });
    await run("setAttemptMessage", { key: it.key, messageId: msg.id });
  }
  const shorts = items.filter(i => i.status === "short");
  if (spent) await log("resources", `Materials −${spent} for this week's construction.`);
  notify(`${items.length - shorts.length} attempt(s) opened${shorts.length ? `, ${shorts.length} short of Materials` : ""}.`);
}

let working = false;
/** Host only: apply attempts players (or the GM) have rolled. Runs whenever core's data changes. */
export async function applyRolledAttempts() {
  if (working || !isHost()) return;
  const { pub } = data();
  const rolled = Object.entries(pub.attempts).filter(([, a]) => a.status === "rolled");
  if (!rolled.length) return;
  working = true;
  try {
    for (const [key, at] of rolled) {
      try { await applyAttempt(key, at); }
      catch (e) { console.error(`${ID} | could not apply attempt`, e); notify(`Could not apply a build attempt: ${e.message}`, "error"); await run("finishAttempt", { key, result: `Error: ${e.message}` }).catch(() => {}); }
    }
  } finally { working = false; }
}

async function applyAttempt(key, at) {
  const api = core();
  const label = building(at.building)?.label || at.building;
  const who = at.actorName || game.users.get(at.by)?.name || "Someone";
  const r = attemptResult(at.degree, at.cost);
  const lines = [`${who}: ${degreeLabel(at.degree)} — ${r.text}.`];
  let complete = false;
  if (r.progress) {
    const res = await api.addProgress(at.host, at.slotId, r.progress);
    complete = !!res?.complete;
    lines.push(complete ? `${label} is finished!` : `Progress ${res?.progress} of ${res?.needed} weeks.`);
  }
  if (r.refund) await api.adjustResource(at.settlementId, "materials", r.refund);
  if (r.setback) {
    const roll = await new Roll("1d6").evaluate();
    await roll.toMessage({ speaker: { alias: "Settlement Manager" }, flavor: `Setback for ${escapeHTML(label)}` }, { rollMode: "publicroll" });
    const s = api.getSettlement(at.settlementId);
    const sb = setbackResult(roll.total, materials(s));
    if (sb.materials) await api.adjustResource(at.settlementId, "materials", -sb.materials);
    if (sb.weeks) { try { await api.addProgress(at.host, at.slotId, sb.weeks); } catch (e) { /* the slot may have no pending build any more */ } }
    lines.push(`(${roll.total}) ${sb.text}`);
    await log("build-setback", `${label}: ${sb.text}`, at.settlementId);
  }
  const text = lines.join(" ");
  await run("finishAttempt", { key, result: text });
  await log(complete ? "build-complete" : "build-progress", `${label}: ${text}`, at.settlementId);
  await Cards.refreshAttemptCard(at.messageId);
}

/* ---------------------------------------------------------------- upkeep */
export function upkeepFor(s = mainSettlement()) {
  const stock = Object.fromEntries(Object.entries(s?.resources || {}).map(([k, v]) => [k, v.amount]));
  return computeUpkeep({ population: s?.population || 0, rationsPerPop: game.settings.get(ID, "upkeepRationsPerPop"), flat: parseFlat(game.settings.get(ID, "upkeepFlat")), stock });
}

export async function applyUpkeep(planned) {
  const s = mainSettlement(); if (!s) return;
  // Stocks may have changed since the card was posted: pay from what is there now.
  const lines = planned.map(l => {
    const stock = s.resources?.[l.resource]?.amount ?? 0, pay = Math.min(stock, l.cost);
    return { ...l, stock, pay, shortage: l.cost - pay };
  });
  for (const l of lines) if (l.pay > 0) await core().adjustResource(s.id, l.resource, -l.pay);
  const labels = Object.fromEntries(lines.map(l => [l.resource, resourceLabel(l.resource)]));
  await log("upkeep", upkeepText(lines, labels));
  const short = lines.filter(l => l.shortage > 0);
  if (short.length) await log("upkeep", `Shortage: ${short.map(l => `${l.shortage} ${labels[l.resource]}`).join(", ")} could not be paid (the GM decides what that means).`);
}

/* ---------------------------------------------------------------- Work */
/** Roll the yield die and add the yield to the settlement. Returns the yield. */
export async function recordWork({ label, die, degree, bonusResources = 0, resource }) {
  const s = mainSettlement(); if (!s) throw Error("Found the settlement first.");
  let total = 0;
  if (degree === "success" || degree === "criticalSuccess") {
    const roll = await new Roll(`1${die}`).evaluate();
    await roll.toMessage({ speaker: { alias: "Settlement Manager" }, flavor: `Work yield: ${escapeHTML(label)}` });
    total = roll.total;
  }
  const amount = workYield(degree, total, bonusResources);
  if (!resource) {
    // Yields specific items, not a stock: the GM hands them out.
    await log("work", `Work on ${label}: ${degreeLabel(degree)}${amount ? `, ${amount} item(s) for the GM to hand out` : ", no yield"}.`);
    return amount;
  }
  if (amount) await core().adjustResource(s.id, resource, amount);
  await log("work", `Work on ${label}: ${degreeLabel(degree)}, ${amount ? `+${amount} ${resourceLabel(resource)}` : "no yield"}${degree === "criticalSuccess" && amount ? " (doubled)" : ""}.`);
  return amount;
}

/* ---------------------------------------------------------------- Chronicle and Week End */
export async function ensureChronicle(s) {
  if (!s) return null;
  const { pub } = data();
  let entry = pub.chronicles[s.id] ? await fromUuid(pub.chronicles[s.id]).catch(() => null) : null;
  if (!entry) {
    entry = await JournalEntry.create({
      name: chronicleName(s.name),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { [ID]: { chronicle: s.id } }
    });
    await run("setChronicle", { settlementId: s.id, uuid: entry.uuid });
  }
  return entry;
}

export async function closeWeek() {
  const s = mainSettlement(); if (!s) return;
  const { week } = core().getClock();
  const events = await run("takeWeek", { settlementId: s.id });
  const entry = await ensureChronicle(s);
  const name = pageName(week);
  const html = weekPageHTML(week, events || []);
  const existing = entry.pages.find(p => p.name === name);
  if (existing) await existing.update({ "text.content": `${existing.text.content || ""}\n${html}` });
  else await entry.createEmbeddedDocuments("JournalEntryPage", [{ name, type: "text", text: { content: html }, sort: week * 100 }]);
  await ChatMessage.create({
    content: `<div class="sm-card"><h3>${escapeHTML(s.name)}: ${escapeHTML(name)} ends</h3><p>${escapeHTML(recapText(events || []))}</p><p>${entry.link ?? `@UUID[${entry.uuid}]{${escapeHTML(entry.name)}}`}</p></div>`,
    speaker: { alias: "Settlement Manager" }
  });
}

/* ---------------------------------------------------------------- phase reactions (host only) */
export async function onPhase({ phase, week, newWeek }) {
  if (!isHost()) return;
  const s = mainSettlement(); if (!s) return;
  try {
    if (phase === "upkeep") {
      await run("pruneAttempts");
      await Cards.upkeepCard(s, upkeepFor(s));
      const need = pendingBuilds(allHosts()).reduce((n, p) => n + materialsPerWeek(building(p.building)), 0);
      if (need) await Cards.gmNote(`Pending builds will need ${need} Materials this week (stock ${materials(s)}).${need > materials(s) ? " Some will be short." : ""}`);
    } else if (phase === "assignment") {
      const n = pendingBuilds(allHosts()).length;
      if (n) await Cards.gmNote(`Assignment: ${n} build(s) are pending. Attempts open in Resolution.`);
    } else if (phase === "resolution") {
      await Cards.openAttemptsCard(week);
    } else if (phase === "weekEnd") {
      await closeWeek();
    }
  } catch (e) {
    console.error(`${ID} | phase ${phase}`, e);
    notify(`Something went wrong in the ${phase} phase: ${e.message}`, "error");
  }
}

/** Host only: when player builds don't need approval, start them as they come in. */
export async function autoApprove() {
  if (!isHost() || game.settings.get(ID, "playerBuildsNeedApproval")) return;
  const { gm } = data();
  for (const req of gm.requests.filter(r => r.kind === "build")) {
    try { await approveRequest(req.id); } catch (e) { notify(`Could not start a requested build: ${e.message}`, "warn"); }
  }
}

export { attemptKey };
