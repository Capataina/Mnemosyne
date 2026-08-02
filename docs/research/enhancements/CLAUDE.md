# docs/research/enhancements/ — the 2026-04-26 run's source notes

## Purpose and format

The ~77 source notes gathered for the recommendation run in
`docs/proposals/enhancements/` — evidence layer, one note per external source,
organised by source type. Every note carries uniform YAML frontmatter:
`source_type`, `date_published`, `hype_score` (0 = primary/measured …
4 = hype-heavy; weight low scores more). Frozen corpus: nothing here has been
updated since the run, and the Hermes-era trust caveat
(`docs/proposals/CLAUDE.md`) applies — summaries of real external sources, but
the summarising agent has one confabulation on record, so re-fetch the primary
source before a claim drives a decision. `date_published` values of `2026-04` on
old projects mean "as seen at run time", not a real publication date.

## The map

The two tracker files are the folder's own index; the eight subfolders are
uniform note collections — thin enough that this map is their whole description
(the three largest also carry their own scope-marker CLAUDE.md):

```
enhancements/
├── _source_count.md      per-surface target vs actual source-count tracker for the run
├── currents.md           the synthesis step: named currents across all 77 notes, coupling-graded
├── papers/          (24) academic papers: ANN/HNSW/DiskANN/ScaNN, CLIP family + SigLIP/DINOv2, MMR/DPP, FHE, dedup
├── projects/        (35) shipped projects and crates: vector DBs, ML runtimes, Tauri apps, Rust ecosystem crates
├── forums/           (7) forum/blog debates: brute-vs-HNSW, CLIP-vs-DINOv2, CoreML-vs-ONNX, React 19, SQLite WAL, Tauri-vs-Electron
├── firm-hiring/      (4) job-posting signal: Anthropic, Apple PCC, Cloudflare, HuggingFace Rust roles
├── rfcs-and-issues/  (3) GitHub RFCs/issues: ort CoreML breakage, Tauri asset-protocol CSP, folder-picker dialog
├── talks/            (2) conference talks: EuroRust Rust-ML, RustConf 2024 WASM
├── funding/          (1) vector-DB funding landscape 2024
└── industry-analyst/ (1) OSS licensing landscape 2025
```

Total on disk 2026-08-02: exactly 77 leaf notes + the 2 trackers — the count
matches `synthesis.md`'s claimed 77 source notes; the corpus migrated complete.
