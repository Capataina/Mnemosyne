# Mnemosyne — monorepo root

## Mission

One engine, many asset browsers. `crates/engine/` is **Mnemosyne the engine** — a media-agnostic catalogue + retrieval core (scan, index, embed, search, thumbnails, paths). `apps/lynceus/` is **Lynceus** — the shipping local-first image browser built on it. Future siblings (Syrinx for audio, Daedalus for 3D) join as `apps/<product>/` with their own `src-tauri` crate depending on the same engine. The engine's public API is deliberately unfrozen until a second product proves the seams.

Local-first is the product thesis, not a feature: the store build bundles its AI models and makes zero network requests (verified by sealed-boot logs). The entitlement slip does carry `network.client` — WKWebView refuses to render under the sandbox without it — so the privacy claim is behavioural ("it never phones home"), not OS-structural.

## Local-first — the reasoning

The app manages personal image libraries — reference boards, personal photography, downloaded inspiration — private by nature; cloud sync would defeat the point. Privacy is by construction, not configuration: the user never opts _in_ to local, and opting _out_ should require deliberate work. That one stance decided the stack: ONNX Runtime over a hosted embeddings API, SQLite over Postgres, Tauri over Electron-with-a-server, query tokenisation in-process through the `tokenizers` crate rather than any hosted service. Any choice that trades single-user performance for multi-user scale (a server hop) is the wrong direction.

The one historically acceptable network call was the first-launch model download; the store build removes even that by bundling the weights (dev builds pre-fetch via `scripts/download_models.py`). Commercialisation forced a licensing pass: OpenAI's original CLIP weights are research-non-commercial and would have blocked a paid release, so a weights-only swap to OpenCLIP LAION-2B ViT-B/32 (MIT — same tokenizer, preprocessing, and 512-d output; zero code change, no embedding version bump) fixed it. All three encoders are commercially licensed: OpenCLIP (MIT), DINOv2 (Apache-2.0, Meta), SigLIP-2 (Apache-2.0, Google). `clip_tokenizer.json` is fetched from `laion/CLIP-ViT-B-32-laion2B-s34B-b79K` (MIT) by `scripts/download_models.py`; it was once mirrored from Xenova's OpenAI export, and that re-sourcing closed the last licence caveat.

One deliberate trade-off rides on the single-user assumption: the Tauri shell runs `csp: null` with asset scope `["**"]` — fine for a local one-user tool, and a named hardening target in the enhancement ledger (`apps/lynceus/CLAUDE.md`). The principle reopens only on a multi-user or hosted-inference pivot, which nothing on the roadmap suggests.

## The four-names trap

| Name | Refers to |
| --- | --- |
| Mnemosyne | the repo AND the engine crate (`crates/engine`, lib name `mnemosyne`) |
| Lynceus | the image-browser product (`apps/lynceus`, bundle `com.capataina.lynceus`) |
| "Image Browser" / PinterestStyleImageBrowser | the project's dead pre-rename name — appears only in old commit bodies and stray stale comments; never write it into anything new |

## Map

```
Mnemosyne/
├── apps/                 product tier — one app per folder (see apps/CLAUDE.md)
├── crates/
│   └── engine/           Mnemosyne the engine, v0.5.6 (own CLAUDE.md tree)
├── scripts/              Python/bash helpers: model download/quantize, test corpus,
│                         CC0 demo/marketing library fetch, launcher
├── models/               gitignored ONNX weights, models/<modality>/ (image|audio|3d);
│                         populated by scripts/download_models.py, bundled by Tauri at build
├── Store Screenshots/    App Store marketing pages per app + regenerating HTML sources
│                         (see its CLAUDE.md); "Lynceus Pics/" beside it is the gitignored
│                         local raw-capture material those sources composite
├── justfile              command runner — thin wrappers over scripts/ and cargo/pnpm
├── Cargo.toml            Rust workspace: crates/engine + apps/lynceus/src-tauri
├── package.json          pnpm monorepo manifest (v0.2.0 — its own version line)
├── pnpm-workspace.yaml   packages: apps/*; allows esbuild's postinstall
├── README.md             public-facing summary — the one non-CLAUDE.md doc sibling
└── target/               shared workspace build dir (gitignored) — bundles land HERE,
                          target/release/bundle/macos/, not under src-tauri/
```

## Global commands (verbatim)

```
just lynceus-dev                                    # dev, hot reload, repo-local models
just lynceus-dev-telemetry                          # dev + profiling layer (PROFILING=1)
just lynceus-release                                # release .app, built and opened
just lynceus-sandbox-test                           # store-shaped build, ad-hoc signed, sandboxed
just lynceus-mas-package                            # real MAS .pkg — real identities (filled 2026-08-04),
                                                    # embeds the profile, strips xattrs, then productbuild
pnpm --filter ./apps/lynceus run test               # frontend suite (vitest)
cargo test --workspace                              # engine + app-crate Rust tests
python3 scripts/download_models.py --modality image # materialise models/image/
```

