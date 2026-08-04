# design/store/ — App Store materials

The two working documents for putting Lynceus on the Mac App Store.

```
store/
├── listing.md           App Store Connect copy, draft 2 (2026-08-03, ASO-research-
│                        grounded): name "Lynceus: AI Image Organizer" (27) / subtitle
│                        "Private photo search & boards" (29) / keywords (93, no-repeat
│                        rule applied) / 3,045-char description with human use-case
│                        section; field mechanics documented inline (name>subtitle>
│                        keywords weight, singulars, no cross-field repeats, no
│                        competitor names per 2.3.7). Categories, privacy label
│                        ("Data Not Collected"), live support+privacy URLs, screenshot
│                        plan, and the OPEN pricing decision block. Awaits founder
│                        sign-off as a whole.
└── release-runbook.md   plain-English signing/notarisation runbook (2026-07-19) for a
                         first-time Mac publisher: defines the five terms, tables what
                         is already done, then the founder's ~1-hour enrolment path
```

## Decisions — all closed 2026-08-04 (founder's calls)

- **Pricing** — paid up front, **£9.99 launch price** (UK base storefront, Apple auto-equalises the other 174; mechanics recorded in listing.md's pricing section). Rising later is the plan.
- **Apple Silicon only** — no Intel build; Apple Silicon is the product's floor.
- **Seller name** — the legal name (Ata Caner Çetinkaya) is accepted for now; account transfers are easy if a company entity comes later.
- **Listing copy and the eight screenshot pages** — both signed off as-is 2026-08-04.

## The owed live test — PASSED 2026-08-04

The 5-minute live folder-persistence run passed founder-driven on the ad-hoc sandbox build: folder added via the system picker, indexed, app fully quit, relaunched — the folder loaded without re-asking. The same pass live-re-verified the AUTOINCREMENT id fix (bc01c71): the founder swapped the museum demo folder for a wallpapers folder and the fresh images showed correct thumbnails, the exact scenario that used to resurrect a deleted root's thumbs. Standing trap, still true: **ad-hoc signing's bookmark identity survives relaunches but NOT rebuilds** — folder memory "breaking" after a local rebuild is a property of test signing, not a bug. The real-certificate confirmation of the same behaviour arrives free via TestFlight once the signed .pkg is uploaded (a distribution-signed .app cannot be launched locally by design).

## Staleness notes

Reconciled 2026-08-03: the description now claims zero network requests ever (bundled models), the privacy label rationale matches, the support/privacy URLs are the live verified pages, the review self-check reflects the finished sandbox work, and screenshot shot 5 names the countdown bar + history strip (the arc timer died in the onboarding/timer v2 work). The copy still awaits founder sign-off as a whole. One fact worth preserving verbatim: the entitlement slip carries `network.client` because sandboxed WKWebView cannot render without it — the "no network entitlement" phrasing must never come back into the copy.
