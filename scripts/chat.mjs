/** Chat cards: build attempts, upkeep, requests and GM notes, and their buttons. */
import { ID, escapeHTML, DEGREES } from "./logic/const.mjs";
import { degreeName, degreeLabel } from "./logic/construction.mjs";
import { upkeepText, editUpkeep } from "./logic/upkeep.mjs";
import { core, run, data, building, resourceLabel, gmOnline, hostInfo } from "./link.mjs";

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const speaker = { alias: "Settlement Manager" };
const skillLabel = slug => globalThis.CONFIG?.PF2E?.skills?.[slug]?.label ? game.i18n.localize(CONFIG.PF2E.skills[slug].label) : slug.replace(/(^|-)(\w)/g, (m, d, c) => `${d ? " " : ""}${c.toUpperCase()}`);
const Flows = () => import("./flows.mjs");

/* ---------------------------------------------------------------- card HTML */
function attemptHTML(key) {
  const at = data().pub.attempts[key];
  if (!at) return `<div class="sm-card"><p>This build attempt is from an earlier week.</p></div>`;
  const label = escapeHTML(building(at.building)?.label || at.building);
  const where = escapeHTML(hostInfo(at.host)?.label || "");
  const head = `<h3>${label}</h3><p class="sm-sub">${where} · DC ${at.dc}${at.cost ? ` · ${at.cost} Materials spent` : ""}</p>`;
  if (at.status === "open") {
    const skills = (at.skills.length ? at.skills : ["crafting"]).map(s => `<button type="button" data-sm="roll" data-skill="${escapeHTML(s)}">Roll ${escapeHTML(skillLabel(s))}</button>`).join("");
    const gm = `<div class="sm-gm-only"><select data-sm-degree>${DEGREES.slice().reverse().map(d => `<option value="${d}">${degreeLabel(d)}</option>`).join("")}</select><button type="button" data-sm="enter">Enter result</button></div>`;
    return `<div class="sm-card" data-sm-key="${escapeHTML(key)}">${head}<div class="sm-buttons">${skills}</div>${gm}</div>`;
  }
  if (at.status === "rolled") return `<div class="sm-card">${head}<p>${escapeHTML(at.actorName || "")} rolled: <strong>${degreeLabel(at.degree)}</strong>. Waiting for the GM's client to apply it…</p></div>`;
  return `<div class="sm-card">${head}<p>${escapeHTML(at.result || "Done.")}</p></div>`;
}

export function attemptCard(it) {
  return ChatMessage.create({ content: attemptHTML(it.key), speaker, flags: { [ID]: { card: { type: "attempt", key: it.key } } } });
}
export async function refreshAttemptCard(messageId) {
  const msg = game.messages.get(messageId); if (!msg) return;
  const card = msg.getFlag(ID, "card");
  await msg.update({ content: attemptHTML(card.key) });
}

export function upkeepCard(s, upkeep) {
  const labels = Object.fromEntries(upkeep.lines.map(l => [l.resource, resourceLabel(l.resource)]));
  const body = `<h3>Upkeep: ${escapeHTML(s.name)}</h3><p>${escapeHTML(upkeepText(upkeep.lines, labels))}</p>${upkeep.shortage ? `<p class="sm-warn">Shortage: the stock goes to 0 and the rest is not paid. Nothing else happens automatically.</p>` : ""}`;
  return ChatMessage.create({
    content: `<div class="sm-card">${body}<div class="sm-buttons"><button type="button" data-sm="upkeep-apply">Apply</button><button type="button" data-sm="upkeep-edit">Edit</button><button type="button" data-sm="upkeep-skip">Skip</button></div></div>`,
    whisper: gmIds(), speaker, flags: { [ID]: { card: { type: "upkeep", lines: upkeep.lines, done: false } } }
  });
}