## Version lockstep

Lynceus's version lives in three text manifests that move together in the same commit, with `Cargo.lock` following: `apps/lynceus/package.json`, `apps/lynceus/src-tauri/Cargo.toml`, `apps/lynceus/src-tauri/tauri.conf.json` — all `1.0.0` today (the 1.0 line was crossed 2026-08-04 with the founder's explicit yes, for the first App Store submission). The engine (`crates/engine/Cargo.toml`, `0.5.6`) versions independently and bumps only when its own code changes. The root `package.json` (`0.2.0`) tracks monorepo-level structure, not either product.

## Invariants and traps

- **`--profiling`, not `--profile`** — the Lynceus CLI flag; `PROFILING=1` env is equivalent and is what `lynceus-dev-telemetry` uses, because of the next trap.
- **pnpm does not strip `--`** the way npm does — it forwards the separator literally, and Tauri's CLI reads a bare `--` after `build` as "rest goes to cargo", corrupting flags like `--bundles`. Pass flags directly, no `--`.
- **`LYNCEUS_MODELS_DIR`** overrides the model search path (dev workflow; `start_lynceus.sh` points it at repo `models/image/`). **`LYNCEUS_DATA_DIR`** overrides the app-data dir for ad-hoc testing.
- **Bundle ID lives in two unlinked places**: `tauri.conf.json` `identifier` and the `BUNDLE_ID` fallback constant in `crates/engine/src/paths.rs` — no compile-time check that they match; rename them together (f14aaa8 did).
- **.gitignore ate CLAUDE.md files until 31217fc** — a personality-era rule silently untracked every per-folder CLAUDE.md. The rule is gone; if a memory file ever fails to show in `git status`, suspect .gitignore first.
- **.gitignore's iCloud-dedup globs** (`* [0-9].md` etc.) silently swallow any file whose name ends in a space plus a digit.
- **There is no `docs/` folder, deliberately** — it was dissolved into the per-folder CLAUDE.md layer on 2026-08-02; its full texts live in git history (last tree at the pre-dissolution commit). Never recreate it, and treat any surviving `docs/...` pointer as drift. Related Hermes confabulation on record: a `docs/architecture/architecture.md` that never existed at all.

## Conventions (repo-wide)

Only the rules a stranger could not infer from the surrounding code. Pure Rust-side patterns live in the `crates/engine/` and `apps/lynceus/src-tauri/` CLAUDE.md trees; pure frontend patterns in the `apps/lynceus/src/` tree.

