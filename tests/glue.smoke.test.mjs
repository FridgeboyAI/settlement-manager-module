// Loads settlement-core (pinned copy) and settlement-manager against stubbed Foundry globals and plays a week as the
// hosting GM. Checks the wiring, not the look of the windows.
import { test } from "node:test";
import assert from "node:assert/strict";

/* ---------------------------------------------------------------- stubs */
const listeners = {}, onceHooks = {};
globalThis.Hooks = {
  on: (n, f) => (listeners[n] ||= []).push(f),
  once: (n, f) => (onceHooks[n] ||= []).push(f),
  callAll: (n, ...a) => { for (const f of listeners[n] || []) f(...a); const o = onceHooks[n] || []; delete onceHooks[n]; for (const f of o) f(...a); return true; }
};
const settings = new Map(), registered = new Map();
const notes = [];
globalThis.ui = { notifications: { info: m => notes.push(["info", m]), warn: m => notes.push(["warn", m]), error: m => notes.push(["error", m]) } };
let nextId = 1;
const id = () => `id${nextId++}`;
const journals = [];
function makePage(d, parent) { return { id: id(), ...d, parent, get uuid() { return `${parent.uuid}.JournalEntryPage.${this.id}`; }, documentName: "JournalEntryPage", text: { ...(d.text || {}) }, async update(u) { if ("text.content" in u) this.text.content = u["text.content"]; } }; }
function makeJournal(d) {
  const j = { id: id(), ...d, documentName: "JournalEntry", pagesList: [] };
  j.uuid = `JournalEntry.${j.id}`;
  j.pages = { find: f => j.pagesList.find(f), get contents() { return [...j.pagesList]; } };
  j.getFlag = (m, k) => d.flags?.[m]?.[k];
  j.createEmbeddedDocuments = async (_t, list) => list.map(p => { const page = makePage(p, j); j.pagesList.push(page); return page; });
  journals.push(j); return j;
}
globalThis.JournalEntry = { create: async d => makeJournal(d) };
globalThis.fromUuid = async u => journals.find(j => j.uuid === u) || null;
globalThis.fromUuidSync = u => journals.find(j => j.uuid === u) || null;
const messages = [];
globalThis.ChatMessage = {
  create: async d => { const m = { id: id(), ...d, getFlag: (mod, k) => d.flags?.[mod]?.[k], async update(u) { Object.assign(m, u); } }; messages.push(m); return m; },
  getSpeaker: () => ({ alias: "x" })
};
let nextRoll = 4;
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = nextRoll; return this; } async toMessage() { return null; } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
class AppStub { static DEFAULT_OPTIONS = {}; render() { return this; } close() {} }
globalThis.foundry = {
  utils: { deepClone: o => structuredClone(o) },
  applications: {
    api: { ApplicationV2: AppStub, DialogV2: { prompt: async () => null, wait: async () => null, confirm: async () => true } },
    apps: { FilePicker: { implementation: { browse: async () => ({ files: ["settlement-manager/buildings/smithy.json", "settlement-manager/buildings/broken.json"] }) } } }
  }
};
globalThis.fetch = async path => ({
  text: async () => path.includes("smithy")
    ? JSON.stringify({ id: "smithy-1", label: "Smithy", complexity: 2, hosts: ["settlement"], skills: ["crafting"], materialsPerWeek: 1, effects: { morale: 1 } })
    : "{ nope"
});
globalThis.document = { getElementById: () => null, querySelector: () => null };

const user = { id: "gm1", name: "GM", isGM: true, active: true };
const mods = { "settlement-core": { active: true }, "settlement-manager": { active: true } };
globalThis.game = {
  user, users: { filter: f => [user].filter(f), get: () => user, some: f => [user].some(f) },
  journal: { find: f => journals.find(f) },
  settings: {
    register: (m, k, d) => registered.set(`${m}.${k}`, d),
    get: (m, k) => settings.has(`${m}.${k}`) ? settings.get(`${m}.${k}`) : registered.get(`${m}.${k}`)?.default,
    set: async (m, k, v) => { settings.set(`${m}.${k}`, structuredClone(v)); registered.get(`${m}.${k}`)?.onChange?.(v); }
  },
  modules: { get: k => mods[k] }, socket: { on() {}, emit() {} },
  scenes: { get: () => ({ name: "Map" }) }, actors: { get: () => null, filter: () => [] },
  messages: { get: i => messages.find(m => m.id === i), contents: messages },
  i18n: { localize: s => s }
};

