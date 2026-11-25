/** Small view helpers shared by the windows. */
import { escapeHTML } from "../logic/const.mjs";
import { core, building, gmOnline } from "../link.mjs";

export const h = escapeHTML;
export const PHASE_LABELS = { upkeep: "Upkeep", assignment: "Assignment", resolution: "Resolution", weekEnd: "Week End" };

export function weeksNeeded(slot) {
  const def = building(slot.pending?.building);
  if (!def) return 1;
  if (def.weeks) return def.weeks;
  return Math.max(1, Number(def.level ?? def.complexity ?? 1) - (slot.built ? 1 : 0));
}

/** One slot as a row. GM rows get override buttons; `hostAttr` identifies the host for the buttons. */
export function slotRow(slot, hostAttr, isGM) {
  const built = slot.built ? building(slot.built) : null;
  const pend = slot.pending ? building(slot.pending.building) : null;
  const parts = [];
  if (built) parts.push(`<strong>${h(built.label || slot.built)}</strong>${slot.damaged ? ' <span class="sm-tag sm-bad">damaged</span>' : ""}`);
  if (pend) parts.push(`${built ? "→ " : ""}<em>${h(pend.label || slot.pending.building)}</em> <span class="sm-tag">${slot.pending.progress}/${weeksNeeded(slot)} weeks</span>`);
  const text = built?.text || pend?.text || "";
  const gm = !isGM ? "" : `<span class="sm-actions">${slot.pending ? `
      <a data-action="progress" data-delta="-1" ${hostAttr} data-slot="${h(slot.id)}" data-tooltip="−1 week"><i class="fa-solid fa-minus"></i></a>
      <a data-action="progress" data-delta="1" ${hostAttr} data-slot="${h(slot.id)}" data-tooltip="+1 week"><i class="fa-solid fa-plus"></i></a>
      <a data-action="finish" ${hostAttr} data-slot="${h(slot.id)}" data-tooltip="Finish now"><i class="fa-solid fa-flag-checkered"></i></a>
      <a data-action="cancel" ${hostAttr} data-slot="${h(slot.id)}" data-tooltip="Cancel (no refund)"><i class="fa-solid fa-ban"></i></a>` : `
      <a data-action="damage" ${hostAttr} data-slot="${h(slot.id)}" data-damaged="${slot.damaged ? "0" : "1"}" data-tooltip="${slot.damaged ? "Mark repaired" : "Mark damaged"}"><i class="fa-solid fa-house-crack"></i></a>`}
      <a data-action="remove" ${hostAttr} data-slot="${h(slot.id)}" data-tooltip="Remove (no refund)"><i class="fa-solid fa-trash"></i></a></span>`;
  return `<li class="sm-slot"><div>${parts.join(" ")}${text ? `<div class="sm-sub">${h(text)}</div>` : ""}</div>${gm}</li>`;
}

/** The Build list for a host: available entries first, unavailable greyed out with the reason. */
export function buildListHTML(list, hostAttr, canAct) {
  if (!list.length) return `<p class="sm-sub">Nothing can be built here.</p>`;
  return `<ul class="sm-build-list">${list.map(b => `
    <li class="${b.ok ? "" : "sm-disabled"}" ${b.ok ? "" : `data-tooltip="${h(b.reason)}"`}>
      <div><strong>${h(b.label)}</strong> <span class="sm-sub">${b.weeks} wk · DC ${b.dc}${b.cost ? ` · ${b.cost} Materials/wk` : ""}</span>
      ${b.ok ? "" : `<div class="sm-reason">${h(b.reason)}</div>`}${b.text ? `<div class="sm-sub">${h(b.text)}</div>` : ""}</div>
      ${b.ok && canAct ? `<button type="button" data-action="build" ${hostAttr} data-building="${h(b.id)}">${game.user.isGM ? "Build" : "Request"}</button>` : ""}
    </li>`).join("")}</ul>`;
}

export const hostAttrs = host => `data-host="${h(JSON.stringify(host))}"`;
export const readHost = el => JSON.parse(el.dataset.host);
export const canAct = () => gmOnline();
export const noGMNote = () => (gmOnline() ? "" : `<p class="sm-warn">A GM needs to be online to change anything.</p>`);
export const clock = () => core()?.getClock?.() || { week: 0, phase: "upkeep" };
