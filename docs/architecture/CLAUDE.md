# docs/architecture/ — current-state architecture, one file per subsystem

Container for exactly one child; all content lives there:

```
architecture/
└── systems/    22 subsystem docs — the docs-side current-state authority (see its CLAUDE.md)
```

There is deliberately **no** `architecture.md` overview file here. One never
existed — Hermes-era proposals (`docs/proposals/`) claim to have read it, which
commit `12d1712` records as confabulation. The per-subsystem files *are* the
architecture documentation; the root `README.md` points readers straight at
`systems/`. Do not add an overview file to satisfy a stale citation — if a
cross-subsystem overview is ever genuinely wanted, that is a new decision, not a
repair.