await import("./.core/module.mjs");
await import("../scripts/main.mjs");
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));

test("a week of play as the host GM", async () => {
  Hooks.callAll("init");
  Hooks.callAll("setup");
  Hooks.callAll("ready");
  await wait(50);
  const core = mods["settlement-core"].api, sm = mods["settlement-manager"].api;
  const Flows = await import("../scripts/flows.mjs");
  const { data } = await import("../scripts/link.mjs");
  assert.ok(sm.open, "our API is set at init");

  // building files: the good one is registered on this client, the broken one is reported
  assert.equal(core.get("buildings", "smithy-1")?.label, "Smithy");
  assert.ok(messages.some(m => /broken\.json/.test(m.content)), "invalid file reported to the GM");

  // found the settlement on a revealed hex
  await core.saveTile("S", "1,1", { terrain: "grassland", revealed: true, name: "Riverbend" });
  const sid = await Flows.found("Haven", "S", "1,1");
  assert.equal(game.settings.get("settlement-manager", "mainSettlementId"), sid);
  await assert.rejects(Flows.found("Second", "S", "1,1"), /already a settlement/);
  assert.ok(data().pub.chronicles[sid], "Chronicle journal created");

  // access gate (core doesn't check needs)
  await assert.rejects(Flows.startBuild({ kind: "settlement", id: sid }, "granary-2"), /access/);
  const list = Flows.buildList({ kind: "settlement", id: sid });
  assert.match(list.find(b => b.id === "granary-2").reason, /Needs access/);
  await Flows.setAccess("lumber", true); await Flows.setAccess("stone", true);
  assert.equal(Flows.buildList({ kind: "settlement", id: sid }).find(b => b.id === "granary-2").ok, true);

  // start two builds; the Smithy costs 1 Material a week and we have none
  await Flows.startBuild({ kind: "settlement", id: sid }, "granary-2");
  await Flows.startBuild({ kind: "settlement", id: sid }, "smithy-1");
  await core.patchSettlement(sid, { population: 5 });
  await core.adjustResource(sid, "rations", 3);

  // Upkeep (week 0 starts in upkeep): card, apply with a shortage
  const up = Flows.upkeepFor();
  assert.deepEqual(up.lines[0], { resource: "rations", cost: 5, stock: 3, pay: 3, shortage: 2 });
  await Flows.applyUpkeep(up.lines);
  assert.equal(core.getSettlement(sid).resources.rations.amount, 0);

  // Resolution: the open-attempts card appears; open attempts
  await core.advancePhase(); await core.advancePhase();
  await wait();
  assert.ok(messages.some(m => m.flags?.["settlement-manager"]?.card?.type === "open-attempts"));
  await Flows.openAttempts();
  const attempts = data().pub.attempts;
  const entries = Object.entries(attempts);
  assert.equal(entries.length, 2);
  const granary = entries.find(([, a]) => a.building === "granary-2");
  const smithy = entries.find(([, a]) => a.building === "smithy-1");
  assert.equal(granary[1].status, "open"); assert.equal(smithy[1].status, "short");
  assert.equal(granary[1].dc, 32, "Improve 30 + 2 for level II");

  // the GM enters a success; the host applies it on the change hook
  await core.request("settlement-manager.submitRoll", { key: granary[0], degree: "success", actorName: "GM" });
  await wait(100);
  assert.equal(data().pub.attempts[granary[0]].status, "done");
  assert.equal(core.getSettlement(sid).slots.find(s => s.pending?.building === "granary-2").pending.progress, 1);

  // GM overrides: finish the granary, remove it again (no refund), stats follow
  const host = { kind: "settlement", id: sid };
  const gSlot = core.getSettlement(sid).slots.find(s => s.pending?.building === "granary-2");
  await Flows.finishNow(host, gSlot.id);
  assert.equal(core.getSettlement(sid).slots.find(s => s.id === gSlot.id).built, "granary-2");
  await Flows.removeBuilding(host, gSlot.id);
  assert.ok(!core.getSettlement(sid).slots.some(s => s.id === gSlot.id));

  // cancelling a pending upgrade keeps the finished earlier level
  await core.saveTile("S", "2,2", { terrain: "grassland", revealed: true });
  const did = await core.addDiscoverable("S", "2,2", { type: "herb-cluster", tier: 3, found: true });
  const dHost = { kind: "discoverable", sceneId: "S", key: "2,2", id: did };
  await core.attach(dHost, "yield-1", true); await core.attach(dHost, "yield-2", true);
  const upSlot = await core.attach(dHost, "yield-3");
  await Flows.cancelBuild(dHost, upSlot);
  const dSlots = core.getTile("S", "2,2").discoverables[0].slots;
  assert.equal(dSlots.length, 1); assert.equal(dSlots[0].built, "yield-2"); assert.equal(dSlots[0].pending, null);

  // Record Work: a critical success doubles the die and the bonus; the bonus goes to Resources
  nextRoll = 3;
  assert.deepEqual(await Flows.recordWork({ label: "Pasture", die: "d6", degree: "criticalSuccess", bonusResources: 1, resource: "rations" }), { main: 6, bonus: 2 });
  assert.equal(core.getSettlement(sid).resources.rations.amount, 6);
  assert.equal(core.getSettlement(sid).resources.resources.amount, 2);
  nextRoll = 5;
  assert.deepEqual(await Flows.recordWork({ label: "Farm", die: "d6", degree: "failure", resource: "rations" }), { main: 2, bonus: 0 });
  assert.equal(core.getSettlement(sid).resources.rations.amount, 8);

  // Week End writes the Chronicle page
  await core.advancePhase();
  await wait(50);
  const chronicle = journals.find(j => j.uuid === data().pub.chronicles[sid]);
  const page = chronicle.pages.find(p => p.name === "Week 0");
  assert.ok(page, "a page for week 0");
  assert.match(page.text.content, /Founding/);
  assert.match(page.text.content, /Upkeep/);
  assert.match(page.text.content, /Work/);
  assert.equal(data().pub.thisWeek.filter(e => e.settlementId === sid).length, 0, "the week's events moved to the page");

  // the next Upkeep prunes last week's attempts
  await core.advancePhase();
  await wait(50);
  assert.equal(core.getClock().week, 1);
  assert.deepEqual(data().pub.attempts, {});
  assert.ok(!notes.some(([t]) => t === "error"), `no errors: ${JSON.stringify(notes.filter(([t]) => t === "error"))}`);

  // every window view renders, for the GM and for a player
  const { SettlementsApp } = await import("../scripts/ui/app.mjs");
  const { HexPanel } = await import("../scripts/ui/hex.mjs");
  const chat = await import("../scripts/chat.mjs");
  const app = new SettlementsApp();
  for (const asGM of [true, false]) {
    user.isGM = asGM;
    for (const tab of ["overview", "buildings", "resources", "history"]) {
      app.tab = tab;
      const html = await app._renderHTML();
      assert.match(html, /Haven/, `${tab} renders (${asGM ? "GM" : "player"})`);
      if (!asGM) assert.doesNotMatch(html, /data-action="(remove|reload|adjust|advance)"/, "no GM controls for players");
    }
    const panel = new HexPanel(); panel.sceneId = "S"; panel.key = "1,1"; panel.open = new Set([JSON.stringify({ kind: "tile", sceneId: "S", key: "1,1" })]);
    assert.match(await panel._renderHTML(), /Riverbend/);
  }
  user.isGM = true;
  // an attempt card renders for an open attempt
  await core.attach({ kind: "settlement", id: sid }, "workshop-1");
  await Flows.openAttempts();
  const card = messages.filter(m => m.flags?.["settlement-manager"]?.card?.type === "attempt").at(-1);
  assert.match(card.content, /Roll Crafting/);
  assert.equal(typeof chat.onRenderChatMessage, "function");
});
