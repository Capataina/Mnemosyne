# docs/engineering/decisions/ — the decision ledgers

## Purpose and trust

Migrated from `context/notes/` in `12d1712`. Rank 3 in the docs trust hierarchy:
below `architecture/systems/` on *current state*, but authoritative on *why* — a
decision recorded here remains true as a decision even when the code has since
moved past it. Rust doc-comments in the source point into this folder (the 12
repoints audited in `12d1712` all resolve). A future session proposing work in a
covered area must read the matching ledger first — most "obvious" improvements
here were already evaluated and rejected for cause.

## The map

```
decisions/
├── clip-preprocessing-decisions.md      CLIP preprocessing history: what was wrong, fixed, traded off (2026-04 core, 2026-07 weights note)
├── conventions.md                       recurrent unenforced codebase patterns: tracing span prefixes, etc.
├── dead-code-inventory.md               residual dead-code list after the audit sweep; trigger for the next sweep
├── encoder-additions-considered.md      candidate 4th/5th encoder families, with the current 3-encoder licence table
├── fusion-architecture.md               the two loops (indexing vs query) of multi-encoder fusion, end to end
├── image-identity-orphan-lifecycle.md   the "21 missing files" diagnosis ledger; content-hash relink remedy, file:line cites at v0.7.1/v0.7.6
├── local-first-philosophy.md            the local-first contract: one network op (model download), everything else on-machine
├── masonry-gesture-bugs.md              2026-07-18 root-cause diagnosis of the three drag/resize bugs (14-agent swarm, packer repros)
├── masonry-gesture-decisions.md         the settled gesture architecture + decision ledger closing the 07-15→19 saga; commit arc inline
├── mutex-poisoning.md                   the app's six long-lived sync primitives and their poisoning posture
├── path-and-state-coupling.md           path normalisation + cosine-owns-a-connection saga; insert-time normalisation still pending
├── performance-decisions.md             durable record of the 100k round: what landed, what was deliberately NOT built and why
├── preprocessing-spatial-coverage.md    OPEN concern (2026-04-26): centre-crop bias; undecided by design
└── random-shuffle-as-feature.md         the always-shuffled feed model; intentional backend randomness that looks like bugs
```

Format varies: a few files carry `name`/`description`/`type` YAML frontmatter
(the old note schema — clip-preprocessing, preprocessing-spatial-coverage), most
don't. Both are fine; don't normalise.

## Current state (2026-08-02)

All content migrated intact and committed today. File:line citations inside are
pinned to the versions they name (v0.7.1, v0.7.6, the 100k-round commits) — the
reasoning holds; re-verify line numbers against v0.7.14 code before acting on
them.

## Traps

- `masonry-gesture-decisions.md:6` and `performance-decisions.md:3` reference
  `context/plans/...` paths — those plans were *deliberately deleted* under the
  plan-lifecycle rule; the references are historical record, not broken links to
  restore.
- `preprocessing-spatial-coverage.md` is an open concern, not a decision — do not
  read its framing as settled.
- `dead-code-inventory.md` is a residual list last reconciled at audit time; the
  store-shaping rounds since may have closed more rows.
