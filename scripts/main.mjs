/** Settlement Manager: entry point and hooks. */
import { ID } from "./logic/const.mjs";
import { createActions } from "./logic/data.mjs";
import { registerSettings } from "./settings.mjs";
import { connect, coreCheck, reportCheck, isHost } from "./link.mjs";
import { applyPublished, reloadBuildings } from "./buildings.mjs";
import * as Flows from "./flows.mjs";
import { onRenderChatMessage, refreshVisibleCards } from "./chat.mjs";
import { SettlementsApp } from "./ui/app.mjs";
import { HexPanel, setHexTool, bindCanvas } from "./ui/hex.mjs";

const refreshViews = () => { SettlementsApp.refresh(); HexPanel.refresh(); };

Hooks.once("init", () => {
  registerSettings(refreshViews);
  game.modules.get(ID).api = { open: () => SettlementsApp.toggle(), openHex: (sceneId, key) => HexPanel.show(sceneId, key), reloadBuildings };
});

/** Core calls this at setup on every client: register our actions so the host can run them. */
Hooks.once("settlementCore.register", coreApi => {
  connect();
  const ownsActor = (userId, actorId) => {
    const user = game.users.get(userId), actor = game.actors.get(actorId);
    return !!(user && actor?.testUserPermission(user, "OWNER"));
  };
  for (const [name, action] of Object.entries(createActions({ ownsActor }))) coreApi.registerAction(name, action);
});

Hooks.once("settlementCore.ready", async () => {
  connect();
  reportCheck();
  applyPublished(true);
  if (isHost() && coreCheck().ok) {
    try { await reloadBuildings({ quiet: true }); } catch (e) { console.error(`${ID} | building files`, e); }
    await Flows.autoApprove();
    await Flows.applyRolledAttempts();
  }
  refreshViews();
});

Hooks.once("ready", () => {
  if (!game.modules.get("settlement-core")?.active && game.user.isGM) {
    ui.notifications.error("Settlement Manager needs the settlement-core module to be active.", { permanent: true });
  }
});

Hooks.on("settlementCore.changed", () => {
  applyPublished();
  refreshViews();
  refreshVisibleCards();
  if (isHost()) {
    Flows.applyRolledAttempts().catch(e => console.error(`${ID} |`, e));
    Flows.autoApprove().catch(e => console.error(`${ID} |`, e));
  }
});
Hooks.on("settlementCore.phase", info => { Flows.onPhase(info); });

Hooks.on("renderChatMessageHTML", onRenderChatMessage);
Hooks.on("canvasReady", bindCanvas);
Hooks.on("userConnected", refreshViews);
for (const h of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) Hooks.on(h, () => SettlementsApp.refresh());

Hooks.on("getSceneControlButtons", controls => {
  const group = Array.isArray(controls) ? controls.find(c => c.name === "token" || c.name === "tokens") : (controls.tokens ?? controls.token);
  if (!group?.tools) return;
  const tools = [
    { name: "sm-settlements", title: "Settlements", icon: "fa-solid fa-chess-rook", button: true, onChange: () => SettlementsApp.toggle(), onClick: () => SettlementsApp.toggle() },
    { name: "sm-hex", title: "Hex buildings (click a hex)", icon: "fa-solid fa-hammer", toggle: true, active: false, onChange: (event, active) => setHexTool(active), onClick: active => setHexTool(active) }
  ];
  for (const tool of tools) {
    if (Array.isArray(group.tools)) group.tools.push(tool);
    else group.tools[tool.name] = { ...tool, order: Object.keys(group.tools).length };
  }
});
