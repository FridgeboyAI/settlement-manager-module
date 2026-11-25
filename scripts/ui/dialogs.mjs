/** Dialogs: confirm, set the clock, found a settlement, Record Work. */
import { DEGREES, escapeHTML as h } from "../logic/const.mjs";
import { degreeLabel } from "../logic/construction.mjs";
import { workTargets, buildingProfile } from "../logic/work.mjs";
import { core, run, building, resourceLabel } from "../link.mjs";
import { PHASE_LABELS } from "./view.mjs";

const D = () => foundry.applications.api.DialogV2;

export function reportError(e) {
  console.error("settlement-manager |", e);
  ui.notifications.error(`Settlement Manager: ${e?.message || e}`);
}

export function confirm(title, text) {
  return D().confirm({ window: { title }, content: `<p>${h(text)}</p>`, rejectClose: false });
}

export async function setClockDialog() {
  const { week, phase } = core().getClock();
  const res = await D().prompt({
    window: { title: "Set week and phase" },
    content: `<label class="sm-row">Week <input type="number" name="week" min="0" value="${week}"></label>
      <label class="sm-row">Phase <select name="phase">${Object.entries(PHASE_LABELS).map(([k, l]) => `<option value="${k}" ${k === phase ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <p class="sm-sub">Jumping to a phase runs that phase's step (for example Week End writes the Chronicle page).</p>`,
    ok: { label: "Set", callback: (e, b) => ({ week: Math.max(0, Math.trunc(Number(b.form.elements.week.value) || 0)), phase: b.form.elements.phase.value }) },
    rejectClose: false
  });
  if (res) await core().request("clock.set", res).catch(reportError);
}

export async function foundDialog(sceneId, key) {
  const tile = core().getTile(sceneId, key);
  const name = await D().prompt({
    window: { title: "Found the settlement" },
    content: `<p>Found the settlement on ${h(tile?.name || key)}?</p><label class="sm-row">Name <input type="text" name="name" value="" placeholder="Settlement name" autofocus></label>`,
    ok: { label: "Found", callback: (e, b) => b.form.elements.name.value.trim() || "Settlement" },
    rejectClose: false
  });
  if (!name) return;
  const { found } = await import("../flows.mjs");
  await found(name, sceneId, key).catch(reportError);
}

/** All workable targets the user can see, optionally on one hex. */
function targetsFor(sceneId, key) {
  const api = core();
  const state = api.getState();
  const out = [];
  for (const [sid, tiles] of Object.entries(state.tiles || {})) {
    if (sceneId && sid !== sceneId) continue;
    for (const tile of Object.values(tiles || {})) {
      if (!tile || (key && tile.key !== key)) continue;
      const where = tile.name || tile.key;
      for (const t of workTargets({ tile, sceneId: sid, getBuilding: id => api.get("buildings", id), getDiscoverable: id => api.get("discoverables", id) })) {
        out.push({ ...t, sceneId: sid, key: tile.key, label: `${t.label} (${where})` });
      }
    }
  }
  return out;
}

function profileFor(t) {
  const api = core();
  if (t.kind === "discoverable") {
    const p = api.workProfile(t.ref);
    const d = api.getTile(t.sceneId, t.key)?.discoverables.find(x => x.id === t.ref.id);
    return { ...p, skills: api.get("discoverables", d?.type)?.skills || [] };
  }
  const slotDef = building(api.getTile(t.sceneId, t.key)?.slots.find(s => s.id === t.slotId)?.built);
  return { ...buildingProfile(t, api.activityDC("work")), skills: slotDef?.skills || [] };
}

/** GM: record a Work result. Player: report Work for the GM to record. Returns true when something was recorded. */
export async function openRecordWork(sceneId, key) {
  const targets = targetsFor(sceneId, key);
  if (!targets.length) { ui.notifications.info("There is nothing workable here: no found resource and no producing building."); return false; }
  const isGM = game.user.isGM;
  const resources = core().all("resources");
  const options = targets.map((t, i) => `<option value="${i}">${h(t.label)}</option>`).join("");
  if (!isGM) {
    const res = await D().prompt({
      window: { title: "Report Work" },
      content: `<label class="sm-row">Worked <select name="t">${options}</select></label><label class="sm-row">Note <input type="text" name="note" placeholder="Who worked it, and the result"></label>`,
      ok: { label: "Send to the GM", callback: (e, b) => ({ t: targets[Number(b.form.elements.t.value)], note: b.form.elements.note.value }) },
      rejectClose: false
    });
    if (!res) return false;
    const id = await run("requestWork", { sceneId: res.t.sceneId, key: res.t.key, target: { label: res.t.label }, note: res.note }).catch(reportError);
    if (!id) return false;
    const { requestCard } = await import("../chat.mjs");
    await requestCard({ kind: "work", id, sceneId: res.t.sceneId, key: res.t.key, target: { label: res.t.label }, note: res.note });
    ui.notifications.info("Sent to the GM.");
    return true;
  }
  const first = profileFor(targets[0]);
  const content = `
    <label class="sm-row">Worked <select name="t">${options}</select></label>
    <p class="sm-sub" data-profile>Die ${h(first.die)} · DC ${first.dc}${first.checkBonus ? ` · +${first.checkBonus} to the check` : ""}${first.bonusResources ? ` · +${first.bonusResources} bonus` : ""}</p>
    <label class="sm-row">Resource <select name="resource">${resources.map(r => `<option value="${h(r.id)}" ${r.id === targets[0].resource ? "selected" : ""}>${h(r.label || r.id)}</option>`).join("")}<option value="" ${targets[0].resource === "" ? "selected" : ""}>Items (the GM hands them out)</option></select></label>
    <label class="sm-row">Result <select name="degree">${DEGREES.slice().reverse().map(d => `<option value="${d}" ${d === "success" ? "selected" : ""}>${degreeLabel(d)}</option>`).join("")}</select></label>
    <p class="sm-sub">Enter the result from the table, or roll with a character (the check bonus is taken off the DC).</p>`;
  const res = await D().wait({
    window: { title: "Record Work" },
    content,
    render: (event, dialog) => {
      const el = dialog.element ?? dialog;
      const form = el.querySelector("form") || el;
      form.querySelector("[name=t]")?.addEventListener("change", ev => {
        const t = targets[Number(ev.currentTarget.value)], p = profileFor(t);
        form.querySelector("[data-profile]").textContent = `Die ${p.die} · DC ${p.dc}${p.checkBonus ? ` · +${p.checkBonus} to the check` : ""}${p.bonusResources ? ` · +${p.bonusResources} bonus` : ""}`;
        form.querySelector("[name=resource]").value = t.resource;
      });
    },
    buttons: [
      { action: "roll", label: "Roll with a character", callback: (e, b) => ({ mode: "roll", t: targets[Number(b.form.elements.t.value)], resource: b.form.elements.resource.value }) },
      { action: "record", label: "Record", default: true, callback: (e, b) => ({ mode: "record", t: targets[Number(b.form.elements.t.value)], resource: b.form.elements.resource.value, degree: b.form.elements.degree.value }) }
    ],
    rejectClose: false
  });
  if (!res || typeof res !== "object") return false;
  const p = profileFor(res.t);
  let degree = res.degree;
  if (res.mode === "roll") {
    const { pickActor, rollSkill } = await import("../chat.mjs");
    const actor = await pickActor(); if (!actor) return false;
    const skills = p.skills.length ? p.skills : ["athletics"];
    const skill = skills.length === 1 ? skills[0] : await D().prompt({
      window: { title: "Which skill?" }, content: `<select name="s">${skills.map(s => `<option value="${h(s)}">${h(s)}</option>`).join("")}</select>`,
      ok: { label: "Roll", callback: (e, b) => b.form.elements.s.value }, rejectClose: false
    });
    if (!skill) return false;
    const r = await rollSkill(actor, skill, p.dc - (p.checkBonus || 0), `Work: ${res.t.label}`);
    if (!r) return false;
    degree = r.degree;
  }
  const { recordWork } = await import("../flows.mjs");
  const amount = await recordWork({ label: res.t.label, die: p.die, degree, bonusResources: p.bonusResources || 0, resource: res.resource }).catch(reportError);
  if (amount !== undefined) ui.notifications.info(`Work: ${degreeLabel(degree)}, +${amount} ${res.resource ? resourceLabel(res.resource) : "item(s) for the GM to hand out"}.`);
  return amount !== undefined;
}
