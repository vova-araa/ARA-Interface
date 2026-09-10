# ARA World — repo-gids voor Claude Code sessies

Real-time isometrische 3D hex-wereld (Armenië-thema) die elke Claude Code
sessie, agent en tool-call visualiseert. Gevoed door een Claude Code plugin
met hooks; draait 24/7 lokaal op de Mac van de eigenaar, bereikbaar via
Tailscale op telefoon en laptop.

## Structuur

```
packages/shared/    @ara/shared   — zod-schemas, WorldState-reducer, hex-math, wereldlayout
apps/collector/     @ara/collector — Express + better-sqlite3 (poort 4747), serveert ook viewer-dist
apps/viewer/        @ara/viewer   — React Three Fiber (dev-poort 4748)
plugins/ara/        Claude Code plugin: hooks, agents (chief/supervisor/manager/worker/scout/ops), commands, org.json
scripts/            watchdog.mjs (24/7, 0 LLM-tokens), notify.mjs (Telegram), install.sh, expose.sh (Tailscale)
ops/                launchd plists (templates; install.sh vult placeholders)
data/               runtime: SQLite db, world.config.json-kopieën, logs (niet committen)
```

Belangrijke leesvolgorde voor context: `PROGRESS.md` (wat af is + Mac-stappen),
`DECISIONS.md` (waarom-keuzes), `plugins/ara/org.json` (org-beleid).

## Commands

```bash
pnpm install                 # workspace
pnpm dev                     # collector (4747) + viewer (4748) parallel
pnpm -r typecheck            # 3 packages
pnpm test                    # 33 unit tests (shared + collector, node:test via tsx)
pnpm --filter @ara/viewer exec playwright test   # 3 smoke-flows (desktop + iPhone)
pnpm fixture                 # demo-events in de db laden
pnpm map                     # world.config.json (her)genereren
pnpm soak                    # soak-test tegen draaiende collector (ARA_SOAK_SECONDS=…)
```

Container/CI-bijzonderheden:
- Playwright: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` in deze container;
  onbekend/leeg = standaard Playwright-Chromium (CI, Mac). Nooit `playwright install` in de container.
- Geen GPU in de container → SwiftShader ~2–8fps; de QualityGovernor schakelt dan
  postfx/sier-lagen uit. `?fx=force` in de viewer-URL forceert alles aan (screenshots).
- Egress-proxy blokkeert externe sites; npm/GitHub werken wel. `NO_PROXY` staat al goed
  voor localhost-tests.

## Conventies

- TypeScript strict; shared wordt als TS-source geconsumeerd (`exports` → `src/index.ts`), geen build-stap voor shared.
- Reducer-symmetrie is heilig: collector en viewer draaien exact dezelfde
  `WorldState`-reducer uit `@ara/shared`. Statelogica NOOIT in maar één van de twee wijzigen.
- Events replayen op `ORDER BY ts, rowid` (zelfde-ms events!).
- Secrets: alle event-payloads door `redactValue`/`capText` in shared voordat ze de db in gaan.
- Viewer onder ortho-camera: drei `<Html>` NOOIT met `distanceFactor` (schaalt kapot).
- Emoji/labels via canvas-sprites (`emojiTexture`), geen font-fetch.
- Hooks (`plugins/ara/hooks/emit.sh`) zijn fire-and-forget: curl met `--max-time`,
  gebackgroundend, altijd exit 0 — een kapotte collector mag Claude Code nooit blokkeren.
- Commit-berichten: gewone beschrijvende Engelse messages (bestaande stijl volgen).

## Auth & toegang

- `ARA_TOKEN` gezet ⇒ collector eist Bearer/X-ARA-Token/?token= op alle API-paden; `/health` blijft open.
- `scripts/expose.sh tailnet|public|off|status`; `public` (funnel) weigert zonder `ARA_TOKEN`.

## Agent-org (plugins/ara)

- Hiërarchie: **chief** (enige contact met de gebruiker, `/ara`) → **supervisor** →
  **managers** per venture (on-demand) → workers/scouts; vaste **ops-manager** voor storingen.
- Communicatie loopt uitsluitend via het takenbord (collector `/tasks`); spawning via
  SPAWN-REQUEST of headless `claude -p` (subagents hebben zelf géén Agent-tool — bewezen).
- Token-discipline: haiku-first voor scouts/simpele workers, Grep vóór Read, korte
  bordresultaten; dagbudget in `org.json` (`tokenBudgetDaily`).
- `watchdog.mjs` draait via launchd elke 5 min met 0 LLM-tokens; spawnt alléén agents
  bij incidenten of geplande taken. Niet ombouwen naar iets dat continu LLM-calls doet.

## Testen vóór elke push

`pnpm -r typecheck && pnpm test` altijd; Playwright-smoke bij viewer-wijzigingen.
CI (`.github/workflows/ci.yml`) draait dezelfde suites + fixture/map + soak.
pnpm-versie komt uit `packageManager` in package.json — niet dupliceren in de workflow.
