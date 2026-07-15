#!/usr/bin/env python3
"""
Mnemosyne — encoder weight quantization.

Produces lower-precision variants of every encoder ONNX model alongside the
FP32 originals in models/<modality>/, so the app can load whichever precision
the user has selected (see LYNCEUS_MODEL_PRECISION / settings.json) and the
originals stay on disk for A/B comparison. Never deletes or overwrites the
FP32 files — this script is purely additive.

Precisions:

    fp16   scripts/quantize_models.py --precision fp16
           A straight weight-precision cast (onnxconverter_common.float16),
           no calibration data needed. Near-zero accuracy risk for CLIP-
           family encoders; roughly halves file size and is a real CPU
           speedup on hardware with native fp16 paths.

    int8   scripts/quantize_models.py --precision int8
           Post-training STATIC quantization (onnxruntime.quantization,
           QDQ format), calibrated against a real sample of images from
           the corpus so the quantizer picks per-layer scale/zero-point
           from actual activation ranges rather than guessing. This is
           NOT fine-tuning or training — no gradients, no labels, just
           forward-pass statistics collection over the calibration set.
           Requires --calibration-dir pointing at a folder of real
           images (a few hundred is plenty).

Usage:
    python3 scripts/quantize_models.py --precision fp16
    python3 scripts/quantize_models.py --precision int8 \
        --calibration-dir "~/Documents/Splash Arts" --calibration-count 300

Output: for each source model.onnx, writes model_fp16.onnx or
model_int8.onnx next to it in the same models/<modality>/ directory.
Text encoders' companion tokenizer.json files are precision-independent
and are not touched.
"""

import argparse
import sys
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "image"

# (filename, kind) — kind picks the calibration input shape/dtype for INT8.
# "vision" models take a [1,3,H,W] float image tensor; "text" models take
# an int32/int64 token-id tensor, which static calibration doesn't usefully
# quantize the same way (text encoders quantize fine with dynamic
# quantization instead — see the --precision int8 branch below).
ENCODERS = [
    ("clip_vision.onnx", "vision", 224, "image"),
    ("clip_text.onnx", "text", None, "text"),
    ("dinov2_base_image.onnx", "vision", 224, "pixel_values"),
    ("siglip2_vision.onnx", "vision", 256, "pixel_values"),
    ("siglip2_text.onnx", "text", None, "input_ids"),
]


def quantize_fp16():
    import onnx
    from onnxconverter_common import float16

    for filename, kind, _size, _input_name in ENCODERS:
        src = MODELS_DIR / filename
        if not src.exists():
            print(f"skip {filename}: not found (run scripts/download_models.py first)")
            continue
        dst = src.with_name(src.stem + "_fp16.onnx")
        print(f"{filename} -> {dst.name} ...", end=" ", flush=True)
        model = onnx.load(str(src))
        # keep_io_types=True: input/output tensors stay float32 at the
        # graph boundary (so the Rust caller doesn't need dtype-aware
        # branching per precision) while internal weights/activations
        # run in fp16.
        #
        # disable_shape_infer=True (the first attempt at this script)
        # broke every single model with mixed float32/float16 type
        # errors at internal nodes (Concat, Add, Resize, Transpose,
        # Gather) — the converter needs the shape-inference pass to
        # correctly decide where to insert Cast nodes; skipping it
        # doesn't just skip an optimization, it produces an invalid
        # graph. Confirmed by reverting to shape inference on and
        # re-running verify_all() clean across all five models.
        #
        # Resize goes in op_block_list (stays fp32) because ONNX's
        # Resize op reads its `scales`/`sizes` operand as a graph
        # Constant that the converter's fp16 rewrite doesn't retype in
        # step with the op's own input — a documented interaction, not
        # specific to this project's graphs. DINOv2 and both vision
        # encoders use Resize during preprocessing-adjacent ops.
        block_list = float16.DEFAULT_OP_BLOCK_LIST + ["Resize"]
        model_fp16 = float16.convert_float_to_float16(
            model, keep_io_types=True, op_block_list=block_list
        )
        onnx.save(model_fp16, str(dst))
        size_before = src.stat().st_size / 1e6
        size_after = dst.stat().st_size / 1e6
        print(f"{size_before:.0f}MB -> {size_after:.0f}MB")

    verify_all("_fp16")


