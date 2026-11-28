# Settlement Manager — v0.1.3

The **Settlement** module for the group's weekly settlement game on Foundry VTT 14 with Pathfinder 2e. It builds on
**settlement-core**, which owns all the data (tiles, the settlement, resources, building slots and the week clock).
Settlement Manager adds the windows and the weekly procedures: founding the settlement, building on it and on the
map with PF2e skill checks, the shared resource pool, upkeep, recording Work, and a weekly Chronicle.

> **Untested in Foundry.** The rules and the wiring pass Node tests (`npm test`, which first downloads the pinned
> settlement-core version into `tests/.core/`), including a full week played against the real settlement-core code with stubbed Foundry globals. Nothing has run in a live
> world yet. Back up your world first.

Design: `M:\RoboFoundry\PF2e\Empire Management\shared\proposals\settlement-manager.md`.

## Install a test build (the `test` branch)
This branch carries a ready-made `settlement-manager.zip`. Either:
- In Foundry's *Install Module* screen, paste the manifest URL
  `https://raw.githubusercontent.com/FridgeboyAI/settlement-manager-module/test/module.json`, or
- download `settlement-manager.zip` from this branch and unzip it into `Data/modules/settlement-manager/`
  (so that `module.json` sits directly in that folder), then restart Foundry.

settlement-core 0.3.2 must be installed too (Foundry offers to install it from its manifest) with *Load the Liftland
content set* on. Test builds keep this manifest, so *Check for updates* picks up a newer test build.

## Install
- Manifest URL (permanent; updates come through it): `https://raw.githubusercontent.com/FridgeboyAI/settlement-manager-module/main/module.json`
- It requires **settlement-core** (0.3.2 or later); Foundry offers to install it. Turn on settlement-core's
  *Load the Liftland content set* for the default buildings.
- For testing a build branch, deploy it with `M:\RoboFoundry\tools\deploy-modules.ps1 -Module settlement-manager`.

## How it works
- **One settlement.** The GM founds it on a revealed hex (switch on **Hex buildings** in the token controls, click
  the hex, *Found settlement here*). Everything is paid from and paid into its stocks: upkeep, construction and Work,
  including buildings on tiles and resources anywhere on the map.
- **Settlements window** (token controls → *Settlements*): week and phase, and tabs for the overview (stats with
  breakdowns on hover, warnings, access, GM notes), buildings, resources (stocks, upkeep, Record Work) and history.
- **Hex buildings** (token controls, toggle): click a hex to see its buildings, each found resource's improvement
  levels and work profile, and the build lists. It's off by default so it never takes the Tile Viewer's click.
- **Stats.** Population and base morale are set by the GM. Housing, building morale and Security are calculated
  from finished, undamaged buildings, so removing one leaves no stale bonus. Security is settlement-core's tile
  Security of the home hex (which already includes the settlement's buildings). Leaders aren't counted yet.
- **Building.** Unavailable buildings are greyed out with the reason (core's placement rules, plus access such as
  Lumber or Stone, which this module checks). Players send requests the GM approves (a setting can turn approval off).
- **The week**, driven by the GM with *Advance*:
  - **Upkeep:** a GM card with the upkeep (1 Ration per population by default) — *Apply*, *Edit* or *Skip*. A shortage
    empties the stock and shows a warning; nothing else happens automatically.
  - **Resolution:** a GM card *Open build attempts* spends each pending build's Materials (missing means 0) and posts
    one card per build. A player rolls a skill from the card with their own character, or the GM enters the result.
    Critical success: +1 week and 1 Materials back. Success: +1 week. Failure: nothing. Critical failure: a Mishap
    d6, reported for the GM to apply (1–2 Injury: a PC takes 1d6 damage or a Team 2 Injuries; 3–4 one Materials access
    disrupted until re-secured; 5–6 an encounter suited to the hex). One attempt per build per week.
  - **Week End:** the week's events are written to the settlement's *Chronicle* journal as a page *Week N*, and a recap
    is posted. Players can read the Chronicle; the GM can add to it.
- **Record Work:** pick a found resource or a producing building, enter the result or roll with a character. Success
  adds the die; a critical success doubles it; a failure gives half the die (minimum 1); a critical failure nothing.
  A building's bonus resources are +1 Resources each, separate from the yield, on a success or better (doubled on a
  critical success). A producing building on a Fully Explored tile has −2 to its Work DC. Yields only ever come
  from Work. The resource comes from what the resource or building
  `produces`; a resource that yields specific items (no stock) is only written to the Chronicle for the GM to hand out.
- **GM overrides:** ±1 week, finish now, cancel (no refund), remove (no refund), mark damaged, set week and phase,
  adjust stocks with a reason, edit population and morale.
- **No GM online:** everyone can read, every action is disabled.

