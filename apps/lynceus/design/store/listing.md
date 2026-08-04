# Lynceus — Mac App Store listing (draft 2, 2026-08-03 — ASO-research-grounded; draft 1 was 2026-07-19)

> Working copy for App Store Connect. Character budgets are Apple's hard limits; every field below is within them (counts verified by script, not eye). Field mechanics from the 2026-08-03 ASO research: name > subtitle > keywords in search weight, never repeat a term across the three fields, singular forms (Apple auto-matches English plurals), no spaces after keyword commas, no competitor names anywhere (guideline 2.3.7). Pricing is deliberately left as a decision block.

## Name (30 chars max)

**Lynceus: AI Image Organizer** (27)

"Image organizer" is the live category vocabulary on the Mac App Store; "AI" is honest (on-device encoders) and searched. Draft-1 alternative `Lynceus — Local Image Browser` (29) kept on record; "browser" is weaker category vocabulary than "organizer".

## Subtitle (30 chars max)

**Private photo search & boards** (29)

Carries three search terms the name doesn't (private, photo, search) plus the moodboard hint — per the no-repeat rule, none of these appear in the keyword field.

## Promotional text (170 chars max — editable without review)

**Every image you've ever saved, one keystroke away. Search by meaning, follow visual trails, arrange your board by hand. All on your Mac, nothing in the cloud.** (158)

## Description (4000 chars max; not indexed by App Store search — its jobs are conversion and Google. First ~170 chars carry the fold.)

Lynceus is for people who collect images: reference art, family photos, screenshots, inspiration. The ones you save carefully and then can never find again.

Point it at your folders and it builds a fast, private library on your Mac. Nothing is uploaded. Nothing is moved. Your files stay exactly where they are; Lynceus just sees them.

FIND BY DESCRIBING
Type what you remember, like "red armour concept art", "birthday cake in the garden", or "foggy mountain at dawn", and Lynceus finds it, even when the filename is IMG_4302. Three on-device AI encoders read your images once, locally. Their rankings are fused so the strongest matches surface first, and from then on search is instant and entirely offline.

FOLLOW VISUAL TRAILS
Click any image to see the ones that look like it. Click again to go deeper. The trail remembers where you came from. It's the "more like this" your file browser never had, and the fastest way to rediscover a collection you forgot you owned.

A BOARD, NOT A LIST
The masonry board packs your images edge to edge like a moodboard. Drag any image exactly where you want it: the board telegraphs where it will land and settles precisely there. Stretch the ones that matter to 2×2 or 3×3. Your arrangement is yours, and it survives restarts, rescans, and reshuffles.

TAGS THAT ACT LIKE FOLDERS
Tag images without moving a single file. Every tag becomes a folder in the library panel, and filters combine (must have this, must not have that) to cut a thousand images down to the twelve you meant.

PRACTISE FROM YOUR OWN COLLECTION
The gesture timer turns any similarity range into a timed drawing session. The countdown advances references automatically, zoom rides your cursor, and a history strip keeps every reference one click away, so you can revisit an earlier pose without losing your place, then resume the clock. Set the interval, hit start, and draw.

MADE FOR COLLECTIONS OF EVERY KIND
- Artists: build reference boards, then practise from them in timed sessions.
- Photographers: rediscover ten years of shoots by describing the frame you half-remember.
- Families: your photo archive, searchable in plain words, on your own machine.
- Designers: moodboards that search themselves, by subject, colour, or feel.
- Collectors and researchers: a thousand scans become a browsable, taggable archive.

PRIVATE BY ARCHITECTURE
Lynceus is local-first the whole way down. The library index, the previews, the AI models: all of it ships inside the app and lives on your Mac. There is no account, no telemetry, no cloud, and no network request. Ever. Unplug the internet and nothing changes. Settings shows you the whole index, every image catalogued, previewed, and encoded, live.

Lynceus watches your folders and keeps itself current. Add files, move them, rename them, restructure everything: images keep their tags, their notes, and their place on your board, because Lynceus recognises files by their content, not their path. A short onboarding tour shows you the whole app in under a minute, replayable any time from Settings.

## Keywords (100 chars max, comma-separated)

`manager,moodboard,reference,browser,viewer,gallery,tag,folder,local,offline,semantic,art,draw` (93)

No term repeats the name or subtitle (repeats waste the slot — Apple already indexes those fields); singulars only; no spaces after commas. Apple combines separate keywords into phrases automatically ("image manager", "reference board", "offline gallery" all emerge from these + the name/subtitle terms).

## Categories

- **Primary:** Graphics & Design
- **Secondary:** Photography

## Privacy nutrition label

**Data Not Collected** — the app has no account system, no analytics, no third-party SDKs, and makes no network requests at all (the store build bundles its models; sealed-boot logs verified zero attempts). Declare "Data is not collected" for every category.

## URLs (required by App Store Connect)

- Support URL: `https://capataina.dev/lynceus/support/` (LIVE — verified 200 with content, 2026-08-03)
- Privacy policy URL: `https://capataina.dev/lynceus/privacy/` (LIVE — verified 200 with content, 2026-08-03)

## Screenshot plan (2880×1800 native Retina PNG, alpha flattened — per Apple's current spec)

| # | Shot | Why it sells |
|---|---|---|
| 1 | Full masonry board, rich art library, one tile mid-drag with telegraph | The product in one frame |
| 2 | Semantic search: query typed, ranked results | The headline feature |
| 3 | Similarity cascade with breadcrumb + inspector open | Depth of discovery |
| 4 | Library drawer: tags-as-folders + must/must-not filters | Organisation story |
| 5 | Gesture timer fullscreen, zoomed reference, countdown bar + history strip visible | The artist audience |
| 6 | Onboarding scene 2 mid-animation | Polish signal |

## Pricing — DECIDED (2026-08-04)

**Paid up front, £9.99 launch price, rising later.** Founder's call, from the three options considered (a $14.99–19.99 pro-tool price: hardest cold-start for an unknown developer; a free tier with one-time unlock: best funnel but needs StoreKit gating the local-first pitch doesn't want). No subscription — it would contradict the local-first pitch. £9.99 sits at the try-it threshold for a first release with zero reviews, and raising a price later reads as success where lowering one reads as distress.

Mechanics: the base storefront is the United Kingdom at £9.99; Apple auto-generates equalised prices for the other 174 storefronts (VAT-inclusive regions offset the FX conversion, so the US lands near $9.99–10.99, not naive-FX $12.99). Review the generated sheet in App Store Connect at record creation; override the US to $9.99 by hand if it generates at $10.99. Enrol in the Small Business Program once the record exists (30% → 15% commission under $1M/year).

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
