#!/usr/bin/env python3
"""
Mnemosyne — encoder-weight fetcher.

Downloads every ONNX encoder model (and its tokenizer) that an app in this
monorepo needs, into `models/<modality>/` at the repo root. The weights are
deliberately NOT committed to git (see .gitignore `/models/`); this script is
how you materialise them inside the repo tree so they are:

    1. easy to inspect on disk (Finder / editor), rather than buried under
       ~/Library/Application Support/… where you'd need a file browser like
       Yazi just to see them, and
    2. the source the Tauri bundler packages into each shipped .app.

Every model here is under a COMMERCIAL-FRIENDLY licence so the resulting apps
can ship on the Mac App Store:

    image/
      clip_vision.onnx      OpenCLIP LAION-2B ViT-B/32 vision   (MIT)
      clip_text.onnx        OpenCLIP LAION-2B ViT-B/32 text     (MIT)
      clip_tokenizer.json   CLIP BPE tokenizer (49408 vocab)    (see note *)
      dinov2_base_image.onnx  DINOv2-Base vision, Meta          (Apache-2.0)
      siglip2_vision.onnx   SigLIP-2 Base 256 vision, Google    (Apache-2.0)
      siglip2_text.onnx     SigLIP-2 Base 256 text, Google      (Apache-2.0)
      siglip2_tokenizer.json  Gemma SentencePiece (256k vocab)  (Apache-2.0)

    audio/   (empty until the audio browser — Syrinx — exists)
    3d/      (empty until the 3D-asset browser — Daedalus — exists)

The OpenAI CLIP weights the project shipped during its portfolio phase are
released under a NON-COMMERCIAL research licence and were removed for the
commercial pivot. `immich-app/ViT-B-32__laion2b-s34b-b79k` is a drop-in MIT
replacement — same CLIP BPE tokenizer, same image preprocessing, same 512-d
output — so nothing but these URLs changed.

* Tokenizer note: the CLIP BPE tokenizer.json below is currently mirrored from
  Xenova's OpenAI export. It is functionally the open_clip MIT vocab/merges
  (not trained model weights), but its provenance should be re-sourced from an
  explicitly MIT repo before a paid release. Tracked as a pre-sale checklist
  item, not a blocker for development.

Usage:
    python3 scripts/download_models.py                 # all modalities → repo models/
    python3 scripts/download_models.py --modality image
    python3 scripts/download_models.py --output /tmp/models   # override target root

Properties:
    - Pure Python 3.9+ stdlib — no `requests`, no `huggingface_hub`.
    - Resumable — re-running skips any file already fully on disk.
    - Atomic — each file writes to `<name>.part` then renames on success, so an
      interrupted download never leaves a half-file masquerading as complete.
    - Total image-modality payload: ~2.5 GB across 7 files.
"""

import argparse
import os
import sys
import urllib.request
from pathlib import Path

# HuggingFace `resolve/main` direct-download URLs. Keep these in lock-step with
# the Rust constants in each encoder module (model_download.rs, encoder_dinov2.rs,
# encoder_siglip2.rs) — the app loads the files by the exact filenames below.
MODELS = {
    "image": [
        # OpenCLIP LAION-2B ViT-B/32 — MIT-licensed drop-in for OpenAI CLIP.
        (
            "https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k/resolve/main/visual/model.onnx",
            "clip_vision.onnx",
        ),
        (
            "https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k/resolve/main/textual/model.onnx",
            "clip_text.onnx",
        ),
        # CLIP BPE tokenizer — see provenance note in the module docstring.
        (
            "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
            "clip_tokenizer.json",
        ),
        # DINOv2-Base (Meta, Apache-2.0) — image-only "View Similar" specialist.
        (
            "https://huggingface.co/Xenova/dinov2-base/resolve/main/onnx/model.onnx",
            "dinov2_base_image.onnx",
        ),
        # SigLIP-2 Base 256 (Google, Apache-2.0) — shared 768-d text+image space.
        (
            "https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/resolve/main/onnx/vision_model.onnx",
            "siglip2_vision.onnx",
        ),
        (
            "https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/resolve/main/onnx/text_model.onnx",
            "siglip2_text.onnx",
        ),
        (
            "https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/resolve/main/tokenizer.json",
            "siglip2_tokenizer.json",
        ),
    ],
    # Placeholders — the folders are created so the layout is visible, but no
    # weights are fetched until these products exist. Add entries here when
    # Syrinx (audio, e.g. CLAP) and Daedalus (3D) land.
    "audio": [],
    "3d": [],
}

CHUNK = 1024 * 1024  # 1 MiB read chunks.


def repo_root() -> Path:
    """Repo root = parent of the scripts/ directory this file lives in."""
    return Path(__file__).resolve().parent.parent


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{int(n)}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}GB"


def download_one(url: str, dest: Path) -> bool:
    """Download `url` → `dest` atomically. Returns True if a fetch happened,
    False if the file was already present (skip)."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  ✓ {dest.name} already present ({human(dest.stat().st_size)}) — skipping")
        return False

    part = dest.with_suffix(dest.suffix + ".part")
    if part.exists():
        part.unlink()  # stale partial — no HTTP Range, so restart clean.

    req = urllib.request.Request(url, headers={"User-Agent": "mnemosyne-download-models/1.0"})
    print(f"  ↓ {dest.name}  <-  {url}")
    with urllib.request.urlopen(req) as resp:
        total = int(resp.headers.get("content-length", 0))
        written = 0
        last_pct = -1
        with open(part, "wb") as f:
            while True:
                buf = resp.read(CHUNK)
                if not buf:
                    break
                f.write(buf)
                written += len(buf)
                if total:
                    pct = int(written / total * 100)
                    if pct != last_pct and pct % 5 == 0:
                        last_pct = pct
                        print(f"      {pct:3d}%  {human(written)} / {human(total)}", end="\r", flush=True)
        print(" " * 60, end="\r")  # clear the progress line.
    part.rename(dest)
    print(f"  ✓ {dest.name}  ({human(dest.stat().st_size)})")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch commercial-licensed encoder weights into models/.")
    ap.add_argument(
        "--output",
        type=Path,
        default=repo_root() / "models",
        help="Target models/ root (default: <repo>/models).",
    )
    ap.add_argument(
        "--modality",
        choices=sorted(MODELS.keys()),
        action="append",
        help="Only fetch this modality (repeatable). Default: all.",
    )
    args = ap.parse_args()

    modalities = args.modality or list(MODELS.keys())
    out_root: Path = args.output
    fetched = skipped = 0

    for modality in modalities:
        targets = MODELS[modality]
        dest_dir = out_root / modality
        dest_dir.mkdir(parents=True, exist_ok=True)
        if not targets:
            print(f"[{modality}] no models defined yet — folder created at {dest_dir}")
            continue
        print(f"[{modality}] → {dest_dir}  ({len(targets)} files)")
        for url, filename in targets:
            try:
                if download_one(url, dest_dir / filename):
                    fetched += 1
                else:
                    skipped += 1
            except Exception as e:  # noqa: BLE001 — one bad file shouldn't abort the batch.
                print(f"  ✗ {filename} FAILED: {e}", file=sys.stderr)

    print(f"\nDone. {fetched} fetched, {skipped} already present. Weights live under {out_root}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
