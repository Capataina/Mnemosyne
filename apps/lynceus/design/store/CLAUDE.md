# design/store/ — App Store materials

The two working documents for putting Lynceus on the Mac App Store.

```
store/
├── listing.md           App Store Connect copy, drafted 2026-07-19: name / subtitle /
│                        promo / description / keywords, each within Apple's hard
│                        character budget (counts inline); categories, privacy label
│                        ("Data Not Collected"), support+privacy URLs (site repo builds
│                        them), six-shot screenshot plan at 2880x1800 flattened PNG,
│                        and the OPEN pricing decision block
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

listing.md's review-risk self-check predates 5968d2e: its "entitlements wiring + enforcement run pending" line is done, and the description's "models downloaded on first launch" hedge is superseded — the store build bundles them. The copy still awaits founder sign-off, so reconcile when it's next edited, not silently.
