# apps/lynceus/src/

React application shell and frontend type declarations.

## Invariants

- The single shuffled feed is driven by a compact manifest plus feed-delta reconciliation — never restore whole-library rematerialisation.
- Masonry packing stays off the main thread over typed arrays with generation-tagged responses; stale worker results must be discarded.
- Indexing status uses a module-singleton `useSyncExternalStore` source, never component-owned polling state.