- **Tauri command names are `snake_case`, identical to the Rust fn.** Components never call `invoke` directly — hooks call `src/services/` wrappers. Errors cross the IPC boundary as the typed `ApiError` union, mirrored in `src/services/apiError.ts`.
- **Tracing, never `println!`.** Every command, pipeline phase, and long-running op carries a span; span names are `dotted.snake_case` with a subsystem prefix (`ipc.`, `pipeline.`, `cosine.`, `model_download.`, `watcher.`), which is what gives new code free perf attribution under `--profiling`.
- **Tests live beside the code**: Rust `#[cfg(test)] mod tests` per submodule, frontend `*.test.ts(x)` next to the source. Cross-module Rust integration tests sit in `apps/lynceus/src-tauri/tests/`; the real-weights ones are `#[ignore]`d by default.
- **Numbered-plan traceability.** Code landed against a numbered plan carries the plan's task ID as an inline-comment prefix (`R<n>` was the 2026-04 perf bundle, `T<n>-<n>` the 100k round); each new plan picks a fresh non-colliding prefix. No numbered tags on ad-hoc fixes — plan traceability is what pays for the visual cost. Audit-derived code cites its finding in a comment.
- **Generation tokens, never timestamps.** Anything cached or computed off-thread trusts a result only when a cheap token derived from the actual inputs-that-matter still matches (the engine's embedding store, the masonry worker). An `mtime` check or boolean dirty flag is the anti-pattern this replaced — it cannot see input changes that leave the file untouched.
- **Persisted binary caches carry a versioned header** (magic + format version + content-identifying fields + freshness token), written temp-file + atomic rename, each header field with its own rejection test so foreign or stale files fail closed.
- **Stable identity keys.** Per-item keys derive from the item's own id, never from its position in the current array or a derived value like a URL — a refetch or sharpen must not read as a new identity.

## Where knowledge lives

The per-folder `CLAUDE.md` layer is the repository's single documentation layer: each folder's file carries its purpose, architecture, invariants, decisions, traps, and current state, at whatever length the folder earns. The root `README.md` is the one sibling — a public summary, never a parallel source. Long-form narrative (the story of a change, its dead ends, its evidence) lives in commit bodies; product/design artefacts with a life of their own (store listing, release runbook, brand SVGs) live under `apps/lynceus/design/`. There is no separate docs tree, and none should be created.

## Decisions: what was chosen, what it beat, and what would reopen it

The ledger behind the stances above; each entry is written so "why didn't we just use X" is answered without reading history.

- **2026-08-04 · Where does the version line cross 1.0?** Chosen: the first App Store submission is 1.0.0, all three Lynceus manifests together; the engine stays on its own line (0.5.x). Rejected: typing the internal pre-1.0 number into the store record, and treating 1.0 as a quality milestone to be earned. Because: a version line needs an observable event, and "the first time a stranger can buy it" is the only one this product has; a quality bar has no definition and gets argued forever. Revives if: never; it has happened.
- **2026-08-04 · What shape is the price?** Chosen: a one-time purchase on the UK base storefront, other regions generated from it. Rejected: a professional-tool premium price, and free-plus-unlock. Because: an unknown developer with no reviews cannot sell at a premium, and an unlock needs an entitlement check against a server, which contradicts the no-network, no-account product. Revives if: real sales data says the price is wrong in either direction.
- **2026-08-28 · Release free now while store paperwork blocks paid sale, and price later?** Chosen: no; nothing on this developer account ships free. Rejected: a free release to get onto the store sooner. Because: a free listing later priced is a different product to the people who already have it, and it trades revenue and positioning for a queue position. This kept being re-derived from the true premise that the paid-apps agreement gates sale but not submission, which is why it is recorded. Revives if: written confirmation from Apple that a paid listing is permanently unavailable on this account. A delay or a form defect is not that.
- **2026-08-03 · Where do screenshot and demo images come from?** Chosen: museum open-access collections released with all rights waived, fetched reproducibly by `scripts/fetch_demo_library.py`. Rejected: freely downloadable game and franchise art, and stock photography. Because: "freely downloadable" and "licensed for commercial use" are unrelated properties; fan-content policies permit personal non-commercial use only, and the store rejects screenshots containing someone else's IP. Revives if: never; the refusal is legal.
- **2026-08-03 · Why does the sealed, sandboxed build open a blank window?** Chosen: grant `com.apple.security.network.client`, which the sandboxed WKWebView needs to start its own helper processes. Rejected: hunting the fault in the app's own rendering path. Because: an A/B on the entitlement alone flipped the behaviour with no app change. The cost: the privacy claim moved from OS-enforced to behavioural (see *Mission*). Revives if: WKWebView stops requiring the entitlement, in which case remove it and restore the stronger claim.
- **2026-08-03 · Why do new images show deleted images' thumbnails?** Chosen: identifiers are non-reusable at the schema level (`AUTOINCREMENT`). Rejected: addressing thumbnails by something other than the id, and clearing derived assets on delete. Because: both treat the symptom; the property that failed is that an id used to address anything outside its own table was being recycled, and a default auto-incrementing key does not prevent that. Revives if: never.
- **2026-08-04 · Why did the store reject a package that verified locally?** Chosen: the packaging recipe strips extended attributes from everything before sealing, as a property of the recipe. Rejected: removing the quarantine marker from the one offending file. Because: the next downloaded resource would carry it in again; the class is invisible state a graphical signing flow handles silently and a script must handle explicitly. Revives if: never.
- **Mid-2026 · Which CLIP weights ship?** Chosen: OpenCLIP LAION-2B ViT-B/32 (MIT). Rejected: OpenAI's original CLIP weights, already built against and working. Because: their licence permits research and not commercial use, which would block a paid release; the swap was free because architecture, preprocessing and output dimension were identical. The property that failed: a weights file's licence is separate from its code's and is release-blocking. Revives if: never.
- **Undated (architecture) · One encoder or several?** Chosen: three encoders fused by rank. Rejected: a single encoder, which would cut download size, memory and indexing time at once. Because: each model is confidently mediocre outside the resemblance it was trained for, and no tuning fixes the queries it was never good at. Revives if: one model matches the fusion across every query class the product cares about.
- **Undated (architecture) · A dedicated vector index?** Chosen: exhaustive comparison over flat mmap stores beside SQLite. Rejected: a purpose-built vector index. Because: a second store to keep consistent for speed not yet needed. Revives if: a query on a library at the top of the target size range stops feeling instant.
- **2026-08-02 · A separate documentation tree?** Chosen: per-folder `CLAUDE.md` as the only documentation layer. Rejected: the `docs/` tree, which grew to 155 files. Because: two homes for one fact diverged, with nothing saying which was current. Revives if: never; the tell it is coming back is a proposal for "a folder of architecture notes for things that fit nowhere". (`AGENTS.md` files were retired at the same time because the runtime in use does not load them; that one revives if the tooling changes to one that does.)

## Laws: what this repository will not violate, and why

These sit beside the conventions above and do not repeat them.

- **A new component arrives with working behaviour in the same change that creates it.** An empty folder named for a future part reads as a decision already taken, and the next person builds against a design that does not exist.
- **Only the engine opens the library or the catalogue; the shell asks.** Two readers of the library drift on what counts as a valid file and disagree in front of a user. Checked by a search that must stay empty: no file access or SQLite opening outside `crates/engine`.
- **Ranking happens only in the engine.** A shell-side re-sort "for speed" becomes the ranking the user actually sees, written to be fast rather than correct.
- **The engine contains no image-specific concept.** Test: does the sentence describing the addition still make sense if the assets were sound files? Each small concession destroys the split's reason to exist. Held by review only, so it erodes silently.
- **No face runs another face as a subprocess and parses its output.** A formatting change in one becomes a broken feature in the other, with no compiler or test connecting them.
- **Product behaviour never lives in the packaging recipe.** Behaviour that only appears in a sealed build cannot be reproduced in development and surfaces at the most expensive moment.
- **Nothing makes a network request, and nothing guards that.** The entitlement that would have enforced it is granted for WKWebView. Any lookup feature (model updates, query help, crash reporting, licence checks, telemetry) must be built to work on the machine or not built.
- **The file layout on disk is closed to writes.** No import step, no managed folder, no rename, move or dedupe; improvements go into the catalogue instead.
- **An unreadable file is skipped, never given a zero or empty vector.** A zero vector is a point in the space and surfaces as a confidently ranked wrong answer.
- **Missing assets are surfaced for the user to clear, never silently purged.** An unmounted drive must not cost hand-made tags.
- **A trained model's weights licence is checked before the model is built around, and recorded.** A non-commercial weights licence blocks a paid release while the code is fine.
- **Anything downloaded has its extended attributes stripped before it is sealed into a build.** The quarantine marker survives a copy and the store's scanner refuses the package.
- **No plugin, scripting or extension surface.** It is a permanent interface for a one-developer, one-user product; ask for the behaviour instead.

## Glossary: private vocabulary the README does not carry

The four-names trap above covers Mnemosyne, Lynceus and the dead "Image Browser"; these are the rest.

- **Face**: any entry point that calls the engine (the Tauri shell, a CLI path, a future sibling app). Faces call the engine, never each other.
- **Medium test**: "would a browser for a different medium also need this?" Yes means engine, no means application. It settles most placement arguments.
- **Syrinx / Daedalus**: the agreed names for the future audio and 3D sibling apps under `apps/`. Not built.
- **Generation token**: the cheap value derived from the inputs that matter, against which any cached or off-thread result is trusted (see *Conventions*).
- **Sealed build**: the sandboxed, signed, store-shaped build (`just lynceus-sandbox-test`, `just lynceus-mas-package`), as opposed to the dev build, which has neither sandbox nor bundled weights.
- **First material / second material**: inside the application window, versus anything a person sees before they have the application (store pages, landing page, screenshot overlays). The second material's spacing and headlines never come back inside the window, and a capture inside it is never retouched.

## Risks: what can still go wrong, and the trigger for each

- **The store account's paperwork can block every paid product at once.** It lives outside this repository; a release that stalls on it is not a code problem.
- **A network request ships and makes the central privacy claim false.** Trigger: any feature that benefits from a lookup, written by someone who does not know the claim is unenforced. The published privacy policy would then contradict the application. A test that fails when a request appears does not exist yet.
- **The engine's split is in the wrong place.** Trigger: starting Syrinx or Daedalus and finding the engine needs structural change rather than extension; every convenience declined to keep the engine image-ignorant would then have bought nothing.
- **The Tauri shell runs `csp: null` with asset scope `["**"]`.** Trigger: any move towards loading remote content or multiple users; acceptable only while the app is single-user and local.
- **Similarity looks weak to a new user on a small library.** Trigger: a first-run user trying "View Similar" on a few hundred images. The fix is corpus density, not ranking changes.

## Planned work

Open work is the repository's GitHub issues, `gh issue list -R Capataina/Mnemosyne`, and the private board, `gh project item-list 4 --owner @me --query 'repo:Capataina/Mnemosyne is:open'`. Where the work stands is read there and in the git log, never in a dated section of this file.
