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

## Open decisions (founder's, not the agent's)

- **Pricing** — three options framed in listing.md; recommendation on record is paid-up-front with a launch price (~$9.99 rising later). Not yet decided.
- **Apple Silicon only vs Intel** — runbook recommends Silicon-only at launch.
- **Seller name** — an individual account shows the legal name, not "Capataina".

## The owed live test

The one repo-side remaining check is the 5-minute live folder-persistence run: `just lynceus-sandbox-test`, founder adds a folder, quits, relaunches — the folder must load without re-asking. It needs a human because only a human can drive the system folder picker. Trap that motivated it: **ad-hoc signing's bookmark identity survives relaunches but NOT rebuilds** — folder memory "breaking" after a rebuild is a known property of test signing, not a bug; the real certificate makes it permanent (and re-runs the same test once).

## Staleness notes

Reconciled 2026-08-03: the description now claims zero network requests ever (bundled models), the privacy label rationale matches, the support/privacy URLs are the live verified pages, the review self-check reflects the finished sandbox work, and screenshot shot 5 names the countdown bar + history strip (the arc timer died in the onboarding/timer v2 work). The copy still awaits founder sign-off as a whole. One fact worth preserving verbatim: the entitlement slip carries `network.client` because sandboxed WKWebView cannot render without it — the "no network entitlement" phrasing must never come back into the copy.
