#!/usr/bin/env bash
# Convenience entry point for launching Lynceus from the monorepo root —
# invoked via `just lynceus-dev` / `just lynceus-release` (or the
# equivalent `pnpm run lynceus:dev` / `pnpm run lynceus:release`),
# never directly. Resolves the repo root from its own location so it
# works regardless of the caller's cwd, and points LYNCEUS_MODELS_DIR
# at the repo-local weights so nobody has to remember that env var
# either.
set -euo pipefail

MODE="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LYNCEUS_MODELS_DIR="$ROOT_DIR/models/image"

cd "$ROOT_DIR/apps/lynceus"

case "$MODE" in
  dev)
    echo "Starting Lynceus (dev, models at $LYNCEUS_MODELS_DIR)…"
    pnpm run tauri dev
    ;;
  dev-telemetry)
    # PROFILING=1 is equivalent to the --profiling CLI flag (main.rs
    # accepts either) but avoids threading a flag through pnpm's
    # literal `--` forwarding and Tauri's own cargo-args marker.
    echo "Starting Lynceus (dev + telemetry, models at $LYNCEUS_MODELS_DIR)…"
    PROFILING=1 pnpm run tauri dev
    ;;
  release)
    echo "Building Lynceus (release, models at $LYNCEUS_MODELS_DIR)…"
    # --bundles app skips the DMG step (slower, needs a signing
    # identity for a real distributable) — a plain .app is enough to
    # launch and profile locally.
    #
    # No `--` before --bundles: unlike npm, pnpm does not strip a `--`
    # separator when forwarding script args — it passes it through
    # literally, and Tauri's own CLI treats a bare `--` after `build`
    # as "forward everything past this to cargo", which corrupts
    # --bundles into an unrecognised cargo flag. Confirmed by testing
    # both forms directly against `tauri build --help`.
    pnpm run tauri build --bundles app
    # Cargo workspace, not a standalone crate — the bundle lands under
    # the WORKSPACE root's target/, not apps/lynceus/src-tauri/target/.
    BUNDLE_DIR="$ROOT_DIR/target/release/bundle/macos"
    APP_PATH="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.app' | head -1)"
    if [ -z "$APP_PATH" ]; then
      echo "Build succeeded but no .app was found under $BUNDLE_DIR" >&2
      exit 1
    fi
    echo "Launching ${APP_PATH}…"
    open "$APP_PATH"
    ;;
  *)
    echo "Usage: $0 [dev|release]" >&2
    exit 1
    ;;
esac
