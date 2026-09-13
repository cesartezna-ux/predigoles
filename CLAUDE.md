# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Predigoles (www.predigoles.com) — a soccer score-prediction pool ("polla") web app. Static frontend on GitHub Pages, Google Apps Script + Google Sheets as the backend. No build tooling, no package manager, no test suite: it's plain HTML/CSS/JS and a single `.gs` file, edited and deployed directly.

## Working in this repo

- There is no build/lint/test command — this is not a Node/npm project. Verify frontend changes by opening `index.html` (it works from `file://` too, though `SCRIPT_URL` calls need CORS/https to actually reach the backend) or by pushing to `main`, which GitHub Pages serves at www.predigoles.com (per `CNAME`).
- Backend changes (`Code.gs`) do **not** deploy from git. They must be pasted into the Apps Script project's editor by hand, then redeployed via "Manage deployments" (reusing the existing deployment keeps `SCRIPT_URL` in `index.html` valid; creating a new deployment breaks it until the URL is updated everywhere). `Code.gs.rtf` is a manual backup export, not a build artifact — keep it in sync manually if you rely on it, but treat `Code.gs` as the source of truth.
- `git log` shows commits going directly to `main`; there's no branch/PR workflow currently in use here.

## Architecture

### Multi-tenant model (one spreadsheet, one tab per group)

Every prediction pool ("grupo") is a row of key/value pairs in its own tab of a single Google Sheet, accessed through one Apps Script Web App (`Code.gs`). The frontend has no build-time concept of "which group" — it's resolved at runtime from the URL:

```
TAB = ?grupo= or ?tab= query param, else localStorage["pg_tab"], else "fpc2026"
```

All cloud reads/writes go through `cloudCall()` → `fetch(SCRIPT_URL, {method:"POST", body: {...data, tab: TAB}})`. On the backend, `doPost` sanitizes `tab` (`sanitizeTab`, regex `^[a-zA-Z0-9_-]{1,40}$`) and lazily creates that sheet tab (`getOrCreateTab`) if it doesn't exist. Per-tab data is stored as `key,value` rows (`getValueFromSheet`/`setKey`/`getAllKV`), with JSON-serialized values for structured data (`roster`, `results`, `preds_<playerId>`, `custom`, `teamOverrides`, `betting`, etc.).

Frontend storage has two tiers, both going through `sGet`/`sSet(key, value, sh)`:
- `sh=false` → plain `localStorage`, per-browser (e.g. `"me"` identity, `"organizer"` flag).
- `sh=true` → shared cloud KV for the current `TAB`, cached client-side in `CACHE` (populated once per boot via `fetchAllShared()` → backend action `"getAll"`, then read/written incrementally).

### Central admin ("panel central") vs. per-group admin

Two separate auth layers, both PIN-based but backed differently:
- **Per-group admin PIN** (`organizerPinHash`, stored per-tab as `adminPin`): gates writes to `PROTECTED_KEYS` (`results`, `betting`, `groupName`, `adminPin`, `teamOverrides`, `modoSeguimiento`, `equiposSeguidos`) via `checkAdminAuth` in `Code.gs`. Frontend uses `setJSONAuth()` instead of `setJSON()` for these.
- **Master/central admin** (César): a single `MASTER_PIN_HASH`, kept only in Apps Script Script Properties (never in a sheet, never returned by `getAll`). Gates the `adminListarGrupos` / `adminProvisionarGrupo` / `adminActualizarPago` / `adminResetearPin` actions (`manejarAccionMaestra`), which manage the `_grupos_maestro` sheet — the registry of every provisioned group (id, name, admin contact, tournament, payment status). A group must be provisioned here before it can be used; there's no more "first PIN set wins" self-provisioning. Reached in the frontend via `?admin=central` → `bootPanelCentral()`.
- Tab names starting with `_` (or equal to `_grupos_maestro`) are reserved and rejected by the normal per-group path in `doPost`.

### Tournaments and fixtures

A single `index.html` serves every group and every tournament. `TOURNAMENTS` (in `index.html`) is a catalog keyed by `torneoId`, each entry providing only presentation data: display copy, `FLAG` (emoji per team), `ESCUDOS` (team name → filename under `/escudos/`), and `EXTRA_ALLOWED` (placeholder team names like "Ganador Grupo A"). A group picks its `torneoId` at creation time (`adminProvisionarGrupo`) and that's stored per-tab; `activarTorneo()` applies the matching catalog entry client-side on boot.

The actual match schedule (fixture) is **not** in `TOURNAMENTS` — it lives server-side in its own sheet tab `_fixture_<torneoId>`, loaded by running `cargarFixtureDesdeAPI(torneoId, leagueId, season)` (or the per-tournament shortcuts `correrCargaFixtureUnaVez`/`cargarLaLiga`/`cargarChampions`) manually from the Apps Script editor. This pulls from api-football.com (api-sports.io) and stores translated team names (`TEAM_DICT` handles naming mismatches between the API and this app's canonical names). Frontend reads it via the public `getFixture` action (no PIN — schedules aren't sensitive) and never touches `_fixture_*` tabs directly.

Adding a new tournament: add a `TOURNAMENTS` entry in `index.html` (FLAG/ESCUDOS/EXTRA_ALLOWED), add a fixture-loader shortcut (or call `cargarFixtureDesdeAPI` directly) in `Code.gs`, run it once from the Apps Script editor. No other architecture changes needed.

### Live score sync

`_sincronizar()` in `Code.gs` pulls the full season for `LEAGUE_ID`/`SEASON` (currently hardcoded to one league — Liga BetPlay Colombia, `TORNEO_ACTIVO_SYNC = "fpc_2026_2"`) from api-football.com in one request, matches fixtures by normalized home/away team names (`normalizar`, tolerant of swapped home/away), and writes `results` (finished matches) and `live` (in-progress, with minute/status) into **every** tenant sheet. Triggered by `doGet` (so hitting the deployed web app URL runs a sync) and also callable directly as `runManualSyncTest()`/`cronSincronizarResultados()` from the Apps Script editor or a time-based trigger. Scoring only supports one live league/season at a time — see the comment above `LEAGUE_ID` if that needs to change.

### Scoring

`ptsFor(prediction, result)` in `index.html`: 1 point for correct outcome (win/draw/loss via `outcome()`), +2 more (3 total) for an exact scoreline match.

### Legacy per-group snapshots

The subdirectories (`Fore/`, `JorgeLozano/`, `Lacordaire93/`, `Lilian/`, `MartinTezna/`, `SanVel/`) each hold a **frozen, older copy** of `index.html` — from before fixtures moved server-side and the `TOURNAMENTS` catalog existed (they embed a hardcoded `FIXTURE` array). They are not templates to keep in sync and not generated from the root `index.html`; they're standing links for specific groups created under the old architecture. Don't assume changes to root `index.html` should propagate there, and don't use them as a reference for current patterns.

### Shared assets

`escudos/` — team crest images referenced by filename from each `TOURNAMENTS[...].ESCUDOS` map. Only Liga BetPlay (Colombia) has crests populated today; other tournaments fall back to the `FLAG` emoji (or `⚽` if that's empty too).
