# docs/research/ — research inputs, mostly frozen

```
research/
├── enhancements/                the 2026-04-26 run's ~77 source notes, by source type (see its CLAUDE.md)
└── m2-perf-options-2026-04.md   M2 perf-optimisation options; the one maintained file here — carries a 2026-07-15 "Current Relevance" recheck
```

Trust: bottom of the docs hierarchy alongside `docs/proposals/` (Hermes-era,
unverified — see `docs/CLAUDE.md` for the full ranking), with one graded
exception: `m2-perf-options-2026-04.md` was actively rechecked post-refactor on
2026-07-15, so its relevance sections are two weeks' fresher than everything
else in this tree. Its measured numbers (CLIP 62 ms, SigLIP-2 189 ms, thumbnail
256 ms per image on M2) are FP32-era baselines — int8 is the default since
v0.7.13, so treat them as the *before* side of any comparison.
