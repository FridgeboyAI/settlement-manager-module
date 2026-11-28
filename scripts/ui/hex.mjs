/** The Hex buildings panel and its scene-control tool (spec §8). */
import { core, mainSettlement, enabled } from "../link.mjs";
import * as Flows from "../flows.mjs";
import { h, slotRow, buildListHTML, hostAttrs, readHost, canAct, noGMNote } from "./view.mjs";
import { foundDialog, openRecordWork, confirm, reportError } from "./dialogs.mjs";

const { ApplicationV2 } = foundry.applications.api;
let panel = null;
let toolActive = false;
let down = null;

export class HexPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "settlement-manager-hex",
    classes: ["settlement-manager"],
    window: { title: "Hex buildings", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 460, height: 600, left: 700, top: 80 },
    actions: {
      build: HexPanel.#onBuild, progress: HexPanel.#onProgress, finish: HexPanel.#onFinish, cancel: HexPanel.#onCancel,
      remove: HexPanel.#onRemove, damage: HexPanel.#onDamage, found: HexPanel.#onFound, work: HexPanel.#onWork, toggle: HexPanel.#onToggle
    }
  };
  static show(sceneId, key) {
    panel ??= new HexPanel();
    panel.sceneId = sceneId; panel.key = key; panel.open = new Set();
    return panel.render({ force: true });
  }
  static refresh() { if (panel?.rendered) panel.render(); }

  sceneId = ""; key = ""; open = new Set();

  async _renderHTML() {
    const api = core(); if (!api) return `<p class="sm-warn">settlement-core is not active.</p>`;
    const isGM = game.user.isGM;
    const tile = api.getTile(this.sceneId, this.key);
    const head = `<header class="sm-head"><h2>${h(tile?.name || `Hex ${this.key}`)}</h2></header>${noGMNote()}`;
    if (!tile) return `${head}<p>${isGM ? "This hex isn't in settlement-core yet. Save it with the tile tools first." : "This hex hasn't been revealed."}</p>`;
    const s = mainSettlement();
    const found = isGM && !s ? `<p><button type="button" data-action="found" ${tile.revealed && canAct() ? "" : "disabled"}>Found settlement here</button>${tile.revealed ? "" : ' <span class="sm-sub">Reveal the hex first.</span>'}</p>` : "";
    const homeHere = s?.home?.sceneId === this.sceneId && s?.home?.key === this.key ? `<p class="sm-good">Home of ${h(s.name)}.</p>` : "";
    const section = (host, title, slots, extra = "") => {
      const id = JSON.stringify(host);
      const list = this.open.has(id) && enabled("buildings") ? buildListHTML(Flows.buildList(host), hostAttrs(host), canAct()) : "";
      return `<section class="sm-host"><h3>${title}</h3>${extra}
        ${slots.length ? `<ul class="sm-slots">${slots.map(sl => slotRow(sl, hostAttrs(host), isGM && canAct())).join("")}</ul>` : `<p class="sm-sub">No buildings.</p>`}
        <a data-action="toggle" data-key="${h(id)}">${this.open.has(id) ? "Hide the build list" : "Build here…"}</a>${list}</section>`;
    };
    const tileHost = { kind: "tile", sceneId: this.sceneId, key: this.key };
    const resources = (tile.discoverables || []).filter(d => d.found).map(d => {
      const used = (d.slots || []).reduce((n, sl) => n + Number(api.get("buildings", sl.pending?.building || sl.built)?.level ?? api.get("buildings", sl.pending?.building || sl.built)?.complexity ?? 0), 0);
      let prof = "";
      try { const p = api.workProfile({ sceneId: this.sceneId, key: this.key, id: d.id }); prof = `Work: ${p.die} · DC ${p.dc}${p.checkBonus ? ` · +${p.checkBonus}` : ""}`; } catch (e) { prof = ""; }
      return section({ kind: "discoverable", sceneId: this.sceneId, key: this.key, id: d.id }, `${h(d.name || d.type)} <span class="sm-tag">tier ${d.tier} · levels ${used}/${d.tier}</span>`, d.slots || [], prof ? `<p class="sm-sub">${h(prof)}</p>` : "");
    }).join("");
    return `${head}${homeHere}${found}${section(tileHost, "On the hex", tile.slots || [])}${resources}
      <p><button type="button" data-action="work" ${canAct() && s && enabled("work") ? "" : "disabled"}>${isGM ? "Record Work here…" : "Report Work here…"}</button></p>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }

  static #onToggle(ev, t) { const k = t.dataset.key; this.open.has(k) ? this.open.delete(k) : this.open.add(k); this.render(); }
  static async #onBuild(ev, t) {
    try {
      const res = await Flows.startBuild(readHost(t), t.dataset.building);
      if (res.status === "requested") {
        const { requestCard } = await import("../chat.mjs");
        await requestCard({ kind: "build", host: readHost(t), building: t.dataset.building, id: res.id });
        ui.notifications.info("Request sent to the GM.");
      } else if (res.status === "queued") ui.notifications.info("Sent; the build starts shortly.");
    } catch (e) { reportError(e); }
  }
  static async #onProgress(ev, t) { await Flows.changeProgress(readHost(t), t.dataset.slot, Number(t.dataset.delta)).catch(reportError); }
  static async #onFinish(ev, t) { await Flows.finishNow(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onCancel(ev, t) { if (await confirm("Cancel this build?", "Progress and spent Materials are lost.")) await Flows.cancelBuild(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onRemove(ev, t) { if (await confirm("Remove this building?", "It is removed without any refund.")) await Flows.removeBuilding(readHost(t), t.dataset.slot).catch(reportError); }
  static async #onDamage(ev, t) { await Flows.setDamaged(readHost(t), t.dataset.slot, t.dataset.damaged === "1").catch(reportError); }
  static async #onFound() { await foundDialog(this.sceneId, this.key); this.render(); }
  static async #onWork() { await openRecordWork(this.sceneId, this.key); }
}

/* ---------------------------------------------------------------- the Hex buildings tool */
function canvasPoint(event) {
  if (typeof canvas.canvasCoordinatesFromClient === "function") return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  const t = canvas.stage.worldTransform;
  return { x: (event.clientX - t.tx) / t.a, y: (event.clientY - t.ty) / t.d };
}
function onPointerDown(ev) { if (toolActive && ev.button === 0) down = { x: ev.clientX, y: ev.clientY }; }
function onPointerUp(ev) {
  if (!toolActive || ev.button !== 0 || !down || !canvas?.ready || !canvas.scene) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y); down = null;
  if (moved > 5 || ev.target?.id !== "board" && ev.target?.tagName !== "CANVAS") return;
  const { i, j } = canvas.grid.getOffset(canvasPoint(ev));
  HexPanel.show(canvas.scene.id, `${i},${j}`);
}

export function setHexTool(active) {
  toolActive = !!active;
  if (toolActive && game.modules.get("settlement-hex-manager")?.active && document.querySelector('[data-tool*="tile" i].active, [data-tool*="Tile" i].active')) {
    ui.notifications.info("Hex buildings and the Tile Viewer are both on; a click opens both.");
  }
}

export function bindCanvas() {
  const board = document.getElementById("board");
  if (!board || board.dataset.smBound) return;
  board.dataset.smBound = "1";
  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointerup", onPointerUp);
}

