# src/test/

Vitest infrastructure, not tests. `setup.ts` runs before every file: Map-backed localStorage shim (happy-dom's Storage is incomplete/non-writable) plus testing-library cleanup. `__mocks__/tauri.ts` exports the shared `mockInvoke` for service-layer tests (`vi.mock("@tauri-apps/api/core", …)` per file; cleared automatically between tests).
