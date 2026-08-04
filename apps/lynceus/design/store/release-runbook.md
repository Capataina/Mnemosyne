# Lynceus — App Store release runbook (plain English)

> Written 2026-07-19. This is the "what actually happens and who does
> what" guide for putting Lynceus on the Mac App Store, assuming no
> prior experience with Apple's release machinery. Jargon is defined
> the first time it appears and never assumed.

## The five words you need

- **Code signing** — a cryptographic wax seal on the app proving who
  made it and that nobody tampered with it. macOS checks the seal every
  launch. Seals come from **certificates** that Apple issues to
  enrolled developers.
- **Entitlements** — a permission slip bundled inside the app listing
  exactly what it's allowed to do (read user-picked folders, remember
  them, and nothing else). Ours is
  `apps/lynceus/src-tauri/Entitlements.plist` — three permissions, all
  commented.
- **App Sandbox** — the padded room every App Store app must run in.
  The app can freely use its own private folder (where the library
  index, previews, and AI models live) but can touch nothing else
  except what the entitlements grant. Required for the store. One
  honest nuance (2026-08-03): the permission slip carries a network
  key because the system webview refuses to render without it — but
  Lynceus itself makes zero network requests, verified from sealed
  boot logs, and the privacy pitch rests on that behaviour.
- **Provisioning profile** — a laminated pass from Apple tying together
  your identity, the app's ID (com.capataina.lynceus), and its permission
  slip. Downloaded from Apple's site, referenced in the build config.
- **App Review** — the human + automated check Apple runs after you
  upload. Store apps do NOT need "notarisation" (that's the separate
  seal-checking service for apps distributed outside the store) —
  review replaces it.

## What is already done (nothing here needs you)

| Piece | State |
|---|---|
| Real app icon, all sizes | ✅ generated from the ringed-almond mark |
| Entitlements (permission slip) | ✅ written, three permissions, commented |
| Build config (`tauri.conf.json`) | ✅ sandbox wired, category Graphics & Design, minimum macOS 12 |
| Store-shaped build recipe | ✅ `just lynceus-sandbox-test` (free local test) and `just lynceus-mas-package` (the real thing, two blanks to fill) |
| AI models bundled inside the app | ✅ so the shipped app makes zero network requests |
| Listing copy (name, description, keywords) | ✅ draft 2 in `listing.md`, founder-signed-off 2026-08-04 |
| Support + privacy pages | ✅ live at capataina.dev/lynceus/support/ and /privacy/ (curl-verified 200) |
| Screenshots | ✅ eight pages in `Store Screenshots/`, spec-verified (2880×1800, no alpha, sRGB), founder-signed-off 2026-08-04 |
| Sandbox smoke test | ✅/⏳ app boots and runs inside the sandbox; the folder-permission persistence check is a 5-minute live test with you (below) |

## The 5-minute live test (you + me, before paying Apple anything)

The one thing only a human can do: grant a folder through the system
picker inside the sandboxed build.

1. I build and launch the sandboxed app (`just lynceus-sandbox-test`).
2. You: add a folder, watch it index, quit the app fully (⌘Q).
3. You: reopen the same app. **The folder should load without asking
   again.** That single observation proves the whole
   remember-my-folders machinery works inside the padded room.

One caveat from research: with the free local signing we use for this
test, that memory survives relaunches but not REBUILDS of the app —
that's a known property of test signing, not a bug. The real
certificate makes it permanent.

## What you do, when you're ready (~1 hour of your time + waiting)

1. **Enrol**: ✅ done 2026-08-03 — individual Apple Developer account,
   approved in ~30 minutes. The legal-name-as-seller point was accepted
   (transfers to a company entity are straightforward later).
2. **Two certificates** (Apple's site → Certificates): "Apple
   Distribution" (seals the app) and "Mac Installer Distribution"
   (seals the installer package). Xcode can generate both for you via
   Settings → Accounts → Manage Certificates.
3. **One provisioning profile** (Apple's site → Profiles): type
   "Mac App Store", for App ID com.capataina.lynceus. Download it.
4. Tell me — I fill the two identity names into the justfile, point
   the config at the profile, and run `just lynceus-mas-package`. Out
   comes `Lynceus.pkg`: the sealed box we upload.
5. **App Store Connect** (appstoreconnect.apple.com): create the app
   record, paste the listing copy, upload screenshots (spec below),
   set the privacy answers to **"Data Not Collected"** everywhere
   (true, and OS-enforced), add the support + privacy URLs, pick the
   price.
6. **Upload**: Apple's free "Transporter" app from the Mac App Store —
   drag the .pkg in, press Deliver.
7. **Submit for review.** First reviews typically take 1–2 days;
   first-time apps often get one bounce-and-fix round — normal, not
   failure. Realistic end-to-end: about a week; budget two.

## Screenshots (spec, from Apple's current rules)

- Native Retina resolution — **2880×1800** for a full-screen capture on
  this MacBook Pro.
- PNG with **no transparency** (alpha channel must be flattened, or the
  upload is rejected).
- Done: the eight final pages live in `Store Screenshots/`, composed
  over the CC0 museum demo library and script-verified against this
  spec (2026-08-03).

## Decisions — all closed 2026-08-04

1. **Price** — £9.99 paid up front, UK base storefront; full mechanics
   in `listing.md`'s pricing section.
2. **Apple Silicon only** — no Intel build at launch; the store lists
   the requirement. Intel can be added later if ever wanted.
3. **Seller name** — legal name accepted; transfer later if needed.

## Known watch-items (flagged honestly)

- The "folder memory survives under the REAL certificate" check
  (runbook step 4) re-runs the 5-minute live test once — research
  says it will pass, but it's inference until observed.
- Apple's per-file upload size cap for macOS builds is unconfirmed
  (iOS's cap is 4GB; our .pkg with bundled models will be well under
  half that, so this is a note, not a worry).
- If review ever mentions "privacy manifests" for third-party
  libraries: that rule mostly targets iOS SDKs; our dependencies are
  Rust crates compiled into one binary. Handle if raised, don't
  pre-engineer.
