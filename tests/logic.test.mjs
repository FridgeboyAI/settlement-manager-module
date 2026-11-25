import { test } from "node:test";
import assert from "node:assert/strict";
import * as Core from "./.core/core.mjs";
import { LIFTLAND } from "./.core/content-liftland.mjs";
import { ID, attemptKey, compareVersions } from "../scripts/logic/const.mjs";
import { checkCoreApi, missingFields, SETTLEMENT_FIELDS } from "../scripts/logic/check.mjs";
import { parseBuildingFile, combineBuildingFiles, validateDefinition, materialsPerWeek } from "../scripts/logic/buildings.mjs";
import { computeStats } from "../scripts/logic/stats.mjs";
import { pendingBuilds, planAttempts, attemptResult, mishapResult, degreeName } from "../scripts/logic/construction.mjs";
import { computeUpkeep, editUpkeep, upkeepText } from "../scripts/logic/upkeep.mjs";
import { workTargets, workYield, resourceOf, buildingProfile } from "../scripts/logic/work.mjs";
import { weekPageHTML, recapText, pageName } from "../scripts/logic/chronicle.mjs";
import { createActions, moduleData } from "../scripts/logic/data.mjs";

const reg = () => Core.createRegistry().defineAll(LIFTLAND);
const gmCtx = r => ({ reg: r, isGM: true, userId: "gm1" });
const playerCtx = r => ({ reg: r, isGM: false, userId: "p1" });

function world() {
  const r = reg();
  const s = Core.blankState();
  s.settlements.main = Core.blankSettlement("main", "Haven", r);
  s.settlements.main.home = { sceneId: "sc", key: "3,4" };
  s.settlements.main.population = 10;
  const t = Core.ensureTile(s, "sc", "3,4"); t.revealed = true; t.terrain = "grassland";
  return { r, s };
}

/* ---------------------------------------------------------------- const and check */
test("compareVersions orders dotted versions", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.10.0", "0.2.0"), 1);
  assert.equal(compareVersions("0.1.9", "0.2"), -1);
});

test("checkCoreApi disables only features whose calls are missing", () => {
  const api = { version: "0.2.1" };
  for (const n of ["getSettlement", "getSettlements", "createSettlement", "patchSettlement", "request", "getClock", "advancePhase",
    "getModuleData", "registerAction", "tileSecurity", "isSecure", "builtOn", "get", "define", "all", "canAttach", "attach",
    "addProgress", "detach", "cancelPending", "buildDC", "adjustResource", "setAccess", "workProfile", "activityDC", "getTile", "tileDCs"]) api[n] = () => {};
  let r = checkCoreApi(api);
  assert.deepEqual(r.disabled, []); assert.ok(r.versionOk);
  delete api.workProfile;
  r = checkCoreApi(api);
  assert.deepEqual(r.disabled, ["work"]); assert.deepEqual(r.missing, ["workProfile"]);
  assert.equal(checkCoreApi({ ...api, version: "0.2.0" }).versionOk, false, "0.2.1 is the minimum");
  assert.equal(checkCoreApi(null).ok, false);
});

test("missingFields finds fields core no longer has", () => {
  const { s } = world();
  assert.deepEqual(missingFields(s.settlements.main, SETTLEMENT_FIELDS), []);
  const { morale, ...rest } = s.settlements.main;
  assert.deepEqual(missingFields(rest, SETTLEMENT_FIELDS), ["morale"]);
});

/* ---------------------------------------------------------------- building files */
test("a building file is parsed and checked", () => {
  assert.equal(parseBuildingFile("a.json", "{nope").ok, false);
  assert.match(parseBuildingFile("a.json", "[]").error, /one JSON object/);
  assert.match(parseBuildingFile("a.json", '{"id":"Bad Id"}').error, /id/);
  assert.match(parseBuildingFile("a.json", '{"id":"x","colour":"red"}').error, /Unknown field/);
  const ok = parseBuildingFile("a.json", '{"id":"x","label":"X","complexity":1,"hosts":["settlement"]}');
  assert.equal(ok.ok, true); assert.equal(ok.patch, false);
});

