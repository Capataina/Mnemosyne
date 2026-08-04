# apps/lynceus/src-tauri/

The Lynceus product crate — Cargo bin `lynceus` v1.0.0, the Tauri v2 desktop host around the media-agnostic Mnemosyne engine (`crates/engine/`, path dependency, no frozen API). Everything image-specific lives here: the ONNX image/text encoders, the thumbnailer, the indexing pipeline, the filesystem watcher, and the Tauri command surface the React frontend (`../src/`) invokes. The engine owns DB, paths, perf, cosine/RRF; this crate re-exports those modules at their old crate-root paths (`lib.rs`) so `crate::db::…` call sites survived the extraction unchanged.

## Map

```
src-tauri/
├── Cargo.toml            crate manifest v1.0.0; platform-gated ort (CoreML on macOS,
│                         CUDA elsewhere), fast_image_resize, blake3 via engine,
│                         objc2/objc2-foundation for security-scoped bookmarks
├── tauri.conf.json       product identity + bundle config — see the pairing trap below
├── Entitlements.plist    the sandbox contract: four grants incl. network.client
│                         (WKWebView needs it to render — see the story below);
│                         identity-free, used by the ad-hoc lynceus-sandbox-test
├── Entitlements.mas.plist  the store-signing variant: the same four keys plus
│                         com.apple.application-identifier and
│                         com.apple.developer.team-identifier, which MAS upload
│                         validation requires (restricted — they break ad-hoc signing)
├── Lynceus_Mac_App_Store.provisionprofile
│                         the Mac App Store provisioning profile, committed on purpose
│                         (profiles are public material; every shipped app embeds one).
│                         lynceus-mas-package cp's it to Contents/embedded.provisionprofile
│                         before codesign — Tauri 2.11 has no provisioningProfile config key
├── build.rs              stock tauri-build shim
├── capabilities/         Tauri v2 permission manifest for the main window (own CLAUDE.md)
├── src/                  the crate source (own CLAUDE.md)
├── tests/                integration + audit-diagnostic suites (own CLAUDE.md)
├── gen/                  Tauri-generated schemas — never edit, no CLAUDE.md
├── icons/                generated icon set from the ringed-almond eye — no CLAUDE.md
└── target/               build output
```

## Current state — 2026-08-04

Store-shaped and repo-side release-ready (commits 5968d2e, f14aaa8; entitlements corrected 2026-08-03). The 5968d2e sandbox test was log-level only (container created, DB initialised, zero network attempts) and missed that the webview never rendered — the blank window surfaced on live founder tests and was fixed by the `network.client` grant (story below). Bundle slimmed 2.9GB → 674MB by naming exactly seven resource files (five int8 models + two tokenizers) instead of the whole models directory. Bundle ID is `com.capataina.lynceus` (Apple rejects personal-looking IDs; CAP-79 closed repo-side). Tests: 44 lib tests plus the integration suites, all green. As of 2026-08-04 the crate is at v1.0.0 and the store path is live end to end: real Apple Distribution + Mac Installer Distribution identities, the committed provisioning profile embedded by the recipe, `Entitlements.mas.plist` sealing the two identity keys, and a verified ~419MB signed `Lynceus.pkg` delivered to App Store Connect via Transporter. The five-minute live folder-persistence pass PASSED founder-driven on the ad-hoc sandbox build (b77145a); the standing caveat remains that ad-hoc bookmark identity does not survive rebuilds, so the real-certificate confirmation arrives via TestFlight. What remains for release is outside this repo: the Paid Applications Agreement's tax form, price entry, and submitting for review.

## The sandbox and entitlements story

`Entitlements.plist` grants four things: the App Sandbox master switch, `files.user-selected.read-only` (Lynceus never writes into user folders — DB, previews, models all live in the app container), `files.bookmarks.app-scope` so granted folders persist across relaunches (`src/security_scope.rs` creates/resolves them), and `com.apple.security.network.client`. That last key is NOT for app networking — **sandboxed WKWebView refuses to render without it** (helper processes fail to start; the window stays permanently blank). Proven by A/B on 2026-08-03 after the founder hit the blank window on two live tests: identical .app, sandbox without the key = blank, with it = renders. The app's own code still makes zero network requests (models ship bundled; sealed-boot logs show no attempts), so the privacy claim survives — but as observed behaviour, not OS enforcement, and every doc that said "no network entitlement" was reworded in the same change.

