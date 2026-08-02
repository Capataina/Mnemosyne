# mutex-poisoning

## Current Understanding

Six long-lived sync primitives live for the lifetime of the app (five rows below — the
text-encoder row holds two independent Mutexes, one per encoder family). The cosine/fusion row
changed shape in the T3-2 perf round (`fc6667a` + `1514a90`): the old primary
`Arc<Mutex<CosineIndex>>` (`CosineIndexState`) is GONE — removed outright, not just
renamed — and `FusionIndexState`'s `Arc<RwLock<HashMap<String, CosineIndex>>>` is now the
ONLY resident embedding-cache lock in the app. See `systems/cosine-similarity.md`'s Durable
Notes for why the primary was removed (it had no genuine reader left once every search
command was rerouted onto fusion slots) and `systems/multi-encoder-fusion.md` for the
lock's double-checked-locking shape.

| Primitive | Owner | Acquired by |
|-----------|-------|-------------|
| `Mutex<rusqlite::Connection>` | each `ImageDatabase` instance (foreground + background indexing) | every DB method (~30 sites across `db/`) |
| `Arc<RwLock<HashMap<String, CosineIndex>>>` | `FusionIndexState.per_encoder` — the only embedding cache; shared with the indexing thread | every similarity / semantic command (via `ranked_for_encoder` / `with_encoder_index`) + `indexing.rs`'s `Phase::Ready` refresh loop + `spawn_cache_warm` + the root-mutation IPCs' `invalidate_all()` |
| `Mutex<Option<ClipTextEncoder>>` + `Mutex<Option<Siglip2TextEncoder>>` | `TextEncoderState.encoder` / `.siglip2_encoder` — two slots, not one, since the SigLIP-2 text encoder shipped | `commands::semantic::semantic_search`'s `encode_with_clip` / `encode_with_siglip2` |
| `Arc<Mutex<Option<WatcherHandle>>>` | `watcher_state` (slot for the debouncer handle) | lib.rs setup callback |
| `Arc<IndexingState>` (`AtomicBool`) | `indexing_state` | every command that triggers an index + watcher debounce closure |

DB methods use `.lock().unwrap()` — the project treats Mutex poisoning as unrecoverable; a panic with the lock held should bring down the session and force a restart. Tauri command bodies use `?` (which routes through the `From<PoisonError<T>> for ApiError` impl, and — for the fusion `RwLock` — a matching `map_err(|e| format!("fusion rwlock poisoned: {e}"))` on both `.read()` and `.write()`) so poisoning surfaces as a typed error to the frontend instead of crashing the Tauri process.

If any code panics while holding one of these locks, it is poisoned for the rest of the session — every subsequent acquisition on it returns an error (`Err(PoisonError)` for a `Mutex`; both `RwLock::read()` and `RwLock::write()` poison identically on a panicking writer). Recovery requires restarting the app. The user gets typed errors instead of vague stringly-typed ones thanks to the `From<PoisonError>` impl / the fusion lock's own `map_err`, which is an improvement over the pre-typed-error state.

## Why the contention pressure is now real, and simpler than it was

WAL means foreground reads no longer block background writes (`systems/database.md`). The
fusion `RwLock` is shared across the indexing thread (writes via `Phase::Ready`'s
`refresh_if_stale` + `save_store_for`, one write lock per encoder released between encoders)
AND the foreground commands (reads via `ranked_for_encoder` / `with_encoder_index`, which
themselves briefly escalate to a write lock only on a cold/stale slot). Concurrent
foreground queries against the SAME encoder the pipeline is actively refreshing contend on
that encoder's populate+persist window (~0.5-1s at 100k; see
`systems/cosine-similarity.md`'s Known Issues); queries against a different, unaffected
encoder are unaffected — the write lock is per-encoder-iteration, not held across the whole
refresh.

