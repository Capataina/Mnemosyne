# Convenience command runner for the Mnemosyne/Lynceus monorepo.
# `just --list` from anywhere in the repo shows everything below.
# Recipes are thin wrappers — the real logic lives in scripts/ or
# plain cargo/pnpm invocations, so there's nothing just-specific to
# maintain if this tool is ever dropped.

# Launch Lynceus in dev mode (hot-reloading frontend + debug Rust build).
lynceus-dev:
    bash scripts/start_lynceus.sh dev

# Dev mode with the telemetry/profiling layer armed: action breadcrumbs,
# IPC timings, render profiler, JSONL event log + on-exit report, and the
# perf overlay auto-open (⌘⇧P toggles it). Same build, just observed.
lynceus-dev-telemetry:
    bash scripts/start_lynceus.sh dev-telemetry

# Build Lynceus in release mode and open the resulting .app — for
# real performance testing, not a full signed/distributable bundle.
lynceus-release:
    bash scripts/start_lynceus.sh release

