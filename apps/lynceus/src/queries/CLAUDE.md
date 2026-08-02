# apps/lynceus/src/queries/

TanStack Query adapters for roots, images, tags, and semantic/similarity search.

## Invariants

- Query keys encode authoritative cache identity, including thumbnail bucket, feed seed/version, tag include/exclude filters, and enabled encoder state.
- Optimistic changes must reconcile against host events or invalidation — never assume mutation success as final state.