**Lock discipline got simpler, not subtler, this round.** Before the primary index's
removal, a caller could in principle need both the primary index's lock AND a fusion slot's
lock in a fixed order to avoid AB-BA deadlock — the previous version of this note documented
exactly that `current_encoder_id` → primary-index two-lock order as something to watch. With
the primary gone, there is exactly ONE lock in the whole embedding-cache path. There is no
ordering discipline to get wrong because there is nothing left to order against.

This makes the cost of a poison panic on the fusion lock similar in kind to before (a panic
during a populate poisons the `RwLock`, and every subsequent foreground similarity/semantic
query fails until restart) but the blast radius is now precisely "every encoder's cache,"
since it's the only cache — there is no longer a separate primary to also worry about.

## Rationale

The choice of `Mutex` over `RwLock` or `parking_lot::Mutex` was implicit: standard library defaults. The poisoning behaviour is std-Mutex's safety mechanism — a partially-mutated state is exposed as an explicit error rather than silently presented as valid.

For a single-user desktop app, the practical implication is: if any panic happens, the affected subsystem becomes unusable until restarted. The user sees typed-but-vague errors after the first failure (`ApiError::Cosine("mutex poisoned: ...")`).

## Guiding Principles

- **The current safety mechanism is restart.** Tauri restarts are fast. The pragmatic posture is: poison-then-restart is acceptable; flailing in a partially-broken state is not.
- **Do not silently `lock().unwrap_or_else(|p| p.into_inner())`** — recovering from poison without understanding what state survived is worse than restarting.
- **`From<PoisonError<T>> for ApiError` over `unwrap()` in command bodies** — the typed signal lets the frontend show a real error message instead of the user wondering why nothing works.
- **`parking_lot::Mutex` is a strict upgrade** if poisoning becomes a real annoyance. It does not poison and is faster. The downgrade is one less safety check; for this codebase, that is acceptable. Documented in `enhancements/recommendations/09-typed-error-enum-and-mutex-replacement.md`.
- **`catch_unwind` at command boundaries** would convert backend panics into typed errors without poisoning the mutex. Not currently implemented — the typed-error From-impl path is the lighter intervention.

## What Was Tried

Nothing in version control switched away from std-Mutex. The poisoning behaviour has not bitten in production because the project's test corpus does not produce panics during normal operation. The risk is theoretical until something like a malformed image, a corrupted DB, or a change in ort versions surfaces a panic path.

The typed-error migration (commit `cda7caa`) made the poison case observable: the user now sees `ApiError::Cosine("mutex poisoned: ...")` instead of the previous opaque "Search failed" string. This is an improvement but doesn't solve the underlying recovery problem.

## Trigger to revisit

- A real session loses functionality after a single panic and the user reports it.
- A new Tauri command path holds two locks simultaneously (currently the most-locks-held-at-once is `semantic_search`, which locks a text-encoder Mutex inside `encode_with_clip`/`encode_with_siglip2` — dropped when that helper returns — *before* taking the fusion `RwLock` in `with_encoder_index`; still non-overlapping in scope, same as pre-round, just against a `RwLock` now instead of the old primary-cache `Mutex`).
- Cross-session poisoning becomes observable in any non-trivial QA run.
- The fusion `RwLock` contention measured in profiling exceeds a comfortable threshold (today's brief per-encoder contention during the `Phase::Ready` refresh — ~0.5-1s/encoder at 100k, see `systems/cosine-similarity.md` — is judged acceptable; a sustained user complaint here is the trigger, not the measurement alone).

At that point: `parking_lot::Mutex` swap, then add `catch_unwind` at command bodies as a defence-in-depth.

## Naming inconsistency

The `From<PoisonError<T>> for ApiError` impl always maps to `ApiError::Cosine` regardless of which mutex was actually poisoned. The source comment in `commands/error.rs` acknowledges this is imprecise — a poisoned `TextEncoderState.encoder` shows as "cosine error: mutex poisoned". Functionally fine (the recovery is the same: restart) but worth fixing if the diagnostic precision matters.