test("validateDefinition reports every problem", () => {
  const errs = validateDefinition({ hosts: ["castle"], effects: { morale: "lots", sparkle: 1, workDie: "d7" }, requires: "nope" });
  assert.ok(errs.some(e => /label/.test(e)));
  assert.ok(errs.some(e => /complexity/.test(e)));
  assert.ok(errs.some(e => /hosts/.test(e)));
  assert.ok(errs.some(e => /morale/.test(e)));
  assert.ok(errs.some(e => /sparkle/.test(e)));
  assert.ok(errs.some(e => /workDie/.test(e)));
  assert.ok(errs.some(e => /requires/.test(e)));
  assert.deepEqual(validateDefinition({ label: "Ok", level: 2, hosts: ["tile"], effects: { workDie: "d6", produces: "rations", security: 2 } }), []);
});

test("combineBuildingFiles adds, replaces, patches and reports", () => {
  const r = reg();
  const existing = id => r.get("buildings", id);
  const ids = r.all("buildings").map(b => b.id);
  const files = [
    { name: "smithy.json", text: JSON.stringify({ id: "smithy-1", label: "Smithy", complexity: 1, hosts: ["settlement"], skills: ["crafting"] }) },
    { name: "palisade.json", text: JSON.stringify({ id: "palisade-2", patch: true, materialsPerWeek: 2, effects: { security: 3 } }) },
    { name: "watch.json", text: JSON.stringify({ id: "watchpost-1", label: "Watch", complexity: 1, hosts: ["settlement"] }) },
    { name: "bad.json", text: "{" },
    { name: "ghost.json", text: JSON.stringify({ id: "ghost", patch: true, materialsPerWeek: 1 }) },
    { name: "dupe.json", text: JSON.stringify({ id: "smithy-1", label: "Again", complexity: 1, hosts: ["settlement"] }) },
    { name: "upgrade.json", text: JSON.stringify({ id: "smithy-2", label: "Smithy II", complexity: 2, hosts: ["settlement"], requires: "smithy-1" }) }
  ];
  const { buildings, report, loaded } = combineBuildingFiles(files, existing, ids);
  assert.deepEqual(Object.keys(buildings).sort(), ["palisade-2", "smithy-1", "smithy-2", "watchpost-1"]);
  assert.equal(buildings["palisade-2"].materialsPerWeek, 2);
  assert.equal(buildings["palisade-2"].effects.eventSeverityStep, 1, "patch keeps existing effects");
  assert.equal(buildings["palisade-2"].effects.security, 3);
  assert.equal(buildings["palisade-2"].label, "Palisade II");
  assert.equal(buildings["watchpost-1"].label, "Watch");
  assert.equal(loaded.find(l => l.id === "watchpost-1").mode, "replace");
  assert.equal(loaded.find(l => l.id === "palisade-2").mode, "patch");
  assert.equal(loaded.find(l => l.id === "smithy-1").mode, "new");
  assert.equal(report.length, 3);
  assert.ok(report.some(x => x.file === "bad.json"));
  assert.ok(report.some(x => x.file === "ghost.json" && /existing building/.test(x.error)));
  assert.ok(report.some(x => x.file === "dupe.json"));
});

test("materialsPerWeek is 0 when a building has none", () => {
  const r = reg();
  assert.equal(materialsPerWeek(r.get("buildings", "workshop-1")), 0);
  assert.equal(materialsPerWeek(r.get("buildings", "yield-2")), 2);
});

/* ---------------------------------------------------------------- stats */
test("stats: housing, morale and Security from core, with no double counting", () => {
  const { r, s } = world();
  s.settlements.main.morale = 2;
  Core.attach(s, r, { kind: "settlement", id: "main" }, "portal-hall", { complete: true });
  Core.attach(s, r, { kind: "settlement", id: "main" }, "common-hall-2", { complete: true });
  Core.attach(s, r, { kind: "tile", sceneId: "sc", key: "3,4" }, "shelter-1", { complete: true });
  const settlementBuilt = Core.builtOn(s.settlements.main, r);
  const homeBuilt = Core.builtOn(Core.getTile(s, "sc", "3,4"), r);
  const tileSecurity = Core.tileSecurity(s, r, "sc", "3,4");
  const st = computeStats({ settlement: s.settlements.main, settlementBuilt, homeBuilt, tileSecurity, isSecure: Core.isSecure });
  assert.equal(st.housing, 24);
  assert.equal(st.morale, 3);
  assert.equal(st.moraleBase, 2);
  assert.equal(st.security, 25, "Portal Hall 20 + Shelter 5, counted once");
  assert.equal(st.securityLines.reduce((n, l) => n + l.value, 0), 25);
  assert.equal(st.secure, true);
  assert.deepEqual(st.warnings, []);
  assert.match(st.leaderNote, /not counted/);
});

