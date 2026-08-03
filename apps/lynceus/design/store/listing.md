# Lynceus — Mac App Store listing (draft 1, 2026-07-19)

> Working copy for App Store Connect. Character budgets are Apple's hard
> limits; every field below is within them. Pricing is deliberately left
> as a decision block. Screenshot sizes to be pinned once the current
> requirements are confirmed (research in flight).

## Name (30 chars max)

**Lynceus — Local Image Browser** (29)

Alternatives, if the dash reads clunky in search:
- `Lynceus: Image Browser` (22)
- `Lynceus` (7 — cleanest, weakest for search)

## Subtitle (30 chars max)

**Your library, seen instantly** (28)

Alternatives:
- `Private, local image search` (27)
- `Find any image by describing` (28)

## Promotional text (170 chars max — editable without review)

**Every image you've ever saved, one keystroke away. Search by meaning,
follow visual trails, arrange your board by hand — all on your Mac,
nothing in the cloud.** (159)

## Description (4000 chars max)

Lynceus is for people who collect images — reference art, wallpapers,
screenshots, inspiration — and then can never find them again.

Point it at your folders and it builds a fast, private library on your
Mac. Nothing is uploaded. Nothing is moved. Your files stay exactly
where they are; Lynceus just sees them.

FIND BY DESCRIBING
Type what you remember — "red armour concept art", "foggy mountain at
dawn" — and Lynceus finds it, even when the filename is IMG_4302.
On-device AI encoders (OpenCLIP, SigLIP-2, DINOv2) read your images
once, locally, and from then on search is instant and entirely offline.

FOLLOW VISUAL TRAILS
Click any image to see the ones that look like it. Click again to go
deeper. It's the "more like this" your file browser never had — and the
fastest way to rediscover a collection you forgot you owned.

A BOARD, NOT A LIST
The masonry board packs your images edge to edge like a moodboard.
Drag any image exactly where you want it — the board telegraphs where
it will land and settles precisely there. Stretch the ones that matter
to 2×2 or 3×3. Your arrangement is yours.

TAGS THAT ACT LIKE FOLDERS
Tag images without moving a single file. Every tag becomes a folder in
the library drawer, and filters combine — must have this, must not have
that — to cut a thousand images down to the twelve you meant.

BUILT FOR ARTISTS WHO PRACTISE
The gesture timer turns any selection into a timed reference session:
auto-advancing images, pinch to zoom, pan with two fingers, pause when
you need longer. Set the interval, hit start, and draw.

PRIVATE BY ARCHITECTURE
Lynceus is local-first the whole way down. The library index, the
previews, the AI models — all of it ships inside the app and lives on
your Mac. There is no account, no telemetry, no cloud, and no network
request — ever. Unplug the internet and nothing changes.

— 

Lynceus watches your folders and keeps itself current: add files, move
them, restructure everything — images keep their tags and their place
on your board. A short onboarding tour shows you the whole app in under
a minute, and you can replay it any time from Settings.

## Keywords (100 chars max, comma-separated)

`image,browser,photo,organizer,moodboard,reference,semantic,search,ai,local,private,art,gesture,draw` (99)

## Categories

- **Primary:** Graphics & Design
- **Secondary:** Photography

## Privacy nutrition label

**Data Not Collected** — the app has no account system, no analytics,
no third-party SDKs, and makes no network requests at all (the store
build bundles its models; sealed-boot logs verified zero attempts).
Declare "Data is not collected" for every category.

## URLs (required by App Store Connect)

- Support URL: `https://capataina.dev/lynceus/support/` (LIVE —
  verified 200 with content, 2026-08-03)
- Privacy policy URL: `https://capataina.dev/lynceus/privacy/` (LIVE —
  verified 200 with content, 2026-08-03)

## Screenshot plan (2880×1800 native Retina PNG, alpha flattened — per Apple's current spec)

| # | Shot | Why it sells |
|---|---|---|
| 1 | Full masonry board, rich art library, one tile mid-drag with telegraph | The product in one frame |
| 2 | Semantic search: query typed, ranked results | The headline feature |
| 3 | Similarity cascade with breadcrumb + inspector open | Depth of discovery |
| 4 | Library drawer: tags-as-folders + must/must-not filters | Organisation story |
| 5 | Gesture timer fullscreen, zoomed reference, countdown bar + history strip visible | The artist audience |
| 6 | Onboarding scene 2 mid-animation | Polish signal |

## Pricing — DECISION NEEDED

Options on the table (no subscription — it would contradict the
local-first pitch):

1. **Paid up front, ~$14.99–19.99** — matches the "pro tool, own it"
   positioning; smallest support surface; hardest cold-start.
2. **Paid up front, launch price ~$9.99 rising later** — momentum lever
   for the launch window ("early supporter" price).
3. **Free + one-time in-app unlock** (e.g. library size cap until
   unlock) — best funnel, more engineering (StoreKit + gating).

Recommendation: option 2. One-time pricing is the honest match for a
no-account, no-cloud app, and a visible launch discount gives the
launch story urgency without a free tier's gating work.

## Review-risk self-check

- Real app icon ✓ (b5005e4). No placeholder content anywhere in the
  shipping build. Onboarding uses deliberate skeletons — cosmetic, not
  "unfinished UI"; the storyboards label them as demonstrations.
- Sandbox: done and live-tested — security-scoped bookmarks
  implemented, entitlements wired (incl. the `network.client` key the
  webview needs to render; the app itself makes zero requests), sealed
  build renders and runs (2026-08-03).
- Minimum functionality: comfortably clear — search, similarity,
  board, tags, timer, onboarding.
