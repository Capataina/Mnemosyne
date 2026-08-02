# apps/ — the product tier

One folder per shipping product, each self-contained: React frontend beside its
`src-tauri` Rust crate (the Tauri-monorepo convention that keeps `frontendDist`'s
`../dist` relative path intact), each crate a member of the root Cargo workspace
and a consumer of `crates/engine`.

```
lynceus/    the image browser — the only product today (see its CLAUDE.md)
```

Future siblings join here as `apps/syrinx/` (audio) and `apps/daedalus/` (3D) when
they exist; the second product is what freezes the engine's public API. No
placeholder folders until then.
