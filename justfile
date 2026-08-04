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

# Mac App Store build + package — the real thing. Identities filled
# 2026-08-04 from the login keychain (certificates created via Xcode
# that day; "3rd Party Mac Developer Installer" is Apple's on-disk name
# for the Mac Installer Distribution certificate). The provisioning
# profile is embedded by the recipe itself (cp before codesign, so the
# seal covers it) — Tauri 2.11 has no provisioningProfile config field.
# Signing uses Entitlements.mas.plist (base four keys + the two
# identity entitlements MAS validation requires; the base plist stays
# identity-free because restricted entitlements break the ad-hoc
# sandbox-test build). The .pkg this produces is what Transporter uploads.
APP_IDENTITY := "Apple Distribution: Ata Caner Çetinkaya (VURQD42U5Z)"
PKG_IDENTITY := "3rd Party Mac Developer Installer: Ata Caner Çetinkaya (VURQD42U5Z)"
lynceus-mas-package:
    cd apps/lynceus && pnpm tauri build --bundles app
    cp apps/lynceus/src-tauri/Lynceus_Mac_App_Store.provisionprofile       "target/release/bundle/macos/Lynceus.app/Contents/embedded.provisionprofile"
    codesign --force --deep --sign "{{APP_IDENTITY}}"       --entitlements apps/lynceus/src-tauri/Entitlements.mas.plist       "target/release/bundle/macos/Lynceus.app"
    xcrun productbuild --sign "{{PKG_IDENTITY}}"       --component "target/release/bundle/macos/Lynceus.app" /Applications       "target/release/bundle/macos/Lynceus.pkg"

