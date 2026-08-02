# scripts/ — repo helpers (none required to build the app)

Python 3 stdlib-or-near helpers plus the launch wrapper. Nothing here runs in the shipped product; `download_models.py` and `quantize_models.py` produce the weights the Tauri bundler packages.

```
download_models.py       fetches every ONNX encoder + tokenizer into models/<modality>/
                         (--modality image|audio|3d; audio and 3d are empty until
                         Syrinx/Daedalus exist). All weights commercially licensed —
                         the non-commercial OpenAI CLIP weights were replaced by the
                         MIT immich-app LAION-2B re-export at the commercial pivot;
                         provenance notes live in its docstring
quantize_models.py       makes lower-precision variants beside the fp32 originals,
                         additive only. int8: static QDQ calibrated on ~300 real
                         images (--calibration-dir, Splash Arts corpus), dynamic for
                         the two text encoders; 1129MB -> 283MB verified with real
                         ORT forward passes. fp16: see trap below
download_lol_splashes.py the canonical test corpus: ~1500 LoL splash arts (1280x720
                         JPG, ~3-4GB) from Riot's public DDragon CDN into
                         ~/Documents/Splash Arts/ (--output overrides; --workers up
                         to ~32 tolerated by the CDN); resumable, stdlib-only.
                         Distinct images, clean CLIP clusters — the shared baseline
                         for cross-machine search-quality comparison
start_lynceus.sh         the launcher behind just lynceus-dev/-dev-telemetry/-release;
                         resolves the repo root, exports LYNCEUS_MODELS_DIR, and
                         documents the pnpm `--` trap inline. Never invoked directly
__pycache__/             gitignored bytecode; no memory file, ever
```

## Traps

- **FP16 is not shipped and its status is self-contradictory in the record.** The authoring commit (8ab6d8c) says fp16 conversion fails on all five models (converter mis-retypes Cast/Concat/Transpose/Gather; dinov2 adds an unhandled SimplifiedLayerNormFusion node) and every broken variant was deleted — yet the same commit's inline comment in `quantize_fp16()` claims a clean `verify_all()` run with shape inference on. No `*_fp16.onnx` exists in `models/image/` today; int8 is the app's effective default (5968d2e). Treat fp16 as unproven until a run produces files that pass `verify_all("_fp16")`.
- **verify_all's dummy-tensor lesson**: dinov2 and siglip2 export fully symbolic input dims; substituting 1 for every non-int dim builds a 1-channel tensor and fails with a QLinearConv error that looks like a quantization bug but isn't. The check now uses each model's real crop size — keep it that way.
- int8 static quantization needs `--calibration-dir` with real images; it is forward-pass statistics only — no training, no labels.

## Key decisions — the splash corpus

- **DDragon over Community Dragon Raw, as a closed decision.** CDragon serves higher resolutions (4K for new champions down to ~720p for old) but the non-uniform resolution confounds cross-run search-quality comparison and the corpus balloons to 30-50GB; DDragon's uniform 1280×720 at ~3-4GB is the controlled test set. Filenames carry ground-truth content tags (`{Champion}_{SkinNumber}_{slug}.jpg`).
- The script always pulls the latest patch; to pin one (rare), edit the `versions[0]` line in `main()` to a literal like `"15.8.1"`. Existing skins are stable across patches; only additions change.
- Known-good semantic probes against this corpus: `cyberpunk`/`neon` → PROJECT and Pulsefire skins, `dark fantasy` → Darkin/Mordekaiser, `mecha` → Mecha and Battle Cast lines. Useful as a smoke test that encoders and fusion are alive.