test("stats: removing a building leaves no stale bonus, and warnings appear", () => {
  const { r, s } = world();
  s.settlements.main.population = 30;
  const slotId = Core.attach(s, r, { kind: "settlement", id: "main" }, "portal-hall", { complete: true });
  Core.detach(s, { kind: "settlement", id: "main" }, slotId);
  const st = computeStats({ settlement: s.settlements.main, settlementBuilt: Core.builtOn(s.settlements.main, r), homeBuilt: [], tileSecurity: Core.tileSecurity(s, r, "sc", "3,4"), isSecure: Core.isSecure });
  assert.equal(st.housing, 0); assert.equal(st.security, 0);
  assert.deepEqual(st.warnings.map(w => w.id), ["overCapacity", "notSecure"]);
});

test("stats: morale is capped to -10..10", () => {
  const st = computeStats({ settlement: { morale: 10, population: 0, home: null }, settlementBuilt: [{ effects: { morale: 3 } }] });
  assert.equal(st.morale, 10);
});

/* ---------------------------------------------------------------- construction */
test("planAttempts spends Materials in order and marks shortages", () => {
  const { r, s } = world();
  const t = Core.getTile(s, "sc", "3,4");
  t.discoverables.push({ ...Core.blankDiscoverable(), id: "d1", type: "grain-grass-stand", tier: 4, found: true });
  Core.attach(s, r, { kind: "settlement", id: "main" }, "workshop-1");
  Core.attach(s, r, { kind: "discoverable", sceneId: "sc", key: "3,4", id: "d1" }, "yield-1", { complete: true });
  Core.attach(s, r, { kind: "discoverable", sceneId: "sc", key: "3,4", id: "d1" }, "yield-2");
  const pending = pendingBuilds([
    { host: { kind: "settlement", id: "main" }, label: "Haven", slots: s.settlements.main.slots },
    { host: { kind: "discoverable", sceneId: "sc", key: "3,4", id: "d1" }, label: "Grain", slots: t.discoverables[0].slots }
  ]);
  assert.equal(pending.length, 2);
  const get = id => r.get("buildings", id);
  let { plan, spent } = planAttempts(pending, get, 1);
  assert.deepEqual(plan.map(p => [p.building, p.cost, p.status]), [["workshop-1", 0, "open"], ["yield-2", 2, "short"]]);
  assert.equal(spent, 0);
  ({ plan, spent } = planAttempts(pending, get, 5));
  assert.deepEqual(plan.map(p => p.status), ["open", "open"]); assert.equal(spent, 2);
  const done = { [attemptKey(pending[0].host, pending[0].slotId)]: { week: 3 } };
  ({ plan } = planAttempts(pending, get, 5, done, 3));
  assert.equal(plan.length, 1, "one attempt per build per week");
});

test("attempt results and the shared Mishap d6", () => {
  assert.deepEqual(attemptResult("criticalSuccess", 2), { progress: 1, refund: 1, setback: false, text: "+1 week and 1 Materials refunded" });
  assert.equal(attemptResult("criticalSuccess", 0).refund, 0);
  assert.equal(attemptResult("success", 2).progress, 1);
  assert.equal(attemptResult("failure", 2).progress, 0);
  assert.equal(attemptResult("criticalFailure", 2).setback, true);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => mishapResult(n).kind), ["injury", "injury", "access", "access", "encounter", "encounter"]);
  assert.match(mishapResult(1).text, /2 Injuries/);
  assert.throws(() => mishapResult(7));
  assert.equal(degreeName(3), "criticalSuccess"); assert.equal(degreeName(0), "criticalFailure"); assert.equal(degreeName("nope"), null);
});

test("a 2-week building finishes through core after two successes", () => {
  const { r, s } = world();
  const host = { kind: "settlement", id: "main" };
  const slotId = Core.attach(s, r, host, "granary-2");
  assert.equal(Core.weeksFor(r.get("buildings", "granary-2")), 2);
  Core.addProgress(s, r, host, slotId, attemptResult("criticalFailure", 0).progress);
  assert.equal(s.settlements.main.slots[0].pending.progress, 0);
  Core.addProgress(s, r, host, slotId, attemptResult("success", 0).progress);
  const res = Core.addProgress(s, r, host, slotId, attemptResult("criticalSuccess", 0).progress);
  assert.equal(res.complete, true); assert.equal(s.settlements.main.slots[0].built, "granary-2");
});

