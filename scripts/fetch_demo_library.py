#!/usr/bin/env python3
"""Build the App Store screenshot library from museum open-access collections.

Downloads a curated, CC0/public-domain-only image set from the Art Institute
of Chicago and The Met — both publish their public-domain works under CC0,
which permits commercial use (App Store screenshots included) with no
attribution and no permission. Filtering is done per item against the API's
own public-domain flag, never assumed from the collection.

The mix is chosen for Lynceus's audience (artists using reference boards):
figure studies, portraits, Japanese woodblock prints, landscapes, botanical
plates, still lifes — visually diverse hues and aspect ratios so the masonry
grid and the search/similarity screenshots read well.

Usage:
    python3 scripts/fetch_demo_library.py                 # full run (~250 images)
    python3 scripts/fetch_demo_library.py --limit-per-query 3   # smoke test
    python3 scripts/fetch_demo_library.py --dest ~/somewhere

Idempotent: existing files are skipped, so re-runs only fetch what's missing.
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "LynceusDemoLibraryFetcher/1.0 (personal use; contact: capataina.dev)"
# AIC's image CDN sits behind a WAF that 403s bare programmatic requests —
# a plain UA string is not enough; it wants a browser-shaped header set
# (verified empirically 2026-08-03: UA-only = 403, these headers = 200).
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
    ),
    "Accept": "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://www.artic.edu/",
}
DEFAULT_DEST = Path.home() / "Pictures" / "LynceusDemoLibrary"

# (query, max results to keep) — tuned for a ~1,500-piece library with varied
# subject matter, hue, and aspect ratio (scaled up from the original ~250 on
# 2026-08-03: a 222-image corpus made "More like this" rank loosely related
# art as neighbours; similarity needs real density to demo honestly).
AIC_QUERIES = [
    ("figure drawing", 80),
    ("portrait painting", 80),
    ("japanese woodblock print", 90),
    ("landscape painting", 90),
    ("botanical", 60),
    ("still life painting", 60),
    ("impressionist painting", 80),
    ("marine seascape", 60),
    ("animal painting", 60),
    ("architecture drawing", 50),
    ("watercolor", 60),
    ("textile design", 60),
    # Second wave (2026-08-03): the Met's search endpoint rate-limited us
    # mid-run, so AIC carries the balance to the ~1,500 target alone.
    ("etching", 80),
    ("drawing study", 80),
    ("cityscape", 70),
    ("genre painting", 80),
    ("ceramics", 60),
    ("gold", 60),
    ("modern painting", 80),
    ("photograph", 80),
]
MET_QUERIES = [
    ("figure study drawing", 80),
    ("ukiyo-e", 80),
    ("watercolor landscape", 70),
    ("flower painting", 60),
    ("bird painting", 60),
    ("dutch painting", 60),
    ("medieval manuscript", 60),
    ("armor", 50),
]


def fetch_json(url: str) -> dict:
    # Browser-shaped headers here too: the Met's search endpoint started
    # 403-ing the plain programmatic UA mid-run on 2026-08-03, same class
    # of WAF behaviour as AIC's image CDN (see BROWSER_HEADERS above).
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers=BROWSER_HEADERS)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        if len(data) < 10_000:  # a real artwork JPEG is never this small
            return False
        dest.write_bytes(data)
        return True
    except Exception as exc:  # noqa: BLE001 — log-and-continue is the contract
        print(f"    ! {dest.name}: {exc}")
        return False


def fetch_aic(dest: Path, limit_per_query: int | None) -> tuple[int, int]:
    """AIC: search carries is_public_domain + image_id directly; images come
    from their IIIF server. 843px is the documented always-available width."""
    kept = skipped = 0
    for query, want in AIC_QUERIES:
        want = min(want, limit_per_query) if limit_per_query else want
        print(f"[aic] {query!r}")
        got = 0
        # Search pages are 100 wide; walk up to 4 pages per query so wants
        # above 100 (or heavily-filtered queries) can still be satisfied.
        for page in range(1, 5):
            if got >= want:
                break
            params = urllib.parse.urlencode(
                {
                    "q": query,
                    "query[term][is_public_domain]": "true",
                    "fields": "id,title,image_id,is_public_domain",
                    "limit": 100,
                    "page": page,
                }
            )
            url = f"https://api.artic.edu/api/v1/artworks/search?{params}"
            try:
                payload = fetch_json(url)
            except Exception as exc:  # noqa: BLE001
                print(f"    ! search failed (page {page}): {exc}")
                break
            rows = payload.get("data", [])
            if not rows:
                break
            for art in rows:
                if got >= want:
                    break
                if not art.get("is_public_domain") or not art.get("image_id"):
                    continue
                out = dest / f"aic_{art['id']}.jpg"
                if out.exists():
                    got += 1
                    skipped += 1
                    continue
                img = (
                    f"https://www.artic.edu/iiif/2/{art['image_id']}"
                    "/full/843,/0/default.jpg"
                )
                if download(img, out):
                    got += 1
                    kept += 1
                    time.sleep(0.15)
        print(f"    -> {got} kept")
    return kept, skipped


def fetch_met(dest: Path, limit_per_query: int | None) -> tuple[int, int]:
    """The Met: search returns object IDs only; the per-object record carries
    isPublicDomain and the image URLs. primaryImageSmall (~750-1200px) keeps
    the run fast and is plenty for masonry tiles and 2880px screenshots."""
    kept = skipped = 0
    for query, want in MET_QUERIES:
        want = min(want, limit_per_query) if limit_per_query else want
        params = urllib.parse.urlencode({"q": query, "hasImages": "true"})
        url = (
            "https://collectionapi.metmuseum.org/public/collection/v1/search?"
            + params
        )
        print(f"[met] {query!r}")
        try:
            payload = fetch_json(url)
        except Exception as exc:  # noqa: BLE001
            print(f"    ! search failed: {exc}")
            continue
        got = 0
        for object_id in payload.get("objectIDs") or []:
            if got >= want:
                break
            out = dest / f"met_{object_id}.jpg"
            if out.exists():
                got += 1
                skipped += 1
                continue
            try:
                record = fetch_json(
                    "https://collectionapi.metmuseum.org/public/collection/v1/objects/"
                    f"{object_id}"
                )
            except Exception:  # noqa: BLE001 — individual records 404 freely
                continue
            if not record.get("isPublicDomain"):
                continue
            img = record.get("primaryImageSmall") or record.get("primaryImage")
            if not img:
                continue
            if download(img, out):
                got += 1
                kept += 1
            time.sleep(0.1)  # stay far under the Met's 80 req/s ceiling
        print(f"    -> {got} kept")
    return kept, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--limit-per-query", type=int, default=None)
    args = parser.parse_args()

    args.dest.mkdir(parents=True, exist_ok=True)
    print(f"destination: {args.dest}")

    aic_new, aic_skip = fetch_aic(args.dest, args.limit_per_query)
    met_new, met_skip = fetch_met(args.dest, args.limit_per_query)

    total = len(list(args.dest.glob("*.jpg")))
    print(
        f"\ndone: {aic_new + met_new} downloaded, {aic_skip + met_skip} already "
        f"present, {total} images in library"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
