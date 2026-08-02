# crates/

Cargo-workspace tier for engine-side library crates — code shared across the asset-browser products, deliberately separate from `apps/`, which holds the products themselves. One member today:

```
crates/
└── engine/    Mnemosyne, the media-agnostic catalogue + retrieval engine (see its own CLAUDE.md).
```

A future engine-side crate (a shared protocol crate, a second substrate library) joins here; a new _product_ never does — products live under `apps/`.
