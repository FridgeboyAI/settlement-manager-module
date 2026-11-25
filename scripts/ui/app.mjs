/** The Settlements window (spec §8): overview, buildings, resources and history. */
import { computeStats, breakdown } from "../logic/stats.mjs";
import { pendingBuilds } from "../logic/construction.mjs";
import { upkeepText } from "../logic/upkeep.mjs";
import { core, data, mainSettlement, building, resourceLabel, allHosts, hostInfo, enabled, run } from "../link.mjs";
import * as Flows from "../flows.mjs";
import { reloadBuildings } from "../buildings.mjs";
import { h, PHASE_LABELS, slotRow, buildListHTML, hostAttrs, readHost, canAct, noGMNote, clock } from "./view.mjs";
import { openRecordWork, setClockDialog, confirm, reportError } from "./dialogs.mjs";

const { ApplicationV2 } = foundry.applications.api;
let instance = null;

export class SettlementsApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "settlement-manager-app",
    classes: ["settlement-manager"],
    window: { title: "Settlements", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 560, height: 680, left: 120, top: 80 },
    actions: {
      tab: SettlementsApp.#onTab, advance: SettlementsApp.#onAdvance, setClock: SettlementsApp.#onSetClock,
      build: SettlementsApp.#onBuild, progress: SettlementsApp.#onProgress, finish: SettlementsApp.#onFinish,
      cancel: SettlementsApp.#onCancel, remove: SettlementsApp.#onRemove, damage: SettlementsApp.#onDamage,
      adjust: SettlementsApp.#onAdjust, work: SettlementsApp.#onWork, reload: SettlementsApp.#onReload,
      openPage: SettlementsApp.#onOpenPage, rename: SettlementsApp.#onRename, deleteSettlement: SettlementsApp.#onDelete,
      request: SettlementsApp.#onRequest
    }
  };

  static toggle() {
    if (instance?.rendered) return instance.close();
    instance ??= new SettlementsApp();
    return instance.render({ force: true });
  }
  static refresh() { if (instance?.rendered) instance.render(); }

  tab = "overview";

  async _renderHTML() {
    if (!core()) return `<p class="sm-warn">settlement-core is not active.</p>`;
    const s = mainSettlement();
    const isGM = game.user.isGM;
    const { week, phase } = clock();
    const tabs = ["overview", "buildings", "resources", "history"];
    const phaseBar = `<div class="sm-phase"><span>Week <strong>${week}</strong> · ${h(PHASE_LABELS[phase] || phase)}</span>${isGM && enabled("week") ? `
      <button type="button" data-action="advance" ${canAct() ? "" : "disabled"}>Advance</button>
      <a data-action="setClock" data-tooltip="Set week and phase"><i class="fa-solid fa-clock-rotate-left"></i></a>` : ""}</div>`;
    if (!s) {
      return `${phaseBar}${noGMNote()}<div class="sm-empty"><h2>No settlement yet</h2><p>${isGM
        ? "Switch on <strong>Hex buildings</strong> in the token controls, click a revealed hex and choose <em>Found settlement here</em>."
        : "The GM hasn't founded the settlement yet."}</p></div>${isGM ? this.#footer() : ""}`;
    }
    const nav = `<nav class="sm-tabs">${tabs.map(t => `<a data-action="tab" data-tab="${t}" class="${this.tab === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</a>`).join("")}</nav>`;
    const body = { overview: () => this.#overview(s), buildings: () => this.#buildings(s), resources: () => this.#resources(s), history: () => this.#history(s) }[this.tab]();
    return `<header class="sm-head"><h2>${h(s.name)}</h2>${isGM ? `<a data-action="rename" data-tooltip="Rename"><i class="fa-solid fa-pen"></i></a><a data-action="deleteSettlement" data-tooltip="Delete the settlement"><i class="fa-solid fa-trash"></i></a>` : ""}</header>
      ${phaseBar}${noGMNote()}${nav}<section class="sm-body">${body}</section>${isGM ? this.#footer() : ""}`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelectorAll("[data-sm-change]").forEach(el => el.addEventListener("change", ev => this.#onChange(ev).catch(reportError)));
  }

  #footer() {
    const { pub } = data();
    return `<footer class="sm-foot"><span class="sm-sub">${Object.keys(pub.buildings).length} building file(s) loaded</span><button type="button" data-action="reload">Reload buildings</button></footer>`;
  }

  #stats(s) {
    const api = core();
    const home = s.home ? { kind: "tile", sceneId: s.home.sceneId, key: s.home.key } : null;
    const settlementBuilt = api.builtOn({ kind: "settlement", id: s.id });
    let homeBuilt = [];
    try { homeBuilt = home && api.getTile(home.sceneId, home.key) ? api.builtOn(home) : []; } catch (e) { homeBuilt = []; }
    const tileSecurity = home ? api.tileSecurity(home.sceneId, home.key) : 0;
    return computeStats({ settlement: s, settlementBuilt, homeBuilt, tileSecurity, isSecure: api.isSecure });
  }

  #overview(s) {
    const isGM = game.user.isGM;
    const st = this.#stats(s);
    const num = (field, value) => isGM ? `<input type="number" data-sm-change="${field}" value="${value}" ${field === "morale" ? 'min="-10" max="10"' : 'min="0"'}>` : `<strong>${value}</strong>`;
    const accessLabels = [...new Set(core().all("buildings").flatMap(b => b.needs || []))].sort();
    const accessRows = accessLabels.map(a => {
      const has = !!s.resources?.[a]?.access;
      return `<label class="sm-access">${isGM ? `<input type="checkbox" data-sm-change="access" data-res="${h(a)}" ${has ? "checked" : ""}>` : (has ? "✔" : "✘")} ${h(resourceLabel(a))}</label>`;
    }).join("");
    const homeTile = s.home ? core().getTile(s.home.sceneId, s.home.key) : null;
    const { gm } = data();
    return `
      <div class="sm-stats">
        <div><span>Population</span>${num("population", st.population)}</div>
        <div data-tooltip="${h(breakdown("Housing", st.housing, st.housingLines))}"><span>Housing</span><strong>${st.housing}</strong></div>
        <div data-tooltip="${h(breakdown("Morale", st.morale, [{ label: "Base", value: st.moraleBase }, ...st.moraleLines]))}"><span>Morale</span><strong>${st.morale}</strong>${isGM ? `<small>base ${num("morale", st.moraleBase)}</small>` : ""}</div>
        <div data-tooltip="${h(breakdown("Security", st.security, st.securityLines, [st.leaderNote]))}"><span>Security</span><strong>${st.security}</strong></div>
        <div><span>Secure?</span><strong class="${st.secure ? "sm-good" : "sm-bad"}">${st.secure ? "Secure" : "Not secure"}</strong></div>
      </div>
      <p class="sm-sub">Home hex: ${h(homeTile?.name || s.home?.key || "none")}${s.home ? ` · ${h(game.scenes.get(s.home.sceneId)?.name || "")}` : ""}</p>
      ${st.warnings.length ? `<ul class="sm-warnings">${st.warnings.map(w => `<li>${h(w.text)}</li>`).join("")}</ul>` : ""}
      ${accessLabels.length ? `<h3>Access</h3><div class="sm-access-list">${accessRows}</div>` : ""}
      ${isGM ? `<h3>GM notes</h3><textarea data-sm-change="note" rows="4">${h(gm.notes[s.id] || "")}</textarea>` : ""}`;
  }

  #buildings(s) {
    const isGM = game.user.isGM;
    const host = { kind: "settlement", id: s.id };
    const slots = s.slots.length ? `<ul class="sm-slots">${s.slots.map(sl => slotRow(sl, hostAttrs(host), isGM && canAct())).join("")}</ul>` : `<p class="sm-sub">No buildings yet.</p>`;
    const elsewhere = pendingBuilds(allHosts().filter(x => x.host.kind !== "settlement"));
    const pendingList = elsewhere.length ? `<h3>Being built on the map</h3><ul class="sm-slots">${elsewhere.map(p => `<li>${h(building(p.building)?.label || p.building)} <span class="sm-sub">on ${h(p.hostLabel)} · ${p.progress} wk done</span></li>`).join("")}</ul>` : "";
    const { gm } = data();
    const requests = isGM && gm.requests.length ? `<h3>Open requests</h3><ul class="sm-slots">${gm.requests.map(r => `<li>${h(game.users.get(r.userId)?.name || "Player")}: ${r.kind === "build" ? h(building(r.building)?.label || r.building) : "Work"}
      <span class="sm-actions"><a data-action="request" data-id="${h(r.id)}" data-ok="1" data-tooltip="Approve"><i class="fa-solid fa-check"></i></a><a data-action="request" data-id="${h(r.id)}" data-ok="0" data-tooltip="Reject"><i class="fa-solid fa-xmark"></i></a></span></li>`).join("")}</ul>` : "";
    return `<h3>In the settlement</h3>${slots}${requests}${pendingList}
      <h3>Build in the settlement</h3>${enabled("buildings") ? buildListHTML(Flows.buildList(host), hostAttrs(host), canAct()) : `<p class="sm-warn">Turned off: settlement-core's building calls are missing.</p>`}
      <p class="sm-sub">To build on a hex or a resource, switch on <strong>Hex buildings</strong> in the token controls and click the hex.</p>`;
  }

  #resources(s) {
    const isGM = game.user.isGM;
    const rows = core().all("resources").map(r => {
      const amount = s.resources?.[r.id]?.amount ?? 0;
      return `<tr><td>${h(r.label || r.id)}</td><td class="sm-num">${amount}</td>${isGM ? `<td><input type="number" class="sm-delta" data-res="${h(r.id)}" placeholder="±"><button type="button" data-action="adjust" data-res="${h(r.id)}">Apply</button></td>` : ""}</tr>`;
    }).join("");
    const up = Flows.upkeepFor(s);
    const labels = Object.fromEntries(up.lines.map(l => [l.resource, resourceLabel(l.resource)]));
    return `<table class="sm-table"><thead><tr><th>Resource</th><th>Stock</th>${isGM ? "<th>Change</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>
      ${isGM ? `<input type="text" class="sm-reason-input" placeholder="Reason for the change (for the Chronicle)">` : ""}
      <h3>Upkeep this week</h3><p>${h(upkeepText(up.lines, labels))}</p>${up.shortage ? `<p class="sm-warn">Shortage: the GM decides what it means.</p>` : ""}
      <h3>Work</h3><p class="sm-sub">Record a Work result on a resource or a producing building. Yields go to ${h(s.name)}.</p>
      <button type="button" data-action="work" ${canAct() && enabled("work") ? "" : "disabled"}>${isGM ? "Record Work…" : "Report Work…"}</button>`;
  }

  #history(s) {
    const { pub } = data();
    const uuid = pub.chronicles[s.id];
    const entry = uuid ? fromUuidSync(uuid) : null;
    const pages = entry ? entry.pages.contents.sort((a, b) => (b.sort || 0) - (a.sort || 0)) : [];
    const mine = pub.thisWeek.filter(e => e.settlementId === s.id);
    return `<h3>This week so far</h3>${mine.length ? `<ul class="sm-slots">${mine.map(e => `<li>${h(e.text)}</li>`).join("")}</ul>` : `<p class="sm-sub">Nothing yet.</p>`}
      <h3>Chronicle</h3>${entry ? `<ul class="sm-slots">${pages.map(p => `<li><a data-action="openPage" data-uuid="${h(p.uuid)}">${h(p.name)}</a></li>`).join("") || "<li class='sm-sub'>No weeks written yet.</li>"}</ul>
      <p><a data-action="openPage" data-uuid="${h(entry.uuid)}">Open the Chronicle journal</a></p>` : `<p class="sm-sub">The Chronicle is created when the settlement is founded or the first week ends.</p>`}`;
  }

  /* ---------------------------------------------------------------- handlers */
  async #onChange(ev) {
    const el = ev.currentTarget, field = el.dataset.smChange;
    if (field === "population" || field === "morale") {
      const value = Math.trunc(Number(el.value) || 0);
      await Flows.patchSettlement({ [field]: value }, `${field === "population" ? "Population" : "Base morale"} set to ${value} by the GM.`);
    } else if (field === "access") {
      await Flows.setAccess(el.dataset.res, el.checked);
    } else if (field === "note") {
      await run("setNote", { settlementId: mainSettlement().id, text: el.value });
    }
  }
  static #onTab(ev, target) { this.tab = target.dataset.tab; this.render(); }
  static async #onAdvance() { await core().advancePhase().catch(reportError); }
  static async #onSetClock() { await setClockDialog(); }
  static async #onBuild(ev, target) {
    try {
      const res = await Flows.startBuild(readHost(target), target.dataset.building);
      if (res.status === "requested") {
        const { requestCard } = await import("../chat.mjs");
        await requestCard({ kind: "build", host: readHost(target), building: target.dataset.building, id: res.id });
        ui.notifications.info("Request sent to the GM.");
      } else if (res.status === "queued") ui.notifications.info("Sent; the build starts shortly.");
    } catch (e) { reportError(e); }
  }
  static async #onProgress(ev, t) { await Flows.changeProgress(readHost(t), t.dataset.slot, Number(t.dataset.delta)).catch(reportError); }
  static async #onFinish(ev, t) { await Flows.finishNow(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onCancel(ev, t) { if (await confirm("Cancel this build?", "Progress and spent Materials are lost.")) await Flows.cancelBuild(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onRemove(ev, t) { if (await confirm("Remove this building?", "It is removed without any refund.")) await Flows.removeBuilding(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onDamage(ev, t) { await Flows.setDamaged(readHost(t), t.dataset.slot, t.dataset.damaged === "1").catch(reportError); }
  static async #onAdjust(ev, t) {
    const input = this.element.querySelector(`input.sm-delta[data-res="${t.dataset.res}"]`);
    const reason = this.element.querySelector("input.sm-reason-input")?.value || "";
    const delta = Math.trunc(Number(input?.value) || 0);
    if (!delta) return;
    await Flows.adjustResource(t.dataset.res, delta, reason).catch(reportError);
  }
  static async #onWork() { await openRecordWork(); }
  static async #onReload() { await reloadBuildings().catch(reportError); this.render(); }
  static async #onOpenPage(ev, t) {
    const doc = await fromUuid(t.dataset.uuid);
    if (!doc) return;
    if (doc.documentName === "JournalEntryPage") doc.parent.sheet.render(true, { pageId: doc.id });
    else doc.sheet.render(true);
  }
  static async #onRename() {
    const s = mainSettlement();
    const { DialogV2 } = foundry.applications.api;
    const name = await DialogV2.prompt({ window: { title: "Rename the settlement" }, content: `<input type="text" name="name" value="${h(s.name)}" autofocus>`, ok: { label: "Rename", callback: (e, b) => b.form.elements.name.value.trim() }, rejectClose: false });
    if (name && name !== s.name) await Flows.patchSettlement({ name }, `Renamed from ${s.name} to ${name}.`).catch(reportError);
  }
  static async #onDelete() {
    if (await confirm("Delete the settlement?", "Its buildings, stocks and stats are removed from settlement-core. The Chronicle journal is kept.")) await Flows.deleteSettlement().catch(reportError);
  }
  static async #onRequest(ev, t) {
    try { if (t.dataset.ok === "1") await Flows.approveRequest(t.dataset.id); else await Flows.rejectRequest(t.dataset.id); }
    catch (e) { reportError(e); }
  }
}