export function openAttemptsCard(week) {
  return ChatMessage.create({
    content: `<div class="sm-card"><h3>Resolution, week ${week}</h3><p>Open this week's build attempts? Materials are spent now, one attempt per pending build.</p><div class="sm-buttons"><button type="button" data-sm="open-attempts">Open build attempts</button></div></div>`,
    whisper: gmIds(), speaker, flags: { [ID]: { card: { type: "open-attempts", done: false } } }
  });
}

export function gmNote(text) {
  return ChatMessage.create({ content: `<div class="sm-card"><p>${escapeHTML(text)}</p></div>`, whisper: gmIds(), speaker });
}

/** Posted by the player's own client after a request; the GM handles it from here. */
export function requestCard(req) {
  let text;
  if (req.kind === "build") text = `${escapeHTML(game.user.name)} asks to build <strong>${escapeHTML(building(req.building)?.label || req.building)}</strong> on ${escapeHTML(hostInfo(req.host)?.label || "the map")}.`;
  else text = `${escapeHTML(game.user.name)} reports Work on <strong>${escapeHTML(req.target?.label || "a hex")}</strong>${req.note ? `: ${escapeHTML(req.note)}` : ""}.`;
  return ChatMessage.create({
    content: `<div class="sm-card"><p>${text}</p><div class="sm-buttons"><button type="button" data-sm="req-approve">${req.kind === "build" ? "Approve" : "Record Work…"}</button><button type="button" data-sm="req-reject">Reject</button></div></div>`,
    whisper: [...new Set([game.user.id, ...gmIds()])], speaker: ChatMessage.getSpeaker(), flags: { [ID]: { card: { type: "request", id: req.id, kind: req.kind, sceneId: req.sceneId, key: req.key, done: false } } }
  });
}

async function closeCard(msg, text) {
  const card = msg.getFlag(ID, "card");
  await msg.update({ content: `<div class="sm-card"><p>${escapeHTML(text)}</p></div>`, [`flags.${ID}.card`]: { ...card, done: true } });
}

/* ---------------------------------------------------------------- rolling */
/** Pick one of the user's own characters (asks when there are several). */
export async function pickActor() {
  const own = game.actors.filter(a => a.isOwner && (game.user.isGM ? a.type === "character" : true));
  const preferred = game.user.character;
  const list = preferred ? [preferred, ...own.filter(a => a.id !== preferred.id)] : own;
  if (!list.length) { ui.notifications.warn("You don't own a character to roll with."); return null; }
  if (list.length === 1) return list[0];
  const { DialogV2 } = foundry.applications.api;
  const id = await DialogV2.prompt({
    window: { title: "Roll with which character?" },
    content: `<select name="actor">${list.map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join("")}</select>`,
    ok: { label: "Roll", callback: (event, button) => button.form.elements.actor.value },
    rejectClose: false
  });
  return id ? game.actors.get(id) : null;
}

/** Roll a PF2e skill against a DC and return the degree name (or null if cancelled). */
export async function rollSkill(actor, slug, dc, label) {
  const stat = actor.skills?.[slug] ?? actor.getStatistic?.(slug);
  if (!stat) { ui.notifications.warn(`${actor.name} has no ${skillLabel(slug)} skill.`); return null; }
  const roll = await stat.roll({ dc: { value: dc }, extraRollOptions: ["action:improve", `${ID}`], title: label });
  if (!roll) return null;
  let degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) degree = roll.total >= dc + 10 ? 3 : roll.total >= dc ? 2 : roll.total <= dc - 10 ? 0 : 1;
  return { degree: degreeName(degree), total: roll.total };
}

