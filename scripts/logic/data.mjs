/**
 * This module's own data inside settlement-core's state, and the actions that change it (spec §4 and §9).
 * Actions run on the host GM's client through core's pipeline; each run() edits `state.modules["settlement-manager"]`
 * only. Core's data (settlements, slots, resources) is changed through core's own API calls, never here.
 * No Foundry dependency.
 */
import { ID, DEGREES, isObj, clampInt } from "./const.mjs";

export const MAX_REQUESTS = 50;
export const MAX_EVENTS = 500;

export const blankPublic = () => ({ buildings: {}, buildingsLoadedAt: "", attempts: {}, thisWeek: [], chronicles: {} });
export const blankGM = () => ({ requests: [], notes: {} });

/** Read this module's data from a core state, filling in anything missing. Returns { pub, gm } (live references). */
export function moduleData(state) {
  const cur = state.modules[ID] ||= { public: {}, gm: {} };
  cur.public = { ...blankPublic(), ...(isObj(cur.public) ? cur.public : {}) };
  cur.gm = { ...blankGM(), ...(isObj(cur.gm) ? cur.gm : {}) };
  return { pub: cur.public, gm: cur.gm };
}
/** Read-only view of module data from core's getModuleData() result. */
export function readModuleData(data) {
  return { pub: { ...blankPublic(), ...(data?.public || {}) }, gm: { ...blankGM(), ...(data?.gm || {}) } };
}

