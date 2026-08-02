# docs/history/code-health-audit/ — the 2026-04-26 audit, frozen

## Purpose

The complete record of the April 2026 code-health audit (28 findings), run right
after the Phase 11 → 12 perf bundle. Frozen historical record: the repo was then
called `PinterestStyleImageBrowser`, all Rust lived under `src-tauri/src/` (the
pre-monorepo, pre-`crates/engine` layout), and finding IDs (`D-IDX-2`,
`D-SIM-1`, …) refer to code at that snapshot. Every stale path in here is stale
by design — never "fix" these files.

## The map

```
code-health-audit/
├── index.md                     entry point: audit scope, methodology, what was and wasn't done
├── area-1-indexing.md           indexing.rs orchestration — hygiene findings, threading model sound
├── area-2-fusion-and-search.md  fusion + search command surface — incl. unreachable legacy IPCs (D-SIM-1)
├── area-3-encoders.md           encoder modules + ort_session — incl. dead constructors (D-ENC-1)
├── area-4-database.md           db/mod.rs + embeddings — read_lock() convention drift
├── area-5-frontend-and-misc.md  frontend dispatch, samplers, deps, stale-comment sweep
├── obligation-evidence-map.md   live-appended ledger of tool-call evidence per audit obligation
├── PASS-1-CHECKPOINT.md         orientation snapshot (line counts, stack) before the deep dive
└── PASS-2-SYSTEMS-AUDITED.md    static per-system table: evidence, diagnostic test, findings, confidence
```

## Trust and follow-through

Findings were resolved *after* this record froze — the audit Pass + Phase 2
sweeps closed most of them (see `docs/engineering/decisions/dead-code-inventory.md`
and `path-and-state-coupling.md` for what shipped and what remains). An
auto-memory note (`project-open-audit`) had the top-3 actions still unresolved as
of 2026-07-15. To learn a finding's current status, check the code and the
decisions ledgers, never this folder.
