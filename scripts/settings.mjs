import { ID } from "./logic/const.mjs";

export function registerSettings(onChange = () => {}) {
  game.settings.register(ID, "mainSettlementId", { scope: "world", config: false, type: String, default: "", onChange });
  game.settings.register(ID, "upkeepRationsPerPop", {
    name: "Rations per population per week", hint: "Upkeep in Rations for each person, each week.",
    scope: "world", config: true, type: Number, default: 1, range: { min: 0, max: 10, step: 1 }
  });
  game.settings.register(ID, "upkeepFlat", {
    name: "Extra weekly upkeep", hint: 'Flat costs on top of Rations, as "resource=amount" pairs separated by commas, e.g. "supplies=1". Leave empty for none.',
    scope: "world", config: true, type: String, default: ""
  });
  game.settings.register(ID, "playerBuildsNeedApproval", {
    name: "Player builds need GM approval", hint: "When on, a player's build is a request the GM approves or rejects.",
    scope: "world", config: true, type: Boolean, default: true, onChange
  });
  game.settings.register(ID, "buildingsFolder", {
    name: "Folder for your own buildings", hint: "Folder in your user data with one JSON file per building. Use Reload buildings in the Settlements window after changing it.",
    scope: "world", config: true, type: String, default: "settlement-manager/buildings"
  });
}

/** "supplies=1, materials=2" -> { supplies: 1, materials: 2 } */
export function parseFlat(text) {
  const out = {};
  for (const part of String(text || "").split(",")) {
    const [k, v] = part.split("=").map(x => x?.trim());
    if (k && Number.isFinite(Number(v))) out[k] = Math.max(0, Math.trunc(Number(v)));
  }
  return out;
}