/* ---------------------------------------------------------------- upkeep and work */
test("upkeep: 1 Ration per population, shortages only warn", () => {
  let u = computeUpkeep({ population: 12, stock: { rations: 20 } });
  assert.deepEqual(u.lines, [{ resource: "rations", cost: 12, stock: 20, pay: 12, shortage: 0 }]);
  assert.equal(u.shortage, false);
  u = computeUpkeep({ population: 12, stock: { rations: 9 }, flat: { supplies: 1 } });
  assert.equal(u.lines[0].shortage, 3); assert.equal(u.lines[0].pay, 9);
  assert.equal(u.lines[1].resource, "supplies"); assert.equal(u.lines[1].pay, 0);
  assert.equal(u.shortage, true);
  assert.match(upkeepText(u.lines, { rations: "Rations" }), /Rations: −9 of 12 \(stock 9 → 0, shortage of 3\)/);
  const e = editUpkeep(u.lines, { rations: 5 });
  assert.equal(e[0].pay, 5); assert.equal(e[0].shortage, 0);
  assert.equal(computeUpkeep({ population: 0 }).lines.length, 0);
});

test("work targets and yields (GM rulings)", () => {
  const { r, s } = world();
  const t = Core.getTile(s, "sc", "3,4");
  t.discoverables.push({ ...Core.blankDiscoverable(), id: "d1", type: "grain-grass-stand", name: "Grain", tier: 1, found: true });
  t.discoverables.push({ ...Core.blankDiscoverable(), id: "d2", type: "ridge-runner-territory", tier: 1, found: true });
  t.discoverables.push({ ...Core.blankDiscoverable(), id: "d3", type: "clay-deposit", tier: 1, found: false });
  Core.attach(s, r, { kind: "tile", sceneId: "sc", key: "3,4" }, "farm-1", { complete: true });
  const targets = workTargets({ tile: t, sceneId: "sc", getBuilding: id => r.get("buildings", id), getDiscoverable: id => r.get("discoverables", id) });
  assert.deepEqual(targets.map(x => [x.kind, x.label, x.resource]), [["discoverable", "Grain", "rations"], ["building", "Farm I", "rations"]]);
  assert.equal(targets[1].die, "d4");
  assert.deepEqual(workYield("success", 3, 1), { main: 3, bonus: 1 });
  assert.deepEqual(workYield("criticalSuccess", 3, 1), { main: 6, bonus: 2 }, "doubles the die and the bonus");
  assert.deepEqual(workYield("failure", 5, 1), { main: 2, bonus: 0 }, "half the die, no bonus");
  assert.deepEqual(workYield("failure", 1, 0), { main: 1, bonus: 0 }, "minimum 1");
  assert.deepEqual(workYield("criticalFailure", 6, 1), { main: 0, bonus: 0 });
  assert.equal(buildingProfile({ die: "d4" }, 25, true).dc, 23, "Fully Explored: -2");
  assert.equal(buildingProfile({ die: "d4" }, 25, false).dc, 25);
});

test("Work yields the discoverable's produces; items-only resources yield no stock", () => {
  const r = reg();
  assert.equal(resourceOf(r.get("discoverables", "herb-cluster")), "supplies");
  assert.equal(resourceOf(r.get("discoverables", "grain-grass-stand")), "rations");
  assert.equal(resourceOf(r.get("discoverables", "crystal-bloom-formation")), "", "produces null: specific items");
  assert.equal(resourceOf({ food: true }), "rations", "older definitions fall back");
  assert.equal(resourceOf({}), "materials");
});

test("cancelling an upgrade keeps the earlier level (core's cancelPending)", () => {
  const { r, s } = world();
  const t = Core.getTile(s, "sc", "3,4");
  t.discoverables.push({ ...Core.blankDiscoverable(), id: "d1", type: "grain-grass-stand", tier: 4, found: true });
  const host = { kind: "discoverable", sceneId: "sc", key: "3,4", id: "d1" };
  Core.attach(s, r, host, "yield-1", { complete: true });
  const slotId = Core.attach(s, r, host, "yield-2", { complete: true }) && t.discoverables[0].slots[0].id;
  Core.attach(s, r, host, "yield-3");
  assert.equal(Core.cancelPending(s, host, slotId), "kept");
  assert.equal(t.discoverables[0].slots[0].built, "yield-2");
  assert.equal(t.discoverables[0].slots[0].pending, null);
});