def quantize_int8(calibration_dir: Path, calibration_count: int):
    import numpy as np
    import onnx
    from onnxruntime.quantization import (
        CalibrationDataReader,
        QuantFormat,
        QuantType,
        quantize_dynamic,
        quantize_static,
    )
    from PIL import Image

    image_paths = sorted(
        p
        for p in calibration_dir.rglob("*")
        if p.suffix.lower() in (".jpg", ".jpeg", ".png")
    )[:calibration_count]
    if not image_paths:
        print(f"no images found under {calibration_dir}; aborting int8 pass")
        sys.exit(1)
    print(f"calibrating from {len(image_paths)} real images under {calibration_dir}")

    # CLIP-native preprocessing (mirrors encoder.rs::preprocess_image):
    # shortest-edge resize to `size`, center-crop, CLIP mean/std.
    def preprocess(path: Path, size: int) -> np.ndarray:
        img = Image.open(path).convert("RGB")
        w, h = img.size
        if w < h:
            new_w, new_h = size, round(h * size / w)
        else:
            new_h, new_w = size, round(w * size / h)
        img = img.resize((new_w, new_h), Image.BICUBIC)
        left = (new_w - size) // 2
        top = (new_h - size) // 2
        img = img.crop((left, top, left + size, top + size))
        arr = np.asarray(img).astype(np.float32) / 255.0
        mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
        std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
        arr = (arr - mean) / std
        return arr.transpose(2, 0, 1)[None, ...]  # NCHW, batch=1

    class ImageCalibrationReader(CalibrationDataReader):
        def __init__(self, paths, size, input_name):
            self._iter = iter(paths)
            self._size = size
            self._input_name = input_name

        def get_next(self):
            path = next(self._iter, None)
            if path is None:
                return None
            return {self._input_name: preprocess(path, self._size)}

    for filename, kind, size, input_name in ENCODERS:
        src = MODELS_DIR / filename
        if not src.exists():
            print(f"skip {filename}: not found")
            continue
        dst = src.with_name(src.stem + "_int8.onnx")
        print(f"{filename} -> {dst.name} ...", end=" ", flush=True)

        if kind == "vision":
            # Static, calibrated quantization — needs real forward-pass
            # activation statistics, not training. QDQ format keeps the
            # graph portable across ORT execution providers.
            reader = ImageCalibrationReader(image_paths, size, input_name)
            quantize_static(
                str(src),
                str(dst),
                reader,
                quant_format=QuantFormat.QDQ,
                weight_type=QuantType.QInt8,
                activation_type=QuantType.QInt8,
            )
        else:
            # Text encoders take integer token-id tensors, not a natural
            # fit for the same image-calibration reader. Dynamic
            # quantization (activation ranges computed per-inference
            # rather than pre-calibrated) is the standard fallback for
            # this input shape and still gives most of the weight-size
            # win; accuracy cost is the one place this script doesn't
            # match the "always calibrate" recommendation, called out
            # here rather than silently applied.
            quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)

        size_before = src.stat().st_size / 1e6
        size_after = dst.stat().st_size / 1e6
        print(f"{size_before:.0f}MB -> {size_after:.0f}MB")

    verify_all("_int8")


def verify_all(suffix: str):
    """Load every produced variant with a real onnxruntime session and run
    one dummy forward pass, so a broken conversion fails loudly here
    instead of silently inside the app."""
    import numpy as np
    import onnxruntime as ort

    print(f"\nVerifying {suffix} variants with a real ORT session...")
    all_ok = True
    for filename, kind, size, input_name in ENCODERS:
        path = MODELS_DIR / (Path(filename).stem + f"{suffix}.onnx")
        if not path.exists():
            continue
        try:
            sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            inp = sess.get_inputs()[0]
            if kind == "vision":
                # Don't trust declared dims blindly: dinov2 and siglip2
                # export with fully symbolic dims ('batch_size',
                # 'num_channels', 'height', 'width') rather than fixed
                # ints, so substituting 1 for every non-int dim (the
                # first version of this check) silently built a 1-
                # channel dummy tensor instead of 3-channel RGB and
                # failed with a QLinearConv channel-count error that
                # looked like a real quantization bug but wasn't one —
                # confirmed by inspecting the actual graph.input dims
                # with onnx.load() before assuming the model was broken.
                # `size` is this model's real, correct crop size.
                shape = [1, 3, size, size]
                dummy = np.zeros(shape, dtype=np.float32)
            else:
                shape = [d if isinstance(d, int) else 1 for d in inp.shape]
                dtype = np.int32 if "int32" in inp.type else np.int64
                dummy = np.zeros(shape, dtype=dtype)
            outputs = sess.run(None, {inp.name: dummy})
            print(f"  {path.name}: OK, output shapes {[o.shape for o in outputs]}")
        except Exception as e:  # noqa: BLE001 — report and keep checking the rest
            print(f"  {path.name}: FAILED — {e}")
            all_ok = False
    if not all_ok:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--precision", choices=["fp16", "int8"], required=True)
    parser.add_argument("--calibration-dir", type=Path, help="Folder of real images for int8 calibration")
    parser.add_argument("--calibration-count", type=int, default=300)
    args = parser.parse_args()

    if not MODELS_DIR.exists():
        print(f"{MODELS_DIR} not found — run scripts/download_models.py first")
        sys.exit(1)

    if args.precision == "fp16":
        quantize_fp16()
    else:
        if not args.calibration_dir:
            print("--precision int8 requires --calibration-dir")
            sys.exit(1)
        quantize_int8(args.calibration_dir.expanduser(), args.calibration_count)


if __name__ == "__main__":
    main()
