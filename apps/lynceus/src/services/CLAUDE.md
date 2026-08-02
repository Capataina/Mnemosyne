# apps/lynceus/src/services/

Typed Tauri-command clients, feed-delta logic, image/note/root services, and service tests.

## Invariants

- Mirror Tauri command payloads exactly; keep optimistic updates reconcilable with authoritative host state.
- `feedDelta.ts` is the canonical incremental feed-reconciliation boundary; preserve ordered, idempotent insert/remove handling and test out-of-order or repeated events.
- Telemetry keeps a flat snake_case event vocabulary and remains opt-in with zero overhead when disabled.
