/** The weekly Chronicle page (decision D15). No Foundry dependency. */
import { EVENT_KINDS, escapeHTML } from "./const.mjs";

const HEADINGS = {
  founded: "Founding", upkeep: "Upkeep", "build-start": "Construction started", "build-progress": "Construction",
  "build-complete": "Completed", "build-setback": "Setbacks", "build-removed": "Removed", work: "Work",
  resources: "Resources", stats: "The settlement", note: "Notes"
};

export const pageName = week => `Week ${week}`;
export const chronicleName = settlementName => `Chronicle — ${settlementName}`;

/** Events for one settlement in one week, as the HTML of a journal page. */
export function weekPageHTML(week, events) {
  if (!events.length) return `<p><em>A quiet week.</em></p>`;
  const groups = new Map();
  for (const e of events) {
    const kind = EVENT_KINDS.includes(e.kind) ? e.kind : "note";
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(e);
  }
  const parts = [];
  for (const kind of EVENT_KINDS) {
    const list = groups.get(kind); if (!list) continue;
    parts.push(`<h3>${HEADINGS[kind]}</h3><ul>${list.map(e => `<li>${escapeHTML(e.text)}</li>`).join("")}</ul>`);
  }
  return parts.join("\n");
}

/** A short recap line for the Week End chat card. */
export function recapText(events) {
  const count = k => events.filter(e => e.kind === k).length;
  const done = count("build-complete"), progressed = count("build-progress"), started = count("build-start");
  const bits = [];
  if (started) bits.push(`${started} started`);
  if (progressed) bits.push(`${progressed} progressed`);
  if (done) bits.push(`${done} completed`);
  return bits.length ? `Construction: ${bits.join(", ")}.` : "No construction this week.";
}
