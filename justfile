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

# Build the store-shaped .app bundle (sandbox entitlements wired via
# tauri.conf.json) and sign it AD-HOC for local sandbox testing. This is
# the "does the app work inside the App Store's padded room" check — it
# needs no Apple account. Bookmarks persist across relaunches of the
# SAME binary; only rebuilds break ad-hoc bookmark identity.
lynceus-sandbox-test:
    cd apps/lynceus && pnpm tauri build --bundles app
    codesign --force --deep --sign -       --entitlements apps/lynceus/src-tauri/Entitlements.plist       "target/release/bundle/macos/Lynceus.app"
    codesign --display --entitlements -       "target/release/bundle/macos/Lynceus.app"
    open "target/release/bundle/macos/Lynceus.app"

# Mac App Store build + package — the real thing, once the Apple
# Developer account exists. Fill the two identity strings from
# Keychain Access after installing the certificates, and set
# bundle.macOS.provisioningProfile in tauri.conf.json to the downloaded
# profile. The .pkg this produces is what Transporter uploads.
APP_IDENTITY := "Apple Distribution: YOUR NAME (TEAMID)"
PKG_IDENTITY := "3rd Party Mac Developer Installer: YOUR NAME (TEAMID)"
lynceus-mas-package:
    cd apps/lynceus && pnpm tauri build --bundles app
    codesign --force --deep --sign "{{APP_IDENTITY}}"       --entitlements apps/lynceus/src-tauri/Entitlements.plist       "target/release/bundle/macos/Lynceus.app"
    xcrun productbuild --sign "{{PKG_IDENTITY}}"       --component "target/release/bundle/macos/Lynceus.app" /Applications       "target/release/bundle/macos/Lynceus.pkg"

