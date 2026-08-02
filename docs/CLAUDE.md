# docs/ — the project's written memory outside the code tree

## Purpose and shape

Everything the repo knows that is not code: current-state architecture, decision
ledgers, frozen historical records, and a large Hermes-era research/proposal corpus.
The tree exists in this shape because of a migration: a Hermes agent session moved
the old `context/` tree here on 2026-07-24 and left it uncommitted for nine days;
the migration was audited content-complete (byte-identical counterparts for every
content file) and committed on 2026-08-02 in `12d1712`, with a follow-up fix in
`31217fc`. The alternative — keeping `context/` — died with the AGENTS.md
convention in the same commit. The old `context/notes.md` hub was deliberately not
migrated; its content survives inside the individual decision files.

## The map

```
docs/
├── architecture/    current-state subsystem docs — the docs-side authority (see its CLAUDE.md)
├── engineering/     decision ledgers and conventions — why things are the way they are
├── history/         frozen records, kept as records (April 2026 code-health audit)
├── proposals/       Hermes-era enhancement recommendations — historical artefacts, unverified
└── research/        Hermes-era source notes feeding the proposals, plus one maintained perf-options note
```

## Source authority and trust

On any disagreement, this hierarchy decides — it is the single most important fact
in this tree:

1. **The code** (`crates/engine`, `apps/lynceus`) — always wins on current state.
2. **`architecture/systems/`** — the current-state docs authority; actively
   verified against code (most files carry dated verification callouts).
3. **`engineering/decisions/`** — decisions remain true *as decisions* even where
   the code has since moved on; read them for the why, not the what.
4. **`history/`** — frozen; correct about its own moment (April 2026), stale about
   today by design.
5. **`proposals/` and `research/`** — Hermes-era, unverified, with one
   confabulation on record: they claim to have read a
   `docs/architecture/architecture.md` that **never existed** (per `12d1712`'s
   audit). Treat as historical research artefacts, never as current fact.

## Current state (2026-08-02)

Tree committed and audited today. Products it describes: Lynceus v0.7.14 on the
Mnemosyne engine v0.5.4, store-shaped, awaiting Apple enrolment. `architecture/
systems/` and `engineering/decisions/` are live and maintained; `history/`,
`proposals/`, and most of `research/` are closed corpora.

## Traps

- **Dead `context/` pointers.** A full grep for `context/` on 2026-08-02 found
  exactly three hits — `architecture/systems/profiling.md:286`,
  `engineering/decisions/masonry-gesture-decisions.md:6`,
  `engineering/decisions/performance-decisions.md:3` — all intentional historical
  references to plan files deleted under the plan-lifecycle rule, not live
  pointers. Any *new* `context/` reference appearing in this tree is drift.
- **`docs/architecture/architecture.md` does not exist and never did.** Proposals
  cite it as read. Do not create it to "fix" the citation; the systems/ folder is
  the architecture doc.
- **CLAUDE.md was gitignored until `31217fc`.** The rule is gone; if these files
  ever vanish from `git status`, check `.gitignore` first.

## Place in the whole

Code doc-comments point down into `engineering/decisions/`; the root `README.md`
points at `architecture/systems/`. LifeOS and Linear carry digests of this tree —
this tree, not they, is canonical for project-internal knowledge; the code is
canonical over everything here.