/* ---------------------------------------------------------------- chronicle */
test("chronicle page groups events and escapes text", () => {
  const html = weekPageHTML(4, [
    { kind: "build-complete", text: "Granary II finished" },
    { kind: "upkeep", text: "Rations −12 <ok>" },
    { kind: "mystery", text: "?" }
  ]);
  assert.ok(html.indexOf("Upkeep") < html.indexOf("Completed"));
  assert.match(html, /&lt;ok&gt;/);
  assert.match(html, /Notes/);
  assert.match(weekPageHTML(1, []), /quiet week/);
  assert.equal(pageName(7), "Week 7");
  assert.match(recapText([{ kind: "build-complete" }, { kind: "build-start" }]), /1 started, 1 completed/);
});

/* ---------------------------------------------------------------- module data actions through core's runAction */
test("actions keep to this module's data and re-check players", () => {
  const { r, s } = world();
  const actions = { ...Core.ACTIONS, ...createActions({ ownsActor: (u, a) => u === "p1" && a === "actor1" }) };
  const run = (name, args, ctx) => Core.runAction(actions, s, `${ID}.${name}`, args, ctx);

  assert.throws(() => run("publishBuildings", { buildings: {} }, playerCtx(r)), /Only the GM/);
  run("publishBuildings", { buildings: { x: { label: "X" } }, loadedAt: "now" }, gmCtx(r));
  assert.equal(moduleData(s).pub.buildings.x.label, "X");

  const reqId = run("requestBuild", { host: { kind: "settlement", id: "main" }, building: "workshop-1", settlementId: "main" }, playerCtx(r));
  assert.throws(() => run("requestBuild", { host: { kind: "castle" }, building: "workshop-1" }, playerCtx(r)), /place/);
  assert.throws(() => run("requestBuild", { host: { kind: "settlement", id: "main" }, building: "nope" }, playerCtx(r)), /Unknown building/);
  assert.equal(moduleData(s).gm.requests.length, 1);
  assert.equal(run("takeRequest", { id: reqId }, gmCtx(r)).building, "workshop-1");
  assert.throws(() => run("takeRequest", { id: reqId }, gmCtx(r)), /already handled/);

  s.week = 2;
  const host = { kind: "settlement", id: "main" };
  const key = attemptKey(host, "slot1");
  run("openAttempts", { items: [{ key, host, slotId: "slot1", building: "workshop-1", settlementId: "main", cost: 0, dc: 30, skills: ["crafting"] }] }, gmCtx(r));
  assert.throws(() => run("submitRoll", { key, degree: "success", actorId: "someoneElse", skill: "crafting" }, playerCtx(r)), /character you own/);
  assert.throws(() => run("submitRoll", { key, degree: "success", actorId: "actor1", skill: "arcana" }, playerCtx(r)), /skill/);
  assert.throws(() => run("submitRoll", { key, degree: "great", actorId: "actor1" }, playerCtx(r)), /degree/);
  run("submitRoll", { key, degree: "success", actorId: "actor1", skill: "crafting", actorName: "Ezren", total: 31 }, playerCtx(r));
  assert.equal(moduleData(s).pub.attempts[key].status, "rolled");
  assert.throws(() => run("submitRoll", { key, degree: "success", actorId: "actor1" }, playerCtx(r)), /already been rolled/);
  run("finishAttempt", { key, result: "+1 week" }, gmCtx(r));
  assert.throws(() => run("finishAttempt", { key }, gmCtx(r)), /already applied/);

  s.week = 3;
  run("pruneAttempts", {}, gmCtx(r));
  assert.deepEqual(moduleData(s).pub.attempts, {});

  run("logEvent", { settlementId: "main", kind: "upkeep", text: "Rations −10" }, gmCtx(r));
  run("logEvent", { settlementId: "other", kind: "note", text: "x" }, gmCtx(r));
  const mine = run("takeWeek", { settlementId: "main" }, gmCtx(r));
  assert.equal(mine.length, 1); assert.equal(mine[0].week, 3);
  assert.equal(moduleData(s).pub.thisWeek.length, 1);

  // the data survives core's validation and the player copy keeps only the public half
  run("setNote", { settlementId: "main", text: "secret" }, gmCtx(r));
  const clean = Core.validateState(s);
  assert.equal(clean.modules[ID].gm.notes.main, "secret");
  const pub = Core.publicState(clean);
  assert.deepEqual(pub.modules[ID].gm, {});
  assert.equal(pub.modules[ID].public.buildings.x.label, "X");
});
