# docs/engineering/ — engineering knowledge that outlives its code

Container for exactly one child:

```
engineering/
└── decisions/    15 decision ledgers, diagnosis notes, and conventions (see its CLAUDE.md)
```

The split from `architecture/` is by question answered: `architecture/systems/`
says how a subsystem works now; this tree says why it got that way, what was
rejected, and what would reopen each question. A decision file staying true while
the code moves on is normal, not drift.
