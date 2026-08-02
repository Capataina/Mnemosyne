# docs/proposals/ — Hermes-era enhancement proposals, unverified

## What this is, and how far to trust it

An enhancement-recommendation corpus dated 2026-04-26, migrated from `context/`
by the Hermes session and committed in `12d1712`. Bottom rank in the docs trust
hierarchy, shared with `docs/research/`: treat every file as a **historical
research artefact**, never as verified current fact.

The specific reason for the distrust, on record in `12d1712`: these docs claim to
have read a local `docs/architecture/architecture.md` — a file that **never
existed** (`audience.md` cites it by name as a source). Hermes was abandoned on
2026-07-25 for confabulated state. The research underneath may well be sound;
each claim just needs independent verification before it drives a decision.

```
proposals/
└── enhancements/    the 11-recommendation corpus and its framing docs (see its CLAUDE.md)
```

## Trap

Several recommendations have since been *implemented* through other routes
(details in `enhancements/recommendations/CLAUDE.md`), while every file still
says `status: draft`. Reading a proposal here as "open work" without checking
the code and `docs/engineering/decisions/` first is the folder's standing
failure mode.