## Settings
| Setting | Scope | Default | Effect |
|---|---|---|---|
| Rations per population per week | world | 1 | Upkeep in Rations |
| Extra weekly upkeep | world | empty | Flat costs, e.g. `supplies=1, materials=0` |
| Player builds need GM approval | world | on | Off: player builds start as soon as the GM's client sees them |
| Folder for your own buildings | world | `settlement-manager/buildings` | Where the GM's building files live |

## Your own buildings
Put one JSON file per building in the folder above (in your Foundry user data), then press **Reload buildings** in
the Settlements window (it also runs when the GM logs in). Use settlement-core's building fields plus an `id`:

```json
{ "id": "smithy-1", "label": "Smithy", "complexity": 1, "hosts": ["settlement"], "skills": ["crafting"],
  "needs": ["stone"], "materialsPerWeek": 1, "effects": { "morale": 1 }, "text": "Repairs tools." }
```

- A file with an existing id **replaces** that building. Add `"patch": true` to change only some fields, e.g.
  `{ "id": "palisade-2", "patch": true, "materialsPerWeek": 2 }`.
- Allowed fields: `label`, `complexity`/`level`, `hosts` (settlement, tile, discoverable), `family`, `requires`,
  `needs`, `skills`, `terrain`, `tileTags`, `discoverableCategories`, `discoverableTypes`, `dc`, `weeks`,
  `materialsPerWeek`, `effects`, `text`. Effects: `security`, `houses`, `morale`, `travelDC`, `travelExploreBonus`,
  `yieldStep`, `workDC`, `workBonus`, `workDie`, `produces`, `bonusResources`, `eventSeverityStep`.
- Invalid files are skipped and listed in a GM-only chat message, with the reason.
- Removing a file takes effect after a world reload.

## Macro
`game.modules.get("settlement-manager").api.open()` toggles the Settlements window;
`.openHex(sceneId, "row,col")` opens a hex; `.reloadBuildings()` reloads the GM's files.

## Manual test checklist
Test world: Foundry 14, PF2e, settlement-core 0.3.2 with Liftland on, settlement-hex-manager present but not needed,
one GM and one player client (the player owns a character). Save at least two revealed hexes in settlement-core first
(one with a found resource, e.g. via `game.modules.get("settlement-core").api`).

1. **Found.** GM: Hex buildings on → click a revealed hex → *Found settlement here* → name it. The Settlements window
   shows it; a *Chronicle — <name>* journal exists. Clicking *Found* again on another hex is refused. The player
   sees the settlement read-only (no inputs, no override buttons).
2. **Building files.** Put a valid file and an invalid one (`{ nope`) in the building folder, press *Reload buildings*:
   the GM gets a chat message naming the invalid file; the new building shows in the GM's and the player's lists.
   A `"patch": true` file changes only the fields it names.
3. **Requests and attempts.** Player requests a building; the GM approves it on the card. Give the settlement
   Materials; go to Resolution; *Open build attempts*: Materials go down by each build's cost; a build that can't be
   paid is listed as short. The player clicks *Roll <skill>* on the card, picks their character and rolls; the card
   updates with the result. Check each degree (the GM can *Enter result*): crit success +1 week and 1 Materials back,
   success +1, failure 0, crit failure a Mishap d6 posted as text (1–2 Injury, 3–4 access disrupted, 5–6 encounter),
   with no change to progress or stocks. A 2-week
   building finishes after two successes. ±1 week and *Finish now* work.
4. **Remove.** Remove a finished building that adds Security or housing: no refund, and the stats drop at once.
   Cancel a pending upgrade (e.g. Yield L3 on top of L2): the earlier level stays.
5. **Upkeep.** Set population 12 with 9 Rations; advance to Upkeep: the card says −9 of 12, shortage of 3. *Apply*
   sets Rations to 0 and only warns. Also try *Edit* and *Skip*.
6. **Record Work.** On a hex with a found resource or a Farm: *Record Work here…*. Success adds the die; Critical
   Success doubles it; Failure adds half the die (minimum 1). On a Pasture II, a success also adds +1 Resources (+2 on a
   critical success). A Farm on a Fully Explored tile shows a DC 2 lower. The player's *Report Work* reaches the GM as a card.
7. **Week End.** Advance to Week End: a page *Week N* appears in the Chronicle with the week's founding, upkeep,
   construction and Work; the player can open it from the History tab.
8. **No GM.** Log the GM out: the player can read every tab; buttons are disabled with "A GM needs to be online".
9. **Access.** A building that needs Lumber is greyed out with "Needs access to Lumber" until the GM ticks Lumber.
10. **Install and update (after the first release).** Install from the permanent `main/module.json` manifest URL;
    after a newer version is released, Foundry's *Check for updates* finds it.

## Known limits
- One settlement (the group hasn't settled multiple settlements; the id lives in a setting so this can change).
- Leaders don't add Security yet (waiting for settlement-teams on core).
- No hidden buildings; no storage caps or trade; no automatic access from buildings.
- Needs a GM online for every change (settlement-core's rule).
