# Settlement Manager

Module id: `settlement-manager` · Version: `0.1.1` (matches module.json) · Stage: `Testing`

## What it does
The Settlement module on settlement-core. The GM founds one settlement on a revealed hex; it holds the shared pool
of resources. A Settlements window shows its stats (with breakdowns), buildings, stocks and history; a Hex buildings
tool shows any hex's buildings and resources. Buildings are started by the GM or requested by players, then built
through one PF2e skill check per week (degrees of success and a 1d6 setback chart). Each week the module helps the
GM with upkeep (1 Ration per population), build attempts and a Chronicle journal page.

## When it shows up
- Token controls: *Settlements* (window) and *Hex buildings* (toggle; a click on a hex opens its panel).
- Chat cards: upkeep, open build attempts and requests (GM only), and build attempts (everyone; players roll).
- Only acts on week phases on the host GM's client (the active GM with the lowest id). Nothing changes a number
  without a GM click, except applying a rolled build attempt.

## Who sees what
- Players: everything public in settlement-core's player copy, read-only; can request builds, roll on attempt cards
  with a character they own, and report Work. Their rolls are re-checked on the GM's client.
- GM: everything, plus founding, stats, stocks, access, approvals, overrides, Record Work, Reload buildings, set week.
- GM notes and open requests live in the `gm` half of the module data, which settlement-core never sends to players.
- Without an active GM, everything is read-only.

## Settings
| Setting | Scope (world/client) | Values | Default | Effect |
|---|---|---|---|---|
| Rations per population per week | world | 0–10 | 1 | Upkeep in Rations |
| Extra weekly upkeep | world | `resource=amount, ...` | empty | Flat weekly costs |
| Player builds need GM approval | world | on/off | on | Off: player builds start automatically |
| Folder for your own buildings | world | path in user data | `settlement-manager/buildings` | GM building files (one JSON per building; `patch` merges) |

Stored without a settings entry: the main settlement id (world setting, hidden); everything else is in
settlement-core's state under `modules["settlement-manager"]` (published building list, this week's attempts and
events, Chronicle ids; GM notes and requests in the `gm` half). Chronicle journals are ordinary journal entries.

## Relies on
- **settlement-core** ≥ 0.2.1 (required): reads, writes and hooks listed in the proposal §10a; the API is checked at
  startup and a missing call turns off only the features that need it. No lib module.
- **PF2e**: `actor.skills[slug].roll({ dc })` and the roll's `degreeOfSuccess`.
- **Foundry 14**: `ApplicationV2`, `DialogV2`, `FilePicker.browse`, `JournalEntry`/`JournalEntryPage`, `ChatMessage`
  flags and `renderChatMessageHTML`, `getSceneControlButtons`, `canvas.grid.getOffset`, `canvasCoordinatesFromClient`.
- No socket of its own: every change goes through settlement-core's pipeline.

## Files
| File | Role |
|---|---|
| `scripts/main.mjs` | Entry point: settings, action registration, hooks, scene controls |
| `scripts/link.mjs` | The only file that talks to settlement-core; API check; host GM rule |
| `scripts/flows.mjs` | Founding, building, overrides, attempts, upkeep, Work, Chronicle, phase reactions |
| `scripts/buildings.mjs` | Reads, checks and publishes GM building files; registers them on every client |
| `scripts/chat.mjs` | Chat cards and their buttons; PF2e skill rolls |
| `scripts/settings.mjs` | World settings |
| `scripts/ui/*.mjs` | Settlements window, Hex buildings panel and tool, dialogs, view helpers |
| `scripts/logic/*.mjs` | Rules without Foundry: building files, stats, construction, upkeep, Work, Chronicle, module-data actions, API check |
| `tests/*.test.mjs` | Rules tests and a glue smoke test, run against settlement-core v0.2.1 |
| `tests/fetch-core.mjs` | Downloads the pinned settlement-core version into `tests/.core/` (not committed) before `npm test` |
| `.github/workflows/release.yml` | Final `vX.Y.Z` tag → full release with zip and `module.json` (stable `releases/latest` manifest) |

## Known limits
- One settlement in v1; Leaders not counted in Security; no hidden buildings, storage caps, trade or automatic access.
- A GM must be online for any change.
- Not yet run inside Foundry.

## Test checklist
See the README's "Manual test checklist".
