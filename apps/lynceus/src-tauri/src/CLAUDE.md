# apps/lynceus/src-tauri/src/

Desktop host composition: filesystem scope, indexing, settings, watcher, model download, and command registration.

## Invariants

- Indexing batches database inserts, runs enabled encoders in parallel, emits per-image progress and feed-delta events, then token-gates per-encoder fusion-store refresh at `Phase::Ready`.
- Watcher and root mutations clear or refresh fusion slots; there is no primary cosine index to invalidate.
- Preserve local-first operation and bounded asset scope. Model download is the only expected post-install network boundary.