The plist split (2026-08-04, 1d783d6): the base `Entitlements.plist` stays identity-free and is what `just lynceus-sandbox-test` signs ad-hoc — the two identity entitlements are restricted and break an ad-hoc signature. Store signing uses `Entitlements.mas.plist` instead, the same four keys plus `com.apple.application-identifier` and `com.apple.developer.team-identifier`, which Mac App Store upload validation requires in the sealed signature. The packaging recipe also runs `xattr -cr` over the whole .app between embedding the profile and codesigning: a quarantine attribute on any bundled file is an App Store rejection (Apple's error 91109, hit on the first 1.0.0 delivery because the profile arrived via a browser download), and the strip must run before signing so the seal covers the final attribute state. The old trap still binds in its narrower form: a sandboxed build attempting a model *download* is a bug in precision/presence resolution (see the int8 trap), and `network.client`'s presence must never be read as licence to add a network call.

## Traps

- **tauri.conf.json `identifier` ↔ engine `BUNDLE_ID` have no compile-time check.** The identifier here and the release-fallback constant in `crates/engine/src/paths.rs` must match or release builds resolve app-data paths into a different container than Tauri runs in. Both moved together in f14aaa8. Any future rename moves both plus every doc path reference, and orphans the previous install's library on disk (accepted twice already).
- **`bundle.resources` names files, not the directory.** Mapping the whole `models/image/` dir re-creates the 2.9GB bundle (fp32 originals ride along). The seven-entry list is the diet; keep it a list.
- **int8 is the effective default precision.** `Settings::effective_model_precision()` defaults to `"int8"` across all call sites (indexing, semantic, fused, downloader). The old `unwrap_or_default()` → empty string → fp32 path made a fresh store install look for fp32 files that don't ship, and the first-launch presence check then attempted a full fp32 download on every launch — blocked by the sandbox, but noisy and wrong. Presence is judged via `paths::model_path_for_in` (precision-variant resolution against an explicit dir) — the same rule the loaders use. Never test bare fp32 filenames for presence.
- **`--profiling`, not `--profile`.** Tauri 2's CLI owns `--profile <NAME>` for cargo profile selection; the binary's flag is `--profiling` (or `PROFILING=1`).
- **Bundle output lands in the workspace-level `target/`,** not under `apps/lynceus/` — the justfile recipes encode the corrected paths.

## Runnable commands

From the repo root:

```
just lynceus-sandbox-test   # free local sandbox loop: pnpm tauri build --bundles app,
                            # codesign ad-hoc with Entitlements.plist, verify, open
just lynceus-mas-package    # the real MAS artifact: APP_IDENTITY/PKG_IDENTITY are the
                            # real keychain identities (filled 2026-08-04, team
                            # VURQD42U5Z); the recipe embeds the provisioning profile,
                            # runs xattr -cr, signs with Entitlements.mas.plist, then
                            # productbuild wraps the .app into the .pkg Transporter uploads
cargo test                  # from apps/lynceus/src-tauri — 44 lib + integration suites
```

The plain-English release runbook (every term defined for a first-time Mac publisher) is `design/store/release-runbook.md`; the listing spec is `design/store/listing.md`.

The 2026-08-02 audit's queue for this crate is fully implemented as of 2026-08-03 (bincode removed from both manifests, the indexing/ split, the legacy-command removal, dedups, state-types/shared-aliases, all doc-rot) — the `src/` and `src/commands/` CLAUDE.md files carry the dated Done records and the surviving knowledge entries.

## Place in the whole

Sits between `crates/engine/` (all media-agnostic persistence and retrieval — the foundation shared with any future Mnemosyne vertical) and `apps/lynceus/src/` (the React frontend, other agents' surface). Version moves with the work: `Cargo.toml`, `tauri.conf.json`, and the frontend `package.json` bump in lockstep per the repo convention.