/* ---------------------------------------------------------------- buttons */
export function onRenderChatMessage(message, html) {
  const card = message.getFlag(ID, "card"); if (!card) return;
  const root = html instanceof HTMLElement ? html : html?.[0]; if (!root) return;
  if (!game.user.isGM) root.querySelectorAll(".sm-gm-only").forEach(e => e.remove());
  if (card.type !== "attempt" && !game.user.isGM) root.querySelectorAll(".sm-buttons").forEach(e => e.remove());
  if (card.type === "attempt") {
    const at = data().pub.attempts[card.key];
    if (!at || at.status !== "open") root.querySelectorAll("[data-sm]").forEach(b => (b.disabled = true));
  }
  if (card.done) root.querySelectorAll("[data-sm]").forEach(b => (b.disabled = true));
  root.querySelectorAll("button[data-sm]").forEach(btn => btn.addEventListener("click", ev => {
    ev.preventDefault();
    if (!gmOnline()) { ui.notifications.warn("A GM needs to be online."); return; }
    btn.disabled = true;
    handle(message, card, btn, root).catch(e => { ui.notifications.error(`Settlement Manager: ${e.message}`); console.error(e); }).finally(() => { btn.disabled = false; });
  }));
}

async function handle(message, card, btn, root) {
  const action = btn.dataset.sm;
  const flows = await Flows();
  switch (action) {
    case "roll": {
      const at = data().pub.attempts[card.key]; if (at?.status !== "open") return;
      const actor = await pickActor(); if (!actor) return;
      const label = building(at.building)?.label || at.building;
      const res = await rollSkill(actor, btn.dataset.skill, at.dc, `Build: ${label}`); if (!res) return;
      await run("submitRoll", { key: card.key, degree: res.degree, actorId: actor.id, actorName: actor.name, skill: btn.dataset.skill, total: res.total });
      return;
    }
    case "enter": {
      const degree = root.querySelector("[data-sm-degree]")?.value;
      await run("submitRoll", { key: card.key, degree, actorName: "GM" });
      return;
    }
    case "upkeep-apply": await flows.applyUpkeep(card.lines); return closeCard(message, `Upkeep applied: ${upkeepText(card.lines, labelsFor(card.lines))}`);
    case "upkeep-skip": await flows.log("upkeep", "Upkeep was skipped by the GM."); return closeCard(message, "Upkeep skipped.");
    case "upkeep-edit": {
      const { DialogV2 } = foundry.applications.api;
      const edits = await DialogV2.prompt({
        window: { title: "Edit upkeep" },
        content: card.lines.map(l => `<label class="sm-row">${escapeHTML(resourceLabel(l.resource))} <input type="number" min="0" name="${escapeHTML(l.resource)}" value="${l.cost}"></label>`).join("") || "<p>No upkeep due.</p>",
        ok: { label: "Apply", callback: (event, button) => Object.fromEntries(card.lines.map(l => [l.resource, button.form.elements[l.resource]?.value])) },
        rejectClose: false
      });
      if (!edits) return;
      const lines = editUpkeep(card.lines, edits);
      await flows.applyUpkeep(lines);
      return closeCard(message, `Upkeep applied (edited): ${upkeepText(lines, labelsFor(lines))}`);
    }
    case "open-attempts": await flows.openAttempts(); return closeCard(message, "Build attempts opened.");
    case "req-approve": {
      if (card.kind === "work") {
        const { openRecordWork } = await import("./ui/dialogs.mjs");
        const done = await openRecordWork(card.sceneId, card.key);
        if (!done) return;
        await run("takeRequest", { id: card.id }).catch(() => {});
        return closeCard(message, "Work recorded.");
      }
      await flows.approveRequest(card.id);
      return closeCard(message, "Approved and started.");
    }
    case "req-reject": await flows.rejectRequest(card.id); return closeCard(message, "Rejected.");
  }
}
const labelsFor = lines => Object.fromEntries(lines.map(l => [l.resource, resourceLabel(l.resource)]));

/** Re-render attempt cards when module data changes, so buttons enable/disable for everyone. */
export function refreshVisibleCards() {
  for (const msg of game.messages.contents.slice(-30)) {
    if (msg.getFlag(ID, "card")?.type === "attempt") ui.chat?.updateMessage?.(msg);
  }
}