const newId = () => globalThis.crypto?.randomUUID?.() || `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const str = (v, max = 500) => String(v ?? "").slice(0, max);
const cleanHost = h => {
  if (!isObj(h) || !["settlement", "tile", "discoverable"].includes(h.kind)) throw Error("Unknown building place");
  if (h.kind === "settlement") return { kind: "settlement", id: str(h.id, 80) };
  const out = { kind: h.kind, sceneId: str(h.sceneId, 40), key: str(h.key, 40) };
  if (h.kind === "discoverable") out.id = str(h.id, 80);
  return out;
};

/**
 * The actions, keyed by their full name. `opts.ownsActor(userId, actorId)` re-checks a player's roll on the host
 * (decision D14, point 4); it defaults to allowing everything, for tests.
 */
export function createActions(opts = {}) {
  const ownsActor = opts.ownsActor || (() => true);
  const A = {};
  const def = (name, permission, run) => { A[`${ID}.${name}`] = { permission, run }; };

  def("publishBuildings", "gm", (s, a) => {
    const { pub } = moduleData(s);
    pub.buildings = isObj(a.buildings) ? a.buildings : {};
    pub.buildingsLoadedAt = str(a.loadedAt, 40);
  });

  def("logEvent", "gm", (s, a) => {
    const { pub } = moduleData(s);
    if (!a.settlementId) throw Error("An event needs a settlement");
    pub.thisWeek.push({ settlementId: str(a.settlementId, 80), kind: str(a.kind, 40) || "note", text: str(a.text, 1000), week: s.week, phase: s.phase });
    if (pub.thisWeek.length > MAX_EVENTS) pub.thisWeek.splice(0, pub.thisWeek.length - MAX_EVENTS);
  });

  /** Remove and return one settlement's collected events (Week End). */
  def("takeWeek", "gm", (s, a) => {
    const { pub } = moduleData(s);
    const mine = pub.thisWeek.filter(e => e.settlementId === a.settlementId);
    pub.thisWeek = pub.thisWeek.filter(e => e.settlementId !== a.settlementId);
    return mine;
  });

  def("setChronicle", "gm", (s, a) => {
    const { pub } = moduleData(s);
    if (a.uuid) pub.chronicles[str(a.settlementId, 80)] = str(a.uuid, 120);
    else delete pub.chronicles[a.settlementId];
  });

  def("setNote", "gm", (s, a) => {
    const { gm } = moduleData(s);
    gm.notes[str(a.settlementId, 80)] = str(a.text, 15000);
  });

  def("requestBuild", "player", (s, a, c) => {
    const { gm } = moduleData(s);
    if (gm.requests.length >= MAX_REQUESTS) throw Error("Too many open requests; ask the GM to handle them first");
    if (!a.building || !c.reg?.get?.("buildings", a.building)) throw Error("Unknown building");
    const req = { id: newId(), kind: "build", userId: str(c.userId, 40), host: cleanHost(a.host), building: str(a.building, 80), settlementId: str(a.settlementId, 80), at: new Date().toISOString() };
    gm.requests.push(req);
    return req.id;
  });

  def("requestWork", "player", (s, a, c) => {
    const { gm } = moduleData(s);
    if (gm.requests.length >= MAX_REQUESTS) throw Error("Too many open requests; ask the GM to handle them first");
    const req = { id: newId(), kind: "work", userId: str(c.userId, 40), sceneId: str(a.sceneId, 40), key: str(a.key, 40), target: isObj(a.target) ? a.target : null, note: str(a.note, 300), at: new Date().toISOString() };
    gm.requests.push(req);
    return req.id;
  });

  /** Remove and return a request, for approval or rejection by the GM. */
  def("takeRequest", "gm", (s, a) => {
    const { gm } = moduleData(s);
    const req = gm.requests.find(r => r.id === a.id);
    if (!req) throw Error("That request was already handled");
    gm.requests = gm.requests.filter(r => r.id !== a.id);
    return req;
  });

  /** Open this week's attempts for the given builds (Materials were already spent through core). */
  def("openAttempts", "gm", (s, a) => {
    const { pub } = moduleData(s);
    for (const it of Array.isArray(a.items) ? a.items : []) {
      pub.attempts[str(it.key, 300)] = {
        week: s.week, status: it.status === "short" ? "short" : "open", host: cleanHost(it.host), slotId: str(it.slotId, 80),
        building: str(it.building, 80), settlementId: str(it.settlementId, 80), cost: clampInt(it.cost), dc: clampInt(it.dc),
        skills: (Array.isArray(it.skills) ? it.skills : []).map(x => str(x, 40)).slice(0, 12), messageId: str(it.messageId, 40)
      };
    }
  });

  def("setAttemptMessage", "gm", (s, a) => {
    const { pub } = moduleData(s);
    if (pub.attempts[a.key]) pub.attempts[a.key].messageId = str(a.messageId, 40);
  });

  /** A player (or the GM) reports a roll. Re-checked here on the host. */
  def("submitRoll", "player", (s, a, c) => {
    const { pub } = moduleData(s);
    const at = pub.attempts[a.key];
    if (!at) throw Error("Unknown build attempt");
    if (at.week !== s.week) throw Error("That attempt belongs to an earlier week");
    if (at.status !== "open") throw Error("That attempt has already been rolled");
    if (!DEGREES.includes(a.degree)) throw Error("Unknown degree of success");
    if (!c.isGM) {
      if (!a.actorId || !ownsActor(c.userId, a.actorId)) throw Error("You can only roll with a character you own");
      if (a.skill && at.skills.length && !at.skills.includes(a.skill)) throw Error("That skill isn't allowed for this building");
    }
    Object.assign(at, { status: "rolled", degree: a.degree, by: str(c.userId, 40), actorName: str(a.actorName, 80), skill: str(a.skill, 40), total: a.total == null ? null : clampInt(a.total, -999, 9999) });
  });

  /** The host applied a rolled attempt. */
  def("finishAttempt", "gm", (s, a) => {
    const { pub } = moduleData(s);
    const at = pub.attempts[a.key];
    if (!at) throw Error("Unknown build attempt");
    if (at.status === "done") throw Error("That attempt was already applied");
    at.status = "done"; at.result = str(a.result, 500);
  });

  /** Drop attempts from earlier weeks. */
  def("pruneAttempts", "gm", (s) => {
    const { pub } = moduleData(s);
    for (const [k, at] of Object.entries(pub.attempts)) if (at.week < s.week) delete pub.attempts[k];
  });

  return A;
}
